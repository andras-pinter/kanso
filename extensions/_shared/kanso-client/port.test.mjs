import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parsePortFile, portFilePath, readPortFile } from "./port.mjs";

describe("parsePortFile", () => {
    it("parses well-formed input", () => {
        expect(parsePortFile("port=54321\ntoken=deadbeef\n")).toEqual({
            port: 54321,
            token: "deadbeef",
        });
    });

    it("tolerates CRLF and surrounding whitespace", () => {
        expect(parsePortFile(" port = 1024 \r\n token = abc \r\n")).toEqual({
            port: 1024,
            token: "abc",
        });
    });

    it("throws on missing token", () => {
        expect(() => parsePortFile("port=8080\n")).toThrow(/missing/);
    });

    it("throws on invalid port", () => {
        expect(() => parsePortFile("port=notanumber\ntoken=abc\n")).toThrow(/invalid/);
        expect(() => parsePortFile("port=70000\ntoken=abc\n")).toThrow(/invalid/);
    });

    it("throws KANSO_PORT_EMPTY for whitespace-only input", () => {
        // The writer briefly truncates the file before rewriting; an empty
        // read must be retryable, not a hard parse failure.
        expect(() => parsePortFile("")).toThrowError(
            expect.objectContaining({ code: "KANSO_PORT_EMPTY" }),
        );
        expect(() => parsePortFile("   \n\r\n")).toThrowError(
            expect.objectContaining({ code: "KANSO_PORT_EMPTY" }),
        );
    });
});

describe("portFilePath", () => {
    it("ends with the dev.kanso.desktop/port suffix", () => {
        expect(portFilePath().endsWith(`dev.kanso.desktop${pathSep()}port`)).toBe(true);
    });
});

describe("readPortFile", () => {
    it("returns parsed values for a valid file", async () => {
        const dir = await mkdtemp(join(tmpdir(), "kanso-port-"));
        const file = join(dir, "port");
        await writeFile(file, "port=9999\ntoken=hex\n");
        await expect(readPortFile(file)).resolves.toEqual({ port: 9999, token: "hex" });
    });

    it("throws KANSO_PORT_MISSING for missing file", async () => {
        const file = join(tmpdir(), `kanso-missing-${Date.now()}`);
        await expect(readPortFile(file)).rejects.toMatchObject({
            code: "KANSO_PORT_MISSING",
        });
    });
});

const pathSep = () => (process.platform === "win32" ? "\\" : "/");
