/**
 * Contract tests: assert that each MCP tool's Zod input schema advertises
 * exactly the fields the Rust DTO accepts. Same intent as the CLI extension's
 * schema-contract test — protect agents from filing 400/422 requests because
 * a schema advertised a field that doesn't exist server-side.
 *
 * Ground truth lives in @kanso/client/dto-contract.
 */

import { describe, expect, it } from "vitest";
import { DTO_CONTRACT, diffFields } from "@kanso/client/dto-contract";
import { z } from "zod";

import { createKansoMcpServer } from "./server.mjs";

const fakeClient = {
    get: async () => ({}),
    post: async () => ({}),
    patch: async () => ({}),
    put: async () => ({}),
    delete: async () => ({}),
};

/**
 * `McpServer.registerTool` (SDK 1.x) stores each tool on `server._registeredTools`
 * (private but stable — the SDK doesn't expose a public reflection API and we
 * only need it in tests). If that shape changes, this helper is the single
 * place to update.
 */
const collectTools = () => {
    const server = createKansoMcpServer({ client: fakeClient });
    const registry = server._registeredTools;
    if (!registry || typeof registry !== "object") {
        throw new Error("MCP server _registeredTools not accessible; SDK internals changed?");
    }
    return registry;
};

const tools = collectTools();

/**
 * Extract the top-level field names from a tool's Zod input schema.
 * The SDK stores it as either a raw ZodRawShape record or a compiled ZodObject.
 */
const topFields = (name) => {
    const t = tools[name];
    if (!t) throw new Error(`tool ${name} not registered`);
    const shape = t.inputSchema instanceof z.ZodObject
        ? t.inputSchema.shape
        : t.inputSchema;
    return Object.keys(shape ?? {});
};

/**
 * Extract the nested `patch` object's field names for `*_update` tools.
 * The patch is a ZodObject.
 */
const patchFields = (name) => {
    const t = tools[name];
    if (!t) throw new Error(`tool ${name} not registered`);
    const shape = t.inputSchema instanceof z.ZodObject
        ? t.inputSchema.shape
        : t.inputSchema;
    const patchSchema = shape?.patch;
    if (!(patchSchema instanceof z.ZodObject)) {
        throw new Error(`tool ${name} has no ZodObject patch field`);
    }
    return Object.keys(patchSchema.shape);
};

/**
 * Extract the Zod type of a nested patch field so we can assert the underlying
 * primitive (integer vs string). Unwrap optional/nullable wrappers.
 */
const unwrapPatchField = (toolName, fieldName) => {
    const t = tools[toolName];
    const shape = t.inputSchema instanceof z.ZodObject
        ? t.inputSchema.shape
        : t.inputSchema;
    let node = shape.patch.shape[fieldName];
    while (node && (node instanceof z.ZodOptional || node instanceof z.ZodNullable)) {
        node = node._def.innerType;
    }
    return node;
};

describe("MCP tool schemas ↔ Rust DTO contract", () => {
    it("board_create matches CreateBoardBody", () => {
        expect(diffFields(topFields("board_create"), DTO_CONTRACT.board_create)).toEqual({
            ok: true,
            extra: [],
            missing: [],
        });
    });

    it("board_update patch matches BoardPatchDto (color, not position)", () => {
        expect(diffFields(patchFields("board_update"), DTO_CONTRACT.board_update_patch)).toEqual({
            ok: true,
            extra: [],
            missing: [],
        });
    });

    it("column_create matches CreateColumnBody (no position — server assigns)", () => {
        // board_id is a path param, drop before diffing.
        const advertised = topFields("column_create").filter((f) => f !== "board_id");
        expect(diffFields(advertised, DTO_CONTRACT.column_create)).toEqual({
            ok: true,
            extra: [],
            missing: [],
        });
    });

    it("column_update patch matches ColumnPatchDto (color, not position)", () => {
        expect(diffFields(patchFields("column_update"), DTO_CONTRACT.column_update_patch)).toEqual({
            ok: true,
            extra: [],
            missing: [],
        });
    });

    it("card_create matches CreateCardBody (title only)", () => {
        const advertised = topFields("card_create").filter((f) => f !== "column_id");
        expect(diffFields(advertised, DTO_CONTRACT.card_create)).toEqual({
            ok: true,
            extra: [],
            missing: [],
        });
    });

    it("card_update patch matches CardPatchDto (body_text — not description)", () => {
        expect(diffFields(patchFields("card_update"), DTO_CONTRACT.card_update_patch)).toEqual({
            ok: true,
            extra: [],
            missing: [],
        });
    });

    it("card_update.due_at is a Zod number, not string", () => {
        const node = unwrapPatchField("card_update", "due_at");
        expect(node).toBeInstanceOf(z.ZodNumber);
        expect(node).not.toBeInstanceOf(z.ZodString);
    });

    it("column_create no longer advertises `position`", () => {
        expect(topFields("column_create")).not.toContain("position");
        const desc = tools.column_create.description ?? "";
        expect(desc).toMatch(/column_move/);
    });
});
