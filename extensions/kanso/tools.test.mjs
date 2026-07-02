import { describe, expect, it, vi } from "vitest";

import { buildTools, wrap } from "./tools.mjs";

/**
 * Fake client that captures HTTP calls and returns a canned response.
 */
const fakeClient = () => {
    const calls = [];
    const respond = (method) =>
        vi.fn(async (path, body) => {
            calls.push({ method, path, body });
            return { ok: true };
        });
    return {
        calls,
        get: respond("GET"),
        post: respond("POST"),
        patch: respond("PATCH"),
        put: respond("PUT"),
        delete: respond("DELETE"),
    };
};

const kansoTools = []; // omit legacy verbs in tests — buildTools spreads them first

describe("CLI extension tools registration", () => {
    const client = fakeClient();
    const tools = buildTools(client, kansoTools);

    it("registers the full set of new verbs", () => {
        const names = tools.map((t) => t.name).sort();
        expect(names).toEqual(
            [
                "board_card_tags",
                "board_create",
                "board_delete",
                "board_get",
                "board_list",
                "board_update",
                "card_body_get",
                "card_body_set",
                "card_create",
                "card_delete",
                "card_get",
                "card_list",
                "card_move",
                "card_search",
                "card_tag_add",
                "card_tag_remove",
                "card_tags",
                "card_update",
                "column_list",
                "tag_cards",
                "tag_create",
                "tag_delete",
                "tag_get",
                "tag_list",
                "tag_update",
            ].sort(),
        );
    });

    it("each tool has a description, parameters schema, and handler", () => {
        for (const t of tools) {
            expect(t.description, `missing description on ${t.name}`).toBeTruthy();
            expect(t.parameters?.type).toBe("object");
            expect(typeof t.handler).toBe("function");
        }
    });

    it("card_delete handler hits DELETE /cards/:id", async () => {
        const c = fakeClient();
        const byName = new Map(buildTools(c, kansoTools).map((t) => [t.name, t]));
        const out = await byName.get("card_delete").handler({ id: "k1" });
        expect(c.calls).toEqual([{ method: "DELETE", path: "/cards/k1", body: undefined }]);
        expect(JSON.parse(out)).toEqual({ ok: true });
    });

    it("card_search handler wires q + limit + offset", async () => {
        const c = fakeClient();
        const byName = new Map(buildTools(c, kansoTools).map((t) => [t.name, t]));
        await byName
            .get("card_search")
            .handler({ q: "hello", limit: 5, offset: 10 });
        expect(c.calls).toEqual([
            {
                method: "GET",
                path: "/cards/search?q=hello&limit=5&offset=10",
                body: undefined,
            },
        ]);
    });
});

describe("wrap", () => {
    it("returns the resolved handler value on success", async () => {
        const client = fakeClient();
        const handler = wrap(client, async () => "hello");
        expect(await handler({})).toBe("hello");
    });

    it("catches errors and returns a kanso: prefixed line", async () => {
        const client = fakeClient();
        // silence stderr for the test
        const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        const handler = wrap(client, async () => {
            throw new Error("boom");
        });
        const out = await handler({});
        expect(out).toBe("kanso: boom");
        writeSpy.mockRestore();
    });
});
