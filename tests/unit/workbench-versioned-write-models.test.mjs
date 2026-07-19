import { describe, expect, it } from "vitest";

import { Event } from "@codingame/monaco-vscode-api/vscode/vs/base/common/event";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import {
	createPlainWorkspaceWriteOutcomeError,
	FileOperationError,
	FileOperationResult,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files";
import { SaveReason } from "@codingame/monaco-vscode-api/vscode/vs/workbench/common/editor";
import { TextFileSaveErrorHandler } from "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/files/browser/editors/textFileSaveErrorHandler";
import { TextFileEditorModel } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/textfile/common/textFileEditorModel";
import { StoredFileWorkingCopy } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/workingCopy/common/storedFileWorkingCopy";

const PLAIN_URI = URI.parse(
	"plain-workspace://00112233-4455-4677-8899-aabbccddeeff/src/main.ts",
);
const OTHER_URI = URI.parse("plain-test:/src/main.ts");
const VERSION_A = `wv1:${"a".repeat(64)}`;
const VERSION_B = `wv1:${"b".repeat(64)}`;
const VERSION_C = `wv1:${"c".repeat(64)}`;
const UNKNOWN_OUTCOME = Object.freeze({
	status: "outcomeUnknown",
	observation: "responseUnavailable",
	rename: "unobserved",
	directorySync: "unobserved",
	target: "ambiguous",
});

function fileStat(version, mtime, { writeReceipt = false } = {}) {
	return Object.freeze({
		resource: PLAIN_URI,
		name: "main.ts",
		mtime,
		ctime: mtime,
		size: 4,
		etag: version,
		readonly: false,
		locked: false,
		executable: false,
		isFile: true,
		isDirectory: false,
		isSymbolicLink: false,
		children: undefined,
		...(writeReceipt ? { plainWriteReceipt: true } : {}),
	});
}

function readContent(version = VERSION_C, mtime = 25) {
	return Object.freeze({
		resource: PLAIN_URI,
		name: "main.ts",
		mtime,
		ctime: mtime,
		size: 4,
		etag: version,
		readonly: false,
		locked: false,
		encoding: "utf8",
		value: Object.freeze({ source: "PLR1" }),
		plainReadReceipt: true,
	});
}

function baselineContext(prototype) {
	return {
		resource: PLAIN_URI,
		lastResolvedFileStat: fileStat(VERSION_A, 300),
		versionId: 1,
		dirty: true,
		inConflictMode: false,
		inErrorMode: false,
		trace() {},
		isReadonly() {
			return false;
		},
		setDirty(value) {
			this.dirty = value;
		},
		setOrphaned() {},
		updateLastResolvedFileStat: prototype.updateLastResolvedFileStat,
		_onDidChangeReadonly: { fire() {} },
		_onDidSave: { fire() {} },
	};
}

function latchContext(prototype, kind) {
	let currentReadContent = readContent();
	let forceResolveCalls = 0;
	let writeAccesses = 0;
	const doSaveCalls = [];
	const context = {
		...baselineContext(prototype),
		name: "main.ts",
		versionId: 7,
		dirty: true,
		bufferSavedVersionId: 1,
		savedVersionId: 1,
		contentEncoding: "utf8",
		preferredEncoding: undefined,
		textEditorModel: {},
		_model: {},
		isResolved() {
			return true;
		},
		isDisposed() {
			return false;
		},
		hasState() {
			return false;
		},
		async doSave(options) {
			doSaveCalls.push(options);
		},
		doSetDirty: prototype.doSetDirty,
		setDirty(value) {
			this.doSetDirty(value);
		},
		updateSavedVersionId() {},
		logService: { trace() {}, error() {} },
		_onDidSaveError: { fire() {} },
		_onDidRevert: { fire() {} },
		_onDidChangeDirty: { fire() {} },
		_onDidResolve: { fire() {} },
		_onDidChangeEncoding: { fire() {} },
		async forceResolveFromFile() {
			forceResolveCalls += 1;
		},
	};

	if (kind === "text") {
		const textFileService = {
			files: { saveErrorHandler: { onSaveError() {} } },
			async readStream() {
				return currentReadContent;
			},
		};
		Object.defineProperty(textFileService, "write", {
			get() {
				writeAccesses += 1;
				throw new Error("latched doSave must not inspect the writer");
			},
		});
		Object.assign(context, {
			textFileService,
			resolveFromContent: prototype.resolveFromContent,
			doUpdateTextModel() {},
		});
	} else {
		const model = { versionId: 1 };
		Object.defineProperty(model, "save", {
			get() {
				writeAccesses += 1;
				throw new Error("latched doSave must not inspect the model writer");
			},
		});
		const fileService = {
			async readFileStream() {
				return currentReadContent;
			},
		};
		Object.defineProperty(fileService, "writeFile", {
			get() {
				writeAccesses += 1;
				throw new Error("latched doSave must not inspect the file writer");
			},
		});
		Object.assign(context, {
			model,
			fileService,
			resolveFromContent: prototype.resolveFromContent,
			async doUpdateModel() {},
			doHandleSaveError() {},
		});
	}

	return {
		context,
		doSaveCalls,
		forceResolveCalls: () => forceResolveCalls,
		writeAccesses: () => writeAccesses,
		setReadContent(value) {
			currentReadContent = value;
		},
	};
}

const MODEL_CASES = [
	{
		name: "TextFileEditorModel",
		kind: "text",
		prototype: TextFileEditorModel.prototype,
	},
	{
		name: "StoredFileWorkingCopy",
		kind: "stored",
		prototype: StoredFileWorkingCopy.prototype,
	},
];

function plainOutcomeError(options = Object.freeze({})) {
	return createPlainWorkspaceWriteOutcomeError(UNKNOWN_OUTCOME, options);
}

function allNotificationActions(notification) {
	return [
		...(notification.actions?.primary ?? []),
		...(notification.actions?.secondary ?? []),
	];
}

function normalizedLabel(action) {
	return String(action.label).replace(/(?:\.\.\.|…)$/u, "");
}

function expectOnlySafePlainActions(notification, expectedIds) {
	const actions = allNotificationActions(notification);
	expect(actions).toHaveLength(3);
	expect(new Set(actions.map((action) => action.id))).toEqual(
		new Set(expectedIds),
	);
	expect(new Set(actions.map(normalizedLabel))).toEqual(
		new Set(["Reload", "Save As", "Details"]),
	);
	const actionText = actions
		.map((action) => `${action.id} ${action.label}`)
		.join(" ");
	expect(actionText).not.toMatch(
		/(?:retry|overwrite|unlock|elevat|compare|evil)/iu,
	);
}

function notificationRecorder() {
	let notification;
	return {
		service: {
			notify(value) {
				notification = value;
				return {
					onDidClose: Event.None,
					close() {},
				};
			},
		},
		value() {
			return notification;
		},
	};
}

function textSaveErrorActions(error, resource = PLAIN_URI) {
	const recorder = notificationRecorder();
	const editorService = {
		findEditors() {
			return [];
		},
		async save() {
			return { success: true };
		},
	};
	const instantiationService = {
		createInstance(Constructor, ...arguments_) {
			return new Constructor(
				...arguments_,
				editorService,
				recorder.service,
				instantiationService,
				{},
			);
		},
	};
	const model = {
		resource,
		isDisposed() {
			return false;
		},
		async save() {},
		async revert() {},
	};
	const context = {
		activeConflictResolutionResource: undefined,
		storageService: { getBoolean() {} },
		instantiationService,
		notificationService: recorder.service,
		editorService,
		messages: new Map(),
	};
	TextFileSaveErrorHandler.prototype.onSaveError.call(
		context,
		error,
		model,
		Object.freeze({}),
	);
	return recorder.value();
}

function storedSaveErrorActions(error, resource = PLAIN_URI) {
	const recorder = notificationRecorder();
	const context = {
		resource,
		name: "main.ts",
		notificationService: recorder.service,
		elevatedFileService: { isSupported: () => false },
		workingCopyEditorService: { findEditor: () => undefined },
		editorService: { async save() {} },
		onDidSave: Event.None,
		onDidRevert: Event.None,
		_register(value) {
			return value;
		},
		async save() {},
		async revert() {},
	};
	StoredFileWorkingCopy.prototype.doHandleSaveError.call(
		context,
		error,
		Object.freeze({}),
	);
	return recorder.value();
}

describe.each(MODEL_CASES)("patched $name Plain write state", (modelCase) => {
	it("accepts A to B to C write receipts even when mtime rolls back", () => {
		const context = baselineContext(modelCase.prototype);
		modelCase.prototype.handleSaveSuccess.call(
			context,
			fileStat(VERSION_B, 200, { writeReceipt: true }),
			1,
			{ reason: SaveReason.EXPLICIT },
		);
		expect(context.lastResolvedFileStat.etag).toBe(VERSION_B);
		expect(context.lastResolvedFileStat.mtime).toBe(200);

		context.versionId = 2;
		context.dirty = true;
		modelCase.prototype.handleSaveSuccess.call(
			context,
			fileStat(VERSION_C, 100, { writeReceipt: true }),
			2,
			{ reason: SaveReason.EXPLICIT },
		);
		expect(context.lastResolvedFileStat.etag).toBe(VERSION_C);
		expect(context.lastResolvedFileStat.mtime).toBe(100);
		expect(context.dirty).toBe(false);
	});

	it("updates the token but remains dirty when content changes during save", () => {
		const context = baselineContext(modelCase.prototype);
		context.versionId = 2;
		context.dirty = true;
		modelCase.prototype.handleSaveSuccess.call(
			context,
			fileStat(VERSION_B, 200, { writeReceipt: true }),
			1,
			{ reason: SaveReason.EXPLICIT },
		);
		expect(context.lastResolvedFileStat.etag).toBe(VERSION_B);
		expect(context.dirty).toBe(true);
	});

	it("fails closed on missing, false, accessor and malformed write markers", () => {
		let markerReads = 0;
		const accessorStat = {
			...fileStat(VERSION_B, 200),
		};
		Object.defineProperty(accessorStat, "plainWriteReceipt", {
			enumerable: true,
			get() {
				markerReads += 1;
				return true;
			},
		});
		Object.freeze(accessorStat);
		const malformed = [
			fileStat(VERSION_B, 200),
			Object.freeze({
				...fileStat(VERSION_B, 200),
				plainWriteReceipt: false,
			}),
			accessorStat,
			fileStat("malformed", 200, { writeReceipt: true }),
		];
		for (const stat of malformed) {
			const context = baselineContext(modelCase.prototype);
			expect(() =>
				modelCase.prototype.handleSaveSuccess.call(context, stat, 1, {
					reason: SaveReason.EXPLICIT,
				}),
			).toThrow();
			expect(context.lastResolvedFileStat.etag).toBe(VERSION_A);
			expect(context.dirty).toBe(true);
		}
		expect(markerReads).toBe(0);
	});

	for (const ignoreErrorHandler of [false, true]) {
		it(`latches an unknown outcome with ignoreErrorHandler=${ignoreErrorHandler}`, async () => {
			const setup = latchContext(modelCase.prototype, modelCase.kind);
			const { context } = setup;
			const error = plainOutcomeError();
			let thrown;
			try {
				modelCase.prototype.handleSaveError.call(context, error, 7, {
					ignoreErrorHandler,
				});
			} catch (candidate) {
				thrown = candidate;
			}
			if (ignoreErrorHandler) {
				expect(thrown).toBe(error);
			}

			for (const reason of [
				SaveReason.EXPLICIT,
				SaveReason.AUTO,
				SaveReason.FOCUS_CHANGE,
				SaveReason.WINDOW_CHANGE,
			]) {
				await modelCase.prototype.save.call(context, { reason });
			}
			expect(setup.doSaveCalls).toHaveLength(0);

			let sequentializerReads = 0;
			Object.defineProperty(context, "saveSequentializer", {
				configurable: true,
				get() {
					sequentializerReads += 1;
					throw new Error("latched doSave must not inspect the sequentializer");
				},
			});
			await modelCase.prototype.doSave.call(context, {
				reason: SaveReason.EXPLICIT,
			});
			expect(sequentializerReads).toBe(0);
			expect(setup.writeAccesses()).toBe(0);

			context.dirty = true;
			await modelCase.prototype.revert.call(context, { soft: true });
			expect(setup.forceResolveCalls()).toBe(0);
			await modelCase.prototype.save.call(context, {
				reason: SaveReason.EXPLICIT,
				force: true,
			});
			expect(setup.doSaveCalls).toHaveLength(0);

			setup.setReadContent(readContent(VERSION_C, 25));
			await modelCase.prototype.resolveFromFile.call(context, {
				forceReadFromFile: true,
			});
			context.dirty = true;
			await modelCase.prototype.save.call(context, {
				reason: SaveReason.EXPLICIT,
			});
			expect(setup.doSaveCalls).toHaveLength(1);
		});
	}
});

describe("patched Plain save error actions", () => {
	it("offers only Reload, Save As and Details for both Plain model handlers", () => {
		for (const [capture, expectedIds] of [
			[
				textSaveErrorActions,
				[
					"workbench.files.action.plainReload",
					"workbench.files.action.saveModelAs",
					"workbench.files.action.plainWriteDetails",
				],
			],
			[
				storedSaveErrorActions,
				[
					"fileWorkingCopy.plainReload",
					"fileWorkingCopy.plainSaveAs",
					"fileWorkingCopy.plainWriteDetails",
				],
			],
		]) {
			const error = plainOutcomeError();
			Object.defineProperty(error, "actions", {
				value: Object.freeze([
					Object.freeze({ id: "evil.retry", label: "Retry", run() {} }),
				]),
			});
			expectOnlySafePlainActions(capture(error), expectedIds);
		}
	});

	it("keeps an upstream Retry or Overwrite action for non-Plain errors", () => {
		for (const capture of [textSaveErrorActions, storedSaveErrorActions]) {
			const error = new FileOperationError(
				"ordinary failure",
				FileOperationResult.FILE_OTHER_ERROR,
			);
			const actions = allNotificationActions(capture(error, OTHER_URI));
			expect(
				actions.some((action) => /(?:Retry|Overwrite)/u.test(action.label)),
			).toBe(true);
		}
	});
});
