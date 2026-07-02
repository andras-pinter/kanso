/**
 * Typed CRUD helpers per resource family. Each helper is a small wrapper
 * around one HTTP call. Mutations return the affected resource so agents
 * can chain writes without a follow-up GET (see docs/agent-surface.md and
 * the Phase 4b contract).
 */

/** @typedef {{
 *   get: (p: string) => Promise<any>,
 *   post: (p: string, b?: unknown) => Promise<any>,
 *   patch: (p: string, b?: unknown) => Promise<any>,
 *   put: (p: string, b?: unknown) => Promise<any>,
 *   delete: (p: string) => Promise<any>,
 * }} Client
 */

const enc = encodeURIComponent;

const pageQuery = ({ limit, offset } = {}) => {
    const parts = [];
    if (typeof limit === "number") parts.push(`limit=${Math.trunc(limit)}`);
    if (typeof offset === "number") parts.push(`offset=${Math.trunc(offset)}`);
    return parts.length ? `?${parts.join("&")}` : "";
};

const requireId = (id, label = "id") => {
    if (typeof id !== "string" || id === "") throw new Error(`kanso: ${label} is required`);
};

// ---------- boards ----------

/** @param {Client} c */
export const boardList = (c, opts) => c.get(`/boards${pageQuery(opts)}`);

/** @param {Client} c */
export const boardGet = (c, { id }) => {
    requireId(id);
    return c.get(`/boards/${enc(id)}`);
};

/** @param {Client} c */
export const boardCreate = (c, { name }) => {
    if (typeof name !== "string" || name.trim() === "") {
        throw new Error("kanso: name is required");
    }
    return c.post(`/boards`, { name: name.trim() });
};

/** @param {Client} c */
export const boardUpdate = (c, { id, patch }) => {
    requireId(id);
    return c.patch(`/boards/${enc(id)}`, patch ?? {});
};

/** @param {Client} c */
export const boardDelete = (c, { id }) => {
    requireId(id);
    return c.delete(`/boards/${enc(id)}`);
};

/** @param {Client} c */
export const boardCardTags = (c, { id }) => {
    requireId(id);
    return c.get(`/boards/${enc(id)}/card_tags`);
};

// ---------- columns ----------
//
// Columns are fixed (Incoming / Todo / In Progress / Done) and seeded by the
// server on board create. Only a read helper is exposed.

/** @param {Client} c */
export const columnList = (c, { board_id, ...opts } = {}) => {
    requireId(board_id, "board_id");
    return c.get(`/boards/${enc(board_id)}/columns${pageQuery(opts)}`);
};

// ---------- cards ----------

/** @param {Client} c */
export const cardList = (c, { column_id, ...opts } = {}) => {
    requireId(column_id, "column_id");
    return c.get(`/columns/${enc(column_id)}/cards${pageQuery(opts)}`);
};

/** @param {Client} c */
export const cardGet = (c, { id }) => {
    requireId(id);
    return c.get(`/cards/${enc(id)}`);
};

/** @param {Client} c */
export const cardCreate = (c, { column_id, title }) => {
    requireId(column_id, "column_id");
    if (typeof title !== "string" || title.trim() === "") {
        throw new Error("kanso: title is required");
    }
    return c.post(`/columns/${enc(column_id)}/cards`, { title: title.trim() });
};

/** @param {Client} c */
export const cardUpdate = (c, { id, patch }) => {
    requireId(id);
    return c.patch(`/cards/${enc(id)}`, patch ?? {});
};

/** @param {Client} c */
export const cardMove = (c, { id, target_column_id, before, after }) => {
    requireId(id);
    requireId(target_column_id, "target_column_id");
    const body = { target_column_id };
    if (before !== undefined) body.before = before;
    if (after !== undefined) body.after = after;
    return c.post(`/cards/${enc(id)}/move`, body);
};

/** @param {Client} c */
export const cardDelete = (c, { id }) => {
    requireId(id);
    return c.delete(`/cards/${enc(id)}`);
};

/** @param {Client} c */
export const cardBodyGet = (c, { id }) => {
    requireId(id);
    return c.get(`/cards/${enc(id)}/body`);
};

/**
 * Set a card body. At least one of `body_blocksuite_b64` or `body_text` must
 * be provided; the other clears to NULL. Text-only calls let agents write
 * plaintext without synthesizing a BlockSuite Yjs blob — the UI seeds a
 * fresh editor from the plaintext on next open. Returns the full CardDto.
 *
 * @param {Client} c
 */
export const cardBodySet = (c, { id, body_blocksuite_b64, body_text }) => {
    requireId(id);
    if (body_blocksuite_b64 === undefined && body_text === undefined) {
        throw new Error("kanso: at least one of body_blocksuite_b64 or body_text is required");
    }
    const body = {};
    if (body_blocksuite_b64 !== undefined) body.body_blocksuite_b64 = body_blocksuite_b64;
    if (body_text !== undefined) body.body_text = body_text;
    return c.put(`/cards/${enc(id)}/body`, body);
};

// ---------- tags ----------

/** @param {Client} c */
export const tagList = (c, opts) => c.get(`/tags${pageQuery(opts)}`);

/** @param {Client} c */
export const tagGet = (c, { id }) => {
    requireId(id);
    return c.get(`/tags/${enc(id)}`);
};

/** @param {Client} c */
export const tagCreate = (c, { name, color }) => {
    if (typeof name !== "string" || name.trim() === "") {
        throw new Error("kanso: name is required");
    }
    const body = { name: name.trim() };
    if (color !== undefined) body.color = color;
    return c.post(`/tags`, body);
};

/** @param {Client} c */
export const tagUpdate = (c, { id, patch }) => {
    requireId(id);
    return c.patch(`/tags/${enc(id)}`, patch ?? {});
};

/** @param {Client} c */
export const tagDelete = (c, { id }) => {
    requireId(id);
    return c.delete(`/tags/${enc(id)}`);
};

/** @param {Client} c */
export const tagCards = (c, { id, ...opts }) => {
    requireId(id);
    return c.get(`/tags/${enc(id)}/cards${pageQuery(opts)}`);
};

/** @param {Client} c */
export const cardTags = (c, { card_id, ...opts }) => {
    requireId(card_id, "card_id");
    return c.get(`/cards/${enc(card_id)}/tags${pageQuery(opts)}`);
};

/** @param {Client} c */
export const cardTagAdd = (c, { card_id, tag_id }) => {
    requireId(card_id, "card_id");
    requireId(tag_id, "tag_id");
    return c.post(`/cards/${enc(card_id)}/tags/${enc(tag_id)}`);
};

/** @param {Client} c */
export const cardTagRemove = (c, { card_id, tag_id }) => {
    requireId(card_id, "card_id");
    requireId(tag_id, "tag_id");
    return c.delete(`/cards/${enc(card_id)}/tags/${enc(tag_id)}`);
};

// ---------- search ----------

/** @param {Client} c */
export const cardSearch = (c, { q, limit, offset } = {}) => {
    if (typeof q !== "string" || q.trim() === "") throw new Error("kanso: q is required");
    const parts = [`q=${enc(q.trim())}`];
    if (typeof limit === "number") parts.push(`limit=${Math.trunc(limit)}`);
    if (typeof offset === "number") parts.push(`offset=${Math.trunc(offset)}`);
    return c.get(`/cards/search?${parts.join("&")}`);
};
