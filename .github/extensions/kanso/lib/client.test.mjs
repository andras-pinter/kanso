import { describe, expect, it, vi } from "vitest";

import { createClient } from "./client.mjs";

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
            if (attempt === 1) {
                const err = /** @type {any} */ (new Error("connect ECONNREFUSED"));
                err.code = "ECONNREFUSED";
                throw err;
            }
            return jsonRes(200, { ok: true });
        });
        const readPort = vi.fn(async () => ({ port: 1, token: "a" }));
        const client = createClient({ readPort, fetchImpl });
        await expect(client.get("/healthz")).resolves.toEqual({ ok: true });
        expect(readPort).toHaveBeenCalledTimes(2);
    });

    it("surfaces friendly message when ECONNREFUSED persists", async () => {
        const fetchImpl = vi.fn(async () => {
            const err = /** @type {any} */ (new Error("connect ECONNREFUSED"));
            err.code = "ECONNREFUSED";
            throw err;
        });
        const client = createClient({
            readPort: async () => ({ port: 9999, token: "a" }),
            fetchImpl,
        });
        await expect(client.get("/boards")).rejects.toThrow(/not running or not listening/);
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
});
