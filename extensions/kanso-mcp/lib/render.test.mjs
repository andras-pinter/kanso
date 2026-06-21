import { describe, expect, it } from "vitest";

import {
    _EXCERPT_MAX_CHARS,
    extractTextFromYjsBlob,
    renderBoardSnapshot,
    renderBoardsIndex,
    renderCard,
} from "./render.mjs";

describe("renderBoardsIndex", () => {
    it("renders empty list", () => {
        const out = renderBoardsIndex({ boards: [] });
        expect(out).toContain("# Kanso boards");
        expect(out).toContain("_No boards._");
    });

    it("renders a table with one board", () => {
        const out = renderBoardsIndex({
            boards: [{ id: "b1", name: "Work", columns: 3, cards: 7 }],
        });
        expect(out).toMatchInlineSnapshot(`
          "# Kanso boards

          | id | name | columns | cards |
          |----|------|---------|-------|
          | b1 | Work | 3 | 7 |"
        `);
    });

    it("appends truncation note when 500+ boards", () => {
        const out = renderBoardsIndex({
            boards: [{ id: "b1", name: "Work", columns: 1, cards: 1 }],
            truncated: true,
        });
        expect(out).toMatch(/_500\+ boards/);
    });

    it("escapes pipe characters in board names", () => {
        const out = renderBoardsIndex({
            boards: [{ id: "b1", name: "A | B", columns: 0, cards: 0 }],
        });
        expect(out).toContain("| b1 | A \\| B | 0 | 0 |");
    });
});

describe("renderBoardSnapshot", () => {
    const fixture = {
        board: { id: "b1", name: "Work" },
        tags: [
            { id: "t-urgent", name: "urgent", color: null },
            { id: "t-wip", name: "wip", color: null },
        ],
        columns: [
            {
                column: { id: "c1", board_id: "b1", name: "To Do" },
                cards: [
                    {
                        card: {
                            id: "card1",
                            column_id: "c1",
                            title: "Buy milk",
                            body_text: "from the corner shop",
                            due_at: Date.UTC(2026, 5, 23),
                        },
                        tag_ids: ["t-urgent"],
                    },
                    {
                        card: {
                            id: "card2",
                            column_id: "c1",
                            title: "Review PR",
                            body_text: null,
                            due_at: null,
                        },
                        tag_ids: [],
                    },
                ],
            },
            {
                column: { id: "c2", board_id: "b1", name: "Done" },
                cards: [],
            },
        ],
    };

    it("renders board, tags, columns, cards with due dates", () => {
        const out = renderBoardSnapshot(fixture);
        expect(out).toContain("# Board: Work");
        expect(out).toContain("Tags: `urgent`, `wip`");
        expect(out).toContain("## To Do (2 cards)");
        expect(out).toContain("- **Buy milk** [#urgent] — due 2026-06-23");
        expect(out).toContain("  from the corner shop");
        expect(out).toContain("- **Review PR**");
        expect(out).toContain("## Done (0 cards)");
        expect(out).toContain("_(empty)_");
    });

    it("omits Tags line when none", () => {
        const out = renderBoardSnapshot({
            board: { name: "X" },
            tags: [],
            columns: [],
        });
        expect(out).not.toMatch(/Tags:/);
        expect(out).toContain("_No columns._");
    });

    it("handles missing body cleanly", () => {
        const out = renderBoardSnapshot({
            board: { name: "X" },
            tags: [],
            columns: [
                {
                    column: { name: "Col" },
                    cards: [{ card: { title: "T", body_text: null }, tag_ids: [] }],
                },
            ],
        });
        expect(out).toContain("- **T**");
        // No newline+excerpt when body is missing.
        expect(out).not.toMatch(/- \*\*T\*\*\n  /);
    });

    it("skips unknown tag ids referenced by a card", () => {
        const out = renderBoardSnapshot({
            board: { name: "X" },
            tags: [{ id: "real", name: "real" }],
            columns: [
                {
                    column: { name: "Col" },
                    cards: [
                        {
                            card: { title: "T", body_text: null },
                            tag_ids: ["real", "ghost"],
                        },
                    ],
                },
            ],
        });
        expect(out).toContain("[#real]");
        expect(out).not.toContain("ghost");
    });
});

describe("renderCard", () => {
    it("renders all fields when present", () => {
        const out = renderCard({
            card: {
                id: "c1",
                column_id: "col1",
                title: "Buy milk",
                body_text: "from the corner shop on the way home",
                due_at: Date.UTC(2026, 5, 23),
                archived_at: null,
            },
            column: { id: "col1", name: "To Do" },
            board: { id: "b1", name: "Work" },
            tags: [{ id: "t1", name: "urgent" }],
        });
        expect(out).toContain("# Card: Buy milk");
        expect(out).toContain("Board: **Work**");
        expect(out).toContain("Column: **To Do**");
        expect(out).toContain("Due: 2026-06-23");
        expect(out).toContain("Tags: `urgent`");
        expect(out).toContain("from the corner shop on the way home");
    });

    it("falls back to raw column_id when column object missing", () => {
        const out = renderCard({
            card: { title: "T", column_id: "col-x", body_text: null, due_at: null },
        });
        expect(out).toContain("Column id: `col-x`");
        expect(out).toContain("_(empty)_");
    });

    it("marks archived cards", () => {
        const out = renderCard({
            card: { title: "T", column_id: "c", body_text: null, archived_at: 1 },
        });
        expect(out).toContain("**[archived]**");
    });
});

describe("excerpt", () => {
    it("caps excerpt at EXCERPT_MAX_CHARS with ellipsis", () => {
        const big = "x".repeat(_EXCERPT_MAX_CHARS + 200);
        const out = renderCard({ card: { title: "T", body_text: big } });
        // Trailing ellipsis present; total body line bounded.
        const bodyLine = out.split("## Body\n")[1];
        expect(bodyLine.length).toBe(_EXCERPT_MAX_CHARS);
        expect(bodyLine.endsWith("…")).toBe(true);
    });

    it("collapses whitespace in body excerpt", () => {
        const out = renderCard({
            card: { title: "T", body_text: "a\n\nb   c\td" },
        });
        expect(out).toContain("a b c d");
    });
});

describe("extractTextFromYjsBlob", () => {
    it("returns empty string for null/empty input", () => {
        expect(extractTextFromYjsBlob(null)).toBe("");
        expect(extractTextFromYjsBlob("")).toBe("");
        expect(extractTextFromYjsBlob(undefined)).toBe("");
    });

    it("returns empty string for non-base64 garbage", () => {
        // Must not throw.
        expect(extractTextFromYjsBlob("not-base64!!!")).toBe("");
    });

    it("decodes a real Yjs document and pulls text out", async () => {
        const Y = await import("yjs");
        const doc = new Y.Doc();
        const text = doc.getText("body");
        text.insert(0, "hello world");
        const update = Y.encodeStateAsUpdate(doc);
        const b64 = Buffer.from(update).toString("base64");
        const extracted = extractTextFromYjsBlob(b64);
        expect(extracted).toContain("hello world");
    });

    it("caps extraction at EXCERPT_MAX_CHARS for a giant YText body", async () => {
        const Y = await import("yjs");
        const doc = new Y.Doc();
        const text = doc.getText("body");
        // Insert in 100-char chunks so Yjs produces multiple Items — proves
        // the walk-bound short-circuits the linked list rather than just
        // slicing a single ContentString at the end.
        const chunk = "x".repeat(100);
        for (let i = 0; i < 100; i += 1) text.insert(text.length, chunk);
        const b64 = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");

        const t0 = Date.now();
        const extracted = extractTextFromYjsBlob(b64);
        const elapsed = Date.now() - t0;

        // Total source is 10_000 chars; cap is 500. Length budget is cap + 1
        // for the trailing ellipsis.
        expect(extracted.length).toBeLessThanOrEqual(_EXCERPT_MAX_CHARS + 1);
        expect(extracted.endsWith("…")).toBe(true);
        // Soft wall-clock guard — a full traversal of 10k chars is still
        // sub-second, but a regression that drops the cap would balloon
        // proportionally on real BlockSuite docs.
        expect(elapsed).toBeLessThan(250);
    });

    it("extracts text from a BlockSuite-shaped Yjs doc (nested YMap with prop:text YText)", async () => {
        const Y = await import("yjs");
        // Mirror BlockSuite's on-wire layout: a top-level YMap `blocks` keyed
        // by block id, each value a YMap with a `prop:text` YText child plus
        // assorted flags. This is the shape that our synthetic Y.Text-only
        // tests don't exercise — a regression in `collectText`'s YMap branch
        // would silently break real card bodies.
        const doc = new Y.Doc();
        const blocks = doc.getMap("blocks");
        const block = new Y.Map();
        const yText = new Y.Text();
        yText.insert(0, "Hello from BlockSuite");
        block.set("prop:text", yText);
        block.set("sys:flavour", "affine:paragraph");
        blocks.set("block-1", block);

        const b64 = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
        const extracted = extractTextFromYjsBlob(b64);
        expect(extracted).toContain("Hello from BlockSuite");
    });
});
