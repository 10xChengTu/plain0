import { describe, expect, it } from "vitest";

import { Event } from "@codingame/monaco-vscode-api/vscode/vs/base/common/event";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import {
	ETAG_DISABLED,
	FileOperationResult,
	FilePermission,
	FileSystemProviderCapabilities,
	FileType,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files";
import { TextFileEditorModel } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/textfile/common/textFileEditorModel";
import { StoredFileWorkingCopy } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/workingCopy/common/storedFileWorkingCopy";
import { FileService } from "@codingame/monaco-vscode-files-service-override/vscode/vs/platform/files/common/fileService";

const PLAIN_URI = URI.parse(
	"plain-workspace://00112233-4455-4677-8899-aabbccddeeff/src/main.ts",
);
const OTHER_URI = URI.parse("plain-test:/src/main.ts");
const VERSION_A = `wv1:${"a".repeat(64)}`;
const VERSION_B = `wv1:${"b".repeat(64)}`;

function bytes(value) {
	return Uint8Array.from(new TextEncoder().encode(value));
}

function receipt(value, version, overrides = {}) {
	const valueBytes = bytes(value);
	const stat = Object.freeze({
		type: FileType.File,
		size: valueBytes.byteLength,
		mtime: 200,
		ctime: 100,
		...(version === null ? { permissions: FilePermission.Readonly } : {}),
		plainVersion: version,
		...overrides,
	});
	return Object.freeze({ stat, value: valueBytes });
}

function fakeProvider({ scheme = "plain-workspace", currentReceipt }) {
	const state = {
		currentReceipt,
		statCalls: 0,
		readCalls: 0,
		plainReadCalls: 0,
	};
	const provider = {
		capabilities:
			FileSystemProviderCapabilities.FileReadWrite |
			(scheme === "plain-workspace"
				? FileSystemProviderCapabilities.Readonly
				: 0),
		onDidChangeCapabilities: Event.None,
		onDidChangeFile: Event.None,
		async stat() {
			state.statCalls += 1;
			return state.currentReceipt.stat;
		},
		async readFile() {
			state.readCalls += 1;
			return state.currentReceipt.value.slice();
		},
		async plainReadFile() {
			state.plainReadCalls += 1;
			return state.currentReceipt;
		},
	};
	return { provider, state };
}

function serviceWith(scheme, provider) {
	const service = new FileService({ trace() {} });
	service.registerProvider(scheme, provider);
	return service;
}

function stringValue(content) {
	return new TextDecoder().decode(content.value.buffer);
}

describe("patched FileService Plain read receipts", () => {
	it("pairs A content with A version in one provider call and never stats B", async () => {
		const { provider, state } = fakeProvider({
			currentReceipt: receipt("AAAA", VERSION_A),
		});
		const service = serviceWith("plain-workspace", provider);
		provider.stat = async () => {
			state.statCalls += 1;
			return receipt("BBBB", VERSION_B).stat;
		};

		const content = await service.readFile(PLAIN_URI);
		expect(stringValue(content)).toBe("AAAA");
		expect(content.etag).toBe(VERSION_A);
		expect(content.plainReadReceipt).toBe(true);
		expect(state).toMatchObject({
			plainReadCalls: 1,
			statCalls: 0,
			readCalls: 0,
		});
	});

	it("applies position, length, conditional etag, and full-file limits", async () => {
		const { provider } = fakeProvider({
			currentReceipt: receipt("abcdef", VERSION_A),
		});
		const service = serviceWith("plain-workspace", provider);
		const content = await service.readFile(PLAIN_URI, {
			position: 2,
			length: 3,
			limits: { size: 6 },
		});
		expect(stringValue(content)).toBe("cde");
		await expect(
			service.readFile(PLAIN_URI, { limits: { size: 5 } }),
		).rejects.toMatchObject({
			fileOperationResult: FileOperationResult.FILE_TOO_LARGE,
		});
		await expect(
			service.readFile(PLAIN_URI, { etag: VERSION_A }),
		).rejects.toMatchObject({
			fileOperationResult: FileOperationResult.FILE_NOT_MODIFIED_SINCE,
		});
	});

	it("rejects receipts over 8 MiB before stream construction", async () => {
		const value = new Uint8Array(8 * 1024 * 1024 + 1);
		const stat = Object.freeze({
			type: FileType.File,
			size: value.byteLength,
			mtime: 200,
			ctime: 100,
			plainVersion: VERSION_A,
		});
		const { provider, state } = fakeProvider({
			currentReceipt: Object.freeze({ stat, value }),
		});
		await expect(
			serviceWith("plain-workspace", provider).readFile(PLAIN_URI),
		).rejects.toMatchObject({
			fileOperationResult: FileOperationResult.FILE_TOO_LARGE,
		});
		expect(state).toMatchObject({
			plainReadCalls: 1,
			statCalls: 0,
			readCalls: 0,
		});
	});

	it("copies provider bytes before the toFileStat await window", async () => {
		const originalValue = bytes("AAAA");
		const stat = Object.freeze({
			type: FileType.File,
			size: originalValue.byteLength,
			mtime: 200,
			ctime: 100,
			plainVersion: VERSION_A,
		});
		const { provider } = fakeProvider({
			currentReceipt: Object.freeze({ stat, value: originalValue }),
		});
		const service = serviceWith("plain-workspace", provider);
		const toFileStat = service.toFileStat.bind(service);
		service.toFileStat = async (...args) => {
			const result = await toFileStat(...args);
			originalValue.fill("B".charCodeAt(0));
			return result;
		};

		const content = await service.readFile(PLAIN_URI);
		expect(stringValue(content)).toBe("AAAA");
		expect(new TextDecoder().decode(originalValue)).toBe("BBBB");
	});

	it("keeps tokenless files readonly and re-reads equal-size equal-mtime changes", async () => {
		const { provider, state } = fakeProvider({
			currentReceipt: receipt("AAAA", null),
		});
		const service = serviceWith("plain-workspace", provider);
		const first = await service.readFile(PLAIN_URI);
		expect(first.etag).toBe(ETAG_DISABLED);
		expect(first.readonly).toBe(true);

		state.currentReceipt = receipt("BBBB", null);
		const second = await service.readFile(PLAIN_URI, { etag: first.etag });
		expect(stringValue(second)).toBe("BBBB");
		expect(state.plainReadCalls).toBe(2);
		expect(state.statCalls).toBe(0);
	});

	it("rejects malformed tokens and typed-array proxies without fallback reads", async () => {
		const malformed = fakeProvider({
			currentReceipt: receipt("AAAA", "wv1:UPPER"),
		});
		const malformedService = serviceWith("plain-workspace", malformed.provider);
		await expect(malformedService.readFile(PLAIN_URI)).rejects.toThrow(
			"PLAIN_WORKSPACE_INVALID_READ_RECEIPT",
		);

		const proxiedValue = new Proxy(bytes("AAAA"), {});
		const proxied = fakeProvider({
			currentReceipt: Object.freeze({
				stat: receipt("AAAA", VERSION_A).stat,
				value: proxiedValue,
			}),
		});
		const proxiedService = serviceWith("plain-workspace", proxied.provider);
		await expect(proxiedService.readFile(PLAIN_URI)).rejects.toThrow(
			"PLAIN_WORKSPACE_INVALID_READ_RECEIPT",
		);
		expect(proxied.state.readCalls).toBe(0);
		expect(proxied.state.statCalls).toBe(0);
	});

	it("snapshots data-only stats and rejects stat proxies/accessors without invoking getters", async () => {
		const base = receipt("AAAA", VERSION_A);
		const proxiedStat = new Proxy(base.stat, {});
		const proxied = fakeProvider({
			currentReceipt: Object.freeze({ stat: proxiedStat, value: base.value }),
		});
		await expect(
			serviceWith("plain-workspace", proxied.provider).readFile(PLAIN_URI),
		).rejects.toThrow();

		let getterCalls = 0;
		const accessorStat = {
			type: FileType.File,
			mtime: 200,
			ctime: 100,
			plainVersion: VERSION_A,
		};
		Object.defineProperty(accessorStat, "size", {
			enumerable: true,
			get() {
				getterCalls += 1;
				return 4;
			},
		});
		Object.freeze(accessorStat);
		const accessor = fakeProvider({
			currentReceipt: Object.freeze({
				stat: accessorStat,
				value: base.value,
			}),
		});
		await expect(
			serviceWith("plain-workspace", accessor.provider).readFile(PLAIN_URI),
		).rejects.toThrow("stat fields must be own data properties");
		expect(getterCalls).toBe(0);
		expect(accessor.state.statCalls).toBe(0);
	});

	it("rejects object-valued stat scalars and invalid version/type/permission relations without coercion", async () => {
		const base = receipt("AAAA", VERSION_A);
		let scalarTrapCalls = 0;
		const nestedScalar = new Proxy(Object.freeze({}), {
			get() {
				scalarTrapCalls += 1;
				throw new Error("scalar coercion must not run");
			},
		});
		const scalarCases = [
			{ type: nestedScalar },
			{ size: nestedScalar },
			{ mtime: nestedScalar },
			{ ctime: nestedScalar },
			{ plainVersion: nestedScalar },
			{ permissions: nestedScalar, plainVersion: null },
		];
		for (const overrides of scalarCases) {
			const stat = Object.freeze({
				type: FileType.File,
				size: 4,
				mtime: 200,
				ctime: 100,
				plainVersion: VERSION_A,
				...overrides,
			});
			const provider = fakeProvider({
				currentReceipt: Object.freeze({ stat, value: base.value }),
			}).provider;
			await expect(
				serviceWith("plain-workspace", provider).readFile(PLAIN_URI),
			).rejects.toThrow("PLAIN_WORKSPACE_INVALID_READ_RECEIPT");
		}
		expect(scalarTrapCalls).toBe(0);

		const invalidRelations = [
			{
				type: FileType.File | FileType.SymbolicLink,
				plainVersion: VERSION_A,
			},
			{ type: FileType.File, plainVersion: null },
			{
				type: FileType.File,
				permissions: FilePermission.Readonly,
				plainVersion: VERSION_A,
			},
			{
				type: FileType.File,
				permissions: FilePermission.Locked,
				plainVersion: null,
			},
		];
		for (const relation of invalidRelations) {
			const stat = Object.freeze({
				size: 4,
				mtime: 200,
				ctime: 100,
				...relation,
			});
			const provider = fakeProvider({
				currentReceipt: Object.freeze({ stat, value: base.value }),
			}).provider;
			await expect(
				serviceWith("plain-workspace", provider).readFile(PLAIN_URI),
			).rejects.toThrow("PLAIN_WORKSPACE_INVALID_READ_RECEIPT");
		}
	});

	it("keeps the non-Plain stat plus read path unchanged", async () => {
		const { provider, state } = fakeProvider({
			scheme: "plain-test",
			currentReceipt: receipt("OTHER", VERSION_A),
		});
		const service = serviceWith("plain-test", provider);
		const content = await service.readFile(OTHER_URI);
		expect(stringValue(content)).toBe("OTHER");
		expect(Object.hasOwn(content, "plainReadReceipt")).toBe(false);
		expect(state).toMatchObject({
			statCalls: 1,
			readCalls: 1,
			plainReadCalls: 0,
		});
	});

	it("maps partial Plain child files to no-baseline readonly stats", async () => {
		const { provider } = fakeProvider({
			currentReceipt: receipt("AAAA", VERSION_A),
		});
		const service = serviceWith("plain-workspace", provider);
		const partialFile = await service.toFileStat(
			provider,
			PLAIN_URI,
			{ type: FileType.File },
			undefined,
			false,
			() => false,
		);
		expect(partialFile).toMatchObject({
			etag: ETAG_DISABLED,
			readonly: true,
		});
		await expect(
			service.toFileStat(
				provider,
				PLAIN_URI,
				Object.freeze({
					type: FileType.File,
					size: 0,
					mtime: 0,
					ctime: 0,
					plainVersion: "not-a-token",
				}),
				undefined,
				true,
				() => false,
			),
		).rejects.toThrow("PLAIN_WORKSPACE_INVALID_VERSION");
	});
});

const MODEL_CASES = [
	["text model", TextFileEditorModel.prototype, "text"],
	["stored working copy", StoredFileWorkingCopy.prototype, "stored"],
];

function modelBufferContext(kind, resource, statResult) {
	let resolved;
	const context = {
		resource,
		name: "main.ts",
		preferredEncoding: undefined,
		trace() {},
		fileService: {
			async stat() {
				if (statResult instanceof Error) {
					throw statResult;
				}
				return statResult;
			},
		},
		textFileService: {
			encoding: {
				async getPreferredWriteEncoding() {
					return { encoding: "utf8" };
				},
			},
		},
		setOrphaned() {},
		resolveFromContent(...args) {
			resolved = args;
		},
	};
	return { context, resolved: () => resolved, kind };
}

function fullFileStat(
	resource,
	{ mtime, etag, readonly = false, locked = false },
) {
	return {
		resource,
		name: "main.ts",
		mtime,
		ctime: mtime,
		size: 4,
		etag,
		readonly,
		locked,
		executable: false,
		isFile: true,
		isDirectory: false,
		isSymbolicLink: false,
		children: undefined,
	};
}

describe.each(MODEL_CASES)("patched %s baselines", (_name, prototype, kind) => {
	it("forces preferred/MOVE-COPY buffers to the sentinel and preserves readonly metadata", async () => {
		const setup = modelBufferContext(kind, PLAIN_URI, {
			mtime: 5,
			ctime: 4,
			size: 4,
			etag: VERSION_A,
			readonly: true,
			locked: true,
		});
		await prototype.resolveFromBuffer.call(
			setup.context,
			{ arbitrary: "memory" },
			{},
		);
		const resolved = setup.resolved();
		const [content, dirty] = resolved;
		const source = kind === "text" ? resolved[3] : resolved[2];
		expect(content).toMatchObject({
			etag: "plain-buffer-no-baseline",
			readonly: true,
			locked: true,
		});
		expect(dirty).toBe(true);
		expect(typeof source).toBe("symbol");

		const baselineContext = {
			resource: PLAIN_URI,
			lastResolvedFileStat: fullFileStat(PLAIN_URI, {
				mtime: 999,
				etag: VERSION_B,
			}),
			isReadonly() {
				return Boolean(this.lastResolvedFileStat?.readonly);
			},
			_onDidChangeReadonly: { fire() {} },
		};
		prototype.updateLastResolvedFileStat.call(
			baselineContext,
			fullFileStat(PLAIN_URI, {
				mtime: content.mtime,
				etag: content.etag,
				readonly: content.readonly,
				locked: content.locked,
			}),
			source,
		);
		expect(baselineContext.lastResolvedFileStat.etag).toBe(
			"plain-buffer-no-baseline",
		);
	});

	it("fails closed as readonly when buffer metadata stat fails", async () => {
		const setup = modelBufferContext(kind, PLAIN_URI, new Error("missing"));
		await prototype.resolveFromBuffer.call(
			setup.context,
			{ arbitrary: "memory" },
			{},
		);
		expect(setup.resolved()[0]).toMatchObject({
			etag: "plain-buffer-no-baseline",
			readonly: true,
			locked: false,
		});
	});

	it("keeps the non-Plain resolveFromBuffer behavior unchanged", async () => {
		const setup = modelBufferContext(kind, OTHER_URI, {
			mtime: 5,
			ctime: 4,
			size: 4,
			etag: "upstream-etag",
			readonly: true,
			locked: true,
		});
		await prototype.resolveFromBuffer.call(
			setup.context,
			{ arbitrary: "memory" },
			{},
		);
		const resolved = setup.resolved();
		const content = resolved[0];
		const source = kind === "text" ? resolved[3] : resolved[2];
		expect(content).toMatchObject({
			etag: "upstream-etag",
			readonly: false,
			locked: false,
		});
		expect(source).toBeUndefined();
	});

	it("accepts an older PLR1 receipt as one whole baseline and rejects malformed etags", async () => {
		const readContent = {
			resource: PLAIN_URI,
			name: "main.ts",
			mtime: 10,
			ctime: 9,
			size: 4,
			etag: VERSION_A,
			readonly: false,
			locked: false,
			encoding: "utf8",
			value: { from: "PLR1" },
			plainReadReceipt: true,
		};
		const context = {
			resource: PLAIN_URI,
			preferredEncoding: undefined,
			lastResolvedFileStat: fullFileStat(PLAIN_URI, {
				mtime: 999,
				etag: VERSION_B,
			}),
			versionId: 1,
			trace() {},
			isResolved() {
				return true;
			},
			isDisposed() {
				return false;
			},
			isReadonly() {
				return Boolean(this.lastResolvedFileStat?.readonly);
			},
			setOrphaned() {},
			setDirty() {},
			_onDidChangeReadonly: { fire() {} },
			_onDidResolve: { fire() {} },
			updateLastResolvedFileStat: prototype.updateLastResolvedFileStat,
		};
		if (kind === "text") {
			Object.assign(context, {
				textFileService: {
					async readStream() {
						return readContent;
					},
				},
				contentEncoding: "utf8",
				textEditorModel: {},
				doUpdateTextModel(value) {
					this.appliedValue = value;
				},
				resolveFromContent: prototype.resolveFromContent,
			});
		} else {
			Object.assign(context, {
				fileService: {
					async readFileStream() {
						return readContent;
					},
				},
				_model: {},
				async doUpdateModel(value) {
					this.appliedValue = value;
				},
				resolveFromContent: prototype.resolveFromContent,
			});
		}

		await prototype.resolveFromFile.call(context, {});
		expect(context.lastResolvedFileStat).toMatchObject({
			mtime: 10,
			etag: VERSION_A,
		});
		expect(context.appliedValue).toBe(readContent.value);

		readContent.etag = "malformed";
		await expect(prototype.resolveFromFile.call(context, {})).rejects.toThrow(
			"PLAIN_WORKSPACE_INVALID_READ_RECEIPT",
		);
	});
});
