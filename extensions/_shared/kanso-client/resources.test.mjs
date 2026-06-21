import { describe, expect, it, vi } from "vitest";

import { KansoApiError } from "./client.mjs";
import { boardFull, boardGet, cardGet, columnGet } from "./resources.mjs";

/**
 * Build a fake client whose `get` records the path it was called with and
 * returns whatever the caller asks for. Mirrors the pure-function shape of
 * the tools tests so we exercise the fetchers without a real HTTP client.
 *
 * @param {(path: string) => unknown} respond
 */
const fakeClient = (respond) => {
    const calls = [];
    return {
        calls,
        get: vi.fn(async (path) => {
            calls.push(path);
            const r = respond(path);
            if (r instanceof Error) throw r;
            return r;
        }),
        post: vi.fn(),
        patch: vi.fn(),
    };
};

describe("boardFull", () => {
    it("hits /boards/:id/_full without include_archived by default", async () => {
        const dto = { board: { id: "b1", name: "Work" }, tags: [], columns: [] };
        const c = fakeClient(() => dto);
        await expect(boardFull(c, { id: "b1" })).resolves.toBe(dto);
        expect(c.calls).toEqual(["/boards/b1/_full"]);
    });

    it("appends include_archived=true when asked", async () => {
        const c = fakeClient(() => ({ board: { id: "b1" }, tags: [], columns: [] }));
        await boardFull(c, { id: "b1", includeArchived: true });
        expect(c.calls).toEqual(["/boards/b1/_full?include_archived=true"]);
    });

    it("url-encodes the id", async () => {
        const c = fakeClient(() => ({ board: { id: "x/y" }, tags: [], columns: [] }));
        await boardFull(c, { id: "x/y" });
        expect(c.calls).toEqual(["/boards/x%2Fy/_full"]);
    });

    it("propagates 404 as KansoApiError(status=404)", async () => {
        const c = fakeClient(() => new KansoApiError(404, "kanso: not found (board)", "board"));
        try {
            await boardFull(c, { id: "nope" });
            throw new Error("expected throw");
        } catch (err) {
            expect(err).toBeInstanceOf(KansoApiError);
            expect(err.status).toBe(404);
        }
    });

    it("propagates 409 as KansoApiError(status=409) when board exceeds card cap", async () => {
        const c = fakeClient(
            () => new KansoApiError(409, "kanso: conflict (board has 1500 cards, cap is 1000)", ""),
        );
        try {
            await boardFull(c, { id: "huge" });
            throw new Error("expected throw");
        } catch (err) {
            expect(err).toBeInstanceOf(KansoApiError);
            expect(err.status).toBe(409);
            expect(err.message).toMatch(/conflict/);
        }
    });

    it("rejects without an id", async () => {
        const c = fakeClient(() => ({}));
        await expect(boardFull(c, { id: "" })).rejects.toThrow(/id is required/);
        expect(c.calls).toEqual([]);
    });
});

describe("cardGet", () => {
    it("hits /cards/:id and returns the CardDto", async () => {
        const dto = { id: "c1", column_id: "col", title: "Buy milk" };
        const c = fakeClient(() => dto);
        await expect(cardGet(c, { id: "c1" })).resolves.toBe(dto);
        expect(c.calls).toEqual(["/cards/c1"]);
    });

    it("url-encodes the id", async () => {
        const c = fakeClient(() => ({ id: "a b" }));
        await cardGet(c, { id: "a b" });
        expect(c.calls).toEqual(["/cards/a%20b"]);
    });

    it("propagates 404 as KansoApiError(status=404)", async () => {
        const c = fakeClient(() => new KansoApiError(404, "kanso: not found (card)", "card"));
        try {
            await cardGet(c, { id: "missing" });
            throw new Error("expected throw");
        } catch (err) {
            expect(err).toBeInstanceOf(KansoApiError);
            expect(err.status).toBe(404);
        }
    });

    it("rejects without an id", async () => {
        const c = fakeClient(() => ({}));
        await expect(cardGet(c, { id: "" })).rejects.toThrow(/id is required/);
        expect(c.calls).toEqual([]);
    });
});

describe("boardGet", () => {
    it("hits /boards/:id and returns the BoardDto", async () => {
        const dto = { id: "b1", name: "Work" };
        const c = fakeClient(() => dto);
        await expect(boardGet(c, { id: "b1" })).resolves.toBe(dto);
        expect(c.calls).toEqual(["/boards/b1"]);
    });

    it("url-encodes the id", async () => {
        const c = fakeClient(() => ({ id: "x/y" }));
        await boardGet(c, { id: "x/y" });
        expect(c.calls).toEqual(["/boards/x%2Fy"]);
    });

    it("propagates 404 as KansoApiError", async () => {
        const c = fakeClient(() => new KansoApiError(404, "kanso: not found (board)", "board"));
        await expect(boardGet(c, { id: "nope" })).rejects.toBeInstanceOf(KansoApiError);
    });

    it("rejects without an id", async () => {
        const c = fakeClient(() => ({}));
        await expect(boardGet(c, { id: "" })).rejects.toThrow(/id is required/);
    });
});

describe("columnGet", () => {
    it("hits /columns/:id and returns the ColumnDto", async () => {
        const dto = { id: "c1", board_id: "b1", name: "Todo" };
        const c = fakeClient(() => dto);
        await expect(columnGet(c, { id: "c1" })).resolves.toBe(dto);
        expect(c.calls).toEqual(["/columns/c1"]);
    });

    it("url-encodes the id", async () => {
        const c = fakeClient(() => ({ id: "a b" }));
        await columnGet(c, { id: "a b" });
        expect(c.calls).toEqual(["/columns/a%20b"]);
    });

    it("propagates 404 as KansoApiError", async () => {
        const c = fakeClient(() => new KansoApiError(404, "kanso: not found (column)", "column"));
        await expect(columnGet(c, { id: "nope" })).rejects.toBeInstanceOf(KansoApiError);
    });

    it("rejects without an id", async () => {
        const c = fakeClient(() => ({}));
        await expect(columnGet(c, { id: "" })).rejects.toThrow(/id is required/);
    });
});
