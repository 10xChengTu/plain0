import {
	CommandsRegistry,
	Registry,
} from "@codingame/monaco-vscode-api/monaco";
import { Extensions as WorkbenchContributionExtensions } from "@codingame/monaco-vscode-api/vscode/vs/workbench/common/contributions";
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

/**
 * The public `IWorkbenchContributionsRegistry` contract
 * (`@codingame/monaco-vscode-api/vscode/vs/workbench/common/contributions`)
 * exposes no enumeration method at all — `getWorkbenchContribution(id)`
 * requires already knowing the id and throws otherwise, and there is no
 * public "list every registered id" API. The concrete
 * `WorkbenchContributionsRegistry` class *does* keep every id ever passed
 * to `registerWorkbenchContribution2` in two plain (not `#`-private, just
 * TypeScript-`private`-annotated) instance maps: `contributionsById` (not
 * yet instantiated) and `instancesById` (already instantiated — moved out
 * of `contributionsById` the moment it is constructed). Reading them here
 * is a deliberate, narrow use of that non-public-but-not-actually-hidden
 * surface — reading a plain already-populated data structure off the same
 * `Registry` singleton `IViewContainersRegistry`/`IViewsRegistry` are
 * already read from below, not importing or instantiating any service, so
 * it still fits the "lazy static contribution registry only" rule in
 * `AGENTS.md`. Confirmed against the pinned
 * `@codingame/monaco-vscode-api@35.0.1` build (see
 * `docs/research/2026-07-25-core-git.md`'s decision 2); a future version
 * bump that renames or removes these two fields would silently stop
 * populating `contributionIds` (this cast has no compile-time link to the
 * real class), so it needs re-verification whenever that dependency's pin
 * changes.
 *
 * Known limitation, stated plainly rather than glossed over: this can only
 * report contributions *registered by the time it is called* —
 * `app/main.ts` calls `enforceExcludedWorkbenchSurfaces()` right after
 * bootstrap, before any `WorkbenchPhase.Eventually`-scheduled contribution
 * (fired 2-5s after restore) has necessarily run its module-level
 * `registerWorkbenchContribution2` call. A contribution registered that
 * late would still show up once genuinely present in memory, just not
 * necessarily inside this specific snapshot's timing window.
 */
interface WorkbenchContributionsRegistryInternals {
	readonly contributionsById: ReadonlyMap<string, { readonly id: string }>;
	readonly instancesById: ReadonlyMap<string, unknown>;
}

function captureContributionIds(): string[] {
	const registry = Registry.as<WorkbenchContributionsRegistryInternals>(
		WorkbenchContributionExtensions.Workbench,
	);
	const ids = new Set<string>([
		...registry.contributionsById.keys(),
		...registry.instancesById.keys(),
	]);
	return [...ids].sort();
}

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
		contributionIds: captureContributionIds(),
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
