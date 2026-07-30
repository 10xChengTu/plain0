import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
	checkMissingServicesShape,
	checkServicesReexportShape,
	KEPT_TOKEN_REGISTRATIONS,
	REMOVED_MISSING_SERVICES_TOKENS,
	REMOVED_SERVICES_REEXPORT_TOKENS,
	validateMissingServicesPatchShape,
} from "../../scripts/plain/missing-services-patch-contract.mjs";

const root = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);

const CLEAN_MISSING_SERVICES = `
import { IUndoRedoService } from './vscode/src/vs/platform/undoRedo/common/undoRedo.service.js';
class UndoRedoService {}
registerSingleton(IUndoRedoService, UndoRedoService, InstantiationType.Delayed);
`;

const CLEAN_SERVICES = `
export { IUndoRedoService } from './vscode/src/vs/platform/undoRedo/common/undoRedo.service.js';
export { IHoverService } from './vscode/src/vs/platform/hover/browser/hover.service.js';
`;

// F110 S3: one hand-written, real `registerSingleton(...)` line per entry in
// `KEPT_TOKEN_REGISTRATIONS` (S3's seven chat-family tokens -- S2's
// `IAuthenticationService` entry was removed from `KEPT_TOKEN_REGISTRATIONS`
// itself in F110 S4, since nothing injects that token anymore once
// `globalCompositeBar.js` migrated into `app/`), keyed by token so the
// reverse tests below can remove exactly one at a time and assert the
// contract catches precisely that removal -- not a hand test per token
// duplicated seven times. F110 S5 adds nine more (extensionRuntime tokens
// with a real non-optional consumer outside missing-services.js/services.js
// itself). F110 S6 adds three more (IRemoteAgentService,
// INotebookDocumentService, ILanguageDetectionService). F120 S0 adds one more
// (IProductService) -- discovered not by static dependency-graph audit but by
// a real, full pnpm test:e2e:browser run: see KEPT_TOKEN_REGISTRATIONS' own
// IProductService entry in scripts/plain/missing-services-patch-contract.mjs
// for the "contextService depends on productService which is NOT registered"
// failure this token's registration turned out to be load-bearing for.
const KEPT_REGISTRATION_LINE_BY_TOKEN = Object.freeze({
	IQuickChatService:
		"registerSingleton(IQuickChatService, QuickChatService, InstantiationType.Delayed);",
	IChatWidgetService:
		"registerSingleton(IChatWidgetService, ChatWidgetService, InstantiationType.Delayed);",
	IChatAccessibilityService:
		"registerSingleton(IChatAccessibilityService, ChatAccessibilityService, InstantiationType.Delayed);",
	IChatCodeBlockContextProviderService:
		"registerSingleton(IChatCodeBlockContextProviderService, ChatCodeBlockContextProviderService, InstantiationType.Delayed);",
	IChatAgentService:
		"registerSingleton(IChatAgentService, QuickChatAgentService, InstantiationType.Delayed);",
	IChatAgentNameService:
		"registerSingleton(IChatAgentNameService, ChatAgentNameService, InstantiationType.Delayed);",
	IAgentNetworkFilterService:
		"registerSingleton(IAgentNetworkFilterService, AgentNetworkFilterService, InstantiationType.Delayed);",
	IExtensionGalleryService:
		"registerSingleton(IExtensionGalleryService, ExtensionGalleryService, InstantiationType.Delayed);",
	IExtensionTipsService:
		"registerSingleton(IExtensionTipsService, ExtensionTipsService, InstantiationType.Delayed);",
	IGlobalExtensionEnablementService:
		"registerSingleton(IGlobalExtensionEnablementService, GlobalExtensionEnablementService, InstantiationType.Delayed);",
	IAllowedExtensionsService:
		"registerSingleton(IAllowedExtensionsService, AllowedExtensionsService, InstantiationType.Delayed);",
	IExtensionsWorkbenchService:
		"registerSingleton(IExtensionsWorkbenchService, ExtensionsWorkbenchService, InstantiationType.Delayed);",
	IWorkbenchExtensionEnablementService:
		"registerSingleton(IWorkbenchExtensionEnablementService, WorkbenchExtensionEnablementService, InstantiationType.Delayed);",
	IExtensionManagementServerService:
		"registerSingleton(IExtensionManagementServerService, ExtensionManagementServerService, InstantiationType.Delayed);",
	IWebExtensionsScannerService:
		"registerSingleton(IWebExtensionsScannerService, WebExtensionsScannerService, InstantiationType.Delayed);",
	IWorkbenchExtensionManagementService:
		"registerSingleton(IWorkbenchExtensionManagementService, WorkbenchExtensionManagementService, InstantiationType.Delayed);",
	IRemoteAgentService:
		"registerSingleton(IRemoteAgentService, RemoteAgentService, InstantiationType.Eager);",
	INotebookDocumentService:
		"registerSingleton(INotebookDocumentService, NotebookDocumentService, InstantiationType.Delayed);",
	ILanguageDetectionService:
		"registerSingleton(ILanguageDetectionService, LanguageDetectionService, InstantiationType.Eager);",
	IProductService:
		"registerSingleton(IProductService, ProductService, InstantiationType.Eager);",
});

// Appends one real `registerSingleton(...)` line per
// `KEPT_TOKEN_REGISTRATIONS` entry (S3's seven chat-family tokens plus S5's
// nine extensionRuntime tokens) on top of `CLEAN_MISSING_SERVICES`, so each
// kept token's registration line appears exactly once and a single
// `.replace()` genuinely removes it. No filter is needed anymore:
// `KEPT_TOKEN_REGISTRATIONS` no longer contains an `IAuthenticationService`
// entry at all (removed from the source module in F110 S4), so every
// remaining entry needs its line appended.
const CLEAN_MISSING_SERVICES_WITH_ALL_KEPT_REGISTRATIONS = `${CLEAN_MISSING_SERVICES}\n${KEPT_TOKEN_REGISTRATIONS.map(
	(kept) => KEPT_REGISTRATION_LINE_BY_TOKEN[kept.token],
).join("\n")}\n`;

async function realVendorSources() {
	const vendorApiRoot = path.join(
		root,
		"node_modules/@codingame/monaco-vscode-api",
	);
	return {
		missingServicesSource: await readFile(
			path.join(vendorApiRoot, "missing-services.js"),
			"utf8",
		),
		servicesSource: await readFile(
			path.join(vendorApiRoot, "services.js"),
			"utf8",
		),
	};
}

describe("checkMissingServicesShape", () => {
	it("reports no violations against a clean, minimal shape", () => {
		expect(
			checkMissingServicesShape(
				CLEAN_MISSING_SERVICES_WITH_ALL_KEPT_REGISTRATIONS,
			),
		).toEqual([]);
	});

	it("reports a violation when a removed mcp token reappears", () => {
		const mutated = `${CLEAN_MISSING_SERVICES_WITH_ALL_KEPT_REGISTRATIONS}\nimport { IMcpGalleryService } from './vscode/src/vs/platform/mcp/common/mcpManagement.service.js';\nregisterSingleton(IMcpGalleryService, McpGalleryService, InstantiationType.Eager);\n`;
		const failures = checkMissingServicesShape(mutated);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain("IMcpGalleryService");
	});

	it("reports a violation when a removed syncEditSessions token reappears", () => {
		const mutated = `${CLEAN_MISSING_SERVICES_WITH_ALL_KEPT_REGISTRATIONS}\nregisterSingleton(IUserDataSyncService, UserDataSyncService, InstantiationType.Delayed);\n`;
		const failures = checkMissingServicesShape(mutated);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain("IUserDataSyncService");
	});

	it("reports a violation when a removed authAccount token reappears", () => {
		const mutated = `${CLEAN_MISSING_SERVICES_WITH_ALL_KEPT_REGISTRATIONS}\nregisterSingleton(IAuthenticationAccessService, AuthenticationAccessService, InstantiationType.Delayed);\n`;
		const failures = checkMissingServicesShape(mutated);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain("IAuthenticationAccessService");
	});

	it("reports a violation when the removed IAuthenticationService token reappears", () => {
		const mutated = `${CLEAN_MISSING_SERVICES_WITH_ALL_KEPT_REGISTRATIONS}\nregisterSingleton(IAuthenticationService, AuthenticationService, InstantiationType.Delayed);\n`;
		const failures = checkMissingServicesShape(mutated);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain("IAuthenticationService");
	});

	it("reports a violation when a removed chatAgent token reappears", () => {
		const mutated = `${CLEAN_MISSING_SERVICES_WITH_ALL_KEPT_REGISTRATIONS}\nregisterSingleton(IChatService, ChatService, InstantiationType.Delayed);\n`;
		const failures = checkMissingServicesShape(mutated);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain("IChatService");
	});

	it("reports a violation when a removed extensionRuntime token reappears", () => {
		const mutated = `${CLEAN_MISSING_SERVICES_WITH_ALL_KEPT_REGISTRATIONS}\nregisterSingleton(IExtensionBisectService, ExtensionBisectService, InstantiationType.Eager);\n`;
		const failures = checkMissingServicesShape(mutated);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain("IExtensionBisectService");
	});

	it("reports a violation when the removed IExtensionService/NullExtensionService registration reappears", () => {
		const mutated = `${CLEAN_MISSING_SERVICES_WITH_ALL_KEPT_REGISTRATIONS}\nregisterSingleton(IExtensionService, NullExtensionService, InstantiationType.Eager);\n`;
		const failures = checkMissingServicesShape(mutated);
		expect(failures).toHaveLength(2);
		expect(failures.some((f) => f.includes("IExtensionService"))).toBe(true);
		expect(failures.some((f) => f.includes("NullExtensionService"))).toBe(true);
	});

	it("reports every reintroduced token at once, not just the first", () => {
		const mutated = `${CLEAN_MISSING_SERVICES_WITH_ALL_KEPT_REGISTRATIONS}\nregisterSingleton(IMcpService, McpService, InstantiationType.Eager);\nregisterSingleton(IUserDataSyncMachinesService, UserDataSyncMachinesService, InstantiationType.Delayed);\n`;
		const failures = checkMissingServicesShape(mutated);
		expect(failures).toHaveLength(2);
		expect(failures.some((f) => f.includes("IMcpService"))).toBe(true);
		expect(
			failures.some((f) => f.includes("IUserDataSyncMachinesService")),
		).toBe(true);
	});

	// Reformatting tolerance (whitespace/line-break changes around a kept
	// registration call must not misfire) is covered generically by
	// KEPT_TOKEN_REGISTRATIONS' own patterns being whitespace-insensitive;
	// see "reports a violation when a deliberately-kept registration is
	// missing" below for the full per-token reverse-test suite, which
	// supersedes the single-token version this file used to hand-write only
	// for IAuthenticationService back when it was the sole kept token (F110
	// S2). `checkMissingServicesShape`'s own
	// `KEPT_AUTHENTICATION_SERVICE_REGISTRATION` regex is exercised by that
	// suite's `IAuthenticationService` case.

	it("every removed token is a real, non-empty identifier and the list has no duplicates", () => {
		expect(REMOVED_MISSING_SERVICES_TOKENS.length).toBeGreaterThan(0);
		expect(new Set(REMOVED_MISSING_SERVICES_TOKENS).size).toBe(
			REMOVED_MISSING_SERVICES_TOKENS.length,
		);
		// F110 S2's 34 tokens were uniformly `IFooService`/`IFoo`-shaped
		// interface decorators. F110 S3 legitimately widened this to include
		// plain PascalCase enum/const/class names imported for use inside a
		// removed class body (e.g. `AgentStatusMode`, `ChatEntitlement`,
		// `SessionType`, `ToolSet`, `NullAgentHostService`) -- every one of
		// these is still a real, single, non-empty JS identifier, just not
		// always interface-shaped.
		for (const token of REMOVED_MISSING_SERVICES_TOKENS) {
			expect(token).toMatch(/^[A-Za-z][A-Za-z0-9]*$/u);
		}
		// F110 S2: mcp(12) + syncEditSessions(14) + authAccount(8, excluding
		// the then-kept IAuthenticationService and the out-of-scope
		// globalCompositeBar.js, which is not a registered token at all) = 34.
		// F110 S3: 89 more tokens covering chat/inlineChat/agentHost/
		// agentEditorComments/agentPlugins/agentsVoice, excluding the seven
		// kept chat-family tokens in KEPT_TOKEN_REGISTRATIONS. 34 + 89 = 123.
		// F110 S4: globalCompositeBar.js's migration into app/ dropped its last
		// real consumer of IAuthenticationService, so this 9th authAccount
		// token is now removed too, with nothing left kept in that category.
		// 123 + 1 = 124.
		// F110 S5: 12 more tokens covering extensionRuntime
		// (IExtensionHostDebugService, IExtensionsScannerService,
		// IExtensionsProfileScannerService, IBuiltinExtensionsScannerService,
		// IExtensionStorageService, IExtensionManifestPropertiesService,
		// IExtensionUrlHandler, IExtensionBisectService,
		// IExtensionFeaturesManagementService, IExtensionGalleryManifestService,
		// IExtensionService, NullExtensionService), excluding the nine kept
		// extensionRuntime tokens in KEPT_TOKEN_REGISTRATIONS. 124 + 12 = 136.
		// F110 S6: 32 more tokens covering notebook(17)/tasks(1)/testing(9)/
		// remote(4: IRemoteExtensionsScannerService, IRemoteSocketFactoryService,
		// IRemoteExplorerService, IRemoteUserDataProfilesService)/
		// languagePacks(1: ILanguagePackService), excluding the three kept
		// tokens in KEPT_TOKEN_REGISTRATIONS (IRemoteAgentService,
		// INotebookDocumentService, ILanguageDetectionService — all three
		// registered but deliberately kept, not removed). 136 + 32 = 168.
		expect(REMOVED_MISSING_SERVICES_TOKENS.length).toBe(168);
	});

	it("none of the removed tokens is also one of the deliberately-kept tokens", () => {
		const removed = new Set(REMOVED_MISSING_SERVICES_TOKENS);
		for (const kept of KEPT_TOKEN_REGISTRATIONS) {
			expect(removed.has(kept.token)).toBe(false);
		}
	});

	it("matches the real, currently-installed missing-services.js with zero violations", async () => {
		const { missingServicesSource } = await realVendorSources();
		expect(checkMissingServicesShape(missingServicesSource)).toEqual([]);
	});

	// This is the reverse test the "主导会话裁定" mandate requires, generalized
	// across every deliberately-kept registration (S2's IAuthenticationService
	// plus S3's seven chat-family tokens): proving the contract actually
	// fires when each one's real, currently-bundled non-optional constructor
	// dependency is violated -- not merely that it always passes. Each
	// iteration removes exactly one kept registration line and checks the
	// contract reports exactly that one violation (not zero, not several).
	describe("reports a violation when a deliberately-kept registration is missing", () => {
		it.each(KEPT_TOKEN_REGISTRATIONS.map((kept) => [kept.token, kept]))(
			"%s",
			(token, kept) => {
				const withoutThisOne =
					CLEAN_MISSING_SERVICES_WITH_ALL_KEPT_REGISTRATIONS.replace(
						KEPT_REGISTRATION_LINE_BY_TOKEN[token],
						"",
					);
				const failures = checkMissingServicesShape(withoutThisOne);
				expect(failures).toHaveLength(1);
				expect(failures[0]).toContain(token);
				expect(failures[0]).toContain(kept.reason.slice(0, 20));
			},
		);
	});

	it("does not misfire when every kept registration is present at once (the real installed shape)", () => {
		expect(
			checkMissingServicesShape(
				CLEAN_MISSING_SERVICES_WITH_ALL_KEPT_REGISTRATIONS,
			),
		).toEqual([]);
	});
});

describe("checkServicesReexportShape", () => {
	it("reports no violations against a clean, minimal shape", () => {
		expect(checkServicesReexportShape(CLEAN_SERVICES)).toEqual([]);
	});

	it("reports a violation when a removed re-export reappears", () => {
		const mutated = `${CLEAN_SERVICES}\nexport { IMcpRegistry } from './vscode/src/vs/workbench/contrib/mcp/common/mcpRegistryTypes.service.js';\n`;
		const failures = checkServicesReexportShape(mutated);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain("IMcpRegistry");
	});

	it("reports a violation when a removed extensionRuntime re-export reappears", () => {
		const mutated = `${CLEAN_SERVICES}\nexport { IExtensionService } from './vscode/src/vs/workbench/services/extensions/common/extensions.service.js';\n`;
		const failures = checkServicesReexportShape(mutated);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain("IExtensionService");
	});

	it("reports a violation for the two services.js-only removed names (IMcpManagementService, IAuthenticationService)", () => {
		const mutated = `${CLEAN_SERVICES}\nexport { IMcpGalleryService, IMcpManagementService } from './vscode/src/vs/platform/mcp/common/mcpManagement.service.js';\nexport { IAuthenticationExtensionsService, IAuthenticationService } from './vscode/src/vs/workbench/services/authentication/common/authentication.service.js';\n`;
		const failures = checkServicesReexportShape(mutated);
		const joined = failures.join("\n");
		expect(joined).toContain("IMcpGalleryService");
		expect(joined).toContain("IMcpManagementService");
		expect(joined).toContain("IAuthenticationExtensionsService");
		expect(joined).toContain("IAuthenticationService");
	});

	// Unlike F110 S2 (where every one of the 34 missing-services.js removals
	// happened to also be re-exported by services.js, making
	// REMOVED_SERVICES_REEXPORT_TOKENS a strict superset), F110 S3 found 32 of
	// its 89 tokens are imported by missing-services.js but never re-exported
	// by services.js at all (pure enums/consts, or concrete classes used only
	// as a registerSingleton implementation argument) -- there is no second
	// re-export line to delete for those 32. So the real invariant is: every
	// REMOVED_SERVICES_REEXPORT_TOKENS entry is either one of the two
	// services.js-only names, or a genuine REMOVED_MISSING_SERVICES_TOKENS
	// member -- not the other way around.
	it("every REMOVED_SERVICES_REEXPORT_TOKENS entry is a real missing-services.js removal or one of the two services.js-only names", () => {
		const missingServicesSet = new Set(REMOVED_MISSING_SERVICES_TOKENS);
		for (const token of REMOVED_SERVICES_REEXPORT_TOKENS) {
			const isServicesOnly =
				token === "IMcpManagementService" || token === "IAuthenticationService";
			expect(isServicesOnly || missingServicesSet.has(token)).toBe(true);
		}
		expect(REMOVED_SERVICES_REEXPORT_TOKENS).toContain("IMcpManagementService");
		expect(REMOVED_SERVICES_REEXPORT_TOKENS).toContain(
			"IAuthenticationService",
		);
		expect(new Set(REMOVED_SERVICES_REEXPORT_TOKENS).size).toBe(
			REMOVED_SERVICES_REEXPORT_TOKENS.length,
		);
		// Before F110 S4: 91 tokens survived the S3_MISSING_SERVICES_ONLY_NOT_REEXPORTED
		// filter (123 REMOVED_MISSING_SERVICES_TOKENS - 32 filtered out, not yet
		// including IAuthenticationService, which was not a
		// REMOVED_MISSING_SERVICES_TOKENS member back then) + 2 hardcoded
		// services.js-only names (IMcpManagementService, IAuthenticationService)
		// = 93.
		// After F110 S4: 92 tokens survive the same filter (124 - 32, NOW
		// including IAuthenticationService, a genuine REMOVED_MISSING_SERVICES_TOKENS
		// member as of this slice) + 1 hardcoded name (IMcpManagementService
		// only, since IAuthenticationService's special-casing was folded into
		// the general mechanism) = 93. Same total -- a reclassification of
		// IAuthenticationService from "hardcoded services.js-only extra" to
		// "ordinary filtered-spread member", not a net addition to the set of
		// tokens this contract tracks.
		// F110 S5: all 12 new extensionRuntime tokens are also re-exported by
		// services.js (unlike S3's mix, every one of these 12 happened to be a
		// services.js re-export too, S2-style) and none of them is in
		// S3_MISSING_SERVICES_ONLY_NOT_REEXPORTED, so they flow straight
		// through the filter. 93 + 12 = 105.
		// F110 S6: 30 of its 32 new tokens are also re-exported by services.js;
		// the other 2 (INotebookCellOutlineDataSourceFactory,
		// INotebookOutlineEntryFactory) are added to
		// S3_MISSING_SERVICES_ONLY_NOT_REEXPORTED instead (confirmed by
		// grepping the pre-patch services.js source: neither name has its own
		// re-export line). 105 + 30 = 135.
		expect(REMOVED_SERVICES_REEXPORT_TOKENS.length).toBe(135);
	});

	it("matches the real, currently-installed services.js with zero violations", async () => {
		const { servicesSource } = await realVendorSources();
		expect(checkServicesReexportShape(servicesSource)).toEqual([]);
	});
});

describe("validateMissingServicesPatchShape", () => {
	it("combines both checks and matches the real installed vendor files", async () => {
		const sources = await realVendorSources();
		expect(validateMissingServicesPatchShape(sources)).toEqual([]);
	});

	it("still reports missing-services.js violations even when services.js is clean", async () => {
		const { servicesSource } = await realVendorSources();
		const mutatedMissingServices = `${CLEAN_MISSING_SERVICES}\nregisterSingleton(IEditSessionsLogService, EditSessionsLogService, InstantiationType.Delayed);\n`;
		const failures = validateMissingServicesPatchShape({
			missingServicesSource: mutatedMissingServices,
			servicesSource,
		});
		expect(failures.some((f) => f.includes("IEditSessionsLogService"))).toBe(
			true,
		);
	});
});
