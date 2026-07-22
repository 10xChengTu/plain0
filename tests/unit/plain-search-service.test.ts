import { describe, expect, it } from "vitest";

import { PlainSearchService } from "../../app/features/search/plain-search-service";

// SearchService's own base constructor only stores each dependency as a
// plain instance field (see the vendor source's own constructor body) — none
// of the seven are called during construction, so minimal stub objects are
// sufficient here without pulling in a real Workbench service graph. The
// extension-service and log-service stubs answer the no-Extension-Host calls
// (`activateByEvent`/`whenInstalledExtensionsRegistered`/`trace`) the base
// class's own `doSearch` makes unconditionally before dispatching to
// providers, exercised by one of the tests below.
function createService(): PlainSearchService {
	const extensionService = {
		activateByEvent: () => Promise.resolve(),
		whenInstalledExtensionsRegistered: () => Promise.resolve(true),
	};
	const logService = {
		trace: () => undefined,
		debug: () => undefined,
		warn: () => undefined,
	};
	return new PlainSearchService(
		{} as never,
		{} as never,
		{} as never,
		logService as never,
		extensionService as never,
		{} as never,
		{} as never,
	);
}

// The base class keeps these as plain (non-private) instance fields, so
// tests can inspect the exact scheme-keyed registration without needing a
// real Workbench DI container.
interface SearchProviderInternals {
	fileSearchProviders: Map<string, unknown>;
	textSearchProviders: Map<string, unknown>;
	aiTextSearchProviders: Map<string, unknown>;
}

describe("PlainSearchService", () => {
	it("registers exactly one plain-workspace provider for both the file and text slots, and nothing else", () => {
		const service = createService() as unknown as SearchProviderInternals;

		expect([...service.fileSearchProviders.keys()]).toEqual([
			"plain-workspace",
		]);
		expect([...service.textSearchProviders.keys()]).toEqual([
			"plain-workspace",
		]);
		expect(service.aiTextSearchProviders.size).toBe(0);

		const fileProvider = service.fileSearchProviders.get("plain-workspace");
		const textProvider = service.textSearchProviders.get("plain-workspace");
		expect(fileProvider).toBeDefined();
		expect(fileProvider).toBe(textProvider);
	});

	it("freezes its own prototype and resolves an empty fileSearch through the base class's own dispatch", async () => {
		const service = createService();
		expect(Object.isFrozen(PlainSearchService.prototype)).toBe(true);
		const complete = await service.fileSearch({
			type: 1,
			folderQueries: [],
		} as never);
		expect(complete).toEqual({ limitHit: false, results: [], messages: [] });
	});

	it("returns the frozen empty-result shape from the registered provider directly", async () => {
		const service = createService() as unknown as SearchProviderInternals;
		const provider = service.fileSearchProviders.get("plain-workspace") as {
			getAIName(): Promise<string | undefined>;
			fileSearch(query: unknown): Promise<unknown>;
			textSearch(query: unknown): Promise<unknown>;
			clearCache(key: string): Promise<void>;
		};

		await expect(provider.getAIName()).resolves.toBeUndefined();
		await expect(provider.fileSearch({} as never)).resolves.toEqual({
			results: [],
			messages: [],
		});
		await expect(provider.textSearch({} as never)).resolves.toEqual({
			results: [],
			messages: [],
		});
		await expect(provider.clearCache("anything")).resolves.toBeUndefined();
	});

	it("disposes both scheme registrations together when the service itself is disposed", () => {
		const service = createService();
		const internals = service as unknown as SearchProviderInternals;
		expect(internals.fileSearchProviders.has("plain-workspace")).toBe(true);
		expect(internals.textSearchProviders.has("plain-workspace")).toBe(true);

		service.dispose();

		expect(internals.fileSearchProviders.has("plain-workspace")).toBe(false);
		expect(internals.textSearchProviders.has("plain-workspace")).toBe(false);
	});
});
