/**
 * MCP server wiring for kanso. Built as a factory so tests can inject a fake
 * `@kanso/client` and drive the server over `InMemoryTransport` instead of a
 * real subprocess + HTTP loop.
 *
 * Tools mirror the Copilot CLI extension verbatim — same names, same input
 * shapes, same string returns. Resources are the new surface: `kanso://boards`
 * (index), `kanso://boards/{id}` (snapshot), `kanso://cards/{id}` (single card).
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
    boardFull,
    cardGet,
    KansoApiError,
    kansoAdd,
    kansoDone,
    kansoList,
    kansoMove,
    kansoSearch,
} from "@kanso/client";
import { z } from "zod";

import {
    renderBoardSnapshot,
    renderBoardsIndex,
    renderCard,
} from "./render.mjs";

const BOARDS_INDEX_URI = "kanso://boards";
const BOARD_TEMPLATE = "kanso://boards/{id}";
const CARD_TEMPLATE = "kanso://cards/{id}";
const MIME = "text/markdown";

const BOARD_INDEX_LIMIT = 500;
const PER_BOARD_CARD_COUNT_LIMIT = 1000;

/**
 * @typedef {Object} ServerDeps
 * @property {import("@kanso/client").createClient extends (...a: any) => infer R ? R : never} client
 * @property {string} [name]
 * @property {string} [version]
 */

/**
 * Wrap a tool handler so handled errors (kanso-prefixed Error messages and
 * KansoApiError instances) become a clean `isError: true` result, while
 * unexpected throws still propagate to the SDK as protocol errors.
 *
 * @template T
 * @param {(client: any, args: T) => Promise<string>} fn
 * @param {any} client
 */
const toolWrap = (fn, client) => async (/** @type {T} */ args) => {
    try {
        const text = await fn(client, args);
        return { content: [{ type: "text", text }] };
    } catch (err) {
        const isHandled =
            err instanceof KansoApiError ||
            (err instanceof Error && err.message.startsWith("kanso:"));
        if (!isHandled) throw err;
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(
            `[kanso-mcp] ${err instanceof Error && err.stack ? err.stack : message}\n`,
        );
        return { content: [{ type: "text", text: message }], isError: true };
    }
};

/**
 * Build the kanso boards index resource — a markdown table of all boards with
 * per-board column and card counts. Counts are derived from `/boards` (board
 * names) and `/boards/:id/columns` + `/columns/:id/cards`. Concurrency is
 * bounded by Promise.all over the (small) board list; if there are >500 boards
 * we cap at 500 and append a truncation note.
 *
 * @param {any} client
 */
const buildBoardsIndex = async (client) => {
    const boards = await client.get(`/boards?limit=${BOARD_INDEX_LIMIT}`);
    const list = Array.isArray(boards) ? boards : [];
    const enriched = await Promise.all(
        list.map(async (b) => {
            try {
                const cols = await client.get(
                    `/boards/${encodeURIComponent(b.id)}/columns?limit=${PER_BOARD_CARD_COUNT_LIMIT}`,
                );
                const colList = Array.isArray(cols) ? cols : [];
                const cardCounts = await Promise.all(
                    colList.map(async (c) => {
                        const cards = await client.get(
                            `/columns/${encodeURIComponent(c.id)}/cards?limit=${PER_BOARD_CARD_COUNT_LIMIT}`,
                        );
                        return Array.isArray(cards) ? cards.length : 0;
                    }),
                );
                return {
                    id: b.id,
                    name: b.name ?? "(unnamed)",
                    columns: colList.length,
                    cards: cardCounts.reduce((s, n) => s + n, 0),
                };
            } catch {
                // A board we can't enumerate (perms, transient db) should still
                // show up in the index — counts collapse to `?`.
                return { id: b.id, name: b.name ?? "(unnamed)", columns: 0, cards: 0 };
            }
        }),
    );
    return renderBoardsIndex({
        boards: enriched,
        truncated: list.length >= BOARD_INDEX_LIMIT,
    });
};

/**
 * @param {any} client
 * @param {string} id
 */
const buildBoardSnapshot = async (client, id) => {
    try {
        const dto = await boardFull(client, { id, includeArchived: false });
        return renderBoardSnapshot(dto);
    } catch (err) {
        if (err instanceof KansoApiError && err.status === 404) {
            return `_Board ${id} not found._`;
        }
        if (err instanceof KansoApiError && err.status === 409) {
            return "_Board too large to render as a snapshot (>1000 cards). Use the `kanso_list` tool or per-column endpoints._";
        }
        throw err;
    }
};

/**
 * @param {any} client
 * @param {string} id
 */
const buildCardSnapshot = async (client, id) => {
    let card;
    try {
        card = await cardGet(client, { id });
    } catch (err) {
        if (err instanceof KansoApiError && err.status === 404) {
            return `_Card ${id} not found._`;
        }
        throw err;
    }
    // Tag list is the only cheap parent context we can resolve without a
    // GET /columns/:id or GET /boards/:id endpoint. Column/board names are
    // skipped on purpose; the column_id on the card is still rendered as a
    // raw id for users that need it.
    let tags = [];
    try {
        tags = await client.get(`/cards/${encodeURIComponent(id)}/tags`);
        if (!Array.isArray(tags)) tags = [];
    } catch {
        tags = [];
    }
    return renderCard({ card, tags });
};

/**
 * Enumerate `kanso://boards/{id}` instances so hosts that support resource
 * autocompletion can offer "@kanso://boards/<board-id>" suggestions.
 *
 * @param {any} client
 */
const listBoardResources = async (client) => {
    try {
        const boards = await client.get(`/boards?limit=${BOARD_INDEX_LIMIT}`);
        const list = Array.isArray(boards) ? boards : [];
        return {
            resources: list.map((b) => ({
                uri: `kanso://boards/${b.id}`,
                name: `kanso board: ${b.name ?? b.id}`,
                mimeType: MIME,
                description: `Snapshot of board "${b.name ?? b.id}" with columns, cards, tags.`,
            })),
        };
    } catch {
        return { resources: [] };
    }
};

/**
 * Construct an `McpServer` and register every tool + resource. The caller is
 * responsible for `connect(transport)`.
 *
 * @param {ServerDeps} deps
 */
export const createKansoMcpServer = ({ client, name = "kanso-mcp", version = "0.1.0" }) => {
    const server = new McpServer({ name, version });

    // ---------- Tools (mirror the CLI extension) ----------

    server.registerTool(
        "kanso_list",
        {
            description:
                "List kanso boards, columns, or cards. With no args: list boards. With board_id: list columns. With column_id: list cards.",
            inputSchema: {
                board_id: z.string().optional().describe("List columns on this board."),
                column_id: z.string().optional().describe("List cards in this column."),
                include_archived: z
                    .boolean()
                    .optional()
                    .describe("Include archived rows. Default false."),
            },
        },
        toolWrap(kansoList, client),
    );

    server.registerTool(
        "kanso_add",
        {
            description: "Create a new kanso card in the given column.",
            inputSchema: {
                column_id: z.string().describe("Target column id."),
                title: z.string().describe("Card title."),
                body: z
                    .string()
                    .optional()
                    .describe(
                        "Optional plaintext body. Stored as body_text; the BlockSuite Yjs body remains empty until edited in the app.",
                    ),
            },
        },
        toolWrap(kansoAdd, client),
    );

    server.registerTool(
        "kanso_move",
        {
            description:
                "Move a kanso card to another column. Appends to the end of the target column.",
            inputSchema: {
                card_id: z.string().describe("Card id to move."),
                target_column_id: z.string().describe("Destination column id."),
            },
        },
        toolWrap(kansoMove, client),
    );

    server.registerTool(
        "kanso_done",
        {
            description: "Archive a kanso card (soft delete, sets archived_at).",
            inputSchema: {
                card_id: z.string().describe("Card id to archive."),
            },
        },
        toolWrap(kansoDone, client),
    );

    server.registerTool(
        "kanso_search",
        {
            description: "Full-text search across kanso cards.",
            inputSchema: {
                q: z.string().describe("Search query (FTS5)."),
                limit: z
                    .number()
                    .optional()
                    .describe("Max hits to return. Default 20, max 50."),
            },
        },
        toolWrap(kansoSearch, client),
    );

    // ---------- Resources ----------

    server.registerResource(
        "kanso_boards_index",
        BOARDS_INDEX_URI,
        {
            title: "kanso boards",
            description: "All boards (id, name, column count, card count).",
            mimeType: MIME,
        },
        async (uri) => {
            const text = await buildBoardsIndex(client);
            return { contents: [{ uri: uri.href, mimeType: MIME, text }] };
        },
    );

    server.registerResource(
        "kanso_board_snapshot",
        new ResourceTemplate(BOARD_TEMPLATE, {
            list: async () => listBoardResources(client),
        }),
        {
            title: "kanso board snapshot",
            description: "Full snapshot of a single board (columns, cards, tags).",
            mimeType: MIME,
        },
        async (uri, vars) => {
            const id = Array.isArray(vars.id) ? vars.id[0] : vars.id;
            const text = await buildBoardSnapshot(client, String(id));
            return { contents: [{ uri: uri.href, mimeType: MIME, text }] };
        },
    );

    server.registerResource(
        "kanso_card",
        new ResourceTemplate(CARD_TEMPLATE, { list: undefined }),
        {
            title: "kanso card",
            description: "Single card with body excerpt, due date, tags, and context.",
            mimeType: MIME,
        },
        async (uri, vars) => {
            const id = Array.isArray(vars.id) ? vars.id[0] : vars.id;
            const text = await buildCardSnapshot(client, String(id));
            return { contents: [{ uri: uri.href, mimeType: MIME, text }] };
        },
    );

    return server;
};

// Exposed for tests.
export { buildBoardSnapshot, buildBoardsIndex, buildCardSnapshot };
