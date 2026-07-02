// kanso — Copilot CLI extension. Talks to the in-process kanso-api over loopback
// using the bearer token written by the Tauri app to its app-data port file.
//
// Handlers live in @kanso/client as pure functions so they can be unit-tested
// without spawning the CLI or the api.

import { joinSession } from "@github/copilot-sdk/extension";

import {
    createClient,
    kansoAdd,
    kansoDone,
    kansoList,
    kansoMove,
    kansoSearch,
} from "@kanso/client";

import { buildTools, wrap } from "./tools.mjs";

const client = createClient();

const kansoTools = [
    {
        name: "kanso_list",
        description:
            "List kanso boards, columns, or cards. With no args: list boards. With board_id: list columns. With column_id: list cards.",
        parameters: {
            type: "object",
            properties: {
                board_id: { type: "string", description: "List columns on this board." },
                column_id: { type: "string", description: "List cards in this column." },
                include_archived: {
                    type: "boolean",
                    description: "Include archived rows. Default false.",
                },
            },
        },
        handler: wrap(client, kansoList),
    },
    {
        name: "kanso_add",
        description: "Create a new kanso card in the given column.",
        parameters: {
            type: "object",
            properties: {
                column_id: { type: "string", description: "Target column id." },
                title: { type: "string", description: "Card title." },
                body: {
                    type: "string",
                    description:
                        "Optional plaintext body. Stored as body_text; the BlockSuite Yjs body remains empty until edited in the app.",
                },
            },
            required: ["column_id", "title"],
        },
        handler: wrap(client, kansoAdd),
    },
    {
        name: "kanso_move",
        description:
            "Move a kanso card to another column. Appends to the end of the target column.",
        parameters: {
            type: "object",
            properties: {
                card_id: { type: "string", description: "Card id to move." },
                target_column_id: { type: "string", description: "Destination column id." },
            },
            required: ["card_id", "target_column_id"],
        },
        handler: wrap(client, kansoMove),
    },
    {
        name: "kanso_done",
        description: "Archive a kanso card (soft delete, sets archived_at).",
        parameters: {
            type: "object",
            properties: {
                card_id: { type: "string", description: "Card id to archive." },
            },
            required: ["card_id"],
        },
        handler: wrap(client, kansoDone),
    },
    {
        name: "kanso_search",
        description: "Full-text search across kanso cards.",
        parameters: {
            type: "object",
            properties: {
                q: { type: "string", description: "Search query (FTS5)." },
                include_archived: {
                    type: "boolean",
                    description: "Include archived cards. Default false.",
                },
                limit: {
                    type: "number",
                    description: "Max hits to return. Default 20, max 50.",
                },
                offset: { type: "number", description: "Row offset for pagination." },
            },
            required: ["q"],
        },
        handler: wrap(client, kansoSearch),
    },
];

await joinSession({
    tools: buildTools(client, kansoTools),
});

