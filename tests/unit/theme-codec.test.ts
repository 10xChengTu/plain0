import { describe, expect, it } from "vitest";

import {
	decodeThemeImportResult,
	decodeThemeListResult,
	decodeThemeReadResourceBytes,
	decodeThemeSelectionResult,
	decodeThemeVoid,
	frozenThemeReadResourceRequest,
	frozenThemeRemoveRequest,
	frozenThemeSetFileIconThemeSelectionRequest,
	frozenThemeSetProductIconThemeSelectionRequest,
	frozenThemeSetSelectionRequest,
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
	iconThemes: Object.freeze([
		Object.freeze({
			id: "demo-icons",
			label: "Demo Icons",
			path: "fileicons/demo-icon-theme.json",
		}),
	]),
	productIconThemes: Object.freeze([]),
	resources: Object.freeze([
		"themes/dark.json",
		"fileicons/demo-icon-theme.json",
	]),
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

// `F060` S3: each of the three theme selection axes builds a request that
// only ever carries its own field — see `frozenSelectionFieldRequest`'s own
// doc comment for why an absent sibling field (not merely a `null` one) is
// what makes Rust's per-field update semantics leave the other two axes
// untouched.
describe.each([
	["frozenThemeSetSelectionRequest", frozenThemeSetSelectionRequest, "themeId"],
	[
		"frozenThemeSetFileIconThemeSelectionRequest",
		frozenThemeSetFileIconThemeSelectionRequest,
		"fileIconThemeId",
	],
	[
		"frozenThemeSetProductIconThemeSelectionRequest",
		frozenThemeSetProductIconThemeSelectionRequest,
		"productIconThemeId",
	],
] as const)("%s", (_name, build, field) => {
	it("builds a frozen request carrying only its own field for a valid id", () => {
		const request = build("Dark Modern");
		expect(request).toEqual({ [field]: "Dark Modern" });
		expect(Object.keys(request)).toEqual([field]);
		expect(Object.isFrozen(request)).toBe(true);
	});

	it("builds a frozen request carrying only its own field for null", () => {
		const request = build(null);
		expect(request).toEqual({ [field]: null });
		expect(Object.keys(request)).toEqual([field]);
	});

	it("rejects an empty, over-long, or control-character id", () => {
		for (const value of [
			"",
			"a".repeat(257),
			"line\nbreak",
			"nul\u{0}byte",
			123,
			undefined,
		]) {
			expect(() => build(value)).toThrowError(
				expect.objectContaining({ code: "THEME_SELECTION_INVALID" }),
			);
		}
	});

	it("accepts an id at the exact 256-byte limit", () => {
		const maxId = "a".repeat(256);
		expect(build(maxId)).toEqual({ [field]: maxId });
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

describe("decodeThemeSelectionResult", () => {
	it("decodes all three axes present", () => {
		expect(
			decodeThemeSelectionResult({
				themeId: "Dark Modern",
				fileIconThemeId: "vs-minimal",
				productIconThemeId: null,
			}),
		).toEqual({
			themeId: "Dark Modern",
			fileIconThemeId: "vs-minimal",
			productIconThemeId: null,
		});
	});

	it("decodes all three axes absent (null)", () => {
		expect(
			decodeThemeSelectionResult({
				themeId: null,
				fileIconThemeId: null,
				productIconThemeId: null,
			}),
		).toEqual({
			themeId: null,
			fileIconThemeId: null,
			productIconThemeId: null,
		});
	});

	it("rejects a response missing one of the three fields", () => {
		expect(() =>
			decodeThemeSelectionResult({
				themeId: null,
				fileIconThemeId: null,
			}),
		).toThrowError(expect.objectContaining(contractError));
	});

	it("rejects a response carrying an extra field", () => {
		expect(() =>
			decodeThemeSelectionResult({
				themeId: null,
				fileIconThemeId: null,
				productIconThemeId: null,
				extra: 1,
			}),
		).toThrowError(expect.objectContaining(contractError));
	});

	it("rejects a non-string, non-null value on any axis", () => {
		for (const field of [
			"themeId",
			"fileIconThemeId",
			"productIconThemeId",
		] as const) {
			expect(() =>
				decodeThemeSelectionResult({
					themeId: null,
					fileIconThemeId: null,
					productIconThemeId: null,
					[field]: 1,
				}),
			).toThrowError(expect.objectContaining(contractError));
		}
	});
});

// `F060` S3: `iconThemes`/`productIconThemes` decode with the same closed-key
// discipline every other array-of-objects field in this contract already
// gets.
describe("decodeThemeListResult icon/product icon contribution decoding", () => {
	it("decodes a package whose iconThemes/productIconThemes are both populated", () => {
		const pkg = {
			...samplePackage,
			productIconThemes: [
				{ id: "acme.picons", label: null, path: "picons/theme.json" },
			],
		};
		const result = decodeThemeListResult({ packages: [pkg], skipped: 0 });
		expect(result.packages[0]?.iconThemes).toEqual([
			{
				id: "demo-icons",
				label: "Demo Icons",
				path: "fileicons/demo-icon-theme.json",
			},
		]);
		expect(result.packages[0]?.productIconThemes).toEqual([
			{ id: "acme.picons", label: null, path: "picons/theme.json" },
		]);
	});

	it("rejects an icon theme contribution missing a required field", () => {
		const pkg = {
			...samplePackage,
			iconThemes: [
				{ label: "Demo Icons", path: "fileicons/demo-icon-theme.json" },
			],
		};
		expect(() =>
			decodeThemeListResult({ packages: [pkg], skipped: 0 }),
		).toThrowError(expect.objectContaining(contractError));
	});

	it("rejects an icon theme contribution carrying an extra field", () => {
		const pkg = {
			...samplePackage,
			iconThemes: [
				{
					id: "demo-icons",
					label: "Demo Icons",
					path: "fileicons/demo-icon-theme.json",
					extra: 1,
				},
			],
		};
		expect(() =>
			decodeThemeListResult({ packages: [pkg], skipped: 0 }),
		).toThrowError(expect.objectContaining(contractError));
	});

	it("rejects a non-array iconThemes/productIconThemes field", () => {
		expect(() =>
			decodeThemeListResult({
				packages: [{ ...samplePackage, iconThemes: "not-an-array" }],
				skipped: 0,
			}),
		).toThrowError(expect.objectContaining(contractError));
		expect(() =>
			decodeThemeListResult({
				packages: [{ ...samplePackage, productIconThemes: "not-an-array" }],
				skipped: 0,
			}),
		).toThrowError(expect.objectContaining(contractError));
	});
});
