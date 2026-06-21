import { readPortFile } from "./port.mjs";

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * @typedef {Object} ClientOptions
 * @property {() => Promise<{ port: number, token: string }>} [readPort]
 * @property {typeof fetch} [fetchImpl]
 * @property {number} [timeoutMs]
 */

/**
 * HTTP client that lazily reads the port file and retries once on auth/conn
 * failures in case the desktop app restarted and rotated its token.
 *
 * @param {ClientOptions} [options]
 */
export const createClient = (options = {}) => {
    const readPort = options.readPort ?? (() => readPortFile());
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    /** @type {{ port: number, token: string } | null} */
    let cached = null;

    const load = async () => {
        if (cached === null) cached = await readPort();
        return cached;
    };
    const invalidate = () => {
        cached = null;
    };

    /**
     * @param {string} method
     * @param {string} path
     * @param {unknown} [body]
     * @param {boolean} [isRetry]
     * @returns {Promise<any>}
     */
    const request = async (method, path, body, isRetry = false) => {
        const { port, token } = await load();
        const url = `http://127.0.0.1:${port}${path}`;
        /** @type {Record<string, string>} */
        const headers = { Authorization: `Bearer ${token}` };
        /** @type {RequestInit} */
        const init = { method, headers, signal: AbortSignal.timeout(timeoutMs) };
        if (body !== undefined) {
            headers["Content-Type"] = "application/json";
            init.body = JSON.stringify(body);
        }

        let res;
        try {
            res = await fetchImpl(url, init);
        } catch (err) {
            const e = /** @type {NodeJS.ErrnoException & { name?: string }} */ (err);
            // ECONNREFUSED, app restarted on a new port, etc. Retry once with a
            // fresh port-file read before declaring the app dead.
            const transient = e?.code === "ECONNREFUSED" || e?.code === "ECONNRESET";
            if (transient && !isRetry) {
                invalidate();
                return request(method, path, body, true);
            }
            if (e?.name === "TimeoutError" || e?.name === "AbortError") {
                throw new Error("kanso: api request timed out");
            }
            if (e?.code === "ECONNREFUSED") {
                throw new Error(`kanso: desktop app is not running or not listening on port ${port}`);
            }
            throw new Error(`kanso: network error (${e?.message ?? String(err)})`);
        }

        if (res.status === 401 && !isRetry) {
            invalidate();
            return request(method, path, body, true);
        }

        if (!res.ok) {
            const detail = await readErrorBody(res);
            throw mapHttpError(res.status, detail);
        }

        if (res.status === 204) return null;
        const ct = res.headers.get("content-type") ?? "";
        return ct.includes("application/json") ? res.json() : res.text();
    };

    return {
        get: (/** @type {string} */ path) => request("GET", path),
        post: (/** @type {string} */ path, /** @type {unknown} */ body) =>
            request("POST", path, body ?? {}),
        patch: (/** @type {string} */ path, /** @type {unknown} */ body) =>
            request("PATCH", path, body ?? {}),
        invalidate,
    };
};

/**
 * @param {Response} res
 * @returns {Promise<string>}
 */
const readErrorBody = async (res) => {
    try {
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
            const j = await res.json();
            if (j && typeof j.error === "string") return j.error;
            return JSON.stringify(j);
        }
        return await res.text();
    } catch {
        return "";
    }
};

/**
 * @param {number} status
 * @param {string} detail
 * @returns {Error}
 */
const mapHttpError = (status, detail) => {
    if (status === 401) return new Error("kanso: auth failed, restart kanso app");
    if (status === 403) return new Error("kanso: host check failed");
    if (status === 404) {
        return new Error(`kanso: not found${detail ? ` (${detail})` : ""}`);
    }
    if (status === 413) return new Error("kanso: payload too large (1 MiB API limit)");
    if (status === 422 || status === 400) {
        return new Error(`kanso: invalid request${detail ? ` (${detail})` : ""}`);
    }
    if (status >= 500) return new Error("kanso: api server error");
    return new Error(`kanso: http ${status}${detail ? ` (${detail})` : ""}`);
};
