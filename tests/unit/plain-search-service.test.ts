import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { describe, expect, it } from "vitest";

import type {
	PlainBridge,
	WorkspaceSearchFilesResult,
	WorkspaceSearchTextPollResult,
	WorkspaceSearchTextStartRequest,
} from "../../app/platform/tauri/contracts";
import {
	configurePlainSearchBridge,
	getReplaceMatchLocation,
	PlainSearchService,
} from "../../app/features/search/plain-search-service";
import type { ITextSearchMatch } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search";

const ROOT_A = "00000000-0000-4000-8000-000000000001";
const ROOT_B = "00000000-0000-4000-8000-000000000002";

function rootUri(rootId: string): URI {
	return URI.from({ scheme: "plain-workspace", authority: rootId, path: "/" });
}

interface FakeSearchProvider {
	fileSearch(query: unknown, token?: unknown): Promise<unknown>;
	textSearch(
		query: unknown,
		onProgress?: (progress: unknown) => void,
		token?: unknown,
	): Promise<unknown>;
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
		workspaceSearchTextStart: notImplemented,
		workspaceSearchTextPoll: notImplemented,
		workspaceSearchTextCancel: notImplemented,
		workspaceSearchTextWatch: notImplemented,
		backupWrite: notImplemented,
		backupReadAll: notImplemented,
		backupDiscard: notImplemented,
		backupDiscardAll: notImplemented,
		themeImportVsix: notImplemented,
		themeImportDirectory: notImplemented,
		themeList: notImplemented,
		themeReadResource: notImplemented,
		themeRemove: notImplemented,
		themeGetSelection: notImplemented,
		themeSetSelection: notImplemented,
		themeSetFileIconThemeSelection: notImplemented,
		themeSetProductIconThemeSelection: notImplemented,
		terminalStart: notImplemented,
		terminalInputText: notImplemented,
		terminalInputKey: notImplemented,
		terminalFocus: notImplemented,
		terminalResize: notImplemented,
		terminalAck: notImplemented,
		terminalScrollback: notImplemented,
		terminalKill: notImplemented,
		terminalWatchData: notImplemented,
		terminalWatchExit: notImplemented,
		workspaceTrustState: notImplemented,
		workspaceTrustGrant: notImplemented,
		workspaceTrustRevoke: notImplemented,
	};
}

function emptyResult(): WorkspaceSearchFilesResult {
	return { entries: [], limitHit: false };
}

interface FakeTextSearchBridge {
	readonly bridge: PlainBridge;
	readonly startCalls: WorkspaceSearchTextStartRequest[];
	readonly pollCalls: Array<{ searchId: string; cursor: number }>;
	readonly cancelCalls: string[];
	enqueuePoll(result: WorkspaceSearchTextPollResult): void;
	failNextStart(error: unknown): void;
}

/**
 * A controllable fake for the four `workspaceSearchText*` bridge methods
 * `runTextSearchStream` calls. Every non-`done` poll response automatically
 * fires the registered wake listener on the next microtask (mirroring how
 * the real Rust task wakes the frontend after producing a batch), so
 * multi-batch streaming tests run fast without depending on
 * `runTextSearchStream`'s real 1000ms lost-wake fallback timer.
 */
function fakeTextSearchBridge(
	searchId = "00000000-0000-4000-8000-000000000201",
): FakeTextSearchBridge {
	const notImplemented = (): never => {
		throw new Error("not implemented in fake bridge for this test");
	};
	const pollQueue: WorkspaceSearchTextPollResult[] = [];
	const startCalls: WorkspaceSearchTextStartRequest[] = [];
	const pollCalls: Array<{ searchId: string; cursor: number }> = [];
	const cancelCalls: string[] = [];
	let startError: unknown;
	let wakeListener: ((wokenSearchId: string) => void) | undefined;

	const bridge: PlainBridge = {
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
		workspaceSearchFiles: notImplemented,
		async workspaceSearchTextStart(request) {
			startCalls.push(request);
			if (startError !== undefined) {
				const error = startError;
				startError = undefined;
				throw error;
			}
			return { searchId };
		},
		async workspaceSearchTextPoll(id, cursor) {
			pollCalls.push({ searchId: id, cursor });
			const next = pollQueue.shift();
			if (next === undefined) {
				throw new Error("fakeTextSearchBridge: no more poll results queued");
			}
			if (!next.done) {
				queueMicrotask(() => wakeListener?.(id));
			}
			return next;
		},
		async workspaceSearchTextCancel(id) {
			cancelCalls.push(id);
		},
		workspaceSearchTextWatch(listener) {
			wakeListener = listener;
			return () => {
				wakeListener = undefined;
			};
		},
		backupWrite: notImplemented,
		backupReadAll: notImplemented,
		backupDiscard: notImplemented,
		backupDiscardAll: notImplemented,
		themeImportVsix: notImplemented,
		themeImportDirectory: notImplemented,
		themeList: notImplemented,
		themeReadResource: notImplemented,
		themeRemove: notImplemented,
		themeGetSelection: notImplemented,
		themeSetSelection: notImplemented,
		themeSetFileIconThemeSelection: notImplemented,
		themeSetProductIconThemeSelection: notImplemented,
		terminalStart: notImplemented,
		terminalInputText: notImplemented,
		terminalInputKey: notImplemented,
		terminalFocus: notImplemented,
		terminalResize: notImplemented,
		terminalAck: notImplemented,
		terminalScrollback: notImplemented,
		terminalKill: notImplemented,
		terminalWatchData: notImplemented,
		terminalWatchExit: notImplemented,
		workspaceTrustState: notImplemented,
		workspaceTrustGrant: notImplemented,
		workspaceTrustRevoke: notImplemented,
	};

	return {
		bridge,
		startCalls,
		pollCalls,
		cancelCalls,
		enqueuePoll: (result) => pollQueue.push(result),
		failNextStart: (error) => {
			startError = error;
		},
	};
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
		await expect(
			provider.textSearch({
				folderQueries: [],
				contentPattern: { pattern: "" },
			} as never),
		).resolves.toEqual({
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

describe("PlainSearchService textSearch (F040 S3 streaming)", () => {
	function textQuery(pattern: string, roots: readonly string[] = [ROOT_A]) {
		return {
			type: 2,
			folderQueries: roots.map((rootId) => ({ folder: rootUri(rootId) })),
			contentPattern: { pattern },
		};
	}

	it("streams every batch to onProgress as it arrives and returns the final limitHit/messages", async () => {
		const fake = fakeTextSearchBridge();
		configurePlainSearchBridge(fake.bridge);
		fake.enqueuePoll({
			batches: [
				{
					path: "a.ts",
					matches: [
						{
							line: 1,
							column: 1,
							length: 6,
							previewText: "needle",
							absoluteColumn: 1,
						},
					],
				},
			],
			nextCursor: 1,
			done: false,
			limitHit: false,
			skipped: { binary: 0, oversize: 0 },
		});
		fake.enqueuePoll({
			batches: [
				{
					path: "b.ts",
					matches: [
						{
							line: 2,
							column: 3,
							length: 6,
							previewText: "needle",
							absoluteColumn: 3,
						},
					],
				},
			],
			nextCursor: 2,
			done: true,
			limitHit: true,
			skipped: { binary: 1, oversize: 2 },
		});
		const provider = providerFor(createService());
		const progressResources: string[] = [];

		const complete = (await provider.textSearch(
			textQuery("needle"),
			(progress: unknown) => {
				const resource = (progress as { resource?: { path: string } }).resource;
				if (resource !== undefined) {
					progressResources.push(resource.path);
				}
			},
		)) as {
			results: Array<{ resource: { path: string } }>;
			limitHit: boolean;
			messages: Array<{ text: string }>;
		};

		expect(progressResources).toEqual(["/a.ts", "/b.ts"]);
		expect(complete.results.map((result) => result.resource.path)).toEqual([
			"/a.ts",
			"/b.ts",
		]);
		expect(complete.limitHit).toBe(true);
		expect(complete.messages).toHaveLength(1);
		expect(complete.messages[0]?.text).toContain("1 binary");
		expect(complete.messages[0]?.text).toContain("2 oversized");
		expect(fake.startCalls[0]).toEqual({
			roots: [ROOT_A],
			pattern: "needle",
			isRegExp: false,
			isCaseSensitive: false,
			isWordMatch: false,
			excludeGlobs: [],
			maxResults: 20_000,
			maxFileSize: null,
		});
		expect(fake.pollCalls.map((call) => call.cursor)).toEqual([0, 1]);
	});

	it("records each match's replace location from absoluteColumn, not the preview-relative column (F040 S4)", async () => {
		const fake = fakeTextSearchBridge();
		configurePlainSearchBridge(fake.bridge);
		// Deliberately different from `column`/`length` alone would suggest,
		// simulating a match whose preview window was rebased for a long
		// line (see src-tauri/src/search/dto.rs's WorkspaceSearchTextMatch
		// doc comment): if getReplaceMatchLocation ever used `column`
		// instead of `absoluteColumn`, this range would come out as
		// startColumn 2 instead of 401.
		fake.enqueuePoll({
			batches: [
				{
					path: "long.ts",
					matches: [
						{
							line: 5,
							column: 2,
							length: 6,
							previewText: "xneedlex",
							absoluteColumn: 401,
						},
					],
				},
			],
			nextCursor: 1,
			done: true,
			limitHit: false,
			skipped: { binary: 0, oversize: 0 },
		});
		const provider = providerFor(createService());
		let recordedMatch: ITextSearchMatch | undefined;

		await provider.textSearch(textQuery("needle"), (progress: unknown) => {
			const fileMatch = progress as {
				resource: { path: string };
				results?: ITextSearchMatch[];
			};
			recordedMatch = fileMatch.results?.[0];
		});

		expect(recordedMatch).toBeDefined();
		const location = getReplaceMatchLocation(recordedMatch!);
		expect(location).toBeDefined();
		expect(location?.resource.path).toBe("/long.ts");
		expect(location?.range).toEqual({
			startLineNumber: 5,
			startColumn: 401,
			endLineNumber: 5,
			endColumn: 407,
		});
	});

	it("returns undefined for a match object this provider never constructed", () => {
		expect(getReplaceMatchLocation({} as ITextSearchMatch)).toBeUndefined();
	});

	it("returns an empty result without starting a search when no plain-workspace folder or pattern is given", async () => {
		const fake = fakeTextSearchBridge();
		configurePlainSearchBridge(fake.bridge);
		const provider = providerFor(createService());

		await expect(
			provider.textSearch({
				type: 2,
				folderQueries: [
					{ folder: URI.from({ scheme: "file", path: "/outside" }) },
				],
				contentPattern: { pattern: "needle" },
			} as never),
		).resolves.toEqual({ results: [], messages: [] });
		await expect(
			provider.textSearch({
				type: 2,
				folderQueries: [{ folder: rootUri(ROOT_A) }],
				contentPattern: { pattern: "" },
			} as never),
		).resolves.toEqual({ results: [], messages: [] });
		expect(fake.startCalls).toHaveLength(0);
	});

	it("turns an INVALID_SEARCH_REGEX start rejection into a warning message instead of throwing", async () => {
		const fake = fakeTextSearchBridge();
		fake.failNextStart({
			code: "INVALID_SEARCH_REGEX",
			message: "unbalanced parenthesis",
		});
		configurePlainSearchBridge(fake.bridge);
		const provider = providerFor(createService());

		const complete = await provider.textSearch(
			textQuery("(unclosed", [ROOT_A]),
		);
		expect(complete).toEqual({
			results: [],
			messages: [{ text: "unbalanced parenthesis", type: 2 }],
		});
	});

	it("rethrows a non-regex start rejection instead of swallowing it", async () => {
		const fake = fakeTextSearchBridge();
		fake.failNextStart({ code: "IO_FAILED", message: "disk exploded" });
		configurePlainSearchBridge(fake.bridge);
		const provider = providerFor(createService());

		await expect(provider.textSearch(textQuery("needle"))).rejects.toEqual({
			code: "IO_FAILED",
			message: "disk exploded",
		});
	});

	it("drops a superseded search's late batches and completion once a newer query starts", async () => {
		const fake = fakeTextSearchBridge();
		let releaseFirstPoll: (() => void) | undefined;
		let pollInvocationCount = 0;
		const originalPoll = fake.bridge.workspaceSearchTextPoll.bind(fake.bridge);
		fake.bridge.workspaceSearchTextPoll = async (id, cursor) => {
			pollInvocationCount += 1;
			// Only the very first poll ever invoked is gated — that call
			// belongs to `first` (its coroutine reaches this point before
			// `second`'s, since `first` was started first and JS's
			// microtask queue resolves interleaved `await` chains in FIFO
			// order), so `second` can run to completion first.
			if (pollInvocationCount === 1) {
				await new Promise<void>((resolve) => {
					releaseFirstPoll = resolve;
				});
			}
			return originalPoll(id, cursor);
		};
		configurePlainSearchBridge(fake.bridge);
		// The immediately-resolving (non-gated) call always shifts whichever
		// item is queued first, since the gated call is blocked *before*
		// reaching the shared queue's shift — so "fresh.ts" is enqueued
		// first, for whichever call proceeds without waiting, and
		// "stale.ts" second, for the one released afterwards.
		fake.enqueuePoll({
			batches: [{ path: "fresh.ts", matches: [] }],
			nextCursor: 1,
			done: true,
			limitHit: false,
			skipped: { binary: 0, oversize: 0 },
		});
		fake.enqueuePoll({
			batches: [{ path: "stale.ts", matches: [] }],
			nextCursor: 1,
			done: true,
			limitHit: false,
			skipped: { binary: 0, oversize: 0 },
		});
		const provider = providerFor(createService());
		const staleProgress: unknown[] = [];

		const first = provider.textSearch(textQuery("needle"), (progress) =>
			staleProgress.push(progress),
		);
		const second = await provider.textSearch(textQuery("needle"));
		expect(
			(
				second as { results: Array<{ resource: { path: string } }> }
			).results.map((r) => r.resource.path),
		).toEqual(["/fresh.ts"]);

		releaseFirstPoll?.();
		await expect(first).resolves.toEqual({ results: [], messages: [] });
		expect(staleProgress).toEqual([]);
	});

	it("drops a response once the caller's token is already cancelled and cancels the Rust task", async () => {
		const fake = fakeTextSearchBridge();
		configurePlainSearchBridge(fake.bridge);
		fake.enqueuePoll({
			batches: [{ path: "late.ts", matches: [] }],
			nextCursor: 1,
			done: true,
			limitHit: false,
			skipped: { binary: 0, oversize: 0 },
		});
		const provider = providerFor(createService());

		const complete = await provider.textSearch(textQuery("needle"), undefined, {
			isCancellationRequested: true,
		} as never);
		expect(complete).toEqual({ results: [], messages: [] });
		expect(fake.cancelCalls).toEqual(["00000000-0000-4000-8000-000000000201"]);
	});

	it("clamps maxResults to the 20000 hard cap and forwards a smaller caller-requested value unchanged", async () => {
		const fake = fakeTextSearchBridge();
		configurePlainSearchBridge(fake.bridge);
		fake.enqueuePoll({
			batches: [],
			nextCursor: 0,
			done: true,
			limitHit: false,
			skipped: { binary: 0, oversize: 0 },
		});
		fake.enqueuePoll({
			batches: [],
			nextCursor: 0,
			done: true,
			limitHit: false,
			skipped: { binary: 0, oversize: 0 },
		});
		const provider = providerFor(createService());

		await provider.textSearch({
			...textQuery("needle"),
			maxResults: 4_000_000,
		} as never);
		await provider.textSearch({
			...textQuery("needle"),
			maxResults: 10,
		} as never);
		expect(fake.startCalls.map((request) => request.maxResults)).toEqual([
			20_000, 10,
		]);
	});
});
