/**
 * Tool handlers. Each is a pure async function `(client, args) => string` so
 * tests can inject a fake client. The string returned is what the model sees.
 */

/** @typedef {{ get: (p: string) => Promise<any>, post: (p: string, b?: unknown) => Promise<any>, patch: (p: string, b?: unknown) => Promise<any> }} Client */

const SEARCH_DEFAULT = 20;
const SEARCH_MAX = 50;

/**
 * @param {Client} client
 * @param {{ board_id?: string, column_id?: string, include_archived?: boolean }} args
 */
export const kansoList = async (client, args) => {
    const includeArchived = args.include_archived === true;
    const q = includeArchived ? "?include_archived=true" : "";

    if (args.column_id !== undefined && args.column_id !== "") {
        const cards = await client.get(`/columns/${encodeURIComponent(args.column_id)}/cards${q}`);
        if (!Array.isArray(cards) || cards.length === 0) return "kanso: no cards in column";
        const lines = cards.map((c) => {
            const preview = bodyPreview(c.body_text);
            const flag = c.archived_at ? " [archived]" : "";
            return `- ${c.id}  ${c.title}${flag}${preview}`;
        });
        return lines.join("\n");
    }

    if (args.board_id !== undefined && args.board_id !== "") {
        const cols = await client.get(`/boards/${encodeURIComponent(args.board_id)}/columns${q}`);
        if (!Array.isArray(cols) || cols.length === 0) return "kanso: no columns on board";
        // For each column include the (non-archived) card count. One round-trip
        // per column is fine — there are rarely more than ~10 columns.
        const lines = await Promise.all(
            cols.map(async (c) => {
                const cards = await client.get(`/columns/${encodeURIComponent(c.id)}/cards`);
                const count = Array.isArray(cards) ? cards.length : 0;
                const flag = c.archived_at ? " [archived]" : "";
                return `- ${c.id}  ${c.name}  (${count} card${count === 1 ? "" : "s"})${flag}`;
            }),
        );
        return lines.join("\n");
    }

    const boards = await client.get(`/boards${q}`);
    if (!Array.isArray(boards) || boards.length === 0) return "kanso: no boards";
    return boards
        .map((b) => `- ${b.id}  ${b.name}${b.archived_at ? " [archived]" : ""}`)
        .join("\n");
};

/**
 * @param {Client} client
 * @param {{ column_id: string, title: string, body?: string }} args
 */
export const kansoAdd = async (client, args) => {
    if (!args?.column_id) throw new Error("kanso: column_id is required");
    if (!args?.title || args.title.trim() === "") throw new Error("kanso: title is required");

    const card = await client.post(
        `/columns/${encodeURIComponent(args.column_id)}/cards`,
        { title: args.title.trim() },
    );

    if (args.body !== undefined && args.body !== "") {
        await client.patch(`/cards/${encodeURIComponent(card.id)}`, { body_text: args.body });
    }
    return `kanso: created card ${card.id} "${card.title}"`;
};

/**
 * @param {Client} client
 * @param {{ card_id: string, target_column_id: string }} args
 */
export const kansoMove = async (client, args) => {
    if (!args?.card_id) throw new Error("kanso: card_id is required");
    if (!args?.target_column_id) throw new Error("kanso: target_column_id is required");

    // Omitting before+after appends to the end of the target column — see
    // crates/kanso-core/src/repo/card.rs::move_card. One round-trip.
    const card = await client.post(
        `/cards/${encodeURIComponent(args.card_id)}/move`,
        { target_column_id: args.target_column_id },
    );
    return `kanso: moved card ${card.id} to column ${card.column_id}`;
};

/**
 * @param {Client} client
 * @param {{ card_id: string }} args
 */
export const kansoDone = async (client, args) => {
    if (!args?.card_id) throw new Error("kanso: card_id is required");
    await client.post(`/cards/${encodeURIComponent(args.card_id)}/archive`);
    return `kanso: archived card ${args.card_id}`;
};

/**
 * @param {Client} client
 * @param {{ q: string, limit?: number }} args
 */
export const kansoSearch = async (client, args) => {
    const q = (args?.q ?? "").trim();
    if (q === "") throw new Error("kanso: q is required");
    const limit = clampLimit(args?.limit, SEARCH_DEFAULT, SEARCH_MAX);

    const hits = await client.get(
        `/cards/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    );
    if (!Array.isArray(hits) || hits.length === 0) return `kanso: no hits for "${q}"`;
    return hits
        .map((h) => {
            const snippet = bodyPreview(h.card?.body_text) || " (no body)";
            return `- ${h.card.id}  ${h.card.title}\n    board: ${h.board_name}  ·  column: ${h.column_name}${snippet}`;
        })
        .join("\n");
};

/**
 * @param {string | null | undefined} text
 * @returns {string}
 */
const bodyPreview = (text) => {
    if (typeof text !== "string") return "";
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (trimmed === "") return "";
    const clipped = trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
    return `\n    ${clipped}`;
};

/**
 * @param {unknown} raw
 * @param {number} fallback
 * @param {number} max
 */
const clampLimit = (raw, fallback, max) => {
    const n = typeof raw === "number" ? Math.trunc(raw) : Number.parseInt(String(raw ?? ""), 10);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(n, max);
};
