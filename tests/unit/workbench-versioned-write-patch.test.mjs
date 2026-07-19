import { describe, expect, it } from "vitest";

import { VSBuffer } from "@codingame/monaco-vscode-api/vscode/vs/base/common/buffer";
import { Event } from "@codingame/monaco-vscode-api/vscode/vs/base/common/event";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import {
	createPlainWorkspaceWriteOutcomeError,
	ETAG_DISABLED,
	FileOperation,
	FileOperationError,
	FileOperationResult,
	FilePermission,
	FileSystemProviderCapabilities,
	FileSystemProviderError,
	FileSystemProviderErrorCode,
	FileType,
	getPlainWorkspaceWriteOutcome,
	isPlainWorkspaceWriteOutcomeError,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files";
import { FileService } from "@codingame/monaco-vscode-files-service-override/vscode/vs/platform/files/common/fileService";

const PLAIN_URI = URI.parse(
	"plain-workspace://00112233-4455-4677-8899-aabbccddeeff/src/main.ts",
);
const PLAIN_UPPER_URI = URI.parse(
	"plain-workspace://00112233-4455-4677-8899-aabbccddeeff/src/Foo.ts",
);
const PLAIN_LOWER_URI = URI.parse(
	"plain-workspace://00112233-4455-4677-8899-aabbccddeeff/src/foo.ts",
);
const OTHER_URI = URI.parse("plain-test:/src/main.ts");
const VERSION_A = `wv1:${"a".repeat(64)}`;
const VERSION_B = `wv1:${"b".repeat(64)}`;
const VERSION_C = `wv1:${"c".repeat(64)}`;
const MAX_WRITE_BYTES = 8 * 1024 * 1024;
const WRITE_OUTCOMES = Object.freeze([
	Object.freeze({
		status: "targetPublished",
		publicationEvidence: "targetObservedWritten",
		rename: "reportedSuccess",
		directorySync: "failed",
		target: "matchesWritten",
	}),
	Object.freeze({
		status: "targetPublished",
		publicationEvidence: "renameReportedSuccess",
		rename: "reportedSuccess",
		directorySync: "synced",
		target: "changed",
	}),
	Object.freeze({
		status: "targetPublished",
		publicationEvidence: "targetObservedWritten",
		rename: "reportedFailure",
		directorySync: "failed",
		target: "unverifiable",
	}),
	Object.freeze({
		status: "outcomeUnknown",
		observation: "native",
		rename: "reportedFailure",
		directorySync: "notAttempted",
		target: "ambiguous",
	}),
	Object.freeze({
		status: "outcomeUnknown",
		observation: "responseUnavailable",
		rename: "unobserved",
		directorySync: "unobserved",
		target: "ambiguous",
	}),
]);

function providerStat({
	size = 4,
	mtime = 200,
	ctime = 100,
	version = VERSION_A,
	omitVersion = false,
} = {}) {
	return Object.freeze({
		type: FileType.File,
		size,
		mtime,
		ctime,
		...(version === null ? { permissions: FilePermission.Readonly } : {}),
		...(omitVersion ? {} : { plainVersion: version }),
	});
}

function strictWrittenStat({
	type = FileType.File,
	size,
	mtime = 50,
	ctime = 40,
	version = VERSION_B,
} = {}) {
	return Object.freeze({
		type,
		size,
		mtime,
		ctime,
		plainVersion: version,
	});
}

function writtenResult(contentLength) {
	return Object.freeze({
		status: "written",
		stat: strictWrittenStat({ size: contentLength }),
	});
}

function plainReadReceipt() {
	return Object.freeze({
		stat: providerStat({ size: 4, version: VERSION_A }),
		value: Uint8Array.from([1, 2, 3, 4]),
	});
}

function fakeProvider({
	scheme = "plain-workspace",
	initialStat = providerStat(),
	statError,
	writeResult,
} = {}) {
	const state = {
		statCalls: 0,
		mkdirCalls: 0,
		readCalls: 0,
		standardWriteCalls: 0,
		plainWriteCalls: 0,
		plainWriteContentLength: undefined,
		plainWriteExpectedVersion: undefined,
	};
	let currentStat = initialStat;
	const provider = {
		capabilities: FileSystemProviderCapabilities.FileReadWrite,
		onDidChangeCapabilities: Event.None,
		onDidChangeFile: Event.None,
		async stat() {
			state.statCalls += 1;
			if (statError !== undefined) {
				throw statError;
			}
			return currentStat;
		},
		async mkdir() {
			state.mkdirCalls += 1;
		},
		async readFile() {
			state.readCalls += 1;
			return new Uint8Array(currentStat.size ?? 0);
		},
		async writeFile(_resource, content) {
			state.standardWriteCalls += 1;
			currentStat = Object.freeze({
				type: FileType.File,
				size: content.byteLength,
				mtime: 300,
				ctime: 100,
				...(scheme === "plain-workspace" ? { plainVersion: VERSION_B } : {}),
			});
		},
		async plainWriteFile(_resource, content, expectedVersion) {
			state.plainWriteCalls += 1;
			state.plainWriteContentLength = content.byteLength;
			state.plainWriteExpectedVersion = expectedVersion;
			if (typeof writeResult === "function") {
				return writeResult(content.byteLength);
			}
			return writeResult ?? writtenResult(content.byteLength);
		},
	};
	return { provider, state };
}

function serviceWith(scheme, provider) {
	const service = new FileService({ trace() {} });
	service.registerProvider(scheme, provider);
	return service;
}

function writeOptions(etag = VERSION_A) {
	return { mtime: 200, etag };
}

async function rejected(promise) {
	try {
		await promise;
		expect.fail("operation must reject");
	} catch (error) {
		return error;
	}
}

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function writeEvents(service) {
	const events = [];
	const subscription = service.onDidRunOperation((event) => {
		if (event.operation === FileOperation.WRITE) {
			events.push(event);
		}
	});
	return { events, subscription };
}

function scriptedReadable(chunks) {
	let index = 0;
	const state = { readCalls: 0 };
	return {
		input: {
			read() {
				state.readCalls += 1;
				return chunks[index++] ?? null;
			},
		},
		state,
	};
}

function scriptedStream(chunks) {
	const listeners = {
		data: new Set(),
		error: new Set(),
		end: new Set(),
	};
	const state = {
		destroyCalls: 0,
		emittedChunks: 0,
		destroyed: false,
		paused: true,
		emitting: false,
	};
	let index = 0;
	let ended = false;
	const stream = {
		on(event, listener) {
			listeners[event].add(listener);
			if (event === "data") {
				stream.resume();
			}
		},
		removeListener(event, listener) {
			listeners[event].delete(listener);
		},
		pause() {
			state.paused = true;
		},
		resume() {
			if (state.destroyed || state.emitting) {
				return;
			}
			state.paused = false;
			state.emitting = true;
			while (!state.destroyed && !state.paused && index < chunks.length) {
				const chunk = chunks[index++];
				state.emittedChunks += 1;
				for (const listener of listeners.data) {
					listener(chunk);
				}
			}
			if (
				!state.destroyed &&
				!state.paused &&
				index === chunks.length &&
				!ended
			) {
				ended = true;
				for (const listener of listeners.end) {
					listener();
				}
			}
			state.emitting = false;
		},
		destroy() {
			state.destroyCalls += 1;
			state.destroyed = true;
			state.paused = true;
		},
	};
	return { stream, state };
}

const INPUT_KINDS = [
	{
		name: "VSBuffer",
		make(boundary) {
			const size =
				boundary === "empty"
					? 0
					: boundary === "maximum"
						? MAX_WRITE_BYTES
						: MAX_WRITE_BYTES + 1;
			return { input: VSBuffer.alloc(size), state: {} };
		},
		assertStopped() {},
	},
	{
		name: "Readable",
		make(boundary) {
			if (boundary === "empty") {
				return scriptedReadable([]);
			}
			if (boundary === "maximum") {
				return scriptedReadable([VSBuffer.alloc(MAX_WRITE_BYTES)]);
			}
			return scriptedReadable([
				VSBuffer.alloc(MAX_WRITE_BYTES),
				VSBuffer.alloc(1),
				VSBuffer.alloc(1),
			]);
		},
		assertStopped(state) {
			expect(state.readCalls).toBe(2);
		},
	},
	{
		name: "ReadableStream",
		make(boundary) {
			const chunks =
				boundary === "empty"
					? []
					: boundary === "maximum"
						? [VSBuffer.alloc(MAX_WRITE_BYTES)]
						: [
								VSBuffer.alloc(MAX_WRITE_BYTES),
								VSBuffer.alloc(1),
								VSBuffer.alloc(1),
							];
			const { stream, state } = scriptedStream(chunks);
			return { input: stream, state };
		},
		assertStopped(state) {
			expect(state.destroyCalls).toBe(1);
			expect(state.emittedChunks).toBe(2);
		},
	},
	{
		name: "ReadableBufferedStream",
		make(boundary) {
			if (boundary === "empty" || boundary === "maximum") {
				const { stream, state } = scriptedStream([]);
				return {
					input: {
						stream,
						buffer:
							boundary === "empty" ? [] : [VSBuffer.alloc(MAX_WRITE_BYTES)],
						ended: true,
					},
					state,
				};
			}
			const { stream, state } = scriptedStream([
				VSBuffer.alloc(1),
				VSBuffer.alloc(1),
			]);
			return {
				input: {
					stream,
					buffer: [VSBuffer.alloc(MAX_WRITE_BYTES)],
					ended: false,
				},
				state,
			};
		},
		assertStopped(state) {
			expect(state.destroyCalls).toBe(1);
			expect(state.emittedChunks).toBe(1);
		},
	},
];

describe("patched FileService Plain versioned writes", () => {
	it("rejects missing, disabled, malformed, stale and tokenless baselines before writing", async () => {
		const cases = [
			{ label: "missing options", options: undefined },
			{ label: "missing etag", options: { mtime: 200 } },
			{ label: "disabled etag", options: writeOptions(ETAG_DISABLED) },
			{ label: "malformed etag", options: writeOptions("wv1:UPPER") },
			{ label: "stale etag", options: writeOptions(VERSION_C) },
			{
				label: "tokenless stat",
				options: writeOptions(),
				initialStat: providerStat({ version: null }),
			},
			{
				label: "missing provider token",
				options: writeOptions(),
				initialStat: providerStat({ omitVersion: true }),
			},
			{
				label: "missing file",
				options: writeOptions(),
				statError: FileSystemProviderError.create(
					"missing",
					FileSystemProviderErrorCode.FileNotFound,
				),
			},
		];

		for (const testCase of cases) {
			const { provider, state } = fakeProvider(testCase);
			const service = serviceWith("plain-workspace", provider);
			const operations = writeEvents(service);
			try {
				const error = await rejected(
					service.writeFile(
						PLAIN_URI,
						VSBuffer.fromString(testCase.label),
						testCase.options,
					),
				);
				expect(error, testCase.label).toMatchObject({
					fileOperationResult: FileOperationResult.FILE_MODIFIED_SINCE,
				});
				expect(state.plainWriteCalls, testCase.label).toBe(0);
				expect(state.standardWriteCalls, testCase.label).toBe(0);
				expect(state.mkdirCalls, testCase.label).toBe(0);
				expect(state.readCalls, testCase.label).toBe(0);
				expect(operations.events, testCase.label).toHaveLength(0);
			} finally {
				operations.subscription.dispose();
				service.dispose();
			}
		}
	});

	it("preserves provider stat permission and unavailable results but treats FileNotFound as modified", async () => {
		const cases = [
			{
				label: "permission denied",
				providerCode: FileSystemProviderErrorCode.NoPermissions,
				expectedResult: FileOperationResult.FILE_PERMISSION_DENIED,
			},
			{
				label: "provider unavailable",
				providerCode: FileSystemProviderErrorCode.Unavailable,
				expectedResult: FileOperationResult.FILE_OTHER_ERROR,
			},
			{
				label: "file not found",
				providerCode: FileSystemProviderErrorCode.FileNotFound,
				expectedResult: FileOperationResult.FILE_MODIFIED_SINCE,
			},
		];

		for (const testCase of cases) {
			const { provider, state } = fakeProvider({
				statError: FileSystemProviderError.create(
					testCase.label,
					testCase.providerCode,
				),
			});
			const service = serviceWith("plain-workspace", provider);
			const operations = writeEvents(service);
			try {
				const error = await rejected(
					service.writeFile(
						PLAIN_URI,
						VSBuffer.fromString(testCase.label),
						writeOptions(),
					),
				);
				expect(error.fileOperationResult, testCase.label).toBe(
					testCase.expectedResult,
				);
				expect(isPlainWorkspaceWriteOutcomeError(error)).toBe(false);
				expect(state, testCase.label).toMatchObject({
					statCalls: 1,
					mkdirCalls: 0,
					readCalls: 0,
					standardWriteCalls: 0,
					plainWriteCalls: 0,
				});
				expect(operations.events, testCase.label).toHaveLength(0);
			} finally {
				operations.subscription.dispose();
				service.dispose();
			}
		}
	});

	for (const inputKind of INPUT_KINDS) {
		for (const [boundary, expectedLength] of [
			["empty", 0],
			["maximum", MAX_WRITE_BYTES],
		]) {
			it(
				`accepts ${inputKind.name} at the ${boundary} boundary`,
				{ timeout: 60_000 },
				async () => {
					const { input } = inputKind.make(boundary);
					const { provider, state } = fakeProvider();
					const service = serviceWith("plain-workspace", provider);
					const operations = writeEvents(service);
					try {
						const stat = await service.writeFile(
							PLAIN_URI,
							input,
							writeOptions(),
						);
						expect(state).toMatchObject({
							statCalls: 1,
							mkdirCalls: 0,
							readCalls: 0,
							standardWriteCalls: 0,
							plainWriteCalls: 1,
							plainWriteContentLength: expectedLength,
							plainWriteExpectedVersion: VERSION_A,
						});
						expect(stat).toMatchObject({
							size: expectedLength,
							mtime: 50,
							etag: VERSION_B,
							plainWriteReceipt: true,
						});
						expect(
							Object.getOwnPropertyDescriptor(stat, "plainWriteReceipt"),
						).toMatchObject({ value: true });
						expect(operations.events).toHaveLength(1);
					} finally {
						operations.subscription.dispose();
						service.dispose();
					}
				},
			);
		}

		it(
			`rejects ${inputKind.name} at 8 MiB + 1 before provider dispatch`,
			{ timeout: 60_000 },
			async () => {
				const { input, state: inputState } = inputKind.make("oversized");
				const { provider, state } = fakeProvider();
				const service = serviceWith("plain-workspace", provider);
				const operations = writeEvents(service);
				try {
					const error = await rejected(
						service.writeFile(PLAIN_URI, input, writeOptions()),
					);
					expect(error).toMatchObject({
						fileOperationResult: FileOperationResult.FILE_TOO_LARGE,
					});
					expect(state).toMatchObject({
						statCalls: 1,
						mkdirCalls: 0,
						readCalls: 0,
						standardWriteCalls: 0,
						plainWriteCalls: 0,
					});
					expect(operations.events).toHaveLength(0);
					inputKind.assertStopped(inputState);
				} finally {
					operations.subscription.dispose();
					service.dispose();
				}
			},
		);
	}

	it("rejects a zero-length ReadableStream chunk, destroys the stream and never dispatches", async () => {
		const { stream, state: streamState } = scriptedStream([
			VSBuffer.alloc(0),
			VSBuffer.alloc(1),
		]);
		const { provider, state } = fakeProvider();
		const service = serviceWith("plain-workspace", provider);
		const operations = writeEvents(service);
		try {
			const error = await rejected(
				service.writeFile(PLAIN_URI, stream, writeOptions()),
			);
			expect(error).toMatchObject({
				fileOperationResult: FileOperationResult.FILE_OTHER_ERROR,
			});
			expect(state).toMatchObject({
				statCalls: 1,
				mkdirCalls: 0,
				readCalls: 0,
				standardWriteCalls: 0,
				plainWriteCalls: 0,
			});
			expect(streamState).toMatchObject({
				destroyCalls: 1,
				emittedChunks: 1,
				destroyed: true,
			});
			expect(operations.events).toHaveLength(0);
		} finally {
			operations.subscription.dispose();
			service.dispose();
		}
	});

	it("stops a pure Readable immediately after a zero-length chunk", async () => {
		const { input, state: readableState } = scriptedReadable([
			VSBuffer.alloc(0),
			VSBuffer.alloc(1),
		]);
		const { provider, state } = fakeProvider();
		const service = serviceWith("plain-workspace", provider);
		const operations = writeEvents(service);
		try {
			const error = await rejected(
				service.writeFile(PLAIN_URI, input, writeOptions()),
			);
			expect(error).toMatchObject({
				fileOperationResult: FileOperationResult.FILE_OTHER_ERROR,
			});
			expect(readableState.readCalls).toBe(1);
			expect(state).toMatchObject({
				statCalls: 1,
				mkdirCalls: 0,
				readCalls: 0,
				standardWriteCalls: 0,
				plainWriteCalls: 0,
			});
			expect(operations.events).toHaveLength(0);
		} finally {
			operations.subscription.dispose();
			service.dispose();
		}
	});

	it("returns only the written receipt, fires one WRITE and never post-stats", async () => {
		const { provider, state } = fakeProvider();
		const service = serviceWith("plain-workspace", provider);
		const operations = writeEvents(service);
		try {
			const stat = await service.writeFile(
				PLAIN_URI,
				VSBuffer.fromString("new contents"),
				writeOptions(),
			);
			expect(stat).toMatchObject({
				mtime: 50,
				etag: VERSION_B,
				plainWriteReceipt: true,
			});
			expect(state).toMatchObject({
				statCalls: 1,
				mkdirCalls: 0,
				readCalls: 0,
				standardWriteCalls: 0,
				plainWriteCalls: 1,
				plainWriteExpectedVersion: VERSION_A,
			});
			expect(operations.events).toHaveLength(1);
			expect(operations.events[0].resource.toString()).toBe(
				PLAIN_URI.toString(),
			);
		} finally {
			operations.subscription.dispose();
			service.dispose();
		}
	});

	it("rejects every hostile written result as a contract error without a WRITE event", async () => {
		let accessorReads = 0;
		const cases = [
			{
				label: "extra result key",
				makeResult: (size) =>
					Object.freeze({
						status: "written",
						stat: strictWrittenStat({ size }),
						privatePath: "/secret",
					}),
			},
			{
				label: "accessor result",
				makeResult(size) {
					const result = { status: "written" };
					Object.defineProperty(result, "stat", {
						enumerable: true,
						get() {
							accessorReads += 1;
							return strictWrittenStat({ size });
						},
					});
					return Object.freeze(result);
				},
			},
			{
				label: "proxied result",
				makeResult: (size) => new Proxy(writtenResult(size), {}),
			},
			{
				label: "malformed stat",
				makeResult: (size) =>
					Object.freeze({
						status: "written",
						stat: Object.freeze({
							type: FileType.File,
							size,
							mtime: 50,
							plainVersion: VERSION_B,
						}),
					}),
			},
			{
				label: "tokenless stat",
				makeResult: (size) =>
					Object.freeze({
						status: "written",
						stat: strictWrittenStat({ size, version: null }),
					}),
			},
			{
				label: "unchanged version token",
				makeResult: (size) =>
					Object.freeze({
						status: "written",
						stat: strictWrittenStat({ size, version: VERSION_A }),
					}),
			},
			{
				label: "size mismatch",
				makeResult: (size) =>
					Object.freeze({
						status: "written",
						stat: strictWrittenStat({ size: size + 1 }),
					}),
			},
		];

		for (const testCase of cases) {
			const input = VSBuffer.fromString(testCase.label);
			const { provider, state } = fakeProvider({
				writeResult: testCase.makeResult(input.byteLength),
			});
			const service = serviceWith("plain-workspace", provider);
			const operations = writeEvents(service);
			try {
				const error = await rejected(
					service.writeFile(PLAIN_URI, input, writeOptions()),
				);
				expect(error, testCase.label).toMatchObject({
					fileOperationResult: FileOperationResult.FILE_OTHER_ERROR,
				});
				expect(isPlainWorkspaceWriteOutcomeError(error)).toBe(false);
				expect(getPlainWorkspaceWriteOutcome(error)).toBeUndefined();
				expect(state, testCase.label).toMatchObject({
					statCalls: 1,
					mkdirCalls: 0,
					readCalls: 0,
					standardWriteCalls: 0,
					plainWriteCalls: 1,
				});
				expect(operations.events, testCase.label).toHaveLength(0);
			} finally {
				operations.subscription.dispose();
				service.dispose();
			}
		}

		expect(accessorReads).toBe(0);
	});

	it("rejects invalid incomplete outcomes and fake full-success downgrades at runtime", async () => {
		const cases = [
			{
				label: "incomplete outcome with an extra key",
				outcome: Object.freeze({
					...WRITE_OUTCOMES[0],
					privatePath: "/secret",
				}),
			},
			{
				label: "invalid unknown cross-fields",
				outcome: Object.freeze({
					status: "outcomeUnknown",
					observation: "responseUnavailable",
					rename: "reportedFailure",
					directorySync: "notAttempted",
					target: "ambiguous",
				}),
			},
			{
				label: "fake full-success downgrade",
				outcome: Object.freeze({
					status: "targetPublished",
					publicationEvidence: "targetObservedWritten",
					rename: "reportedSuccess",
					directorySync: "synced",
					target: "matchesWritten",
				}),
			},
		];

		for (const testCase of cases) {
			expect(() =>
				createPlainWorkspaceWriteOutcomeError(testCase.outcome, writeOptions()),
			).toThrow();
			const { provider, state } = fakeProvider({
				writeResult: testCase.outcome,
			});
			const service = serviceWith("plain-workspace", provider);
			const operations = writeEvents(service);
			try {
				const error = await rejected(
					service.writeFile(
						PLAIN_URI,
						VSBuffer.fromString(testCase.label),
						writeOptions(),
					),
				);
				expect(error, testCase.label).toMatchObject({
					fileOperationResult: FileOperationResult.FILE_OTHER_ERROR,
				});
				expect(isPlainWorkspaceWriteOutcomeError(error)).toBe(false);
				expect(getPlainWorkspaceWriteOutcome(error)).toBeUndefined();
				expect(state, testCase.label).toMatchObject({
					statCalls: 1,
					mkdirCalls: 0,
					readCalls: 0,
					standardWriteCalls: 0,
					plainWriteCalls: 1,
				});
				expect(operations.events, testCase.label).toHaveLength(0);
			} finally {
				operations.subscription.dispose();
				service.dispose();
			}
		}
	});

	it("brands every incomplete or unknown outcome without a WRITE success event", async () => {
		for (const outcome of WRITE_OUTCOMES) {
			const { provider, state } = fakeProvider({ writeResult: outcome });
			const service = serviceWith("plain-workspace", provider);
			const operations = writeEvents(service);
			try {
				const error = await rejected(
					service.writeFile(
						PLAIN_URI,
						VSBuffer.fromString("new contents"),
						writeOptions(),
					),
				);
				expect(error).toMatchObject({
					fileOperationResult: FileOperationResult.FILE_OTHER_ERROR,
				});
				expect(isPlainWorkspaceWriteOutcomeError(error)).toBe(true);
				expect(getPlainWorkspaceWriteOutcome(error)).toEqual(outcome);
				expect(Object.hasOwn(error, "plainWorkspaceWriteOutcome")).toBe(false);
				expect(Object.isFrozen(getPlainWorkspaceWriteOutcome(error))).toBe(
					true,
				);
				expect(state).toMatchObject({
					statCalls: 1,
					mkdirCalls: 0,
					readCalls: 0,
					standardWriteCalls: 0,
					plainWriteCalls: 1,
				});
				expect(operations.events).toHaveLength(0);
			} finally {
				operations.subscription.dispose();
				service.dispose();
			}
		}
	});

	it("gates queued same-URI dispatch after an unknown result until one authoritative PLR1 read", async () => {
		const { provider, state } = fakeProvider();
		const firstStarted = deferred();
		const firstResult = deferred();
		const secondValidated = deferred();
		let plainReadCalls = 0;
		const originalStat = provider.stat.bind(provider);
		provider.stat = async () => {
			const stat = await originalStat();
			if (state.statCalls === 2) {
				secondValidated.resolve();
			}
			return stat;
		};
		provider.plainWriteFile = async (_resource, content, expectedVersion) => {
			state.plainWriteCalls += 1;
			state.plainWriteContentLength = content.byteLength;
			state.plainWriteExpectedVersion = expectedVersion;
			if (state.plainWriteCalls === 1) {
				firstStarted.resolve();
				return firstResult.promise;
			}
			return writtenResult(content.byteLength);
		};
		provider.plainReadFile = async () => {
			plainReadCalls += 1;
			return plainReadReceipt();
		};
		const service = serviceWith("plain-workspace", provider);
		const operations = writeEvents(service);
		try {
			const firstErrorPromise = rejected(
				service.writeFile(
					PLAIN_URI,
					VSBuffer.fromString("gate"),
					writeOptions(),
				),
			);
			await firstStarted.promise;
			const secondErrorPromise = rejected(
				service.writeFile(
					PLAIN_URI,
					VSBuffer.fromString("gate"),
					writeOptions(),
				),
			);
			await secondValidated.promise;
			expect(state.statCalls).toBe(2);

			firstResult.resolve(WRITE_OUTCOMES[3]);
			const [firstError, secondError] = await Promise.all([
				firstErrorPromise,
				secondErrorPromise,
			]);
			expect(isPlainWorkspaceWriteOutcomeError(firstError)).toBe(true);
			expect(isPlainWorkspaceWriteOutcomeError(secondError)).toBe(true);
			expect(state.plainWriteCalls).toBe(1);
			expect(operations.events).toHaveLength(0);

			const laterError = await rejected(
				service.writeFile(
					PLAIN_URI,
					VSBuffer.fromString("gate"),
					writeOptions(),
				),
			);
			expect(isPlainWorkspaceWriteOutcomeError(laterError)).toBe(true);
			expect(state.statCalls).toBe(2);
			expect(state.plainWriteCalls).toBe(1);

			await service.readFile(PLAIN_URI);
			expect(plainReadCalls).toBe(1);
			const receipt = await service.writeFile(
				PLAIN_URI,
				VSBuffer.fromString("gate"),
				writeOptions(),
			);
			expect(receipt).toMatchObject({
				etag: VERSION_B,
				plainWriteReceipt: true,
			});
			expect(state.statCalls).toBe(3);
			expect(state.plainWriteCalls).toBe(2);
			expect(operations.events).toHaveLength(1);
		} finally {
			operations.subscription.dispose();
			service.dispose();
		}
	});

	it("does not clear a new gate with a PLR1 read that started before the unknown result", async () => {
		const { provider, state } = fakeProvider();
		const readStarted = deferred();
		const delayedRead = deferred();
		let plainReadCalls = 0;
		provider.plainReadFile = async () => {
			plainReadCalls += 1;
			if (plainReadCalls === 1) {
				readStarted.resolve();
				return delayedRead.promise;
			}
			return plainReadReceipt();
		};
		provider.plainWriteFile = async (_resource, content, expectedVersion) => {
			state.plainWriteCalls += 1;
			state.plainWriteContentLength = content.byteLength;
			state.plainWriteExpectedVersion = expectedVersion;
			return state.plainWriteCalls === 1
				? WRITE_OUTCOMES[3]
				: writtenResult(content.byteLength);
		};
		const service = serviceWith("plain-workspace", provider);
		const operations = writeEvents(service);
		try {
			const prestartedRead = service.readFile(PLAIN_URI);
			await readStarted.promise;
			const firstError = await rejected(
				service.writeFile(
					PLAIN_URI,
					VSBuffer.fromString("gate"),
					writeOptions(),
				),
			);
			expect(isPlainWorkspaceWriteOutcomeError(firstError)).toBe(true);
			expect(state.plainWriteCalls).toBe(1);

			delayedRead.resolve(plainReadReceipt());
			await prestartedRead;
			const blockedError = await rejected(
				service.writeFile(
					PLAIN_URI,
					VSBuffer.fromString("gate"),
					writeOptions(),
				),
			);
			expect(isPlainWorkspaceWriteOutcomeError(blockedError)).toBe(true);
			expect(state.plainWriteCalls).toBe(1);
			expect(operations.events).toHaveLength(0);

			await service.readFile(PLAIN_URI);
			await service.writeFile(
				PLAIN_URI,
				VSBuffer.fromString("gate"),
				writeOptions(),
			);
			expect(plainReadCalls).toBe(2);
			expect(state.plainWriteCalls).toBe(2);
			expect(operations.events).toHaveLength(1);
		} finally {
			operations.subscription.dispose();
			service.dispose();
		}
	});

	it("does not let a case-colliding URI clear another resource's gate", async () => {
		const { provider, state } = fakeProvider();
		provider.plainReadFile = async () => plainReadReceipt();
		provider.plainWriteFile = async (_resource, content, expectedVersion) => {
			state.plainWriteCalls += 1;
			state.plainWriteContentLength = content.byteLength;
			state.plainWriteExpectedVersion = expectedVersion;
			return state.plainWriteCalls === 1
				? WRITE_OUTCOMES[3]
				: writtenResult(content.byteLength);
		};
		const service = serviceWith("plain-workspace", provider);
		const operations = writeEvents(service);
		try {
			const firstError = await rejected(
				service.writeFile(
					PLAIN_UPPER_URI,
					VSBuffer.fromString("gate"),
					writeOptions(),
				),
			);
			expect(isPlainWorkspaceWriteOutcomeError(firstError)).toBe(true);
			await service.readFile(PLAIN_LOWER_URI);

			const blockedError = await rejected(
				service.writeFile(
					PLAIN_UPPER_URI,
					VSBuffer.fromString("gate"),
					writeOptions(),
				),
			);
			expect(isPlainWorkspaceWriteOutcomeError(blockedError)).toBe(true);
			expect(state.plainWriteCalls).toBe(1);
			expect(operations.events).toHaveLength(0);

			await service.readFile(PLAIN_UPPER_URI);
			await service.writeFile(
				PLAIN_UPPER_URI,
				VSBuffer.fromString("gate"),
				writeOptions(),
			);
			expect(state.plainWriteCalls).toBe(2);
			expect(operations.events).toHaveLength(1);
		} finally {
			operations.subscription.dispose();
			service.dispose();
		}
	});

	it("keeps the WeakMap brand unforgeable and rejects hostile outcomes", () => {
		const options = Object.freeze(writeOptions());
		const outcome = WRITE_OUTCOMES[0];
		const branded = createPlainWorkspaceWriteOutcomeError(outcome, options);
		expect(branded).toMatchObject({
			fileOperationResult: FileOperationResult.FILE_OTHER_ERROR,
			options,
		});
		expect(branded.options).toBe(options);
		expect(isPlainWorkspaceWriteOutcomeError(branded)).toBe(true);
		expect(getPlainWorkspaceWriteOutcome(branded)).toEqual(outcome);
		expect(Object.hasOwn(branded, "plainWorkspaceWriteOutcome")).toBe(false);

		const forged = new FileOperationError(
			branded.message,
			FileOperationResult.FILE_OTHER_ERROR,
			options,
		);
		Object.defineProperty(forged, "plainWorkspaceWriteOutcome", {
			value: outcome,
			writable: false,
			configurable: false,
		});
		expect(isPlainWorkspaceWriteOutcomeError(forged)).toBe(false);
		expect(getPlainWorkspaceWriteOutcome(forged)).toBeUndefined();

		let accessorReads = 0;
		const accessorOutcome = {
			status: "targetPublished",
			publicationEvidence: "targetObservedWritten",
			rename: "reportedSuccess",
			directorySync: "failed",
		};
		Object.defineProperty(accessorOutcome, "target", {
			enumerable: true,
			get() {
				accessorReads += 1;
				return "matchesWritten";
			},
		});
		Object.freeze(accessorOutcome);
		let proxyReads = 0;
		const proxiedOutcome = new Proxy(outcome, {
			get(target, property, receiver) {
				proxyReads += 1;
				return Reflect.get(target, property, receiver);
			},
		});
		const invalidOutcomes = [
			null,
			Object.freeze({ ...outcome, privatePath: "/secret" }),
			Object.freeze({ ...outcome, directorySync: "synced" }),
			accessorOutcome,
			proxiedOutcome,
		];
		for (const invalidOutcome of invalidOutcomes) {
			expect(() =>
				createPlainWorkspaceWriteOutcomeError(invalidOutcome, options),
			).toThrow();
		}
		expect(accessorReads).toBe(0);
		expect(proxyReads).toBe(0);
	});

	it("keeps the non-Plain write path on the standard provider and post-stat", async () => {
		const { provider, state } = fakeProvider({
			scheme: "plain-test",
			initialStat: Object.freeze({
				type: FileType.File,
				size: 4,
				mtime: 200,
				ctime: 100,
			}),
		});
		const service = serviceWith("plain-test", provider);
		const operations = writeEvents(service);
		try {
			const stat = await service.writeFile(
				OTHER_URI,
				VSBuffer.fromString("other"),
				{ mtime: 200, etag: "ordinary-etag" },
			);
			expect(state).toMatchObject({
				statCalls: 2,
				standardWriteCalls: 1,
				plainWriteCalls: 0,
			});
			expect(Object.hasOwn(stat, "plainWriteReceipt")).toBe(false);
			expect(stat.size).toBe(5);
			expect(operations.events).toHaveLength(1);
		} finally {
			operations.subscription.dispose();
			service.dispose();
		}
	});
});
