import { describe, expect, it } from "vitest";

import {
	decodeThemeImportResult,
	decodeThemeListResult,
	decodeThemeReadResourceBytes,
	decodeThemeVoid,
	frozenThemeReadResourceRequest,
	frozenThemeRemoveRequest,
} from "../../app/platform/tauri/theme-codec";

const contractError = { code: "IPC_CONTRACT_VIOLATION" };

const samplePackage = Object.freeze({
	id: "demo-publisher.demo-theme@1.0.0",
	publisher: "demo-publisher",
	name: "demo-theme",
	version: "1.0.0",
	themes: Object.freeze([
		Object.freeze({
			label: "Demo Dark",
			uiTheme: "vs-dark" as const,
			path: "themes/dark.json",
		}),
	]),
	resources: Object.freeze(["themes/dark.json"]),
	containsCode: false,
});

describe("theme codec requests", () => {
	it("builds a frozen own-data read-resource request from valid inputs", () => {
		const request = frozenThemeReadResourceRequest(
			"demo-publisher.demo-theme@1.0.0",
			"themes/dark.json",
		);
		expect(request).toEqual({
			packageId: "demo-publisher.demo-theme@1.0.0",
			relativePath: "themes/dark.json",
		});
		expect(Object.isFrozen(request)).toBe(true);
	});

	it("rejects a hostile or malformed package id", () => {
		for (const packageId of [
			"",
			"a/b",
			"..",
			".",
			"a b",
			"a\\b",
			"a:b",
			123,
			null,
			undefined,
		]) {
			expect(() =>
				frozenThemeReadResourceRequest(packageId, "themes/dark.json"),
			).toThrowError(
				expect.objectContaining({ code: "THEME_PACKAGE_NOT_FOUND" }),
			);
		}
	});

	it("rejects a hostile or malformed relative path", () => {
		for (const relativePath of [
			"",
			"/etc/passwd",
			"../escape",
			"a\\b",
			"a:b",
			123,
			null,
			undefined,
		]) {
			expect(() =>
				frozenThemeReadResourceRequest(
					"demo-publisher.demo-theme@1.0.0",
					relativePath,
				),
			).toThrowError(
				expect.objectContaining({ code: "THEME_RESOURCE_NOT_FOUND" }),
			);
		}
	});

	it("builds a frozen own-data remove request and rejects hostile ids", () => {
		const request = frozenThemeRemoveRequest("demo-publisher.demo-theme@1.0.0");
		expect(request).toEqual({ packageId: "demo-publisher.demo-theme@1.0.0" });
		expect(Object.isFrozen(request)).toBe(true);
		expect(() => frozenThemeRemoveRequest("a/b")).toThrowError(
			expect.objectContaining({ code: "THEME_PACKAGE_NOT_FOUND" }),
		);
	});
});

describe("decodeThemeImportResult", () => {
	it("decodes a cancelled result", () => {
		expect(decodeThemeImportResult({ status: "cancelled" })).toEqual({
			status: "cancelled",
		});
	});

	it("decodes an imported result with its package summary", () => {
		const result = decodeThemeImportResult({
			status: "imported",
			package: samplePackage,
		});
		expect(result).toEqual({ status: "imported", package: samplePackage });
		expect(Object.isFrozen(result)).toBe(true);
	});

	it("rejects an unknown status, extra fields, and a cancelled result carrying a package", () => {
		for (const value of [
			{ status: "unknown" },
			{ status: "cancelled", extra: 1 },
			{ status: "imported" },
			{ status: "imported", package: samplePackage, extra: 1 },
			null,
			"cancelled",
			[],
		]) {
			expect(() => decodeThemeImportResult(value)).toThrowError(
				expect.objectContaining(contractError),
			);
		}
	});

	it("rejects a package summary missing a required field or carrying an extra one", () => {
		const { containsCode: _containsCode, ...missingField } = samplePackage;
		expect(() =>
			decodeThemeImportResult({ status: "imported", package: missingField }),
		).toThrowError(expect.objectContaining(contractError));
		expect(() =>
			decodeThemeImportResult({
				status: "imported",
				package: { ...samplePackage, extra: 1 },
			}),
		).toThrowError(expect.objectContaining(contractError));
	});

	it("rejects a Proxy-wrapped response", () => {
		const proxied = new Proxy(
			{ status: "cancelled" },
			{ get: (target, key) => Reflect.get(target, key) },
		);
		expect(() => decodeThemeImportResult(proxied)).toThrowError(
			expect.objectContaining(contractError),
		);
	});
});

describe("decodeThemeListResult", () => {
	it("decodes an empty listing", () => {
		expect(decodeThemeListResult({ packages: [], skipped: 0 })).toEqual({
			packages: [],
			skipped: 0,
		});
	});

	it("decodes multiple packages and a nonzero skipped count", () => {
		const result = decodeThemeListResult({
			packages: [samplePackage],
			skipped: 2,
		});
		expect(result).toEqual({ packages: [samplePackage], skipped: 2 });
	});

	it("rejects a negative or non-integer skipped count", () => {
		for (const skipped of [-1, 1.5, "0", null]) {
			expect(() =>
				decodeThemeListResult({ packages: [], skipped }),
			).toThrowError(expect.objectContaining(contractError));
		}
	});

	it("rejects a non-array packages field", () => {
		expect(() =>
			decodeThemeListResult({ packages: "not-an-array", skipped: 0 }),
		).toThrowError(expect.objectContaining(contractError));
	});
});

describe("decodeThemeVoid", () => {
	it("accepts exactly null", () => {
		expect(decodeThemeVoid(null)).toBeUndefined();
	});

	it("rejects anything else", () => {
		for (const value of [undefined, 0, "", {}, []]) {
			expect(() => decodeThemeVoid(value)).toThrowError(
				expect.objectContaining(contractError),
			);
		}
	});
});

describe("decodeThemeReadResourceBytes", () => {
	it("decodes a dense number[] response", () => {
		const bytes = decodeThemeReadResourceBytes([0, 255, 128, 1]);
		expect(bytes).toBeInstanceOf(Uint8Array);
		expect([...bytes]).toEqual([0, 255, 128, 1]);
	});

	it("decodes an empty number[] response", () => {
		expect([...decodeThemeReadResourceBytes([])]).toEqual([]);
	});

	it("decodes a real ArrayBuffer response", () => {
		const source = new Uint8Array([1, 2, 3]);
		const bytes = decodeThemeReadResourceBytes(source.buffer);
		expect([...bytes]).toEqual([1, 2, 3]);
	});

	it("rejects an oversized array claim beyond the 8 MiB cap", () => {
		const hostileLengthArray: number[] = [];
		hostileLengthArray.length = 8 * 1_024 * 1_024 + 1;
		expect(() => decodeThemeReadResourceBytes(hostileLengthArray)).toThrowError(
			expect.objectContaining(contractError),
		);
	});

	it("rejects a value that is out of byte range", () => {
		expect(() => decodeThemeReadResourceBytes([0, 256])).toThrowError(
			expect.objectContaining(contractError),
		);
		expect(() => decodeThemeReadResourceBytes([-1])).toThrowError(
			expect.objectContaining(contractError),
		);
	});

	it("rejects a non-Array, non-ArrayBuffer value", () => {
		for (const value of [null, undefined, "bytes", {}, 42]) {
			expect(() => decodeThemeReadResourceBytes(value)).toThrowError(
				expect.objectContaining(contractError),
			);
		}
	});
});
