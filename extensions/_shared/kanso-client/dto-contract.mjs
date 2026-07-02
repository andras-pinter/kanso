/**
 * Hand-maintained mirror of the Rust DTO field names in
 * `crates/kanso-api/src/dto.rs`. This is the ground truth extension tool
 * schemas are contract-tested against, so agents can't file 400/422 requests
 * because a schema advertised a field the API silently ignores or rejects.
 *
 * Only lists request-body fields (the parts extensions send). Response DTOs
 * are richer but that's fine — extensions render whatever comes back.
 *
 * Keep in sync with dto.rs. If you change a DTO there, change this list too.
 */

export const DTO_CONTRACT = {
    // CreateBoardBody
    board_create: { required: ["name"], optional: [] },
    // BoardPatchDto — all optional; color is nullable (via double_option)
    board_update_patch: { required: [], optional: ["name", "color"] },

    // CreateColumnBody — position is server-assigned; NOT accepted here.
    column_create: { required: ["name"], optional: ["color"] },
    // ColumnPatchDto — no `position`; color is nullable.
    column_update_patch: { required: [], optional: ["name", "color"] },

    // CreateCardBody — title only. due_at/body_text land via card_update or card_body_set.
    card_create: { required: ["title"], optional: [] },
    // CardPatchDto — all optional; body_text + due_at nullable.
    // due_at is i64 Unix epoch milliseconds.
    card_update_patch: { required: [], optional: ["title", "body_text", "due_at"] },

    // CreateTagBody
    tag_create: { required: ["name"], optional: ["color"] },
    // TagPatchDto — color nullable.
    tag_update_patch: { required: [], optional: ["name", "color"] },
};

/**
 * Assert a schema's advertised field names exactly match the DTO contract.
 * Returns { ok: true } or { ok: false, extra: [...], missing: [...] }.
 *
 * @param {string[]} advertised — field names the tool's schema exposes
 * @param {{required: string[], optional: string[]}} dto — ground truth entry
 */
export const diffFields = (advertised, dto) => {
    const allowed = new Set([...dto.required, ...dto.optional]);
    const extra = advertised.filter((f) => !allowed.has(f));
    const missing = dto.required.filter((f) => !advertised.includes(f));
    return { ok: extra.length === 0 && missing.length === 0, extra, missing };
};
