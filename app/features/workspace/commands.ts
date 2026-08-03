import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
import { ICommandService } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands.service";
import type { IContextKeyService } from "@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import {
	EnterMultiRootWorkspaceSupportContext,
	OpenFolderWorkspaceSupportContext,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/common/contextkeys";

import type { PlainBridge } from "../../platform/tauri";
import { PlainWorkspaceOperationUnsupportedError } from "../../services/plain-workspace-services";
import type { WorkspaceTopologyCoordinator } from "./workspace-projection";

export const WORKSPACE_COMMAND_IDS = Object.freeze({
	openFolder: "workbench.action.files.openFolder",
	openFolderViaWorkspace: "workbench.action.files.openFolderViaWorkspace",
	setRootFolder: "setRootFolder",
	addRootFolder: "addRootFolder",
	removeRootFolder: "removeRootFolder",
	removeRootFolderViaPicker: "workbench.action.removeRootFolder",
});

export const GUARDED_WORKSPACE_COMMAND_IDS = Object.freeze([
	"workbench.action.openWorkspace",
	"workbench.action.openWorkspaceConfigFile",
	"workbench.action.openWorkspaceInNewWindow",
	"workbench.action.saveWorkspaceAs",
	"workbench.action.duplicateWorkspaceInNewWindow",
	"workbench.action.files.openFileFolder",
	"workbench.action.files.openFileInNewWindow",
	"vscode.openFolder",
	"vscode.newWindow",
	"_files.pickFolderAndOpen",
	"_files.newWindow",
	"_files.windowOpen",
] as const);

const PICK_WORKSPACE_FOLDER_COMMAND_ID = "_workbench.pickWorkspaceFolder";
const PLAIN_WORKSPACE_SCHEME = "plain-workspace";
const UUID_V4_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const URI_COMPONENT_KEYS = Object.freeze([
	"scheme",
	"authority",
	"path",
	"query",
	"fragment",
] as const);

export const PLAIN_WORKSPACE_ROOT_RESOURCE_INVALID =
	"PLAIN_WORKSPACE_ROOT_RESOURCE_INVALID" as const;

class PlainWorkspaceRootResourceInvalidError extends TypeError {
	readonly code = PLAIN_WORKSPACE_ROOT_RESOURCE_INVALID;

	constructor() {
		super("The workspace root URI is invalid.");
		this.name = "PlainWorkspaceRootResourceInvalidError";
		Object.freeze(this);
	}
}

function invalidWorkspaceRootResource(): never {
	throw new PlainWorkspaceRootResourceInvalidError();
}

function workspaceRootId(resource: unknown): string {
	try {
		if (!(resource instanceof URI)) {
			return invalidWorkspaceRootResource();
		}
		const descriptors = Object.getOwnPropertyDescriptors(resource);
		const components: Record<string, string> = Object.create(null);
		for (const key of URI_COMPONENT_KEYS) {
			const descriptor = descriptors[key];
			if (
				descriptor === undefined ||
				!("value" in descriptor) ||
				descriptor.get !== undefined ||
				descriptor.set !== undefined ||
				typeof descriptor.value !== "string"
			) {
				return invalidWorkspaceRootResource();
			}
			components[key] = descriptor.value;
		}
		for (const key of Reflect.ownKeys(descriptors)) {
			if (typeof key !== "string") {
				return invalidWorkspaceRootResource();
			}
			const descriptor = descriptors[key];
			if (
				descriptor === undefined ||
				!("value" in descriptor) ||
				descriptor.get !== undefined ||
				descriptor.set !== undefined ||
				(typeof descriptor.value !== "string" && descriptor.value !== null)
			) {
				return invalidWorkspaceRootResource();
			}
		}
		structuredClone(resource);
		if (
			components.scheme !== PLAIN_WORKSPACE_SCHEME ||
			!UUID_V4_PATTERN.test(components.authority!) ||
			components.path !== "/" ||
			components.query !== "" ||
			components.fragment !== ""
		) {
			return invalidWorkspaceRootResource();
		}
		return components.authority!;
	} catch {
		return invalidWorkspaceRootResource();
	}
}

function workspaceFolderResource(folder: unknown): unknown {
	try {
		if (typeof folder !== "object" || folder === null) {
			return invalidWorkspaceRootResource();
		}
		const descriptor = Object.getOwnPropertyDescriptor(folder, "uri");
		if (
			descriptor === undefined ||
			!("value" in descriptor) ||
			descriptor.get !== undefined ||
			descriptor.set !== undefined
		) {
			return invalidWorkspaceRootResource();
		}
		return descriptor.value;
	} catch {
		return invalidWorkspaceRootResource();
	}
}

export interface WorkspaceCommandRegistration {
	dispose(): void;
}

export function registerWorkspaceCommands(
	bridge: PlainBridge,
	contextKeyService: IContextKeyService,
	topologyCoordinator: WorkspaceTopologyCoordinator,
): WorkspaceCommandRegistration {
	const previousOpenFolderSupport =
		contextKeyService.getContextKeyValue<boolean>(
			OpenFolderWorkspaceSupportContext.key,
		);
	const openFolderSupported =
		OpenFolderWorkspaceSupportContext.bindTo(contextKeyService);
	openFolderSupported.set(true);
	const previousMultiRootSupport =
		contextKeyService.getContextKeyValue<boolean>(
			EnterMultiRootWorkspaceSupportContext.key,
		);
	const multiRootSupported =
		EnterMultiRootWorkspaceSupportContext.bindTo(contextKeyService);
	const restoreMultiRootSupport =
		previousMultiRootSupport ?? multiRootSupported.get() ?? false;
	multiRootSupported.set(false);

	const pickRoots = (mode: "replace" | "add") =>
		topologyCoordinator.runMutation(async () => {
			const result = await bridge.workspacePickRoots(mode);
			return Object.freeze({
				result,
				snapshot: result.status === "selected" ? result.snapshot : undefined,
			});
		});
	const removeRoot = (commandService: ICommandService, resource: unknown) =>
		topologyCoordinator.runMutation(async () => {
			let selectedResource = resource;
			if (selectedResource === undefined) {
				const folder = await commandService.executeCommand<unknown>(
					PICK_WORKSPACE_FOLDER_COMMAND_ID,
				);
				if (folder === undefined) {
					return Object.freeze({
						result: undefined,
						snapshot: undefined,
					});
				}
				selectedResource = workspaceFolderResource(folder);
			}
			const rootId = workspaceRootId(selectedResource);
			const snapshot = await bridge.workspaceRemoveRoot(rootId);
			return Object.freeze({ result: undefined, snapshot });
		});
	const registrations = [
		CommandsRegistry.registerCommand(WORKSPACE_COMMAND_IDS.openFolder, () =>
			pickRoots("replace"),
		),
		CommandsRegistry.registerCommand(
			WORKSPACE_COMMAND_IDS.openFolderViaWorkspace,
			() => pickRoots("replace"),
		),
		CommandsRegistry.registerCommand(WORKSPACE_COMMAND_IDS.setRootFolder, () =>
			pickRoots("replace"),
		),
		CommandsRegistry.registerCommand(WORKSPACE_COMMAND_IDS.addRootFolder, () =>
			pickRoots("add"),
		),
		CommandsRegistry.registerCommand(
			WORKSPACE_COMMAND_IDS.removeRootFolder,
			(accessor, resource) =>
				removeRoot(accessor.get(ICommandService), resource),
		),
		CommandsRegistry.registerCommand(
			WORKSPACE_COMMAND_IDS.removeRootFolderViaPicker,
			(accessor) => removeRoot(accessor.get(ICommandService), undefined),
		),
		...GUARDED_WORKSPACE_COMMAND_IDS.map((id) =>
			CommandsRegistry.registerCommand(id, () =>
				Promise.reject(new PlainWorkspaceOperationUnsupportedError()),
			),
		),
	];

	return {
		dispose() {
			for (const registration of registrations.reverse()) {
				registration.dispose();
			}
			openFolderSupported.set(previousOpenFolderSupport ?? false);
			multiRootSupported.set(restoreMultiRootSupport);
		},
	};
}
