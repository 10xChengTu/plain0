import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import type { IAnyWorkspaceIdentifier } from "@codingame/monaco-vscode-api/vscode/vs/platform/workspace/common/workspace";
import type { IWorkspaceProvider } from "@codingame/monaco-vscode-api/vscode/vs/workbench/browser/web.api";

import type { WorkspaceSnapshot } from "../../platform/tauri";
import { decodeWorkspaceSnapshot } from "../../platform/tauri/workspace-codec";

export const MULTI_ROOT_WORKSPACE_UNSUPPORTED =
	"WORKSPACE_MULTI_ROOT_UNSUPPORTED" as const;

export class MultiRootWorkspaceUnsupportedError extends Error {
	readonly code = MULTI_ROOT_WORKSPACE_UNSUPPORTED;

	constructor() {
		super("Plain does not support adding workspace folders yet.");
		this.name = "MultiRootWorkspaceUnsupportedError";
		Object.freeze(this);
	}
}

export interface WorkspaceProjection {
	readonly provider: IWorkspaceProvider;
	readonly identifier: IAnyWorkspaceIdentifier;
}

export type ReinitializeWorkspace = (
	identifier: IAnyWorkspaceIdentifier,
) => Promise<void>;

export interface WorkspaceProjector {
	project(snapshot: WorkspaceSnapshot): WorkspaceProjection;
	apply(snapshot: WorkspaceSnapshot): Promise<IAnyWorkspaceIdentifier>;
}

const rejectWorkbenchWorkspaceOpen: IWorkspaceProvider["open"] = async () =>
	false;

function projectDecodedSnapshot(
	snapshot: WorkspaceSnapshot,
): WorkspaceProjection {
	// F020 currently exposes one folder in Workbench. Any additional native
	// capabilities remain authorized in Rust but are not projected until the
	// virtual .code-workspace slice lands; the add-root command stays disabled.
	const root = snapshot.roots[0];
	if (root === undefined) {
		return Object.freeze({
			provider: Object.freeze({
				workspace: undefined,
				// Filesystem authorization does not grant Git, PTY or DAP process
				// trust, so the Workbench must not infer a trusted workspace here.
				trusted: false,
				open: rejectWorkbenchWorkspaceOpen,
			}),
			identifier: Object.freeze({ id: snapshot.workspaceId }),
		});
	}

	const folderUri = URI.parse(root.uri, true);
	return Object.freeze({
		provider: Object.freeze({
			workspace: Object.freeze({
				folderUri,
				id: snapshot.workspaceId,
				label: root.displayName,
			}),
			// Native directory authorization is deliberately separate from
			// permission to execute Git, terminal or debug adapter processes.
			trusted: false,
			open: rejectWorkbenchWorkspaceOpen,
		}),
		identifier: Object.freeze({
			id: snapshot.workspaceId,
			uri: folderUri,
		}),
	});
}

export function projectWorkspaceSnapshot(
	snapshot: WorkspaceSnapshot,
): WorkspaceProjection {
	return projectDecodedSnapshot(decodeWorkspaceSnapshot(snapshot));
}

export async function applyWorkspaceSnapshot(
	snapshot: WorkspaceSnapshot,
	reinitializeWorkspace: ReinitializeWorkspace,
): Promise<IAnyWorkspaceIdentifier> {
	const projection = projectWorkspaceSnapshot(snapshot);
	await reinitializeWorkspace(projection.identifier);
	return projection.identifier;
}

export function createWorkspaceProjector(
	reinitializeWorkspace: ReinitializeWorkspace,
): WorkspaceProjector {
	return Object.freeze({
		project: projectWorkspaceSnapshot,
		apply: (snapshot: WorkspaceSnapshot) =>
			applyWorkspaceSnapshot(snapshot, reinitializeWorkspace),
	});
}
