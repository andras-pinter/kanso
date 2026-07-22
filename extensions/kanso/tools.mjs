/**
 * Tool definitions for the Copilot CLI extension. Kept separate from
 * extension.mjs (which calls joinSession) so tests can import the list
 * without spawning the CLI.
 */

import * as h from "./handlers.mjs";

/** Wrap a handler so unhandled errors surface as a single user-facing line. */
export const wrap = (client, fn) => async (/** @type {any} */ args) => {
    try {
        return await fn(client, args);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[kanso ext] ${err instanceof Error && err.stack ? err.stack : msg}\n`);
        return msg.startsWith("kanso:") ? msg : `kanso: ${msg}`;
    }
};

const strId = (desc) => ({ type: "string", description: desc });
const num = (desc) => ({ type: "number", description: desc });

/**
 * Build the full tool list bound to a client. Kept as a factory so tests
 * can inject a fake client.
 */
export const buildTools = (client, kansoTools) => [
    ...kansoTools,

    // ---------- boards ----------
    {
        name: "board_list",
        description: "List boards. Returns JSON array of BoardDto. Idempotent.",
        parameters: {
            type: "object",
            properties: {
                limit: num("Max rows (default 100, max 500)."),
                offset: num("Row offset for pagination."),
            },
        },
        handler: wrap(client, h.boardList),
    },
    {
        name: "board_get",
        description: "Fetch one board by id. Returns JSON BoardDto. Idempotent.",
        parameters: {
            type: "object",
            properties: { id: strId("Board id.") },
            required: ["id"],
        },
        handler: wrap(client, h.boardGet),
    },
    {
        name: "board_create",
        description:
            "Create a board. Seeds the four fixed columns (Incoming / Todo / In Progress / Done). Returns the new BoardDto.",
        parameters: {
            type: "object",
            properties: { name: strId("Board name.") },
            required: ["name"],
        },
        handler: wrap(client, h.boardCreate),
    },
    {
        name: "board_update",
        description:
            "Patch a board (rename, recolor). Returns the updated BoardDto. Idempotent per field.",
        parameters: {
            type: "object",
            properties: {
                id: strId("Board id."),
                patch: {
                    type: "object",
                    properties: {
                        name: strId("New name."),
                        color: {
                            type: ["string", "null"],
                            description: "New colour (hex like #RRGGBB), or null to clear.",
                        },
                    },
                },
            },
            required: ["id", "patch"],
        },
        handler: wrap(client, h.boardUpdate),
    },
    {
        name: "board_delete",
        description: "Hard-delete a board and cascade its columns/cards. Returns null. Destructive.",
        parameters: {
            type: "object",
            properties: { id: strId("Board id.") },
            required: ["id"],
        },
        handler: wrap(client, h.boardDelete),
    },
    {
        name: "board_card_tags",
        description:
            "List (card_id, tag_id) links across every card on a board. Returns JSON array.",
        parameters: {
            type: "object",
            properties: { id: strId("Board id.") },
            required: ["id"],
        },
        handler: wrap(client, h.boardCardTags),
    },

    // ---------- columns ----------
    //
    // Columns are fixed (Incoming / Todo / In Progress / Done) and seeded on
    // board create. Only a read helper is exposed.
    {
        name: "column_list",
        description: "List columns on a board. Returns JSON array of ColumnDto.",
        parameters: {
            type: "object",
            properties: {
                board_id: strId("Board id."),
                limit: num("Max rows."),
                offset: num("Row offset."),
            },
            required: ["board_id"],
        },
        handler: wrap(client, h.columnList),
    },

    // ---------- cards ----------
    {
        name: "card_list",
        description:
            "List cards in a column. Returns a JSON array of CardListDto (no body_markdown; use has_body to check whether the card has notes, and card_body_get for the full markdown).",
        parameters: {
            type: "object",
            properties: {
                column_id: strId("Column id."),
                limit: num("Max rows."),
                offset: num("Row offset."),
            },
            required: ["column_id"],
        },
        handler: wrap(client, h.cardList),
    },
    {
        name: "card_get",
        description:
            "Fetch one card by id. Returns the full CardDto (title, position, due_at, body_markdown, updated_at). Idempotent.",
        parameters: {
            type: "object",
            properties: { id: strId("Card id.") },
            required: ["id"],
        },
        handler: wrap(client, h.cardGet),
    },
    {
        name: "card_create",
        description:
            "Create a card in a column. Returns the new CardListDto (thin shape: no body_markdown). Fetch card_get to see the full card.",
        parameters: {
            type: "object",
            properties: {
                column_id: strId("Column id."),
                title: strId("Card title."),
            },
            required: ["column_id", "title"],
        },
        handler: wrap(client, h.cardCreate),
    },
    {
        name: "card_update",
        description:
            "Patch a card (title, due_at, body_markdown). Returns the updated CardListDto (thin shape: has_body reflects the new body, but body_markdown is not echoed — use card_body_get to read it back). Idempotent per field.",
        parameters: {
            type: "object",
            properties: {
                id: strId("Card id."),
                patch: {
                    type: "object",
                    properties: {
                        title: strId("New title."),
                        body_markdown: {
                            type: ["string", "null"],
                            description: "New markdown body, or null to clear.",
                        },
                        due_at: {
                            type: ["integer", "null"],
                            description: "Due date as Unix epoch milliseconds, or null to clear.",
                        },
                    },
                },
            },
            required: ["id", "patch"],
        },
        handler: wrap(client, h.cardUpdate),
    },
    {
        name: "card_move",
        description:
            "Move a card to another column, optionally between two sibling cards. Returns the updated CardListDto (thin shape: no body_markdown).",
        parameters: {
            type: "object",
            properties: {
                id: strId("Card id."),
                target_column_id: strId("Destination column id."),
                before: strId("Card id it should sit before in the target column."),
                after: strId("Card id it should sit after in the target column."),
            },
            required: ["id", "target_column_id"],
        },
        handler: wrap(client, h.cardMove),
    },
    {
        name: "card_delete",
        description: "Hard-delete a card and its tag links. Returns null. Destructive.",
        parameters: {
            type: "object",
            properties: { id: strId("Card id.") },
            required: ["id"],
        },
        handler: wrap(client, h.cardDelete),
    },
    {
        name: "card_body_get",
        description:
            "Fetch a card's body as { body_markdown, updated_at }. body_markdown may be null on a fresh card. Use this after card_list / card_search to read a specific card's markdown (list responses only expose has_body).",
        parameters: {
            type: "object",
            properties: { id: strId("Card id.") },
            required: ["id"],
        },
        handler: wrap(client, h.cardBodyGet),
    },
    {
        name: "card_body_set",
        description:
            "Replace a card's body with markdown. Pass an empty string to clear the body. Returns the updated CardListDto (thin shape: has_body reflects the new body, but body_markdown is not echoed — use card_body_get to read it back).",
        parameters: {
            type: "object",
            properties: {
                id: strId("Card id."),
                body_markdown: {
                    type: "string",
                    description:
                        "Markdown body. Empty string clears the body to NULL. The same string is indexed by FTS.",
                },
            },
            required: ["id", "body_markdown"],
        },
        handler: wrap(client, h.cardBodySet),
    },

    // ---------- tags ----------
    {
        name: "tag_list",
        description: "List tags. Returns JSON array of TagDto.",
        parameters: {
            type: "object",
            properties: {
                limit: num("Max rows."),
                offset: num("Row offset."),
            },
        },
        handler: wrap(client, h.tagList),
    },
    {
        name: "tag_get",
        description: "Fetch a tag by id. Returns TagDto.",
        parameters: {
            type: "object",
            properties: { id: strId("Tag id.") },
            required: ["id"],
        },
        handler: wrap(client, h.tagGet),
    },
    {
        name: "tag_create",
        description: "Create a tag. Returns the new TagDto.",
        parameters: {
            type: "object",
            properties: {
                name: strId("Tag name."),
                color: strId("Optional hex colour."),
            },
            required: ["name"],
        },
        handler: wrap(client, h.tagCreate),
    },
    {
        name: "tag_update",
        description: "Patch a tag (rename, recolor). Returns the updated TagDto.",
        parameters: {
            type: "object",
            properties: {
                id: strId("Tag id."),
                patch: {
                    type: "object",
                    properties: {
                        name: strId("New name."),
                        color: strId("New colour, or null to clear."),
                    },
                },
            },
            required: ["id", "patch"],
        },
        handler: wrap(client, h.tagUpdate),
    },
    {
        name: "tag_delete",
        description: "Hard-delete a tag and its links. Returns null. Destructive.",
        parameters: {
            type: "object",
            properties: { id: strId("Tag id.") },
            required: ["id"],
        },
        handler: wrap(client, h.tagDelete),
    },
    {
        name: "tag_cards",
        description:
            "List cards linked to a tag. Returns JSON array of CardListDto (thin shape: no body_markdown; call card_body_get to read a specific card's markdown).",
        parameters: {
            type: "object",
            properties: {
                id: strId("Tag id."),
                limit: num("Max rows."),
                offset: num("Row offset."),
            },
            required: ["id"],
        },
        handler: wrap(client, h.tagCards),
    },
    {
        name: "card_tags",
        description: "List tags on a card. Returns JSON array of TagDto.",
        parameters: {
            type: "object",
            properties: {
                card_id: strId("Card id."),
                limit: num("Max rows."),
                offset: num("Row offset."),
            },
            required: ["card_id"],
        },
        handler: wrap(client, h.cardTags),
    },
    {
        name: "card_tag_add",
        description:
            "Link a tag to a card. Returns the updated CardListDto (thin shape: no body_markdown; call card_tags for the resulting tag set). Idempotent.",
        parameters: {
            type: "object",
            properties: {
                card_id: strId("Card id."),
                tag_id: strId("Tag id."),
            },
            required: ["card_id", "tag_id"],
        },
        handler: wrap(client, h.cardTagAdd),
    },
    {
        name: "card_tag_remove",
        description:
            "Unlink a tag from a card. Returns the updated CardListDto (thin shape: no body_markdown; call card_tags for the resulting tag set). Idempotent.",
        parameters: {
            type: "object",
            properties: {
                card_id: strId("Card id."),
                tag_id: strId("Tag id."),
            },
            required: ["card_id", "tag_id"],
        },
        handler: wrap(client, h.cardTagRemove),
    },

    // ---------- search ----------
    {
        name: "card_search",
        description:
            "Full-text search across cards. Supports FTS5 syntax. Returns JSON array of CardSearchHit.",
        parameters: {
            type: "object",
            properties: {
                q: strId("Search query (FTS5)."),
                limit: num("Max hits."),
                offset: num("Row offset."),
            },
            required: ["q"],
        },
        handler: wrap(client, h.cardSearch),
    },
];
