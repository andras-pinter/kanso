/**
 * Pure markdown renderers for kanso MCP resources. Kept separate from the
 * server wiring so they're trivially unit-testable.
 *
 * All renderers return a single markdown string. Yjs body excerpts are
 * extracted via the lazy `extractBodyExcerpt` helper and capped at 500 chars.
 */

import * as Y from "yjs";

const EXCERPT_MAX_CHARS = 500;

/**
 * @typedef {Object} BoardListEntry
 * @property {string} id
 * @property {string} name
 * @property {number} [archived_at]
 */

/**
 * @typedef {Object} BoardListEntryEnriched
 * @property {string} id
 * @property {string} name
 * @property {number} columns
 * @property {number} cards
 * @property {boolean} [truncated]
 */

/**
 * Boards index. The caller fetches `/boards` and (optionally) per-board
 * column/card counts; we just format whatever shape they provide.
 *
 * @param {{ boards: BoardListEntryEnriched[], truncated?: boolean }} dto
 * @returns {string}
 */
export const renderBoardsIndex = ({ boards, truncated = false }) => {
    const lines = ["# Kanso boards", ""];
    if (boards.length === 0) {
        lines.push("_No boards._");
        return lines.join("\n");
    }
    lines.push("| id | name | columns | cards |", "|----|------|---------|-------|");
    for (const b of boards) {
        const name = b.name.replace(/\|/g, "\\|");
        lines.push(`| ${b.id} | ${name} | ${b.columns} | ${b.cards} |`);
    }
    if (truncated) {
        lines.push("", "_500+ boards; showing first 500._");
    }
    return lines.join("\n");
};

/**
 * Single board snapshot. Input is the `BoardFullDto` straight off the wire.
 *
 * Archived columns/cards are already filtered server-side when
 * `include_archived=false`. Tags listed at the top dedupe to those actually
 * referenced by at least one visible card.
 *
 * @param {any} dto BoardFullDto
 * @returns {string}
 */
export const renderBoardSnapshot = (dto) => {
    const board = dto.board ?? {};
    const tags = Array.isArray(dto.tags) ? dto.tags : [];
    const columns = Array.isArray(dto.columns) ? dto.columns : [];
    const tagById = new Map(tags.map((t) => [t.id, t]));

    const lines = [`# Board: ${board.name ?? "(unnamed)"}`];

    if (tags.length > 0) {
        const names = tags.map((t) => `\`${t.name}\``).join(", ");
        lines.push("", `Tags: ${names}`);
    }

    if (columns.length === 0) {
        lines.push("", "_No columns._");
        return lines.join("\n");
    }

    for (const col of columns) {
        const colMeta = col.column ?? {};
        const cards = Array.isArray(col.cards) ? col.cards : [];
        lines.push("", `## ${colMeta.name ?? "(unnamed column)"} (${cards.length} card${cards.length === 1 ? "" : "s"})`);
        if (cards.length === 0) {
            lines.push("_(empty)_");
            continue;
        }
        for (const cwt of cards) {
            lines.push(renderCardLine(cwt.card ?? {}, cwt.tag_ids ?? [], tagById));
        }
    }

    return lines.join("\n");
};

/**
 * @param {any} card CardDto
 * @param {string[]} tagIds
 * @param {Map<string, { name: string }>} tagById
 * @returns {string}
 */
const renderCardLine = (card, tagIds, tagById) => {
    const title = card.title ?? "(untitled)";
    const tagPart =
        tagIds.length > 0
            ? " " +
              tagIds
                  .map((id) => tagById.get(id))
                  .filter(Boolean)
                  .map((t) => `[#${t.name}]`)
                  .join(" ")
            : "";
    const duePart = formatDue(card.due_at);
    const head = `- **${title}**${tagPart}${duePart}`;
    const excerpt = excerptFromBodyText(card.body_text);
    return excerpt ? `${head}\n  ${excerpt}` : head;
};

/**
 * Render a single CardDto (the `cards/{id}` resource).
 *
 * @param {{ card: any, column?: any, board?: any, tags?: any[] }} args
 * @returns {string}
 */
export const renderCard = ({ card, column, board, tags = [] }) => {
    const lines = [`# Card: ${card.title ?? "(untitled)"}`];

    const meta = [];
    if (board?.name) meta.push(`Board: **${board.name}**`);
    if (column?.name) meta.push(`Column: **${column.name}**`);
    else if (card.column_id) meta.push(`Column id: \`${card.column_id}\``);
    if (card.due_at !== null && card.due_at !== undefined) {
        meta.push(`Due: ${formatIsoFromMs(card.due_at)}`);
    }
    if (card.archived_at) {
        meta.push("**[archived]**");
    }
    if (meta.length > 0) {
        lines.push("", meta.join("  ·  "));
    }

    if (tags.length > 0) {
        lines.push("", `Tags: ${tags.map((t) => `\`${t.name}\``).join(", ")}`);
    }

    lines.push("", "## Body");
    const excerpt = excerptFromBodyText(card.body_text);
    if (excerpt) {
        lines.push(excerpt);
    } else {
        lines.push("_(empty)_");
    }
    return lines.join("\n");
};

/**
 * @param {number | null | undefined} ms
 * @returns {string}
 */
const formatDue = (ms) => {
    if (ms === null || ms === undefined) return "";
    return ` — due ${formatIsoFromMs(ms)}`;
};

/**
 * Format an epoch-ms timestamp as YYYY-MM-DD (UTC). The desktop app stores
 * `due_at` as epoch ms; we render UTC date-only so the snapshot doesn't drift
 * across host timezones.
 *
 * @param {number} ms
 * @returns {string}
 */
const formatIsoFromMs = (ms) => {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return String(ms);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
};

/**
 * Take a `body_text` plaintext string and return a normalized excerpt.
 * The API already maintains `body_text` as the Yjs doc's plaintext mirror —
 * we don't need to parse the Yjs blob ourselves for the v1 renderer.
 *
 * @param {string | null | undefined} text
 * @returns {string}
 */
const excerptFromBodyText = (text) => {
    if (typeof text !== "string") return "";
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (trimmed === "") return "";
    if (trimmed.length <= EXCERPT_MAX_CHARS) return trimmed;
    return trimmed.slice(0, EXCERPT_MAX_CHARS - 1) + "…";
};

/**
 * Decode a base64 Yjs document update and extract its plaintext. The body
 * blob is a Yjs YDoc state vector encoding; we apply it to a fresh doc and
 * walk its top-level shared types pulling any YText content out. Failures
 * (corrupt blob, unknown shape) return `""`.
 *
 * Exposed for tests and for callers that want to render from a raw blob
 * instead of relying on the API's `body_text` mirror.
 *
 * @param {string | null | undefined} base64
 * @returns {string}
 */
export const extractTextFromYjsBlob = (base64) => {
    if (typeof base64 !== "string" || base64 === "") return "";
    try {
        const buf = Buffer.from(base64, "base64");
        const doc = new Y.Doc();
        Y.applyUpdate(doc, new Uint8Array(buf));
        const parts = [];
        doc.share.forEach((value) => {
            collectText(value, parts);
        });
        return parts.join(" ").replace(/\s+/g, " ").trim();
    } catch {
        return "";
    }
};

/**
 * Walk a Y.AbstractType subtree, pushing every text item into `out`.
 *
 * Yjs applies updates lazily — if a fresh `Doc` receives an update for a
 * type that was never explicitly bound (e.g. via `doc.getText('body')`),
 * the share entry is a generic `AbstractType` whose runtime class is *not*
 * `Y.Text`. We work around that by traversing the underlying `_start` linked
 * list of CRDT items and pulling out any `ContentString`/`ContentEmbed` payloads
 * directly; we recurse into `ContentType` items for nested structures.
 *
 * @param {any} node
 * @param {string[]} out
 */
const collectText = (node, out) => {
    if (!node || typeof node !== "object") return;
    let item = node._start;
    while (item) {
        const content = item.content;
        if (content?.str !== undefined) {
            out.push(String(content.str));
        } else if (typeof content?.getContent === "function") {
            // ContentEmbed and friends — only collect string-y values.
            try {
                const arr = content.getContent();
                if (Array.isArray(arr) && arr.every((c) => typeof c === "string")) {
                    out.push(arr.join(""));
                }
            } catch {
                /* skip */
            }
        }
        if (content?.type) collectText(content.type, out);
        item = item.right;
    }
    // YMap stores children in a Map keyed by string, not on `_start`.
    if (node._map && typeof node._map.forEach === "function") {
        node._map.forEach((mapItem) => {
            if (!mapItem || mapItem.deleted) return;
            const c = mapItem.content;
            if (c?.str !== undefined) out.push(String(c.str));
            if (c?.type) collectText(c.type, out);
        });
    }
};

/**
 * Exported for testing.
 * @internal
 */
export const _EXCERPT_MAX_CHARS = EXCERPT_MAX_CHARS;
