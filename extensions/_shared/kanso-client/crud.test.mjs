import { describe, expect, it, vi } from "vitest";

import {
    boardArchive,
    boardCreate,
    boardDelete,
    boardList,
    cardArchive,
    cardBodySet,
    cardCreate,
    cardMove,
    cardSearch,
    cardTagAdd,
    cardTagRemove,
    cardUpdate,
    columnCreate,
    columnList,
    columnMove,
    tagArchive,
    tagCreate,
    tagList,
} from "./crud.mjs";

/**
 * Fake client that records every call and returns whatever the responder
 * hands back. Same style as resources.test.mjs so behaviour is easy to eyeball.
 */
const fakeClient = () => {
    const calls = [];
    const record = (method) =>
        vi.fn(async (path, body) => {
            calls.push({ method, path, body });
            return { ok: true, path };
        });
    return {
        calls,
        get: record("GET"),
        post: record("POST"),
        patch: record("PATCH"),
        put: record("PUT"),
        delete: record("DELETE"),
    };
};

describe("boards", () => {
    it("boardList hits /boards with page query", async () => {
        const c = fakeClient();
        await boardList(c, { include_archived: true, limit: 5, offset: 10 });
        expect(c.calls).toEqual([
            { method: "GET", path: "/boards?include_archived=true&limit=5&offset=10", body: undefined },
        ]);
    });

    it("boardCreate trims name and POSTs to /boards", async () => {
        const c = fakeClient();
        await boardCreate(c, { name: "  Work  " });
        expect(c.calls).toEqual([{ method: "POST", path: "/boards", body: { name: "Work" } }]);
    });

    it("boardCreate rejects empty name", () => {
        const c = fakeClient();
        expect(() => boardCreate(c, { name: "  " })).toThrow(/name is required/);
    });

    it("boardArchive posts to /boards/:id/archive and returns the response", async () => {
        const c = fakeClient();
        const res = await boardArchive(c, { id: "b1" });
        expect(c.calls).toEqual([{ method: "POST", path: "/boards/b1/archive", body: undefined }]);
        expect(res).toEqual({ ok: true, path: "/boards/b1/archive" });
    });

    it("boardDelete hits DELETE /boards/:id", async () => {
        const c = fakeClient();
        await boardDelete(c, { id: "b1" });
        expect(c.calls).toEqual([{ method: "DELETE", path: "/boards/b1", body: undefined }]);
    });
});

describe("columns", () => {
    it("columnList requires board_id and appends page query", async () => {
        const c = fakeClient();
        await columnList(c, { board_id: "b1", include_archived: true });
        expect(c.calls).toEqual([
            { method: "GET", path: "/boards/b1/columns?include_archived=true", body: undefined },
        ]);
    });

    it("columnCreate trims name and forwards color when set", async () => {
        const c = fakeClient();
        await columnCreate(c, { board_id: "b1", name: " Todo ", color: "#ff8800" });
        expect(c.calls).toEqual([
            { method: "POST", path: "/boards/b1/columns", body: { name: "Todo", color: "#ff8800" } },
        ]);
    });

    it("columnCreate omits color when not supplied (position is server-assigned)", async () => {
        const c = fakeClient();
        await columnCreate(c, { board_id: "b1", name: "Todo" });
        expect(c.calls).toEqual([
            { method: "POST", path: "/boards/b1/columns", body: { name: "Todo" } },
        ]);
    });

    it("columnMove wires before/after nulls when omitted", async () => {
        const c = fakeClient();
        await columnMove(c, { id: "c1" });
        expect(c.calls).toEqual([
            { method: "POST", path: "/columns/c1/move", body: { before: null, after: null } },
        ]);
    });
});

describe("cards", () => {
    it("cardCreate posts to /columns/:column_id/cards", async () => {
        const c = fakeClient();
        await cardCreate(c, { column_id: "col1", title: "  Do a thing  " });
        expect(c.calls).toEqual([
            { method: "POST", path: "/columns/col1/cards", body: { title: "Do a thing" } },
        ]);
    });

    it("cardUpdate PATCHes /cards/:id with the patch payload", async () => {
        const c = fakeClient();
        await cardUpdate(c, { id: "k1", patch: { title: "renamed", due_at: null } });
        expect(c.calls).toEqual([
            { method: "PATCH", path: "/cards/k1", body: { title: "renamed", due_at: null } },
        ]);
    });

    it("cardMove omits before/after when not supplied", async () => {
        const c = fakeClient();
        await cardMove(c, { id: "k1", target_column_id: "col2" });
        expect(c.calls).toEqual([
            { method: "POST", path: "/cards/k1/move", body: { target_column_id: "col2" } },
        ]);
    });

    it("cardArchive posts to /cards/:id/archive", async () => {
        const c = fakeClient();
        await cardArchive(c, { id: "k1" });
        expect(c.calls).toEqual([{ method: "POST", path: "/cards/k1/archive", body: undefined }]);
    });

    it("cardBodySet PUTs only the fields that were provided", async () => {
        const c = fakeClient();
        // text-only — flagship agent call, must not send body_blocksuite_b64
        await cardBodySet(c, { id: "k1", body_text: "hi" });
        // blob-only
        await cardBodySet(c, { id: "k2", body_blocksuite_b64: "AAA=" });
        // both
        await cardBodySet(c, { id: "k3", body_blocksuite_b64: "BBB=", body_text: "yo" });
        expect(c.calls).toEqual([
            {
                method: "PUT",
                path: "/cards/k1/body",
                body: { body_text: "hi" },
            },
            {
                method: "PUT",
                path: "/cards/k2/body",
                body: { body_blocksuite_b64: "AAA=" },
            },
            {
                method: "PUT",
                path: "/cards/k3/body",
                body: { body_blocksuite_b64: "BBB=", body_text: "yo" },
            },
        ]);
    });

    it("cardBodySet rejects calls with neither field", () => {
        const c = fakeClient();
        expect(() => cardBodySet(c, { id: "k1" })).toThrow(/at least one/i);
    });
});

describe("tags + card↔tag links", () => {
    it("tagList and tagCreate", async () => {
        const c = fakeClient();
        await tagList(c);
        await tagCreate(c, { name: "urgent", color: "#f00" });
        expect(c.calls).toEqual([
            { method: "GET", path: "/tags", body: undefined },
            { method: "POST", path: "/tags", body: { name: "urgent", color: "#f00" } },
        ]);
    });

    it("tagArchive posts to /tags/:id/archive", async () => {
        const c = fakeClient();
        await tagArchive(c, { id: "t1" });
        expect(c.calls).toEqual([{ method: "POST", path: "/tags/t1/archive", body: undefined }]);
    });

    it("cardTagAdd / cardTagRemove hit /cards/:card_id/tags/:tag_id", async () => {
        const c = fakeClient();
        await cardTagAdd(c, { card_id: "k1", tag_id: "t1" });
        await cardTagRemove(c, { card_id: "k1", tag_id: "t1" });
        expect(c.calls).toEqual([
            { method: "POST", path: "/cards/k1/tags/t1", body: undefined },
            { method: "DELETE", path: "/cards/k1/tags/t1", body: undefined },
        ]);
    });
});

describe("search", () => {
    it("cardSearch builds q + optional include_archived + limit + offset", async () => {
        const c = fakeClient();
        await cardSearch(c, { q: "hello world", include_archived: true, limit: 5, offset: 10 });
        expect(c.calls).toEqual([
            {
                method: "GET",
                path: "/cards/search?q=hello%20world&include_archived=true&limit=5&offset=10",
                body: undefined,
            },
        ]);
    });

    it("cardSearch rejects empty q", () => {
        const c = fakeClient();
        expect(() => cardSearch(c, { q: "  " })).toThrow(/q is required/);
    });
});
