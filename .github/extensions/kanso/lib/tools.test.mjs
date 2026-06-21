import { describe, expect, it, vi } from "vitest";

import {
    kansoAdd,
    kansoDone,
    kansoList,
    kansoMove,
    kansoSearch,
} from "./tools.mjs";

/**
 * @param {Partial<{get: any, post: any, patch: any}>} overrides
 */
const fakeClient = (overrides = {}) => ({
    get: overrides.get ?? vi.fn(),
    post: overrides.post ?? vi.fn(),
    patch: overrides.patch ?? vi.fn(),
});

describe("kansoList", () => {
    it("lists boards when no args", async () => {
        const client = fakeClient({
            get: vi.fn(async () => [{ id: "b1", name: "My Board" }]),
        });
        const out = await kansoList(client, {});
        expect(client.get).toHaveBeenCalledWith("/boards");
        expect(out).toContain("b1");
        expect(out).toContain("My Board");
    });

    it("lists columns with card counts when board_id given", async () => {
        const get = vi.fn(async (/** @type {string} */ p) => {
            if (p.startsWith("/boards/")) return [{ id: "c1", name: "To Do" }];
            if (p.startsWith("/columns/c1/cards")) return [{ id: "x" }, { id: "y" }];
            return [];
        });
        const out = await kansoList(fakeClient({ get }), { board_id: "b1" });
        expect(out).toContain("To Do");
        expect(out).toContain("(2 cards)");
    });

    it("lists cards when column_id given", async () => {
        const get = vi.fn(async () => [
            { id: "k1", title: "Hello", body_text: "world", archived_at: null },
        ]);
        const out = await kansoList(fakeClient({ get }), { column_id: "c1" });
        expect(get).toHaveBeenCalledWith("/columns/c1/cards");
        expect(out).toContain("k1");
        expect(out).toContain("Hello");
        expect(out).toContain("world");
    });

    it("propagates errors from the client", async () => {
        const client = fakeClient({
            get: vi.fn(async () => {
                throw new Error("kanso: desktop app is not running");
            }),
        });
        await expect(kansoList(client, {})).rejects.toThrow(/not running/);
    });
});

describe("kansoAdd", () => {
    it("creates a card and returns its id", async () => {
        const post = vi.fn(async () => ({ id: "card-1", title: "ship it" }));
        const out = await kansoAdd(fakeClient({ post }), {
            column_id: "col-1",
            title: "ship it",
        });
        expect(post).toHaveBeenCalledWith("/columns/col-1/cards", { title: "ship it" });
        expect(out).toContain("card-1");
    });

    it("patches body_text when body provided", async () => {
        const post = vi.fn(async () => ({ id: "card-2", title: "t" }));
        const patch = vi.fn(async () => ({}));
        await kansoAdd(fakeClient({ post, patch }), {
            column_id: "col-1",
            title: "t",
            body: "details here",
        });
        expect(patch).toHaveBeenCalledWith("/cards/card-2", { body_text: "details here" });
    });

    it("rejects empty title", async () => {
        await expect(
            kansoAdd(fakeClient(), { column_id: "c", title: "   " }),
        ).rejects.toThrow(/title is required/);
    });
});

describe("kansoMove", () => {
    it("posts to /move and appends by default", async () => {
        const post = vi.fn(async () => ({ id: "k", column_id: "c2" }));
        const out = await kansoMove(fakeClient({ post }), {
            card_id: "k",
            target_column_id: "c2",
        });
        expect(post).toHaveBeenCalledWith("/cards/k/move", { target_column_id: "c2" });
        expect(out).toContain("c2");
    });

    it("rejects missing target", async () => {
        await expect(
            // @ts-expect-error testing required-field guard
            kansoMove(fakeClient(), { card_id: "k" }),
        ).rejects.toThrow(/target_column_id/);
    });
});

describe("kansoDone", () => {
    it("archives a card", async () => {
        const post = vi.fn(async () => null);
        const out = await kansoDone(fakeClient({ post }), { card_id: "k1" });
        expect(post).toHaveBeenCalledWith("/cards/k1/archive");
        expect(out).toContain("archived");
    });
});

describe("kansoSearch", () => {
    it("queries FTS with default limit", async () => {
        const get = vi.fn(async () => [
            {
                card: { id: "c1", title: "Bug fix", body_text: "Something" },
                column_id: "col1",
                column_name: "Doing",
                board_id: "b1",
                board_name: "Personal",
            },
        ]);
        const out = await kansoSearch(fakeClient({ get }), { q: "bug" });
        expect(get).toHaveBeenCalledWith("/cards/search?q=bug&limit=20");
        expect(out).toContain("c1");
        expect(out).toContain("Bug fix");
        expect(out).toContain("Personal");
    });

    it("clamps limit to 50", async () => {
        const get = vi.fn(async () => []);
        await kansoSearch(fakeClient({ get }), { q: "x", limit: 999 });
        expect(get).toHaveBeenCalledWith("/cards/search?q=x&limit=50");
    });

    it("rejects empty query", async () => {
        await expect(kansoSearch(fakeClient(), { q: "  " })).rejects.toThrow(/q is required/);
    });
});
