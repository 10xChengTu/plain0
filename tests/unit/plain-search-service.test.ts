import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { describe, expect, it } from "vitest";

import type {
	PlainBridge,
	WorkspaceSearchFilesResult,
} from "../../app/platform/tauri/contracts";
import {
	configurePlainSearchBridge,
	PlainSearchService,
} from "../../app/features/search/plain-search-service";

const ROOT_A = "00000000-0000-4000-8000-000000000001";
const ROOT_B = "00000000-0000-4000-8000-000000000002";

function rootUri(rootId: string): URI {
	return URI.from({ scheme: "plain-workspace", authority: rootId, path: "/" });
}

interface FakeSearchProvider {
	fileSearch(query: unknown, token?: unknown): Promise<unknown>;
}

function providerFor(service: PlainSearchService): FakeSearchProvider {
	const internals = service as unknown as {
		fileSearchProviders: Map<string, FakeSearchProvider>;
	};
	const provider = internals.fileSearchProviders.get("plain-workspace");
	if (provider === undefined) {
		throw new Error("plain-workspace file search provider is not registered");
	}
	return provider;
}

function fakeBridge(
	workspaceSearchFiles: PlainBridge["workspaceSearchFiles"],
): PlainBridge {
	const notImplemented = (): never => {
		throw new Error("not implemented in fake bridge for this test");
	};
	return {
		runtimeInfo: notImplemented,
		onRuntimeReady: notImplemented,
		workspaceCapabilities: notImplemented,
		workspaceSnapshot: notImplemented,
		workspaceReconcileWatchRoots: notImplemented,
		workspaceWatch: notImplemented,
		workspacePickRoots: notImplemented,
		workspaceRemoveRoot: notImplemented,
		workspaceCreateFile: notImplemented,
		workspaceCreateDirectory: notImplemented,
		workspaceRename: notImplemented,
		workspaceCopy: notImplemented,
		workspaceMove: notImplemented,
		workspacePrepareDelete: notImplemented,
		workspaceCancelDelete: notImplemented,
		workspaceBeginDelete: notImplemented,
		workspaceCommitDeleteEntry: notImplemented,
		workspaceStat: notImplemented,
		workspaceReadDirectory: notImplemented,
		workspaceReadFile: notImplemented,
		workspaceWriteFile: notImplemented,
		workspaceSearchFiles,
		backupWrite: notImplemented,
		backupReadAll: notImplemented,
		backupDiscard: notImplemented,
		backupDiscardAll: notImplemented,
	};
}

function emptyResult(): WorkspaceSearchFilesResult {
	return { entries: [], limitHit: false };
}

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
		await expect(
			provider.fileSearch({ folderQueries: [] } as never),
		).resolves.toEqual({
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

	it("fileSearch maps folderQueries to roots, merges exclude globs, clamps maxResults, and builds resource URIs from the response", async () => {
		const requests: Array<{
			roots: readonly string[];
			filePattern: string;
			excludeGlobs: readonly string[];
			maxResults: number;
		}> = [];
		configurePlainSearchBridge(
			fakeBridge(async (roots, filePattern, excludeGlobs, maxResults) => {
				requests.push({ roots, filePattern, excludeGlobs, maxResults });
				return {
					entries: ["src/main.ts", "README.md"],
					limitHit: true,
				};
			}),
		);
		const provider = providerFor(createService());

		const complete = await provider.fileSearch({
			type: 1,
			filePattern: "main",
			maxResults: 999_999,
			excludePattern: { "**/top-level-exclude": true, "**/off": false },
			folderQueries: [
				{
					folder: rootUri(ROOT_A),
					excludePattern: [{ pattern: { "**/node_modules": true } }],
				},
			],
		});

		expect(requests).toEqual([
			{
				roots: [ROOT_A],
				filePattern: "main",
				excludeGlobs: ["**/top-level-exclude", "**/node_modules"],
				maxResults: 512,
			},
		]);
		expect(complete).toEqual({
			results: [
				{
					resource: URI.from({
						scheme: "plain-workspace",
						authority: ROOT_A,
						path: "/src/main.ts",
					}),
				},
				{
					resource: URI.from({
						scheme: "plain-workspace",
						authority: ROOT_A,
						path: "/README.md",
					}),
				},
			],
			limitHit: true,
			messages: [],
		});
	});

	it("fileSearch passes an empty pattern through and never raises maxResults above 512", async () => {
		let observedMaxResults: number | undefined;
		configurePlainSearchBridge(
			fakeBridge(async (_roots, _filePattern, _excludeGlobs, maxResults) => {
				observedMaxResults = maxResults;
				return emptyResult();
			}),
		);
		const provider = providerFor(createService());

		await provider.fileSearch({
			type: 1,
			folderQueries: [{ folder: rootUri(ROOT_A) }],
			maxResults: 10,
		} as never);
		expect(observedMaxResults).toBe(10);

		await provider.fileSearch({
			type: 1,
			folderQueries: [{ folder: rootUri(ROOT_A) }],
		} as never);
		expect(observedMaxResults).toBe(512);
	});

	it("fileSearch returns an empty result without calling the bridge when no plain-workspace folder is named", async () => {
		let calls = 0;
		configurePlainSearchBridge(
			fakeBridge(async () => {
				calls += 1;
				return emptyResult();
			}),
		);
		const provider = providerFor(createService());

		const complete = await provider.fileSearch({
			type: 1,
			folderQueries: [
				{ folder: URI.from({ scheme: "file", path: "/outside" }) },
			],
		} as never);

		expect(complete).toEqual({ results: [], messages: [] });
		expect(calls).toBe(0);
	});

	it("fileSearch drops a stale response superseded by a newer query", async () => {
		let resolveFirst: ((value: WorkspaceSearchFilesResult) => void) | undefined;
		let callIndex = 0;
		configurePlainSearchBridge(
			fakeBridge(async () => {
				callIndex += 1;
				if (callIndex === 1) {
					return new Promise((resolve) => {
						resolveFirst = resolve;
					});
				}
				return { entries: ["second.txt"], limitHit: false };
			}),
		);
		const provider = providerFor(createService());
		const query = {
			type: 1,
			folderQueries: [{ folder: rootUri(ROOT_A) }],
		} as never;

		const first = provider.fileSearch(query);
		const second = await provider.fileSearch(query);
		expect(second).toEqual({
			results: [
				{
					resource: URI.from({
						scheme: "plain-workspace",
						authority: ROOT_A,
						path: "/second.txt",
					}),
				},
			],
			limitHit: false,
			messages: [],
		});

		resolveFirst?.({ entries: ["first.txt"], limitHit: false });
		await expect(first).resolves.toEqual({ results: [], messages: [] });
	});

	it("fileSearch drops a response once the caller's token is already cancelled", async () => {
		configurePlainSearchBridge(
			fakeBridge(async () => ({ entries: ["late.txt"], limitHit: false })),
		);
		const provider = providerFor(createService());

		const complete = await provider.fileSearch(
			{
				type: 1,
				folderQueries: [{ folder: rootUri(ROOT_A) }],
			} as never,
			{ isCancellationRequested: true } as never,
		);
		expect(complete).toEqual({ results: [], messages: [] });
	});

	it("fileSearch resolves a two-root query and reuses roots[0] as every result's authority", async () => {
		configurePlainSearchBridge(
			fakeBridge(async (roots) => {
				expect(roots).toEqual([ROOT_A, ROOT_B]);
				return { entries: ["shared.txt"], limitHit: false };
			}),
		);
		const provider = providerFor(createService());

		const complete = await provider.fileSearch({
			type: 1,
			folderQueries: [{ folder: rootUri(ROOT_A) }, { folder: rootUri(ROOT_B) }],
		} as never);
		expect(complete).toEqual({
			results: [
				{
					resource: URI.from({
						scheme: "plain-workspace",
						authority: ROOT_A,
						path: "/shared.txt",
					}),
				},
			],
			limitHit: false,
			messages: [],
		});
	});
});
