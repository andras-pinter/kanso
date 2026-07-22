import { describe, expect, it, vi } from "vitest";

import {
    boardCreate,
    boardDelete,
    boardGet,
    boardList,
    cardBodySet,
    cardCreate,
    cardDelete,
    cardGet,
    cardMove,
    cardSearch,
    cardTagAdd,
    cardTagRemove,
    cardUpdate,
    columnList,
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
        await boardList(c, { limit: 5, offset: 10 });
        expect(c.calls).toEqual([
            { method: "GET", path: "/boards?limit=5&offset=10", body: undefined },
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

    it("boardDelete hits DELETE /boards/:id", async () => {
        const c = fakeClient();
        await boardDelete(c, { id: "b1" });
        expect(c.calls).toEqual([{ method: "DELETE", path: "/boards/b1", body: undefined }]);
    });

    it("boardGet hits GET /boards/:id and encodes the id", async () => {
        const c = fakeClient();
        await boardGet(c, { id: "b/1" });
        expect(c.calls).toEqual([{ method: "GET", path: "/boards/b%2F1", body: undefined }]);
    });

    it("boardGet rejects empty id", () => {
        const c = fakeClient();
        expect(() => boardGet(c, { id: "" })).toThrow(/id is required/);
    });
});

describe("columns", () => {
    it("columnList requires board_id and appends page query", async () => {
        const c = fakeClient();
        await columnList(c, { board_id: "b1", limit: 4 });
        expect(c.calls).toEqual([
            { method: "GET", path: "/boards/b1/columns?limit=4", body: undefined },
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

    it("cardDelete hits DELETE /cards/:id", async () => {
        const c = fakeClient();
        await cardDelete(c, { id: "k1" });
        expect(c.calls).toEqual([{ method: "DELETE", path: "/cards/k1", body: undefined }]);
    });

    it("cardGet hits GET /cards/:id and encodes the id", async () => {
        const c = fakeClient();
        await cardGet(c, { id: "k 1" });
        expect(c.calls).toEqual([{ method: "GET", path: "/cards/k%201", body: undefined }]);
    });

    it("cardGet rejects empty id", () => {
        const c = fakeClient();
        expect(() => cardGet(c, { id: "" })).toThrow(/id is required/);
    });

    it("cardBodySet PUTs the body_markdown string verbatim", async () => {
        const c = fakeClient();
        await cardBodySet(c, { id: "k1", body_markdown: "# hi" });
        // Empty string is the "clear body" sentinel; must still hit the API.
        await cardBodySet(c, { id: "k2", body_markdown: "" });
        expect(c.calls).toEqual([
            {
                method: "PUT",
                path: "/cards/k1/body",
                body: { body_markdown: "# hi" },
            },
            {
                method: "PUT",
                path: "/cards/k2/body",
                body: { body_markdown: "" },
            },
        ]);
    });

    it("cardBodySet rejects non-string body_markdown", () => {
        const c = fakeClient();
        expect(() => cardBodySet(c, { id: "k1" })).toThrow(/body_markdown/);
        expect(() => cardBodySet(c, { id: "k1", body_markdown: null })).toThrow(/body_markdown/);
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
    it("cardSearch builds q + optional limit + offset", async () => {
        const c = fakeClient();
        await cardSearch(c, { q: "hello world", limit: 5, offset: 10 });
        expect(c.calls).toEqual([
            {
                method: "GET",
                path: "/cards/search?q=hello%20world&limit=5&offset=10",
                body: undefined,
            },
        ]);
    });

    it("cardSearch rejects empty q", () => {
        const c = fakeClient();
        expect(() => cardSearch(c, { q: "  " })).toThrow(/q is required/);
    });
});
