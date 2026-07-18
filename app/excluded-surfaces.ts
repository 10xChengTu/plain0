import {
	CommandsRegistry,
	Registry,
} from "@codingame/monaco-vscode-api/monaco";
import {
	Extensions as ViewExtensions,
	type IViewContainersRegistry,
	type IViewsRegistry,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/common/views";

import {
	EXCLUDED_SURFACE_GUARD_MARKER,
	findExcludedWorkbenchSurfaces,
	type WorkbenchSurfaceSnapshot,
} from "./excluded-surface-policy";

export function captureWorkbenchSurfaces(): WorkbenchSurfaceSnapshot {
	const viewContainers = Registry.as<IViewContainersRegistry>(
		ViewExtensions.ViewContainersRegistry,
	).all;
	const viewsRegistry = Registry.as<IViewsRegistry>(
		ViewExtensions.ViewsRegistry,
	);

	return {
		commandIds: [...CommandsRegistry.getCommands().keys()].sort(),
		viewContainerIds: viewContainers.map(({ id }) => id).sort(),
		viewIds: viewContainers
			.flatMap((container) =>
				viewsRegistry.getViews(container).map(({ id }) => id),
			)
			.sort(),
	};
}

export function enforceExcludedWorkbenchSurfaces(): WorkbenchSurfaceSnapshot {
	const snapshot = captureWorkbenchSurfaces();
	const violations = findExcludedWorkbenchSurfaces(snapshot);
	if (violations.length > 0) {
		throw new Error(
			`${EXCLUDED_SURFACE_GUARD_MARKER}: ${violations
				.map(({ kind, id, category }) => `${kind}:${id} (${category})`)
				.join(", ")}`,
		);
	}
	return snapshot;
}
