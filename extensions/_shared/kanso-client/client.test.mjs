import { describe, expect, it, vi } from "vitest";

import { createClient, KansoApiError } from "./client.mjs";

/**
 * @param {number} status
 * @param {unknown} body
 * @param {string} [contentType]
 */
const jsonRes = (status, body, contentType = "application/json") =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": contentType },
    });

/**
 * Build an error matching the real shape Node 18+ fetch (undici) throws for
 * connection failures: a top-level `TypeError("fetch failed")` whose `cause`
 * carries the actual `code`.
 *
 * @param {string} code
 * @param {string} [innerMsg]
 */
const undiciConnectErr = (code, innerMsg = `connect ${code} 127.0.0.1:1`) => {
    const inner = Object.assign(new Error(innerMsg), { code });
    return Object.assign(new TypeError("fetch failed"), { cause: inner });
};

describe("createClient", () => {
    it("attaches bearer token and parses JSON on 200", async () => {
        const fetchImpl = vi.fn(async (/** @type {string} */ url, /** @type {RequestInit} */ init) => {
            expect(url).toBe("http://127.0.0.1:1234/boards");
            expect(init.headers).toMatchObject({ Authorization: "Bearer tok" });
            return jsonRes(200, [{ id: "b1" }]);
        });
        const client = createClient({
            readPort: async () => ({ port: 1234, token: "tok" }),
            fetchImpl,
        });
        await expect(client.get("/boards")).resolves.toEqual([{ id: "b1" }]);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("maps 401 to auth message after one retry", async () => {
        const fetchImpl = vi.fn(async () => jsonRes(401, { error: "unauthorized" }));
        const readPort = vi
            .fn()
            .mockResolvedValueOnce({ port: 1, token: "a" })
            .mockResolvedValueOnce({ port: 1, token: "a" });
        const client = createClient({ readPort, fetchImpl });
        await expect(client.get("/boards")).rejects.toThrow(/auth failed/);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(readPort).toHaveBeenCalledTimes(2);
    });

    it("maps 413 to payload-too-large message", async () => {
        const client = createClient({
            readPort: async () => ({ port: 1, token: "a" }),
            fetchImpl: async () => jsonRes(413, "too big", "text/plain"),
        });
        await expect(client.post("/columns/x/cards", { title: "x" })).rejects.toThrow(/1 MiB/);
    });

    it("retries once on ECONNREFUSED with a fresh port read", async () => {
        let attempt = 0;
        const fetchImpl = vi.fn(async () => {
            attempt += 1;
            if (attempt === 1) throw undiciConnectErr("ECONNREFUSED");
            return jsonRes(200, { ok: true });
        });
        const readPort = vi.fn(async () => ({ port: 1, token: "a" }));
        const client = createClient({ readPort, fetchImpl });
        await expect(client.get("/healthz")).resolves.toEqual({ ok: true });
        expect(readPort).toHaveBeenCalledTimes(2);
    });

    it("retries on ECONNREFUSED nested in TypeError cause (real undici shape)", async () => {
        // Regression lock-down: if the unwrap is reverted to `e?.code` only,
        // this test fails because the top-level TypeError has no `code` and
        // the retry path is skipped.
        let attempt = 0;
        const fetchImpl = vi.fn(async () => {
            attempt += 1;
            if (attempt === 1) throw undiciConnectErr("ECONNREFUSED");
            return jsonRes(200, { recovered: true });
        });
        const readPort = vi.fn(async () => ({ port: 5, token: "tok" }));
        const client = createClient({ readPort, fetchImpl });
        await expect(client.get("/boards")).resolves.toEqual({ recovered: true });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(readPort).toHaveBeenCalledTimes(2);
    });

    it("surfaces friendly message when ECONNREFUSED persists", async () => {
        const fetchImpl = vi.fn(async () => {
            throw undiciConnectErr("ECONNREFUSED");
        });
        const client = createClient({
            readPort: async () => ({ port: 9999, token: "a" }),
            fetchImpl,
        });
        await expect(client.get("/boards")).rejects.toThrow(/not running or not listening/);
    });

    it("recovers when ECONNREFUSED is followed by 401 on retry", async () => {
        // Cross-class recovery: conn-failure → retry → 401 → retry → 200.
        // Bounded at one retry per class, so this should land on the third
        // fetch call, not bail because a shared `isRetry` flag is set.
        let attempt = 0;
        const fetchImpl = vi.fn(async () => {
            attempt += 1;
            if (attempt === 1) throw undiciConnectErr("ECONNREFUSED");
            if (attempt === 2) return jsonRes(401, { error: "unauthorized" });
            return jsonRes(200, { ok: true });
        });
        const readPort = vi.fn(async () => ({ port: 1, token: "a" }));
        const client = createClient({ readPort, fetchImpl });
        await expect(client.get("/boards")).resolves.toEqual({ ok: true });
        expect(fetchImpl).toHaveBeenCalledTimes(3);
        // Two invalidations (conn + auth) → three port reads.
        expect(readPort).toHaveBeenCalledTimes(3);
    });

    it("concurrent requests during invalidate don't restore stale cache", async () => {
        // Race scenario: a load() is in flight; invalidate() runs before the
        // readPort promise resolves. The late resolution must NOT install
        // itself into the (now-fresh) cache slot. A subsequent request must
        // see an empty cache and trigger a new readPort.
        /** @type {((v: { port: number, token: string }) => void)[]} */
        const resolvers = [];
        const readPort = vi.fn(
            () =>
                new Promise((resolve) => {
                    resolvers.push(resolve);
                }),
        );
        const fetchImpl = vi.fn(async () => jsonRes(200, { ok: true }));
        const client = createClient({ readPort, fetchImpl });

        // Start request A → triggers readPort (still pending).
        const a = client.get("/a");
        await Promise.resolve();
        expect(resolvers.length).toBe(1);

        // Externally invalidate while readPort is in flight.
        client.invalidate();

        // Now resolve the original readPort. Without gen guard, this would
        // write "stale" into the cache slot that was just invalidated.
        resolvers[0]({ port: 1, token: "stale" });
        await a;

        // Subsequent request: cache should be empty → readPort called again.
        const b = client.get("/b");
        await Promise.resolve();
        expect(resolvers.length).toBe(2);
        resolvers[1]({ port: 1, token: "fresh" });
        await b;

        expect(readPort).toHaveBeenCalledTimes(2);
    });

    it("posts JSON body with content-type", async () => {
        const fetchImpl = vi.fn(async (_url, /** @type {RequestInit} */ init) => {
            expect(init.method).toBe("POST");
            expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
            expect(init.body).toBe('{"title":"hi"}');
            return jsonRes(201, { id: "c1", title: "hi" });
        });
        const client = createClient({
            readPort: async () => ({ port: 1, token: "a" }),
            fetchImpl,
        });
        await expect(client.post("/columns/x/cards", { title: "hi" })).resolves.toEqual({
            id: "c1",
            title: "hi",
        });
    });

    it("throws KansoApiError with .status for HTTP error responses", async () => {
        const fetchImpl = vi.fn(async () =>
            jsonRes(409, { error: "board has 1500 cards, cap is 1000" }),
        );
        const client = createClient({
            readPort: async () => ({ port: 1, token: "a" }),
            fetchImpl,
        });
        try {
            await client.get("/boards/huge/_full");
            throw new Error("expected throw");
        } catch (err) {
            expect(err).toBeInstanceOf(KansoApiError);
            expect(err.status).toBe(409);
            expect(err.detail).toMatch(/1500 cards/);
        }
    });
});
