import { describe, expect, it, vi } from "vitest";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createKansoMcpServer } from "./server.mjs";

/**
 * Build a fake `@kanso/client` HTTP client that returns predefined values for
 * matching path prefixes. Records every call for assertion.
 *
 * @param {Record<string, unknown | ((path: string) => unknown)>} responses
 */
const fakeClient = (responses) => {
    const calls = [];
    const lookup = (path) => {
        const keys = Object.keys(responses).sort((a, b) => b.length - a.length);
        for (const prefix of keys) {
            if (path === prefix || path.startsWith(prefix)) {
                const value = responses[prefix];
                const resolved = typeof value === "function" ? value(path) : value;
                if (resolved instanceof Error) throw resolved;
                return resolved;
            }
        }
        throw new Error(`fakeClient: no mock for ${path}`);
    };
    return {
        calls,
        get: vi.fn(async (path) => {
            calls.push({ method: "GET", path });
            return lookup(path);
        }),
        post: vi.fn(async (path, body) => {
            calls.push({ method: "POST", path, body });
            return lookup(path);
        }),
        patch: vi.fn(async (path, body) => {
            calls.push({ method: "PATCH", path, body });
            return lookup(path);
        }),
        put: vi.fn(async (path, body) => {
            calls.push({ method: "PUT", path, body });
            return lookup(path);
        }),
        delete: vi.fn(async (path) => {
            calls.push({ method: "DELETE", path });
            return lookup(path);
        }),
        invalidate: vi.fn(),
    };
};

/**
 * Spin up a paired Client+Server over InMemoryTransport.
 * @param {ReturnType<typeof fakeClient>} client
 */
const harness = async (client) => {
    const server = createKansoMcpServer({ client });
    const mcpClient = new Client({ name: "test", version: "0.0.0" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
        server.connect(serverTransport),
        mcpClient.connect(clientTransport),
    ]);
    return { server, mcpClient };
};

describe("tools/list", () => {
    it("registers the 5 legacy kanso_* tools and the expanded CRUD surface", async () => {
        const { mcpClient } = await harness(fakeClient({}));
        const { tools } = await mcpClient.listTools();
        const names = tools.map((t) => t.name);
        for (const legacy of ["kanso_add", "kanso_done", "kanso_list", "kanso_move", "kanso_search"]) {
            expect(names).toContain(legacy);
        }
        for (const t of [
            "board_list", "board_create", "board_delete",
            "column_list",
            "card_get", "card_update", "card_delete", "card_body_set", "card_search",
            "tag_list", "tag_create", "tag_delete",
            "card_tag_add", "card_tag_remove",
        ]) {
            expect(names).toContain(t);
        }
        for (const gone of [
            "board_archive", "board_unarchive",
            "column_create", "column_update", "column_move",
            "column_archive", "column_unarchive",
            "card_archive", "card_unarchive",
            "tag_archive", "tag_unarchive",
        ]) {
            expect(names).not.toContain(gone);
        }

        const add = tools.find((t) => t.name === "kanso_add");
        expect(add?.description).toMatch(/create/i);
        expect(add?.inputSchema?.properties?.column_id).toBeDefined();
        expect(add?.inputSchema?.properties?.title).toBeDefined();
        expect(add?.inputSchema?.required).toContain("column_id");
        expect(add?.inputSchema?.required).toContain("title");
    });
});

describe("tool dispatch", () => {
    it("kanso_list with no args fetches /boards", async () => {
        const client = fakeClient({
            "/boards": [{ id: "b1", name: "Work" }],
        });
        const { mcpClient } = await harness(client);
        const res = await mcpClient.callTool({ name: "kanso_list", arguments: {} });
        expect(res.isError).toBeFalsy();
        expect(res.content[0].text).toContain("b1");
        expect(client.calls[0]).toMatchObject({ method: "GET", path: "/boards" });
    });

    it("kanso_add issues POST with trimmed title", async () => {
        const client = fakeClient({
            "/columns/col1/cards": { id: "c1", title: "Hi" },
        });
        const { mcpClient } = await harness(client);
        const res = await mcpClient.callTool({
            name: "kanso_add",
            arguments: { column_id: "col1", title: "  Hi  " },
        });
        expect(res.isError).toBeFalsy();
        expect(res.content[0].text).toContain("created card c1");
        const post = client.calls.find((c) => c.method === "POST");
        expect(post).toMatchObject({
            method: "POST",
            path: "/columns/col1/cards",
            body: { title: "Hi" },
        });
    });

    it("kanso_move POSTs to /cards/:id/move", async () => {
        const client = fakeClient({
            "/cards/c1/move": { id: "c1", column_id: "col2" },
        });
        const { mcpClient } = await harness(client);
        const res = await mcpClient.callTool({
            name: "kanso_move",
            arguments: { card_id: "c1", target_column_id: "col2" },
        });
        expect(res.isError).toBeFalsy();
        expect(res.content[0].text).toContain("moved card c1");
    });

    it("kanso_done DELETEs /cards/:id", async () => {
        const client = fakeClient({ "/cards/c1": null });
        const { mcpClient } = await harness(client);
        const res = await mcpClient.callTool({
            name: "kanso_done",
            arguments: { card_id: "c1" },
        });
        expect(res.isError).toBeFalsy();
        expect(res.content[0].text).toContain("deleted card c1");
        const del = client.calls.find((c) => c.method === "DELETE");
        expect(del).toMatchObject({ method: "DELETE", path: "/cards/c1" });
    });

    it("kanso_search GETs /cards/search with query and limit", async () => {
        const client = fakeClient({
            "/cards/search": [
                {
                    card: { id: "c1", title: "Buy milk", has_body: false },
                    board_name: "Work",
                    column_name: "To Do",
                },
            ],
        });
        const { mcpClient } = await harness(client);
        const res = await mcpClient.callTool({
            name: "kanso_search",
            arguments: { q: "milk", limit: 5 },
        });
        expect(res.isError).toBeFalsy();
        const getCall = client.calls.find((c) => c.method === "GET");
        expect(getCall.path).toMatch(/^\/cards\/search\?q=milk&limit=5$/);
        expect(res.content[0].text).toContain("Buy milk");
    });
});

describe("tool error handling", () => {
    it("handled `kanso:`-prefixed errors surface as isError content (no throw)", async () => {
        const { mcpClient } = await harness(fakeClient({}));
        // Empty title triggers validation in kansoAdd before any HTTP call.
        const res = await mcpClient.callTool({
            name: "kanso_add",
            arguments: { column_id: "c1", title: "   " },
        });
        expect(res.isError).toBe(true);
        expect(res.content[0].text).toMatch(/title is required/);
    });

    it("KansoApiError surfaces as isError content", async () => {
        const { KansoApiError } = await import("@kanso/client");
        const client = fakeClient({
            "/cards/missing": new KansoApiError(404, "kanso: not found (card)", "card"),
        });
        const { mcpClient } = await harness(client);
        const res = await mcpClient.callTool({
            name: "kanso_done",
            arguments: { card_id: "missing" },
        });
        expect(res.isError).toBe(true);
        expect(res.content[0].text).toMatch(/not found/);
    });
});

describe("resources/list", () => {
    it("returns the static index and enumerated board instances", async () => {
        const client = fakeClient({
            "/boards": [
                { id: "b1", name: "Work" },
                { id: "b2", name: "Personal" },
            ],
        });
        const { mcpClient } = await harness(client);
        const { resources } = await mcpClient.listResources();
        const uris = resources.map((r) => r.uri).sort();
        expect(uris).toContain("kanso://boards");
        expect(uris).toContain("kanso://boards/b1");
        expect(uris).toContain("kanso://boards/b2");
    });
});

describe("resources/templates/list", () => {
    it("exposes both board and card URI templates", async () => {
        const { mcpClient } = await harness(fakeClient({}));
        const { resourceTemplates } = await mcpClient.listResourceTemplates();
        const patterns = resourceTemplates.map((t) => t.uriTemplate).sort();
        expect(patterns).toContain("kanso://boards/{id}");
        expect(patterns).toContain("kanso://cards/{id}");
    });
});

describe("resources/read", () => {
    it("renders the boards index", async () => {
        const client = fakeClient({
            "/boards?limit=501": [{ id: "b1", name: "Work" }],
            "/boards/b1/columns?limit=1000": [{ id: "c1", name: "Col" }],
            "/columns/c1/cards?limit=1000": [{ id: "card1" }, { id: "card2" }],
        });
        const { mcpClient } = await harness(client);
        const res = await mcpClient.readResource({ uri: "kanso://boards" });
        expect(res.contents).toHaveLength(1);
        const text = res.contents[0].text;
        expect(text).toContain("# Kanso boards");
        expect(text).toContain("| b1 | Work | 1 | 2 |");
        expect(text).not.toMatch(/_500\+ boards/);
    });

    it("renders ? for enrichment failures in the boards index", async () => {
        const client = fakeClient({
            "/boards?limit=501": [{ id: "b1", name: "Work" }],
            "/boards/b1/columns?limit=1000": new Error("transient db error"),
        });
        const { mcpClient } = await harness(client);
        const res = await mcpClient.readResource({ uri: "kanso://boards" });
        const text = res.contents[0].text;
        expect(text).toContain("| b1 | Work | ? | ? |");
    });

    it("does not show the 500+ banner when exactly 500 boards exist", async () => {
        const boards = Array.from({ length: 500 }, (_, i) => ({
            id: `b${i}`,
            name: `Board ${i}`,
        }));
        const client = fakeClient({
            "/boards?limit=501": boards,
            "/boards/": new Error("nope"),
        });
        const { mcpClient } = await harness(client);
        const res = await mcpClient.readResource({ uri: "kanso://boards" });
        expect(res.contents[0].text).not.toMatch(/_500\+ boards/);
    });

    it("shows the 500+ banner only when more than 500 boards exist", async () => {
        const boards = Array.from({ length: 501 }, (_, i) => ({
            id: `b${i}`,
            name: `Board ${i}`,
        }));
        const client = fakeClient({
            "/boards?limit=501": boards,
            "/boards/": new Error("nope"),
        });
        const { mcpClient } = await harness(client);
        const res = await mcpClient.readResource({ uri: "kanso://boards" });
        const text = res.contents[0].text;
        expect(text).toMatch(/_500\+ boards; showing first 500\._/);
        // Verify we truncate to 500 rows in the table.
        const tableRows = text.split("\n").filter((l) => l.startsWith("| b"));
        expect(tableRows).toHaveLength(500);
    });

    it("renders a board snapshot for boards/{id} (happy path)", async () => {
        const dto = {
            board: { id: "b1", name: "Work" },
            tags: [],
            columns: [
                {
                    column: { id: "c1", name: "To Do" },
                    cards: [
                        {
                            card: {
                                id: "card1",
                                title: "Buy milk",
                                has_body: true,
                                due_at: null,
                            },
                            tag_ids: [],
                        },
                    ],
                },
            ],
        };
        const client = fakeClient({ "/boards/b1/_full": dto });
        const { mcpClient } = await harness(client);
        const res = await mcpClient.readResource({ uri: "kanso://boards/b1" });
        const text = res.contents[0].text;
        expect(text).toContain("# Board: Work");
        expect(text).toContain("## To Do (1 card)");
        expect(text).toContain("- **Buy milk**");
        expect(text).toContain("_(has notes)_");
    });

    it("renders a friendly message on 404 board", async () => {
        const { KansoApiError } = await import("@kanso/client");
        const client = fakeClient({
            "/boards/nope/_full": new KansoApiError(404, "kanso: not found (board)", "board"),
        });
        const { mcpClient } = await harness(client);
        const res = await mcpClient.readResource({ uri: "kanso://boards/nope" });
        expect(res.contents[0].text).toMatch(/Board nope not found/);
    });

    it("renders the cap message on 409 board too large", async () => {
        const { KansoApiError } = await import("@kanso/client");
        const client = fakeClient({
            "/boards/huge/_full": new KansoApiError(
                409,
                "kanso: conflict (board has 1500 cards, cap is 1000)",
                "",
            ),
        });
        const { mcpClient } = await harness(client);
        const res = await mcpClient.readResource({ uri: "kanso://boards/huge" });
        expect(res.contents[0].text).toMatch(/too large/);
        expect(res.contents[0].text).toMatch(/1000 cards/);
    });

    it("renders a card with body excerpt and tags", async () => {
        const client = fakeClient({
            "/cards/c1": {
                id: "c1",
                column_id: "col1",
                title: "Buy milk",
                body_markdown: "from the corner shop on the way home",
                due_at: Date.UTC(2026, 5, 23),
            },
            "/columns/col1": { id: "col1", board_id: "b1", name: "To Do" },
            "/boards/b1": { id: "b1", name: "Work" },
            "/cards/c1/tags": [{ id: "t1", name: "urgent" }],
        });
        const { mcpClient } = await harness(client);
        const res = await mcpClient.readResource({ uri: "kanso://cards/c1" });
        const text = res.contents[0].text;
        expect(text).toContain("# Card: Buy milk");
        expect(text).toContain("Board: **Work**");
        expect(text).toContain("Column: **To Do**");
        expect(text).not.toContain("Column id:");
        expect(text).toContain("Due: 2026-06-23");
        expect(text).toContain("Tags: `urgent`");
        expect(text).toContain("from the corner shop");
    });

    it("falls back to raw column_id when column lookup fails", async () => {
        const client = fakeClient({
            "/cards/c1": {
                id: "c1",
                column_id: "col-x",
                title: "Orphan",
                body_markdown: null,
                due_at: null,
            },
            "/columns/col-x": new Error("boom"),
            "/cards/c1/tags": [],
        });
        const { mcpClient } = await harness(client);
        const res = await mcpClient.readResource({ uri: "kanso://cards/c1" });
        const text = res.contents[0].text;
        expect(text).toContain("# Card: Orphan");
        expect(text).toContain("Column id: `col-x`");
        expect(text).not.toContain("Board:");
    });

    it("renders a friendly message on missing card", async () => {
        const { KansoApiError } = await import("@kanso/client");
        const client = fakeClient({
            "/cards/missing": new KansoApiError(404, "kanso: not found (card)", "card"),
        });
        const { mcpClient } = await harness(client);
        const res = await mcpClient.readResource({ uri: "kanso://cards/missing" });
        expect(res.contents[0].text).toMatch(/Card missing not found/);
    });

    it("renders a card with empty body cleanly", async () => {
        const client = fakeClient({
            "/cards/c1": {
                id: "c1",
                column_id: "col1",
                title: "Empty",
                body_markdown: null,
                due_at: null,
            },
            "/cards/c1/tags": [],
        });
        const { mcpClient } = await harness(client);
        const res = await mcpClient.readResource({ uri: "kanso://cards/c1" });
        expect(res.contents[0].text).toContain("_(empty)_");
    });
});

describe("expanded CRUD tools", () => {
    it("board_delete DELETEs and returns null", async () => {
        const client = fakeClient({ "/boards/b1": null });
        const { mcpClient } = await harness(client);
        const res = await mcpClient.callTool({
            name: "board_delete",
            arguments: { id: "b1" },
        });
        expect(res.isError).not.toBe(true);
        expect(client.calls).toContainEqual({ method: "DELETE", path: "/boards/b1" });
    });

    it("card_delete DELETEs and returns null", async () => {
        const client = fakeClient({ "/cards/c1": null });
        const { mcpClient } = await harness(client);
        const res = await mcpClient.callTool({
            name: "card_delete",
            arguments: { id: "c1" },
        });
        expect(res.isError).not.toBe(true);
        expect(client.calls).toContainEqual({ method: "DELETE", path: "/cards/c1" });
    });

    it("card_tag_add posts and returns the updated CardListDto", async () => {
        const cardListDto = {
            id: "c1",
            column_id: "col1",
            title: "Ship",
            has_body: false,
            position: "a",
            due_at: null,
            created_at: 1,
            updated_at: 2,
        };
        const client = fakeClient({ "/cards/c1/tags/t1": cardListDto });
        const { mcpClient } = await harness(client);
        const res = await mcpClient.callTool({
            name: "card_tag_add",
            arguments: { card_id: "c1", tag_id: "t1" },
        });
        expect(res.isError).not.toBe(true);
        const dto = JSON.parse(res.content[0].text);
        expect(dto).toEqual(cardListDto);
    });

    it("card_body_set puts text-only and returns the updated CardListDto", async () => {
        const cardListDto = {
            id: "c1",
            column_id: "col1",
            title: "T",
            has_body: true,
            position: "a",
            due_at: null,
            created_at: 1,
            updated_at: 2,
        };
        const client = fakeClient({ "/cards/c1/body": cardListDto });
        const { mcpClient } = await harness(client);
        const res = await mcpClient.callTool({
            name: "card_body_set",
            arguments: { id: "c1", body_markdown: "hello" },
        });
        expect(res.isError).not.toBe(true);
        const dto = JSON.parse(res.content[0].text);
        expect(dto).toEqual(cardListDto);
        expect(client.calls).toEqual([
            { method: "PUT", path: "/cards/c1/body", body: { body_markdown: "hello" } },
        ]);
    });
});
