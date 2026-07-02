/**
 * Extension-side view of the Rust request DTOs in
 * `crates/kanso-api/src/dto.rs`. Consumed by CLI + MCP tool-schema contract
 * tests to prevent tools from advertising fields the API rejects.
 *
 * `DTO_CONTRACT` is auto-generated from Rust via `cargo run -p dto-contract-gen`;
 * `just check` fails on drift. `diffFields` is pure JS logic and stays here.
 */

export { DTO_CONTRACT } from "./dto-contract.generated.mjs";

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
