/**
 * Tool handlers. Each is a pure async function `(client, args) => string` so
 * tests can inject a fake client. The string returned is what the model sees.
 */

/** @typedef {{ get: (p: string) => Promise<any>, post: (p: string, b?: unknown) => Promise<any>, patch: (p: string, b?: unknown) => Promise<any>, delete: (p: string) => Promise<any> }} Client */

const SEARCH_DEFAULT = 20;
const SEARCH_MAX = 50;

/**
 * @param {Client} client
 * @param {{ board_id?: string, column_id?: string }} args
 */
export const kansoList = async (client, args) => {
    if (args.column_id !== undefined && args.column_id !== "") {
        const cards = await client.get(`/columns/${encodeURIComponent(args.column_id)}/cards`);
        if (!Array.isArray(cards) || cards.length === 0) return "kanso: no cards in column";
        const lines = cards.map((c) => {
            const notes = c.has_body ? "  (has notes)" : "";
            return `- ${c.id}  ${c.title}${notes}`;
        });
        return lines.join("\n");
    }

    if (args.board_id !== undefined && args.board_id !== "") {
        const cols = await client.get(`/boards/${encodeURIComponent(args.board_id)}/columns`);
        if (!Array.isArray(cols) || cols.length === 0) return "kanso: no columns on board";
        // For each column include the card count. limit=500 matches the API
        // cap; render `500+` when saturated so the user knows there are more.
        // One round-trip per column is fine — there are exactly 4.
        const lines = await Promise.all(
            cols.map(async (c) => {
                const cards = await client.get(
                    `/columns/${encodeURIComponent(c.id)}/cards?limit=500`,
                );
                const n = Array.isArray(cards) ? cards.length : 0;
                const display = n >= 500 ? "500+" : `${n}`;
                return `- ${c.id}  ${c.name}  (${display} card${n === 1 ? "" : "s"})`;
            }),
        );
        return lines.join("\n");
    }

    const boards = await client.get(`/boards`);
    if (!Array.isArray(boards) || boards.length === 0) return "kanso: no boards";
    return boards.map((b) => `- ${b.id}  ${b.name}`).join("\n");
};

/**
 * Create a card. If `body` is provided this is two API calls: POST to create
 * the card, then PATCH to set `body_markdown`. If the PATCH fails (transient
 * network blip), the titled card persists — there is no atomic create-with-body
 * endpoint yet. The body-size preflight below short-circuits the 413 case so
 * we don't strand a card on the most common partial-failure path.
 *
 * @param {Client} client
 * @param {{ column_id: string, title: string, body?: string }} args
 */
export const kansoAdd = async (client, args) => {
    if (!args?.column_id) throw new Error("kanso: column_id is required");
    if (!args?.title || args.title.trim() === "") throw new Error("kanso: title is required");

    if (args.body !== undefined && args.body !== "") {
        // 900 KiB leaves headroom for the JSON envelope under the API's 1 MiB
        // outer body limit; reject locally so we don't POST-then-PATCH-then-fail.
        const bytes = Buffer.byteLength(JSON.stringify({ body_markdown: args.body }), "utf8");
        const MAX = 900 * 1024;
        if (bytes > MAX) {
            throw new Error(`kanso: body is ${bytes} bytes, exceeds ${MAX} byte limit`);
        }
    }

    const card = await client.post(
        `/columns/${encodeURIComponent(args.column_id)}/cards`,
        { title: args.title.trim() },
    );

    if (args.body !== undefined && args.body !== "") {
        await client.patch(`/cards/${encodeURIComponent(card.id)}`, { body_markdown: args.body });
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
 * Hard-delete a card. Archive/soft-delete is gone; done means gone.
 *
 * @param {Client} client
 * @param {{ card_id: string }} args
 */
export const kansoDone = async (client, args) => {
    if (!args?.card_id) throw new Error("kanso: card_id is required");
    await client.delete(`/cards/${encodeURIComponent(args.card_id)}`);
    return `kanso: deleted card ${args.card_id}`;
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
            const notes = h.card?.has_body ? "  (has notes)" : " (no body)";
            return `- ${h.card.id}  ${h.card.title}\n    board: ${h.board_name}  ·  column: ${h.column_name}${notes}`;
        })
        .join("\n");
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
