// F110 S0 (docs/research/2026-07-28-legacy-retirement.md, decision points 4/5):
// pure, unit-testable bundle-debt classification and ratchet comparison
// logic. `scripts/plain/check-bundle.mjs` is the runner — it does real
// filesystem IO (walking `dist/`, parsing `.js.map` files) and then defers
// to the functions in this module for (a) categorizing a normalized source
// path into zero or more transitional-debt categories and (b) comparing a
// freshly computed debt snapshot against `docs/bundle-baseline.json` under
// ratchet semantics. Both are exported so tests can exercise them with
// synthetic paths/baselines instead of a real `vite build` output.

export function normalizeSource(source) {
	return source
		.replaceAll("\\", "/")
		.replace(/^.*?node_modules\/\.pnpm\/[^/]+\/node_modules\//, "node_modules/")
		.replace(/^(?:\.\.\/)+/, "");
}

// Every matcher below is checked against the *normalized* source path
// produced by `normalizeSource`. Each entry documents whether it matches on
// directory-segment path shape, an exact filename, or (for two categories
// where a directory segment does not exist for every real member) a plain
// case-insensitive substring — and, where that is a real risk, why the
// broader match is still safe against the current real bundle.
export const categories = {
	// Unmodified since F010. `agentHost` and `remoteCodingAgents` are
	// directory segments under `@codingame/monaco-vscode-api`'s
	// `platform/agentHost/**` and `workbench/contrib/remoteCodingAgents/**`
	// trees. `remoteCodingAgents` was added in F110 S0 after reading
	// `remoteCodingAgentsService.service.js`'s real content: it is
	// registered in `missing-services.js` immediately between
	// `ChatAttachmentResolveService` and `McpElicitationService` (both
	// already `chatAgent`/`mcp` debt) and its stub implementation
	// (`registerAgent`/`getRegisteredAgents`/`getAvailableAgents`, all
	// no-ops) is about registering AI coding agents, not SSH/tunnel remote
	// hosts — despite the "remote" spelling in its directory name, this is
	// AI/Agent debt (acceptance #2), not remote-development debt
	// (acceptance #5). Classifying it under a naive `remote` keyword match
	// would have repeated the exact `globalCompositeBar.js` filename-vs-
	// content mismatch this research documented as a trap to avoid.
	//
	// `agentPlugins` and `agentsVoice` were added in F110 S3 after real
	// dependency-graph audit found both were *already* reachable in the real
	// bundle (independent of anything S3 touched) but matched by none of the
	// 12 existing categories: `platform/agentPlugins/common/pluginParsers.js`
	// parses Claude/Copilot/OpenPlugin-format AI agent plugin manifests and
	// hook configs (real logic, not a stub) and is pulled in transitively via
	// the chat prompt-syntax hook chain; `workbench/contrib/agentsVoice/**`
	// (`agentsVoice.service.js`/`voiceTranscriptStore.service.js`) is a
	// missing-services.js-registered AI voice-agent stub pair that was simply
	// never covered by the directory alternation above. Both are genuinely
	// AI/Agent debt despite not containing the literal segment `chat` or
	// `agentHost`.
	//
	// `networkFilterService.service.js` is matched by filename, not
	// directory shape (it lives under `platform/networkFilter/common/`, no
	// `agent` or `chat` segment anywhere in its path) — the same
	// content-vs-path-name mismatch `globalCompositeBar.js` already
	// established a precedent for. Its token (`IAgentNetworkFilterService`,
	// declared as `createDecorator("agentNetworkFilterService")`) and its
	// missing-services.js stub gate an AI-agent capability: whether an
	// external agent may be granted network access to a given URI. Found
	// during F110 S3's real dependency-graph audit to be a genuine,
	// non-optional constructor dependency of `browserView.js`'s real
	// `BrowserViewModel` ("Share with Agent" + Playwright-based agent
	// browser-observation bridge) — seeded here so it is honestly tracked as
	// a floor rather than silently invisible; removing it requires the
	// deeper `BrowserViewModel`/`IPlaywrightService` surgery documented in
	// `docs/bundle-baseline.json`'s `categoryNotes.chatAgent`, out of scope
	// for this slice.
	chatAgent: (source) =>
		/\/(?:chat|inlineChat|agentHost|agentEditorComments|remoteCodingAgents|agentPlugins|agentsVoice)\//i.test(
			source,
		) || /\/networkFilterService\.service\.js$/i.test(source),
	mcp: (source) => /\/mcp\//i.test(source),
	// `globalCompositeBar.js` is matched by filename, not content: it is a
	// real, currently-imported piece of Activity Bar layout (the "Manage"
	// gear icon), already behaviorally neutered by
	// `patches/@codingame__monaco-vscode-api@35.0.1.patch` (see
	// `docs/research/2026-07-28-legacy-retirement.md` "结论 2"). It stays
	// in this category until F110 S4 migrates the surviving gear-icon logic
	// into `app/`.
	authAccount: (source) =>
		/\/(?:authentication|accounts?)\//i.test(source) ||
		/\/(?:defaultAccount|globalCompositeBar)\.js$/i.test(source),
	syncEditSessions: (source) =>
		/\/(?:userDataSync|editSessions)\//i.test(source),
	extensionRuntime: (source) =>
		/\/(?:extensions|extensionManagement|extensionGallery|extensionHost)(?:\/|[A-Z])/i.test(
			source,
		),
	// Directory segment `/notebook/` covers 22 of 23 real members. The 23rd,
	// `workbench/contrib/search/common/notebookSearch.service.js`, lives
	// under the generic `search` contribution (it bridges Search and
	// Notebook — searching inside notebook cells), not a `notebook/`
	// directory, so the matcher is a plain case-insensitive substring
	// instead of a directory anchor. Verified against the real 2208-source
	// corpus (F110 S0): every substring hit is genuine notebook content —
	// no unrelated file anywhere in the bundle happens to contain
	// "notebook".
	notebook: (source) => /notebook/i.test(source),
	tasks: (source) => /\/tasks\//i.test(source),
	testing: (source) => /\/testing\//i.test(source),
	// Directory-anchored on the two real remote-development trees
	// (`platform/remote/**`, `workbench/services/remote/**`, which include
	// `remoteAuthorityResolver`, `remoteAgentConnection`, `tunnelModel`,
	// `remoteExplorerService`, etc. — SSH/tunnel/remote-authority
	// infrastructure) plus one explicit filename,
	// `remoteUserDataProfiles.service.js`, which lives under
	// `workbench/services/userDataProfile/common/` but is content-wise a
	// remote-authority profile resolver (profiles associated with a
	// connected remote host), not settings-sync.
	//
	// Deliberately does NOT match on a bare `/remote/i` substring. Two real
	// files in the current bundle would have been swept in by that and
	// both would have been *wrong*:
	// - `workbench/contrib/remoteCodingAgents/common/remoteCodingAgentsService.service.js`
	//   — reclassified into `chatAgent` above (real AI/Agent content).
	// - `@codingame/monaco-vscode-configuration-service-override`'s
	//   `workbench/contrib/workspaces/browser/recentRemoteFolderPruner.js`
	//   — a real, currently-imported contribution from a package Plain
	//   actually depends on (not a `missing-services.js` stub). Its content
	//   only prunes the *recently opened* MRU list of stale
	//   `vscode-remote://` folder entries; `app/excluded-surface-policy.ts`
	//   already documents this exact file as configuration housekeeping,
	//   not the Remote Development/tunnels feature surface. Counting it
	//   here would contradict that existing, already-audited judgment, so
	//   it is deliberately left out of every category (0 debt) rather than
	//   force-fit into `remote`.
	remote: (source) =>
		/\/(?:platform\/remote|workbench\/services\/remote)\//i.test(source) ||
		/\/remoteUserDataProfiles\.service\.js$/i.test(source),
	languagePacks: (source) => /\/languagePacks\//i.test(source),
	languageDetection: (source) => /\/languageDetection\//i.test(source),
	// Plain substring, not directory-anchored: 7 of 8 real members live
	// under a `treeSitter/` directory segment
	// (`editor/common/model/tokens/treeSitter/**`,
	// `editor/common/services/treeSitter/**`), but the 8th,
	// `editor/standalone/browser/standaloneTreeSitterLibraryService.js`,
	// only carries "TreeSitter" as a camelCase filename infix. Verified
	// against the real 2208-source corpus (F110 S0): no unrelated file
	// anywhere in the bundle happens to contain "treesitter".
	treeSitter: (source) => /treesitter/i.test(source),
};

export function classifyDebtSources(sortedSources) {
	const byCategory = {};
	for (const [name, matches] of Object.entries(categories)) {
		byCategory[name] = sortedSources.filter((source) => matches(source));
	}
	const debtSources = [...new Set(Object.values(byCategory).flat())].sort();
	return { byCategory, debtSources };
}

/**
 * Ratchet comparison (`docs/research/2026-07-28-legacy-retirement.md`
 * decision point 5): each category records a ceiling plus the exact set of
 * known debt-source paths already attributed to it
 * (`baseline.debtSources`). A category may only ever *shrink* — its actual
 * member set must stay a subset of the recorded set — without touching
 * `docs/bundle-baseline.json`. Any category whose actual member count rises
 * above its ceiling, or whose actual members include a path never
 * catalogued for that category before, fails the check. This also catches
 * a same-count "swap" (one tracked debt source quietly replaced by a
 * different, previously-untracked one) that a bare numeric ceiling alone
 * would miss.
 */
export function evaluateBundleBaseline(sortedSources, baseline) {
	const failures = [];
	const { byCategory, debtSources } = classifyDebtSources(sortedSources);

	const ceilings = baseline.categoryCeilings ?? {};
	for (const name of Object.keys(categories)) {
		if (typeof ceilings[name] !== "number") {
			failures.push(
				`bundle baseline is missing a categoryCeilings entry for category: ${name}`,
			);
		}
	}

	const knownByCategory = new Map();
	for (const entry of baseline.debtSources ?? []) {
		if (!knownByCategory.has(entry.category)) {
			knownByCategory.set(entry.category, new Set());
		}
		knownByCategory.get(entry.category).add(entry.source);
	}

	for (const [name, sources] of Object.entries(byCategory)) {
		const ceiling = ceilings[name];
		if (typeof ceiling === "number" && sources.length > ceiling) {
			failures.push(
				`bundle baseline ${name} ceiling exceeded: expected <= ${ceiling}, got ${sources.length}`,
			);
		}
		const known = knownByCategory.get(name) ?? new Set();
		for (const source of sources) {
			if (!known.has(source)) {
				failures.push(
					`bundle baseline ${name} contains an untracked debt source: ${source}`,
				);
			}
		}
	}

	const actual = {
		sourceCount: sortedSources.length,
		debtSourceCount: debtSources.length,
		categoryCounts: Object.fromEntries(
			Object.entries(byCategory).map(([name, sources]) => [
				name,
				sources.length,
			]),
		),
	};

	return { failures, actual };
}
