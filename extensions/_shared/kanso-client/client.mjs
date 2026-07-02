import { readPortFile } from "./port.mjs";

const DEFAULT_TIMEOUT_MS = 5000;
const EMPTY_PORT_FILE_BACKOFF_MS = 50;

/**
 * Typed HTTP error so resource fetchers can branch on `.status` (e.g. render
 * a friendly "board too large" for 409 and "not found" for 404). Extends
 * `Error` so existing `toThrow(/regex/)` assertions continue to match.
 */
export class KansoApiError extends Error {
    /**
     * @param {number} status
     * @param {string} message
     * @param {string} [detail]
     */
    constructor(status, message, detail = "") {
        super(message);
        this.name = "KansoApiError";
        this.status = status;
        this.detail = detail;
    }
}

/**
 * @typedef {Object} ClientOptions
 * @property {() => Promise<{ port: number, token: string }>} [readPort]
 * @property {typeof fetch} [fetchImpl]
 * @property {number} [timeoutMs]
 * @property {(ms: number) => Promise<void>} [sleep]
 */

/**
 * @typedef {{ auth: boolean, conn: boolean }} RetryBudget
 */

/**
 * Pull the underlying cause `code` / `name` out of a thrown error. Node 18+
 * fetch (undici) wraps connection failures as `TypeError("fetch failed")` with
 * the real ECONNREFUSED / AbortError on `err.cause`, so we have to look both
 * places to detect them.
 *
 * @param {unknown} err
 * @returns {{ code: string | undefined, name: string | undefined, message: string }}
 */
const unwrapError = (err) => {
    const top = /** @type {any} */ (err);
    const cause = top?.cause;
    return {
        code: top?.code ?? cause?.code,
        name: top?.name ?? cause?.name,
        message: top?.message ?? String(err),
    };
};

/**
 * HTTP client that lazily reads the port file and retries once per failure
 * class (auth + conn) so a desktop restart that rotates the token recovers in
 * a single follow-up request.
 *
 * @param {ClientOptions} [options]
 */
export const createClient = (options = {}) => {
    const readPort = options.readPort ?? (() => readPortFile());
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const sleep =
        options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

    /** @type {{ gen: number, value: { port: number, token: string } } | null} */
    let cached = null;
    /** @type {{ gen: number, promise: Promise<{ port: number, token: string }> } | null} */
    let inflight = null;
    let gen = 0;

    const load = async () => {
        if (cached) return cached.value;
        if (inflight) return inflight.promise;
        const myGen = gen;
        const promise = (async () => {
            const value = await readPort();
            // Only install the result if no concurrent invalidate happened.
            if (gen === myGen) cached = { gen: myGen, value };
            return value;
        })();
        inflight = { gen: myGen, promise };
        try {
            return await promise;
        } finally {
            if (inflight?.gen === myGen) inflight = null;
        }
    };
    const invalidate = () => {
        gen += 1;
        cached = null;
        inflight = null;
    };

    /**
     * @param {string} method
     * @param {string} path
     * @param {unknown} [body]
     * @param {RetryBudget} [retried]
     * @returns {Promise<any>}
     */
    const request = async (method, path, body, retried = { auth: false, conn: false }) => {
        /** @type {{ port: number, token: string }} */
        let credentials;
        try {
            credentials = await load();
        } catch (err) {
            const e = unwrapError(err);
            if (e.code === "KANSO_PORT_EMPTY" && !retried.conn) {
                await sleep(EMPTY_PORT_FILE_BACKOFF_MS);
                invalidate();
                return request(method, path, body, { ...retried, conn: true });
            }
            throw err;
        }
        const { port, token } = credentials;
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
            const e = unwrapError(err);

            // Connection-class failures retry once with a fresh port-file read.
            const transient = e.code === "ECONNREFUSED" || e.code === "ECONNRESET";
            if (transient && !retried.conn) {
                invalidate();
                return request(method, path, body, { ...retried, conn: true });
            }
            if (e.name === "TimeoutError" || e.name === "AbortError") {
                throw new Error("kanso: api request timed out");
            }
            if (e.code === "ECONNREFUSED") {
                throw new Error(
                    `kanso: desktop app is not running or not listening on port ${port}`,
                );
            }
            throw new Error(`kanso: network error (${e.message})`);
        }

        if (res.status === 401 && !retried.auth) {
            invalidate();
            return request(method, path, body, { ...retried, auth: true });
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
        put: (/** @type {string} */ path, /** @type {unknown} */ body) =>
            request("PUT", path, body ?? {}),
        delete: (/** @type {string} */ path) => request("DELETE", path),
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
 * @returns {KansoApiError}
 */
const mapHttpError = (status, detail) => {
    if (status === 401)
        return new KansoApiError(401, "kanso: auth failed, restart kanso app", detail);
    if (status === 403) return new KansoApiError(403, "kanso: host check failed", detail);
    if (status === 404) {
        return new KansoApiError(
            404,
            `kanso: not found${detail ? ` (${detail})` : ""}`,
            detail,
        );
    }
    if (status === 409) {
        return new KansoApiError(
            409,
            `kanso: conflict${detail ? ` (${detail})` : ""}`,
            detail,
        );
    }
    if (status === 413)
        return new KansoApiError(413, "kanso: payload too large (1 MiB API limit)", detail);
    if (status === 422 || status === 400) {
        return new KansoApiError(
            status,
            `kanso: invalid request${detail ? ` (${detail})` : ""}`,
            detail,
        );
    }
    if (status >= 500) return new KansoApiError(status, "kanso: api server error", detail);
    return new KansoApiError(
        status,
        `kanso: http ${status}${detail ? ` (${detail})` : ""}`,
        detail,
    );
};
