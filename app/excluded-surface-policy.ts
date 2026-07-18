export const EXCLUDED_SURFACE_GUARD_MARKER =
	"PLAIN_EXCLUDED_SURFACE_GUARD_V1" as const;

export interface WorkbenchSurfaceSnapshot {
	commandIds: string[];
	viewContainerIds: string[];
	viewIds: string[];
}

export interface ExcludedWorkbenchSurface {
	kind: keyof WorkbenchSurfaceSnapshot;
	id: string;
	category: string;
}

declare global {
	interface Window {
		__PLAIN_WORKBENCH_SURFACES__?: Readonly<WorkbenchSurfaceSnapshot>;
	}
}

const excludedIdPatterns: ReadonlyArray<{
	category: string;
	pattern: RegExp;
}> = [
	{
		category: "AI, Chat, Agent or MCP",
		pattern:
			/chat|agent|copilot|mcp|language.?models?|aiSettings|aiRelated|embeddings?/i,
	},
	{
		category: "authentication or accounts",
		pattern:
			/authentication|authSession|accounts?|signIn|signOut|logIn|logOut/i,
	},
	{
		category: "settings sync or edit sessions",
		pattern: /userDataSync|settingsSync|syncAccount|editSessions?/i,
	},
	{
		category: "extensions, gallery or marketplace",
		pattern:
			/extension(?:Host|Gallery|Management|Bisect|s)?|gallery|marketplace/i,
	},
	{
		category: "remote development or tunnels",
		pattern: /remote|tunnel/i,
	},
	{
		category: "notebooks, tasks or testing",
		pattern:
			/notebook|interactiveWindow|workbench\.action\.tasks?|testExplorer|testing/i,
	},
];

function matchExcludedId(id: string): string | undefined {
	return excludedIdPatterns.find(({ pattern }) => pattern.test(id))?.category;
}

export function findExcludedWorkbenchSurfaces(
	snapshot: WorkbenchSurfaceSnapshot,
): ExcludedWorkbenchSurface[] {
	const violations: ExcludedWorkbenchSurface[] = [];
	for (const kind of ["commandIds", "viewContainerIds", "viewIds"] as const) {
		for (const id of snapshot[kind]) {
			const category = matchExcludedId(id);
			if (category !== undefined) {
				violations.push({ kind, id, category });
			}
		}
	}
	return violations.sort((left, right) =>
		`${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`),
	);
}
