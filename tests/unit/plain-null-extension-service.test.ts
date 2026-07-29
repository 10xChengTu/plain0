import { describe, expect, it } from "vitest";

import { PlainNullExtensionService } from "../../app/services/plain-null-extension-service";

/**
 * `F110` S5 (`docs/research/2026-07-28-legacy-retirement.md` decision 3):
 * these tests lock the exact behavioral parity claims this class's own doc
 * comment makes against vendor's `NullExtensionService`
 * (`vscode/src/vs/workbench/services/extensions/common/extensions.js`) —
 * every event never fires, every read resolves the same "nothing here"
 * value, `activateByEvent`/`activateById` are no-ops, `canAddExtension`/
 * `canRemoveExtension` are permanently `false` — plus the one addition
 * beyond the formal `IExtensionService` interface, `deltaExtensions`, which
 * `@codingame/monaco-vscode-api`'s own `extensions.js`-adjacent top-level
 * `extensions` module needs for `registerExtension(...).dispose()` (used by
 * Plain's own theme-package import/removal flow) not to throw.
 */
describe("PlainNullExtensionService", () => {
	it("never fires any of its events", () => {
		const service = new PlainNullExtensionService();
		const seen: unknown[] = [];
		const listeners = [
			service.onDidRegisterExtensions(() =>
				seen.push("onDidRegisterExtensions"),
			),
			service.onDidChangeExtensionsStatus(() =>
				seen.push("onDidChangeExtensionsStatus"),
			),
			service.onDidChangeExtensions(() => seen.push("onDidChangeExtensions")),
			service.onWillActivateByEvent(() => seen.push("onWillActivateByEvent")),
			service.onDidChangeResponsiveChange(() =>
				seen.push("onDidChangeResponsiveChange"),
			),
			service.onWillStop(() => seen.push("onWillStop")),
		];
		expect(seen).toEqual([]);
		for (const listener of listeners) {
			expect(() => listener.dispose()).not.toThrow();
		}
	});

	it("reports a permanently empty extensions list", () => {
		const service = new PlainNullExtensionService();
		expect(service.extensions).toEqual([]);
	});

	it("activateByEvent resolves without activating anything (key NullExtensionService parity)", async () => {
		const service = new PlainNullExtensionService();
		await expect(
			service.activateByEvent("onLanguage:plaintext"),
		).resolves.toBeUndefined();
	});

	it("activateById resolves without activating anything", async () => {
		const service = new PlainNullExtensionService();
		await expect(
			service.activateById(
				{ value: "publisher.extension" } as never,
				{
					startup: false,
					extensionId: "publisher.extension",
					activationEvent: "*",
				} as never,
			),
		).resolves.toBeUndefined();
	});

	it("activationEventIsDone is always false", () => {
		const service = new PlainNullExtensionService();
		expect(service.activationEventIsDone("onStartupFinished")).toBe(false);
		expect(service.activationEventIsDone("*")).toBe(false);
	});

	it("whenInstalledExtensionsRegistered resolves true immediately", async () => {
		const service = new PlainNullExtensionService();
		await expect(service.whenInstalledExtensionsRegistered()).resolves.toBe(
			true,
		);
	});

	it("getExtension always resolves undefined", async () => {
		const service = new PlainNullExtensionService();
		await expect(
			service.getExtension("publisher.extension"),
		).resolves.toBeUndefined();
	});

	it("canAddExtension is permanently false (key NullExtensionService parity)", () => {
		const service = new PlainNullExtensionService();
		expect(service.canAddExtension({} as never)).toBe(false);
		expect(
			service.canAddExtension({ identifier: { value: "x" } } as never),
		).toBe(false);
	});

	it("canRemoveExtension is permanently false", () => {
		const service = new PlainNullExtensionService();
		expect(service.canRemoveExtension({} as never)).toBe(false);
	});

	it("readExtensionPointContributions resolves an empty object, mirroring NullExtensionService's own type-inexact behavior", async () => {
		const service = new PlainNullExtensionService();
		const result = await service.readExtensionPointContributions({} as never);
		expect(result).toEqual({});
	});

	it("getExtensionsStatus returns an empty status map", () => {
		const service = new PlainNullExtensionService();
		expect(service.getExtensionsStatus()).toEqual({});
	});

	it("getInspectPorts resolves an empty array regardless of host kind", async () => {
		const service = new PlainNullExtensionService();
		await expect(service.getInspectPorts(undefined, true)).resolves.toEqual([]);
	});

	it("stopExtensionHosts resolves true", async () => {
		const service = new PlainNullExtensionService();
		await expect(service.stopExtensionHosts("test", false)).resolves.toBe(true);
	});

	it("startExtensionHosts resolves with no effect, with or without updates", async () => {
		const service = new PlainNullExtensionService();
		await expect(service.startExtensionHosts()).resolves.toBeUndefined();
		await expect(
			service.startExtensionHosts({ toAdd: [], toRemove: [] }),
		).resolves.toBeUndefined();
	});

	it("setRemoteEnvironment resolves with no effect", async () => {
		const service = new PlainNullExtensionService();
		await expect(
			service.setRemoteEnvironment({ FOO: "bar", BAZ: null }),
		).resolves.toBeUndefined();
	});

	it("deltaExtensions is a safe no-op even though it is not part of IExtensionService — the regression this class exists to prevent", async () => {
		const service = new PlainNullExtensionService();
		// This mirrors exactly how `@codingame/monaco-vscode-api`'s top-level
		// `extensions` module's `registerExtension(...).dispose()` calls it:
		// unconditionally, with whatever was (never actually) added as
		// `toRemove`. Without this method, that call throws
		// `extensionService.deltaExtensions is not a function`.
		await expect(
			service.deltaExtensions([], [{ identifier: { value: "x" } } as never]),
		).resolves.toBeUndefined();
	});

	it("_serviceBrand is present but undefined, matching the DI marker convention", () => {
		const service = new PlainNullExtensionService();
		expect(service._serviceBrand).toBeUndefined();
		expect("_serviceBrand" in service).toBe(true);
	});
});
