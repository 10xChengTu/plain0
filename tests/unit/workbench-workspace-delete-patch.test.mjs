import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { FileService } from "@codingame/monaco-vscode-files-service-override/vscode/vs/platform/files/common/fileService";
import { CancellationToken } from "@codingame/monaco-vscode-api/vscode/vs/base/common/cancellation";
import { Event } from "@codingame/monaco-vscode-api/vscode/vs/base/common/event";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { ResourceFileEdit } from "@codingame/monaco-vscode-api/vscode/vs/editor/browser/services/bulkEditService";
import {
	FileOperation,
	FileSystemProviderCapabilities,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files";
import {
	authorizePlainWorkspaceDeleteResourceEdit,
	beginPlainWorkspaceDeleteProviderDispatch,
	classifyPlainWorkspaceDeleteResource,
	completePlainWorkspaceDeleteProviderFailure,
	completePlainWorkspaceDeleteProviderResult,
	getPlainWorkspaceDeleteState,
	movePlainWorkspaceDeleteFileServiceAuthorization,
	movePlainWorkspaceDeleteResourceEditAuthorization,
	movePlainWorkspaceDeleteWorkingCopyAuthorization,
	takePlainWorkspaceDeleteProviderAuthorization,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/plainWorkspaceDelete";

const rootId = "00000000-0000-4000-8000-000000000101";
const confirmationId = "00000000-0000-4000-8000-000000000303";
const entryId = "00000000-0000-4000-8000-000000000404";

function transitivePackagePath(packageName, modulePath) {
	const pnpmDirectory = fileURLToPath(
		new URL("../../node_modules/.pnpm/", import.meta.url),
	);
	return path.join(pnpmDirectory, "node_modules", packageName, modulePath);
}

async function importTransitivePackage(packageName, modulePath) {
	return import(
		pathToFileURL(transitivePackagePath(packageName, modulePath)).href
	);
}

const { BulkFileEdits } = await importTransitivePackage(
	"@codingame/monaco-vscode-bulk-edit-service-override",
	"vscode/src/vs/workbench/contrib/bulkEdit/browser/bulkFileEdits.js",
);
const { WorkingCopyFileService } = await importTransitivePackage(
	"@codingame/monaco-vscode-base-service-override",
	"vscode/src/vs/workbench/services/workingCopy/common/workingCopyFileService.js",
);

function resource(relativePath = "delete.txt") {
	return URI.parse(`plain-workspace://${rootId}/${relativePath}`);
}

function authorizedResourceEdit(target = resource(), entrySuffix = 404) {
	const options = {
		recursive: true,
		folder: false,
		ignoreIfNotExists: false,
		skipTrashBin: true,
	};
	const authorization = authorizePlainWorkspaceDeleteResourceEdit(
		options,
		target,
		{
			confirmationId,
			entryId: `00000000-0000-4000-8000-${entrySuffix
				.toString()
				.padStart(12, "0")}`,
			rootId,
			relativePath: target.path.slice(1),
			recursive: true,
			kind: "file",
			permanent: true,
		},
	);
	return {
		authorization,
		edit: new ResourceFileEdit(target, undefined, options),
	};
}

function moveToWorkingCopy(edit) {
	const operation = {
		resource: edit.oldResource,
		recursive: true,
		useTrash: false,
	};
	expect(
		movePlainWorkspaceDeleteResourceEditAuthorization(
			edit.options,
			edit.oldResource,
			operation,
		),
	).toBe(true);
	return operation;
}

function moveToFileService(operation) {
	const options = { recursive: true, useTrash: false, atomic: false };
	expect(
		movePlainWorkspaceDeleteWorkingCopyAuthorization(
			operation,
			operation.resource,
			options,
		),
	).toBe(true);
	return options;
}

function terminalizeAtProvider(fileOptions, target) {
	const providerOptions = { recursive: true, useTrash: false, atomic: false };
	expect(
		movePlainWorkspaceDeleteFileServiceAuthorization(
			fileOptions,
			target,
			providerOptions,
		),
	).toBe(true);
	const authorization = takePlainWorkspaceDeleteProviderAuthorization(
		providerOptions,
		target,
	);
	expect(authorization).toBeDefined();
	beginPlainWorkspaceDeleteProviderDispatch(authorization);
	completePlainWorkspaceDeleteProviderResult(authorization, {
		status: "deleted",
	});
	return providerOptions;
}

describe("confirmed-delete Workbench patch", () => {
	it("rejects an invalid Plain resource before it can fall through to generic delete UI", () => {
		const invalidPlain = URI.from({
			scheme: "plain-workspace",
			authority: "not-a-root-id",
			path: "/delete.txt",
		});
		expect(classifyPlainWorkspaceDeleteResource(invalidPlain)).toBeUndefined();

		const source = readFileSync(
			fileURLToPath(
				new URL(
					"../../node_modules/@codingame/monaco-vscode-api/vscode/src/vs/workbench/contrib/files/browser/fileActions.js",
					import.meta.url,
				),
			),
			"utf8",
		);
		const classification = source.indexOf(
			"const classifiedElements = distinctElements.map",
		);
		const invalidGuard = source.indexOf(
			"if (classifiedElements.some(value => value.classification === undefined))",
		);
		const genericDeleteBoundary = source.indexOf(
			"const dirtyWorkingCopies = ( new Set());",
		);
		expect(classification).toBeGreaterThanOrEqual(0);
		expect(invalidGuard).toBeGreaterThan(classification);
		expect(genericDeleteBoundary).toBeGreaterThan(invalidGuard);
		expect(source.slice(invalidGuard, genericDeleteBoundary)).toContain(
			"PLAIN_WORKSPACE_DELETE_CONTRACT: invalid deletion resource rejected",
		);
	});

	it("keeps every carrier exact and one-shot, including permanent mode and unknown terminals", () => {
		const target = resource("strict.txt");
		const options = {
			recursive: true,
			folder: false,
			ignoreIfNotExists: false,
			skipTrashBin: true,
		};
		const input = {
			confirmationId,
			entryId,
			rootId,
			relativePath: "strict.txt",
			recursive: true,
			kind: "file",
			permanent: true,
		};
		expect(() =>
			authorizePlainWorkspaceDeleteResourceEdit(options, target, {
				...input,
				permanent: false,
			}),
		).toThrow(/invalid authorization/u);

		let getterReads = 0;
		const accessorOptions = {
			folder: false,
			ignoreIfNotExists: false,
			skipTrashBin: true,
		};
		Object.defineProperty(accessorOptions, "recursive", {
			enumerable: true,
			get() {
				getterReads += 1;
				return true;
			},
		});
		expect(() =>
			authorizePlainWorkspaceDeleteResourceEdit(accessorOptions, target, input),
		).toThrow(/enumerable own data/u);
		expect(getterReads).toBe(0);

		const { authorization, edit } = authorizedResourceEdit(target);
		const operation = moveToWorkingCopy(edit);
		expect(
			movePlainWorkspaceDeleteResourceEditAuthorization(
				edit.options,
				target,
				operation,
			),
		).toBe(false);
		const fileOptions = moveToFileService(operation);
		const providerOptions = {
			recursive: true,
			useTrash: false,
			atomic: false,
		};
		expect(
			movePlainWorkspaceDeleteFileServiceAuthorization(
				fileOptions,
				target,
				providerOptions,
			),
		).toBe(true);
		const providerAuthorization = takePlainWorkspaceDeleteProviderAuthorization(
			providerOptions,
			target,
		);
		expect(providerAuthorization).toBeDefined();
		expect(
			takePlainWorkspaceDeleteProviderAuthorization(providerOptions, target),
		).toBeUndefined();
		beginPlainWorkspaceDeleteProviderDispatch(providerAuthorization);
		completePlainWorkspaceDeleteProviderFailure(
			providerAuthorization,
			"outcomeUnknown",
		);
		expect(getPlainWorkspaceDeleteState(authorization)).toEqual({
			status: "outcomeUnknown",
		});
		expect(() =>
			beginPlainWorkspaceDeleteProviderDispatch(providerAuthorization),
		).toThrow(/dispatch rejected/u);
	});

	it("BulkFileEdits transfers a pure authorized delete without resolve, read, Trash, or Undo", async () => {
		const { authorization, edit } = authorizedResourceEdit();
		const resolve = vi.fn();
		const readFile = vi.fn();
		const workingCopyDelete = vi.fn(async (operations) => {
			expect(operations).toHaveLength(1);
			const fileOptions = moveToFileService(operations[0]);
			terminalizeAtProvider(fileOptions, operations[0].resource);
		});
		const pushElement = vi.fn();
		const progress = { report: vi.fn() };
		const fileService = {
			resolve,
			readFile,
			hasCapability: vi.fn(),
		};
		const configurationService = { getValue: vi.fn() };
		const logService = { error: vi.fn() };
		const instantiationService = {
			createInstance(ctor, ...args) {
				return new ctor(
					...args,
					{ delete: workingCopyDelete },
					fileService,
					configurationService,
					instantiationService,
					logService,
				);
			},
		};
		const bulk = new BulkFileEdits(
			"delete",
			"plain.delete",
			{ id: 1 },
			undefined,
			false,
			progress,
			CancellationToken.None,
			[edit],
			instantiationService,
			{ pushElement },
		);

		await expect(bulk.apply()).resolves.toEqual([]);
		expect(workingCopyDelete).toHaveBeenCalledOnce();
		expect(resolve).not.toHaveBeenCalled();
		expect(readFile).not.toHaveBeenCalled();
		expect(fileService.hasCapability).not.toHaveBeenCalled();
		expect(configurationService.getValue).not.toHaveBeenCalled();
		expect(pushElement).not.toHaveBeenCalled();
		expect(progress.report).toHaveBeenCalledOnce();
		expect(getPlainWorkspaceDeleteState(authorization)).toEqual({
			status: "deleted",
		});
	});

	it("rejects an authorized delete mixed with any other bulk-edit group before instantiation", async () => {
		const { edit } = authorizedResourceEdit();
		const createInstance = vi.fn();
		const bulk = new BulkFileEdits(
			"mixed",
			"plain.delete",
			{ id: 2 },
			undefined,
			false,
			{ report: vi.fn() },
			CancellationToken.None,
			[
				edit,
				new ResourceFileEdit(undefined, resource("created.txt"), {
					folder: false,
				}),
			],
			{ createInstance },
			{ pushElement: vi.fn() },
		);

		await expect(bulk.apply()).rejects.toThrow(/authorized delete batch/u);
		expect(createInstance).not.toHaveBeenCalled();
	});

	it("WorkingCopy runs participants and will-event before del, then soft-reverts only after the authorized entry succeeds", async () => {
		const { authorization, edit } = authorizedResourceEdit();
		const operation = moveToWorkingCopy(edit);
		const order = [];
		const revert = vi.fn(async () => {
			order.push("revert");
		});
		const participant = {
			dispose() {},
			async participate() {
				order.push("participant");
			},
			addFileOperationParticipant() {
				return { dispose() {} };
			},
		};
		const saveParticipant = {
			dispose() {},
			length: 0,
			async participate() {},
			addSaveParticipant() {
				return { dispose() {} };
			},
		};
		const fileService = {
			hasProvider: () => true,
			canDelete: vi.fn(),
			async del(target, fileOptions) {
				order.push("del");
				expect(revert).not.toHaveBeenCalled();
				terminalizeAtProvider(fileOptions, target);
			},
		};
		const instantiationService = {
			createInstance(ctor) {
				return ctor.name === "WorkingCopyFileOperationParticipant"
					? participant
					: saveParticipant;
			},
		};
		const service = new WorkingCopyFileService(
			fileService,
			{
				workingCopies: [
					{
						resource: operation.resource,
						isDirty: () => true,
						revert,
					},
				],
			},
			instantiationService,
			{
				extUri: {
					isEqualOrParent: () => true,
					isEqual: () => true,
				},
			},
		);
		service.onWillRunWorkingCopyFileOperation(() => order.push("will"));
		service.onDidRunWorkingCopyFileOperation(() => order.push("did"));

		await service.delete([operation], CancellationToken.None);

		expect(fileService.canDelete).not.toHaveBeenCalled();
		expect(order).toEqual(["participant", "will", "del", "revert", "did"]);
		expect(revert).toHaveBeenCalledWith({ soft: true });
		expect(getPlainWorkspaceDeleteState(authorization)).toEqual({
			status: "deleted",
		});
		service.dispose();
	});

	it("WorkingCopy stops after an incomplete second entry and preserves the second and remaining dirty copies", async () => {
		const authorized = [
			authorizedResourceEdit(resource("first.txt"), 501),
			authorizedResourceEdit(resource("second.txt"), 502),
			authorizedResourceEdit(resource("third.txt"), 503),
		];
		const operations = authorized.map(({ edit }) => moveToWorkingCopy(edit));
		const reverts = operations.map(() => vi.fn(async () => {}));
		const del = vi.fn(async (target, fileOptions) => {
			const providerOptions = {
				recursive: true,
				useTrash: false,
				atomic: false,
			};
			expect(
				movePlainWorkspaceDeleteFileServiceAuthorization(
					fileOptions,
					target,
					providerOptions,
				),
			).toBe(true);
			const providerAuthorization =
				takePlainWorkspaceDeleteProviderAuthorization(providerOptions, target);
			beginPlainWorkspaceDeleteProviderDispatch(providerAuthorization);
			if (target.path === "/second.txt") {
				completePlainWorkspaceDeleteProviderResult(providerAuthorization, {
					status: "entryPartiallyDeleted",
					reason: "deleteFailed",
					removedEntries: 2,
				});
				throw new Error("incomplete");
			}
			completePlainWorkspaceDeleteProviderResult(providerAuthorization, {
				status: "deleted",
			});
		});
		const participant = {
			dispose() {},
			async participate() {},
			addFileOperationParticipant() {
				return { dispose() {} };
			},
		};
		const saveParticipant = {
			dispose() {},
			length: 0,
			async participate() {},
			addSaveParticipant() {
				return { dispose() {} };
			},
		};
		const service = new WorkingCopyFileService(
			{ hasProvider: () => true, canDelete: vi.fn(), del },
			{
				workingCopies: operations.map((operation, index) => ({
					resource: operation.resource,
					isDirty: () => true,
					revert: reverts[index],
				})),
			},
			{
				createInstance(ctor) {
					return ctor.name === "WorkingCopyFileOperationParticipant"
						? participant
						: saveParticipant;
				},
			},
			{
				extUri: {
					isEqualOrParent(left, right) {
						return left.toString() === right.toString();
					},
					isEqual(left, right) {
						return left.toString() === right.toString();
					},
				},
			},
		);

		await expect(
			service.delete(operations, CancellationToken.None),
		).rejects.toThrow("incomplete");
		expect(del).toHaveBeenCalledTimes(2);
		expect(reverts[0]).toHaveBeenCalledWith({ soft: true });
		expect(reverts[1]).not.toHaveBeenCalled();
		expect(reverts[2]).not.toHaveBeenCalled();
		expect(getPlainWorkspaceDeleteState(authorized[0].authorization)).toEqual({
			status: "deleted",
		});
		expect(getPlainWorkspaceDeleteState(authorized[1].authorization)).toEqual({
			status: "entryPartiallyDeleted",
			reason: "deleteFailed",
			removedEntries: 2,
		});
		expect(getPlainWorkspaceDeleteState(authorized[2].authorization)).toEqual({
			status: "pending",
		});
		service.dispose();
	});

	it("FileService accepts only a staged Plain authorization, skips stat and Trash logic, and fires DELETE only after provider success", async () => {
		const target = resource();
		const { authorization, edit } = authorizedResourceEdit(target);
		const operation = moveToWorkingCopy(edit);
		const fileOptions = moveToFileService(operation);
		const order = [];
		const stat = vi.fn();
		const provider = {
			capabilities:
				FileSystemProviderCapabilities.FileReadWrite |
				FileSystemProviderCapabilities.Readonly,
			onDidChangeCapabilities: Event.None,
			onDidChangeFile: Event.None,
			stat,
			async delete(providerResource, providerOptions) {
				order.push("provider");
				const providerAuthorization =
					takePlainWorkspaceDeleteProviderAuthorization(
						providerOptions,
						providerResource,
					);
				expect(providerAuthorization).toBeDefined();
				beginPlainWorkspaceDeleteProviderDispatch(providerAuthorization);
				completePlainWorkspaceDeleteProviderResult(providerAuthorization, {
					status: "deleted",
				});
			},
		};
		const service = new FileService({ trace() {}, error() {}, warn() {} });
		const registration = service.registerProvider("plain-workspace", provider);
		service.onDidRunOperation((event) => {
			expect(event.operation).toBe(FileOperation.DELETE);
			order.push("event");
		});

		await expect(service.del(target, fileOptions)).resolves.toBeUndefined();
		expect(order).toEqual(["provider", "event"]);
		expect(stat).not.toHaveBeenCalled();
		expect(getPlainWorkspaceDeleteState(authorization)).toEqual({
			status: "deleted",
		});

		const direct = await service.canDelete(target, {
			recursive: true,
			useTrash: false,
			atomic: false,
		});
		expect(direct).toBeInstanceOf(Error);
		expect(stat).not.toHaveBeenCalled();
		registration.dispose();
		service.dispose();
	});
});
