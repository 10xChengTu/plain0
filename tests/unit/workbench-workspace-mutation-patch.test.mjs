import { describe, expect, it } from "vitest";

import { Event } from "@codingame/monaco-vscode-api/vscode/vs/base/common/event";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import {
	FileOperation,
	FileOperationError,
	FileOperationResult,
	FilePermission,
	FileSystemProviderCapabilities,
	FileSystemProviderError,
	FileSystemProviderErrorCode,
	FileType,
	toFileSystemProviderErrorCode,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files";
import { FileService } from "@codingame/monaco-vscode-files-service-override/vscode/vs/platform/files/common/fileService";

const ROOT_A = "00112233-4455-4677-8899-aabbccddeeff";
const ROOT_B = "10112233-4455-4677-8899-aabbccddeeff";
const PLAIN_SOURCE = URI.parse(`plain-workspace://${ROOT_A}/source.txt`);
const PLAIN_TARGET = URI.parse(`plain-workspace://${ROOT_A}/target.txt`);
const PLAIN_MISSING_PARENT_TARGET = URI.parse(
	`plain-workspace://${ROOT_A}/missing/target.txt`,
);
const PLAIN_CASE_SOURCE = URI.parse(`plain-workspace://${ROOT_A}/Foo.ts`);
const PLAIN_CASE_TARGET = URI.parse(`plain-workspace://${ROOT_A}/foo.ts`);
const PLAIN_CROSS_ROOT_TARGET = URI.parse(
	`plain-workspace://${ROOT_B}/target.txt`,
);
const OTHER_SOURCE = URI.parse("plain-test:/source.txt");
const OTHER_TARGET = URI.parse("plain-test:/target.txt");
const OTHER_MOVE_SOURCE = URI.parse("plain-test:/move-source.txt");
const OTHER_MOVE_TARGET = URI.parse("plain-test:/move-target.txt");
const OTHER_CLONE_TARGET = URI.parse("plain-test:/clone-target.txt");

function fileStat(resource) {
	return Object.freeze({
		type: FileType.File,
		ctime: 1,
		mtime: 2,
		size: 1,
		...(resource.scheme === "plain-workspace"
			? {
					permissions: FilePermission.Readonly,
					plainVersion: null,
				}
			: {}),
	});
}

function directoryStat() {
	return Object.freeze({
		type: FileType.Directory,
		ctime: 1,
		mtime: 2,
		size: 0,
	});
}

function providerHarness({
	capabilities = FileSystemProviderCapabilities.FileReadWrite |
		FileSystemProviderCapabilities.FileFolderCopy,
	sources = [PLAIN_SOURCE],
	targets = [],
	omitCopy = false,
	omitRename = false,
	copyError,
	renameError,
} = {}) {
	const entries = new Set(
		[...sources, ...targets].map((resource) => resource.toString()),
	);
	const state = {
		statCalls: 0,
		deleteCalls: 0,
		mkdirCalls: 0,
		readCalls: 0,
		writeCalls: 0,
		copyCalls: 0,
		renameCalls: 0,
		copyOptions: [],
		renameOptions: [],
		copyTargets: [],
		renameTargets: [],
		copyResourcesFrozen: [],
		renameResourcesFrozen: [],
	};
	const provider = {
		capabilities,
		onDidChangeCapabilities: Event.None,
		onDidChangeFile: Event.None,
		async stat(resource) {
			state.statCalls += 1;
			if (resource.path === "/") {
				return directoryStat();
			}
			if (entries.has(resource.toString())) {
				return fileStat(resource);
			}
			throw FileSystemProviderError.create(
				"missing",
				FileSystemProviderErrorCode.FileNotFound,
			);
		},
		async mkdir(resource) {
			state.mkdirCalls += 1;
			entries.add(resource.toString());
		},
		async delete(resource) {
			state.deleteCalls += 1;
			entries.delete(resource.toString());
		},
		async readFile() {
			state.readCalls += 1;
			return Uint8Array.of(1);
		},
		async writeFile(resource) {
			state.writeCalls += 1;
			entries.add(resource.toString());
		},
	};
	if (!omitCopy) {
		provider.copy = async (source, target, options) => {
			state.copyCalls += 1;
			state.copyOptions.push(options);
			state.copyTargets.push(target.toString());
			state.copyResourcesFrozen.push(
				Object.isFrozen(source) && Object.isFrozen(target),
			);
			if (copyError !== undefined) {
				throw copyError;
			}
			if (!entries.has(source.toString())) {
				throw FileSystemProviderError.create(
					"missing source",
					FileSystemProviderErrorCode.FileNotFound,
				);
			}
			if (entries.has(target.toString()) && options.overwrite !== true) {
				throw FileSystemProviderError.create(
					"target already exists",
					FileSystemProviderErrorCode.FileExists,
				);
			}
			entries.add(target.toString());
		};
	}
	if (!omitRename) {
		provider.rename = async (source, target, options) => {
			state.renameCalls += 1;
			state.renameOptions.push(options);
			state.renameTargets.push(target.toString());
			state.renameResourcesFrozen.push(
				Object.isFrozen(source) && Object.isFrozen(target),
			);
			if (renameError !== undefined) {
				throw renameError;
			}
			if (!entries.has(source.toString())) {
				throw FileSystemProviderError.create(
					"missing source",
					FileSystemProviderErrorCode.FileNotFound,
				);
			}
			if (entries.has(target.toString()) && options.overwrite !== true) {
				throw FileSystemProviderError.create(
					"target already exists",
					FileSystemProviderErrorCode.FileExists,
				);
			}
			entries.delete(source.toString());
			entries.add(target.toString());
		};
	}
	return {
		provider,
		state,
		hasEntry(resource) {
			return entries.has(resource.toString());
		},
	};
}

function serviceHarness(registrations = []) {
	const service = new FileService({ trace() {} });
	const providerRegistrations = registrations.map(([scheme, provider]) =>
		service.registerProvider(scheme, provider),
	);
	const state = {
		activationCalls: 0,
		operations: [],
	};
	const activationSubscription = service.onWillActivateFileSystemProvider(
		() => {
			state.activationCalls += 1;
		},
	);
	const operationSubscription = service.onDidRunOperation((event) => {
		state.operations.push(event);
	});
	return {
		service,
		state,
		dispose() {
			operationSubscription.dispose();
			activationSubscription.dispose();
			for (const registration of providerRegistrations) {
				registration.dispose();
			}
			service.dispose();
		},
	};
}

async function rejected(promise) {
	try {
		await promise;
		expect.fail("operation must reject");
	} catch (error) {
		return error;
	}
}

function expectNoProviderSideEffects(state) {
	expect(state).toMatchObject({
		statCalls: 0,
		deleteCalls: 0,
		mkdirCalls: 0,
		readCalls: 0,
		writeCalls: 0,
		copyCalls: 0,
		renameCalls: 0,
	});
}

async function invokeGuarded(service, method, source, target, overwrite) {
	const operation = service[method](source, target, overwrite);
	return method.startsWith("can") ? operation : rejected(operation);
}

describe("patched FileService Plain workspace mutation routing", () => {
	it("rejects every URI or overwrite violation before provider activation", async () => {
		const cases = [
			{
				label: "Plain source crosses to another scheme",
				source: PLAIN_SOURCE,
				target: OTHER_TARGET,
			},
			{
				label: "another scheme crosses to a Plain target",
				source: OTHER_SOURCE,
				target: PLAIN_TARGET,
			},
			{
				label: "Plain source has a query",
				source: PLAIN_SOURCE.with({ query: "unsafe" }),
				target: PLAIN_TARGET,
			},
			{
				label: "Plain target has a fragment",
				source: PLAIN_SOURCE,
				target: PLAIN_TARGET.with({ fragment: "unsafe" }),
			},
			{
				label: "source and target are identical",
				source: PLAIN_SOURCE,
				target: PLAIN_SOURCE,
				expectedResult: FileOperationResult.FILE_MOVE_CONFLICT,
			},
			...[
				["true overwrite", true],
				["null overwrite", null],
				["numeric overwrite", 0],
				["string overwrite", ""],
				["boxed overwrite", Object(false)],
			].map(([label, overwrite]) => ({
				label,
				source: PLAIN_SOURCE,
				target: PLAIN_TARGET,
				overwrite,
			})),
		];

		for (const method of ["canCopy", "canMove", "copy", "move"]) {
			for (const testCase of cases) {
				const harness = serviceHarness();
				try {
					const error = await invokeGuarded(
						harness.service,
						method,
						testCase.source,
						testCase.target,
						testCase.overwrite,
					);
					expect(error, `${method}: ${testCase.label}`).toBeInstanceOf(
						FileOperationError,
					);
					expect(
						error.fileOperationResult,
						`${method}: ${testCase.label}`,
					).toBe(
						testCase.expectedResult ??
							FileOperationResult.FILE_PERMISSION_DENIED,
					);
					expect(harness.state.activationCalls).toBe(0);
					expect(harness.state.operations).toHaveLength(0);
				} finally {
					harness.dispose();
				}
			}
		}
	});

	it("rejects Plain clone paths before provider activation", async () => {
		for (const [source, target] of [
			[PLAIN_SOURCE, PLAIN_TARGET],
			[PLAIN_SOURCE, OTHER_TARGET],
			[OTHER_SOURCE, PLAIN_TARGET],
		]) {
			const harness = serviceHarness();
			try {
				const error = await rejected(harness.service.cloneFile(source, target));
				expect(error).toBeInstanceOf(FileOperationError);
				expect(error.fileOperationResult).toBe(
					FileOperationResult.FILE_PERMISSION_DENIED,
				);
				expect(harness.state.activationCalls).toBe(0);
				expect(harness.state.operations).toHaveLength(0);
			} finally {
				harness.dispose();
			}
		}
	});

	it("rejects cross-scheme operations even when both schemes share one provider", async () => {
		const { provider, state } = providerHarness({
			sources: [PLAIN_SOURCE, OTHER_SOURCE],
		});
		for (const method of ["canCopy", "canMove", "copy", "move"]) {
			const harness = serviceHarness([
				["plain-workspace", provider],
				["plain-test", provider],
			]);
			try {
				const error = await invokeGuarded(
					harness.service,
					method,
					PLAIN_SOURCE,
					OTHER_TARGET,
					false,
				);
				expect(error).toBeInstanceOf(FileOperationError);
				expect(error.fileOperationResult).toBe(
					FileOperationResult.FILE_PERMISSION_DENIED,
				);
				expect(harness.state.activationCalls).toBe(0);
				expect(harness.state.operations).toHaveLength(0);
				expectNoProviderSideEffects(state);
			} finally {
				harness.dispose();
			}
		}
	});

	it("rejects overwrite before observing either an existing or missing target", async () => {
		for (const method of ["copy", "move"]) {
			for (const targetExists of [false, true]) {
				const { provider, state } = providerHarness({
					targets: targetExists ? [PLAIN_TARGET] : [],
				});
				const harness = serviceHarness([["plain-workspace", provider]]);
				try {
					const error = await rejected(
						harness.service[method](PLAIN_SOURCE, PLAIN_TARGET, true),
					);
					expect(error).toBeInstanceOf(FileOperationError);
					expect(error.fileOperationResult).toBe(
						FileOperationResult.FILE_PERMISSION_DENIED,
					);
					expect(harness.state.activationCalls).toBe(0);
					expect(harness.state.operations).toHaveLength(0);
					expectNoProviderSideEffects(state);
				} finally {
					harness.dispose();
				}
			}
		}
	});

	it("requires one provider and callable native copy or rename before stat", async () => {
		const cases = [
			{
				method: "copy",
				providerOptions: {
					capabilities: FileSystemProviderCapabilities.FileReadWrite,
				},
			},
			{
				method: "copy",
				providerOptions: { omitCopy: true },
			},
			{
				method: "move",
				providerOptions: { omitRename: true },
			},
		];
		for (const testCase of cases) {
			for (const can of [true, false]) {
				const { provider, state } = providerHarness(testCase.providerOptions);
				const harness = serviceHarness([["plain-workspace", provider]]);
				try {
					const method = can
						? `can${
								testCase.method[0].toUpperCase() + testCase.method.slice(1)
							}`
						: testCase.method;
					const error = await invokeGuarded(
						harness.service,
						method,
						PLAIN_SOURCE,
						PLAIN_TARGET,
						false,
					);
					expect(error).toBeInstanceOf(FileOperationError);
					expect(error.fileOperationResult).toBe(
						FileOperationResult.FILE_PERMISSION_DENIED,
					);
					expect(harness.state.operations).toHaveLength(0);
					expectNoProviderSideEffects(state);
				} finally {
					harness.dispose();
				}
			}
		}

		const source = providerHarness();
		const target = providerHarness();
		const harness = serviceHarness([["plain-workspace", target.provider]]);
		try {
			const error = await rejected(
				harness.service.doMoveCopy(
					source.provider,
					PLAIN_SOURCE,
					target.provider,
					PLAIN_TARGET,
					"copy",
					false,
				),
			);
			expect(error).toBeInstanceOf(FileOperationError);
			expectNoProviderSideEffects(source.state);
			expectNoProviderSideEffects(target.state);
		} finally {
			harness.dispose();
		}
	});

	it("repeats every Plain policy guard at the direct doMoveCopy seam", async () => {
		const cases = [
			{
				label: "same URI",
				source: URI.parse(PLAIN_SOURCE.toString()),
				target: URI.parse(PLAIN_SOURCE.toString()),
				mode: "copy",
				overwrite: false,
				expectedResult: FileOperationResult.FILE_MOVE_CONFLICT,
			},
			{
				label: "query",
				source: PLAIN_SOURCE.with({ query: "unsafe" }),
				target: PLAIN_TARGET,
				mode: "copy",
				overwrite: false,
			},
			{
				label: "overwrite",
				source: PLAIN_SOURCE,
				target: PLAIN_TARGET,
				mode: "move",
				overwrite: true,
			},
			{
				label: "cross scheme",
				source: PLAIN_SOURCE,
				target: OTHER_TARGET,
				mode: "copy",
				overwrite: false,
			},
			{
				label: "invalid mode",
				source: PLAIN_SOURCE,
				target: PLAIN_TARGET,
				mode: "link",
				overwrite: false,
			},
		];

		for (const testCase of cases) {
			const { provider, state } = providerHarness();
			const harness = serviceHarness([["plain-workspace", provider]]);
			try {
				const error = await rejected(
					harness.service.doMoveCopy(
						provider,
						testCase.source,
						provider,
						testCase.target,
						testCase.mode,
						testCase.overwrite,
					),
				);
				expect(error, testCase.label).toBeInstanceOf(FileOperationError);
				expect(error.fileOperationResult, testCase.label).toBe(
					testCase.expectedResult ?? FileOperationResult.FILE_PERMISSION_DENIED,
				);
				expectNoProviderSideEffects(state);
				expect(harness.state.operations).toHaveLength(0);
			} finally {
				harness.dispose();
			}
		}
	});

	it("dispatches legal Plain copy and move only to one native provider method", async () => {
		for (const [method, expectedOperation] of [
			["copy", FileOperation.COPY],
			["move", FileOperation.MOVE],
		]) {
			for (const overwrite of [undefined, false]) {
				const { provider, state } = providerHarness();
				const harness = serviceHarness([["plain-workspace", provider]]);
				try {
					const canMethod = `can${method[0].toUpperCase() + method.slice(1)}`;
					expect(
						await harness.service[canMethod](
							PLAIN_SOURCE,
							PLAIN_CROSS_ROOT_TARGET,
							overwrite,
						),
					).toBe(true);
					await harness.service[method](
						PLAIN_SOURCE,
						PLAIN_CROSS_ROOT_TARGET,
						overwrite,
					);
					expect(state.copyCalls).toBe(method === "copy" ? 1 : 0);
					expect(state.renameCalls).toBe(method === "move" ? 1 : 0);
					expect(
						method === "copy" ? state.copyOptions : state.renameOptions,
					).toEqual([{ overwrite: false }]);
					expect(state).toMatchObject({
						deleteCalls: 0,
						mkdirCalls: 0,
						readCalls: 0,
						writeCalls: 0,
					});
					expect(harness.state.operations).toHaveLength(1);
					expect(harness.state.operations[0].operation).toBe(expectedOperation);
				} finally {
					harness.dispose();
				}
			}
		}
	});

	it("leaves target conflicts to one sanitized native no-clobber mutation", async () => {
		for (const method of ["copy", "move"]) {
			const { provider, state, hasEntry } = providerHarness({
				targets: [PLAIN_TARGET],
			});
			const harness = serviceHarness([["plain-workspace", provider]]);
			try {
				const canMethod = `can${method[0].toUpperCase() + method.slice(1)}`;
				expect(
					await harness.service[canMethod](PLAIN_SOURCE, PLAIN_TARGET, false),
				).toBe(true);
				const error = await rejected(
					harness.service[method](PLAIN_SOURCE, PLAIN_TARGET, false),
				);
				expect(toFileSystemProviderErrorCode(error)).toBe(
					FileSystemProviderErrorCode.FileExists,
				);
				expect(error.message).toBe("target already exists");
				expect(error.message).not.toContain(ROOT_A);
				expect(error.message).not.toContain("source.txt");
				expect(error.message).not.toContain("target.txt");
				expect(error.message).not.toContain("plain-workspace");
				expect(hasEntry(PLAIN_SOURCE)).toBe(true);
				expect(hasEntry(PLAIN_TARGET)).toBe(true);
				expect(state.statCalls).toBe(0);
				expect(state).toMatchObject({
					deleteCalls: 0,
					mkdirCalls: 0,
					readCalls: 0,
					writeCalls: 0,
					copyCalls: method === "copy" ? 1 : 0,
					renameCalls: method === "move" ? 1 : 0,
				});
				expect(harness.state.operations).toHaveLength(0);
			} finally {
				harness.dispose();
			}
		}
	});

	it("does not apply provider-wide ignore-case validation before native copy", async () => {
		const { provider, state, hasEntry } = providerHarness({
			sources: [PLAIN_CASE_SOURCE],
		});
		const harness = serviceHarness([["plain-workspace", provider]]);
		try {
			expect(
				await harness.service.canCopy(
					PLAIN_CASE_SOURCE,
					PLAIN_CASE_TARGET,
					false,
				),
			).toBe(true);
			await harness.service.copy(PLAIN_CASE_SOURCE, PLAIN_CASE_TARGET, false);
			expect(state.copyCalls).toBe(1);
			expect(state.copyOptions).toEqual([{ overwrite: false }]);
			expect(state).toMatchObject({
				deleteCalls: 0,
				mkdirCalls: 0,
				readCalls: 0,
				writeCalls: 0,
				renameCalls: 0,
			});
			expect(hasEntry(PLAIN_CASE_SOURCE)).toBe(true);
			expect(hasEntry(PLAIN_CASE_TARGET)).toBe(true);
			expect(harness.state.operations).toHaveLength(1);
			expect(harness.state.operations[0].operation).toBe(FileOperation.COPY);
		} finally {
			harness.dispose();
		}
	});

	it("snapshots Plain URIs before any asynchronous provider lookup", async () => {
		for (const [method, expectedOperation] of [
			["copy", FileOperation.COPY],
			["move", FileOperation.MOVE],
		]) {
			const source = URI.parse(
				`plain-workspace://${ROOT_A}/${method}-mutable-source.txt`,
			);
			const target = URI.parse(
				`plain-workspace://${ROOT_B}/${method}-original-target.txt`,
			);
			const originalSource = source.toString();
			const originalTarget = target.toString();
			const { provider, state, hasEntry } = providerHarness({
				sources: [source],
			});
			const harness = serviceHarness([["plain-workspace", provider]]);
			try {
				const operation = harness.service[method](source, target, false);
				source.scheme = "plain-test";
				source.path = "/redirected-source.txt";
				target.scheme = "plain-test";
				target.path = "/redirected-target.txt";
				await operation;

				const targetCalls =
					method === "copy" ? state.copyTargets : state.renameTargets;
				const frozenCalls =
					method === "copy"
						? state.copyResourcesFrozen
						: state.renameResourcesFrozen;
				expect(targetCalls).toEqual([originalTarget]);
				expect(frozenCalls).toEqual([true]);
				expect(hasEntry(URI.parse(originalTarget))).toBe(true);
				expect(hasEntry(URI.parse(originalSource))).toBe(method === "copy");
				expect(state).toMatchObject({
					deleteCalls: 0,
					mkdirCalls: 0,
					readCalls: 0,
					writeCalls: 0,
					copyCalls: method === "copy" ? 1 : 0,
					renameCalls: method === "move" ? 1 : 0,
				});
				expect(harness.state.operations).toHaveLength(1);
				expect(harness.state.operations[0].operation).toBe(expectedOperation);
			} finally {
				harness.dispose();
			}
		}
	});

	it("reads URI accessor fields once before classifying or dispatching", async () => {
		const source = URI.parse(`plain-workspace://${ROOT_A}/accessor-source.txt`);
		const approvedTarget = URI.parse(
			`plain-workspace://${ROOT_A}/approved-target.txt`,
		);
		const redirectedTarget = URI.parse(
			`plain-workspace://${ROOT_A}/redirected-target.txt`,
		);
		let pathReads = 0;
		const target = new Proxy(approvedTarget, {
			get(resource, property, receiver) {
				if (property === "path") {
					pathReads += 1;
					return pathReads === 1 ? approvedTarget.path : redirectedTarget.path;
				}
				return Reflect.get(resource, property, receiver);
			},
		});
		const { provider, state, hasEntry } = providerHarness({
			sources: [source],
		});
		const harness = serviceHarness([["plain-workspace", provider]]);
		try {
			await harness.service.copy(source, target, false);
			expect(pathReads).toBe(1);
			expect(state.copyCalls).toBe(1);
			expect(state.copyTargets).toEqual([approvedTarget.toString()]);
			expect(state.copyResourcesFrozen).toEqual([true]);
			expect(hasEntry(approvedTarget)).toBe(true);
			expect(hasEntry(redirectedTarget)).toBe(false);
			expect(state).toMatchObject({
				deleteCalls: 0,
				mkdirCalls: 0,
				readCalls: 0,
				writeCalls: 0,
				renameCalls: 0,
			});
			expect(harness.state.operations).toHaveLength(1);
			expect(harness.state.operations[0].operation).toBe(FileOperation.COPY);
		} finally {
			harness.dispose();
		}
	});

	it("lets a native missing-parent error escape without mkdir, delete or fallback", async () => {
		const missingParent = FileSystemProviderError.create(
			"missing parent",
			FileSystemProviderErrorCode.FileNotFound,
		);
		for (const [method, providerOptions] of [
			["copy", { copyError: missingParent }],
			["move", { renameError: missingParent }],
		]) {
			const { provider, state } = providerHarness(providerOptions);
			const harness = serviceHarness([["plain-workspace", provider]]);
			try {
				await rejected(
					harness.service[method](
						PLAIN_SOURCE,
						PLAIN_MISSING_PARENT_TARGET,
						false,
					),
				);
				expect(state.copyCalls).toBe(method === "copy" ? 1 : 0);
				expect(state.renameCalls).toBe(method === "move" ? 1 : 0);
				expect(state).toMatchObject({
					deleteCalls: 0,
					mkdirCalls: 0,
					readCalls: 0,
					writeCalls: 0,
				});
				expect(harness.state.operations).toHaveLength(0);
			} finally {
				harness.dispose();
			}
		}
	});

	it("blocks direct generic file and folder copy helpers for either Plain endpoint", async () => {
		for (const [source, target, folder] of [
			[PLAIN_SOURCE, OTHER_TARGET, false],
			[OTHER_SOURCE, PLAIN_TARGET, false],
			[PLAIN_SOURCE, OTHER_TARGET, true],
			[OTHER_SOURCE, PLAIN_TARGET, true],
		]) {
			const { provider, state } = providerHarness({
				sources: [PLAIN_SOURCE, OTHER_SOURCE],
			});
			const harness = serviceHarness();
			try {
				const operation = folder
					? harness.service.doCopyFolder(
							provider,
							{ resource: source, children: [] },
							provider,
							target,
						)
					: harness.service.doCopyFile(provider, source, provider, target);
				const error = await rejected(operation);
				expect(error).toBeInstanceOf(FileOperationError);
				expect(error.fileOperationResult).toBe(
					FileOperationResult.FILE_PERMISSION_DENIED,
				);
				expectNoProviderSideEffects(state);
			} finally {
				harness.dispose();
			}
		}
	});

	it("preserves native copy, move and clone behavior for non-Plain schemes", async () => {
		const { provider, state } = providerHarness({
			sources: [OTHER_SOURCE, OTHER_MOVE_SOURCE],
		});
		const harness = serviceHarness([["plain-test", provider]]);
		try {
			await harness.service.copy(OTHER_SOURCE, OTHER_TARGET, false);
			await harness.service.move(OTHER_MOVE_SOURCE, OTHER_MOVE_TARGET, false);
			await harness.service.cloneFile(OTHER_SOURCE, OTHER_CLONE_TARGET);

			expect(state.copyCalls).toBe(2);
			expect(state.copyOptions).toEqual([
				{ overwrite: false },
				{ overwrite: true },
			]);
			expect(state.renameCalls).toBe(1);
			expect(state.renameOptions).toEqual([{ overwrite: false }]);
			expect(state).toMatchObject({
				deleteCalls: 0,
				mkdirCalls: 0,
				readCalls: 0,
				writeCalls: 0,
			});
			expect(harness.state.operations.map((event) => event.operation)).toEqual([
				FileOperation.COPY,
				FileOperation.MOVE,
			]);
		} finally {
			harness.dispose();
		}
	});

	it("preserves non-Plain same-URI, generic-copy and cross-provider move fallbacks", async () => {
		const same = providerHarness({ sources: [OTHER_SOURCE] });
		const sameHarness = serviceHarness([["plain-test", same.provider]]);
		try {
			expect(
				await sameHarness.service.canCopy(OTHER_SOURCE, OTHER_SOURCE, false),
			).toBe(true);
			await sameHarness.service.copy(OTHER_SOURCE, OTHER_SOURCE, false);
			expect(same.state).toMatchObject({
				copyCalls: 0,
				renameCalls: 0,
				deleteCalls: 0,
				mkdirCalls: 0,
				readCalls: 0,
				writeCalls: 0,
			});
			expect(sameHarness.state.operations).toHaveLength(1);
		} finally {
			sameHarness.dispose();
		}

		const generic = providerHarness({
			capabilities: FileSystemProviderCapabilities.FileReadWrite,
			sources: [OTHER_SOURCE],
		});
		const genericHarness = serviceHarness([["plain-test", generic.provider]]);
		try {
			await genericHarness.service.copy(OTHER_SOURCE, OTHER_TARGET, false);
			expect(generic.state).toMatchObject({
				copyCalls: 0,
				renameCalls: 0,
				deleteCalls: 0,
				mkdirCalls: 0,
				readCalls: 1,
				writeCalls: 1,
			});
			expect(genericHarness.state.operations).toHaveLength(1);
		} finally {
			genericHarness.dispose();
		}

		const crossSourceResource = URI.parse("plain-source:/source.txt");
		const crossTargetResource = URI.parse("plain-target:/target.txt");
		const crossSource = providerHarness({
			capabilities: FileSystemProviderCapabilities.FileReadWrite,
			sources: [crossSourceResource],
		});
		const crossTarget = providerHarness({
			capabilities: FileSystemProviderCapabilities.FileReadWrite,
			sources: [],
		});
		const crossHarness = serviceHarness([
			["plain-source", crossSource.provider],
			["plain-target", crossTarget.provider],
		]);
		try {
			await crossHarness.service.move(
				crossSourceResource,
				crossTargetResource,
				false,
			);
			expect(crossSource.state).toMatchObject({
				copyCalls: 0,
				renameCalls: 0,
				deleteCalls: 1,
				mkdirCalls: 0,
				readCalls: 1,
				writeCalls: 0,
			});
			expect(crossTarget.state).toMatchObject({
				copyCalls: 0,
				renameCalls: 0,
				deleteCalls: 0,
				mkdirCalls: 0,
				readCalls: 0,
				writeCalls: 1,
			});
			expect(
				crossHarness.state.operations.map((event) => event.operation),
			).toEqual([FileOperation.DELETE, FileOperation.COPY]);
		} finally {
			crossHarness.dispose();
		}
	});
});
