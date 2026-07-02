/**
 * Contract tests: assert that each CLI tool's advertised inputSchema matches
 * the Rust DTO shape it will POST/PATCH to. Guards against schema drift like
 * the one that shipped in Phase 4b (position on column_create, `description`
 * on card_update, string-typed due_at).
 *
 * Ground truth lives in @kanso/client/dto-contract; that re-exports
 * DTO_CONTRACT from dto-contract.generated.mjs, which `cargo run -p
 * dto-contract-gen` generates from `crates/kanso-api/src/dto.rs`. If a DTO
 * changes there, rerun the generator; `just check` fails on drift.
 */

import { describe, expect, it } from "vitest";
import { DTO_CONTRACT, diffFields } from "@kanso/client/dto-contract";

import { buildTools } from "./tools.mjs";

const fakeClient = {
    get: async () => ({}),
    post: async () => ({}),
    patch: async () => ({}),
    put: async () => ({}),
    delete: async () => ({}),
};

const byName = new Map(buildTools(fakeClient, []).map((t) => [t.name, t]));

/** Top-level property names on a tool's parameters schema. */
const topProps = (tool) => Object.keys(tool.parameters?.properties ?? {});

/** Nested property names under `patch` for `*_update` tools. */
const patchProps = (tool) =>
    Object.keys(tool.parameters?.properties?.patch?.properties ?? {});

describe("CLI tool schemas ↔ Rust DTO contract", () => {
    it("board_create matches CreateBoardBody", () => {
        const advertised = topProps(byName.get("board_create"));
        expect(diffFields(advertised, DTO_CONTRACT.board_create)).toEqual({
            ok: true,
            extra: [],
            missing: [],
        });
    });

    it("board_update patch matches BoardPatchDto", () => {
        const advertised = patchProps(byName.get("board_update"));
        expect(diffFields(advertised, DTO_CONTRACT.board_update_patch)).toEqual({
            ok: true,
            extra: [],
            missing: [],
        });
    });

    it("column_create matches CreateColumnBody (no position — server assigns)", () => {
        // board_id is a path param, not part of CreateColumnBody. Drop it.
        const advertised = topProps(byName.get("column_create")).filter(
            (f) => f !== "board_id",
        );
        expect(diffFields(advertised, DTO_CONTRACT.column_create)).toEqual({
            ok: true,
            extra: [],
            missing: [],
        });
    });

    it("column_update patch matches ColumnPatchDto (color, not position)", () => {
        const advertised = patchProps(byName.get("column_update"));
        expect(diffFields(advertised, DTO_CONTRACT.column_update_patch)).toEqual({
            ok: true,
            extra: [],
            missing: [],
        });
    });

    it("card_create matches CreateCardBody (title only)", () => {
        // column_id is a path param, not part of CreateCardBody. Drop it.
        const advertised = topProps(byName.get("card_create")).filter(
            (f) => f !== "column_id",
        );
        expect(diffFields(advertised, DTO_CONTRACT.card_create)).toEqual({
            ok: true,
            extra: [],
            missing: [],
        });
    });

    it("card_update patch matches CardPatchDto (body_text — not description)", () => {
        const advertised = patchProps(byName.get("card_update"));
        expect(diffFields(advertised, DTO_CONTRACT.card_update_patch)).toEqual({
            ok: true,
            extra: [],
            missing: [],
        });
    });

    it("card_update.due_at is integer (nullable), not string", () => {
        const dueAt = byName.get("card_update").parameters.properties.patch.properties.due_at;
        // JSON Schema type may be a string or array of strings; both are allowed.
        const types = Array.isArray(dueAt.type) ? dueAt.type : [dueAt.type];
        expect(types).toContain("integer");
        expect(types).toContain("null");
        expect(types).not.toContain("string");
    });

    it("column_create no longer advertises `position`", () => {
        const tool = byName.get("column_create");
        expect(topProps(tool)).not.toContain("position");
        expect(tool.description).toMatch(/column_move/);
    });

    it("board_get takes a single required `id` string param", () => {
        const tool = byName.get("board_get");
        expect(tool).toBeDefined();
        expect(topProps(tool)).toEqual(["id"]);
        expect(tool.parameters.required).toEqual(["id"]);
        expect(tool.parameters.properties.id.type).toBe("string");
    });

    it("card_get takes a single required `id` string param", () => {
        const tool = byName.get("card_get");
        expect(tool).toBeDefined();
        expect(topProps(tool)).toEqual(["id"]);
        expect(tool.parameters.required).toEqual(["id"]);
        expect(tool.parameters.properties.id.type).toBe("string");
    });
});
