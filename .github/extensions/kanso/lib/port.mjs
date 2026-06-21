import { readFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";

/**
 * Locate the kanso port file. The Tauri app writes it to
 * `app_data_dir().join("port")`, where `app_data_dir` follows the platform
 * convention with bundle identifier `dev.kanso.desktop`.
 *
 * @returns {string}
 */
export const portFilePath = () => {
    const id = "dev.kanso.desktop";
    const home = homedir();
    switch (platform()) {
        case "darwin":
            return join(home, "Library", "Application Support", id, "port");
        case "win32": {
            const appdata = process.env.APPDATA ?? join(home, "AppData", "Roaming");
            return join(appdata, id, "port");
        }
        default: {
            const xdg = process.env.XDG_DATA_HOME ?? join(home, ".local", "share");
            return join(xdg, id, "port");
        }
    }
};

/**
 * Parse the `key=value` lines produced by `crates/kanso-tauri/src/main.rs`.
 * Unknown keys are ignored; whitespace around `=` and trailing CR are tolerated.
 *
 * @param {string} text
 * @returns {{ port: number, token: string }}
 */
export const parsePortFile = (text) => {
    /** @type {Record<string, string>} */
    const fields = {};
    for (const raw of text.split("\n")) {
        const line = raw.replace(/\r$/, "").trim();
        if (line === "" || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq < 0) continue;
        const k = line.slice(0, eq).trim();
        const v = line.slice(eq + 1).trim();
        if (k !== "") fields[k] = v;
    }

    const portRaw = fields.port;
    const token = fields.token;
    if (portRaw === undefined || token === undefined || token === "") {
        throw new Error("port file missing port= or token=");
    }
    const port = Number.parseInt(portRaw, 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`port file has invalid port: ${portRaw}`);
    }
    return { port, token };
};

/**
 * Read and parse the port file. Throws a typed error when the file is missing
 * so callers can surface a friendly "app not running" message.
 *
 * @param {string} [path]
 * @returns {Promise<{ port: number, token: string }>}
 */
export const readPortFile = async (path = portFilePath()) => {
    let text;
    try {
        text = await readFile(path, "utf8");
    } catch (err) {
        const e = /** @type {NodeJS.ErrnoException} */ (err);
        if (e?.code === "ENOENT") {
            const missing = new Error(`kanso desktop app is not running (port file not found at ${path})`);
            /** @type {any} */ (missing).code = "KANSO_PORT_MISSING";
            throw missing;
        }
        throw err;
    }
    return parsePortFile(text);
};
