/**
 * Resource-shape fetchers (read-only). Kept separate from `tools.mjs` because
 * MCP resources and tools are distinct surfaces — tools mutate, resources
 * just hand back snapshots. Each returns the parsed DTO on success and lets
 * the typed `KansoApiError` (with `.status`) bubble up so renderers can
 * branch on 404 vs 409.
 */

/** @typedef {{ get: (p: string) => Promise<any>, post: (p: string, b?: unknown) => Promise<any>, patch: (p: string, b?: unknown) => Promise<any> }} Client */

/**
 * `GET /boards/:id/_full?include_archived=...`. Returns the parsed BoardFullDto.
 * Throws KansoApiError on 404 (board missing) or 409 (board exceeds 1000-card cap).
 *
 * @param {Client} client
 * @param {{ id: string, includeArchived?: boolean }} args
 */
export const boardFull = async (client, { id, includeArchived = false }) => {
    if (!id) throw new Error("kanso: id is required");
    const q = includeArchived ? "?include_archived=true" : "";
    return client.get(`/boards/${encodeURIComponent(id)}/_full${q}`);
};

/**
 * `GET /cards/:id`. Returns the parsed CardDto. Throws KansoApiError on 404.
 *
 * @param {Client} client
 * @param {{ id: string }} args
 */
export const cardGet = async (client, { id }) => {
    if (!id) throw new Error("kanso: id is required");
    return client.get(`/cards/${encodeURIComponent(id)}`);
};
