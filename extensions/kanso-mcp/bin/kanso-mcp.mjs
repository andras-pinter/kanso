#!/usr/bin/env node
// kanso-mcp — Model Context Protocol stdio server for kanso.
//
// MCP hosts (Claude Desktop, Cursor, VS Code Copilot Chat, Zed, …) spawn this
// binary as a subprocess and exchange JSON-RPC messages over stdin/stdout.
// All logging must go to stderr to avoid corrupting the JSON-RPC frame.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@kanso/client";

import { createKansoMcpServer } from "../lib/server.mjs";

const main = async () => {
    const client = createClient();
    const server = createKansoMcpServer({ client });
    const transport = new StdioServerTransport();
    await server.connect(transport);
};

main().catch((err) => {
    process.stderr.write(
        `[kanso-mcp] fatal: ${err instanceof Error && err.stack ? err.stack : String(err)}\n`,
    );
    if (err && typeof err === "object" && /** @type {any} */ (err).code === "KANSO_PORT_MISSING") {
        process.stderr.write(
            "[kanso-mcp] is the kanso desktop app running? the port file is missing.\n",
        );
    }
    process.exit(1);
});
