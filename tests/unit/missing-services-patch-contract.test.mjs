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
import { IAuthenticationService } from './vscode/src/vs/workbench/services/authentication/common/authentication.service.js';
class UndoRedoService {}
registerSingleton(IUndoRedoService, UndoRedoService, InstantiationType.Delayed);
class AuthenticationService {
    constructor() {
        this.getAccounts = async () => [];
    }
}
registerSingleton(IAuthenticationService, AuthenticationService, InstantiationType.Delayed);
`;

const CLEAN_SERVICES = `
export { IUndoRedoService } from './vscode/src/vs/platform/undoRedo/common/undoRedo.service.js';
export { IHoverService } from './vscode/src/vs/platform/hover/browser/hover.service.js';
`;

// F110 S3: one hand-written, real `registerSingleton(...)` line per entry in
// `KEPT_TOKEN_REGISTRATIONS` (S2's `IAuthenticationService` plus S3's seven
// chat-family tokens), keyed by token so the reverse tests below can remove
// exactly one at a time and assert the contract catches precisely that
// removal -- not a hand test per token duplicated eight times.
const KEPT_REGISTRATION_LINE_BY_TOKEN = Object.freeze({
	IAuthenticationService:
		"registerSingleton(IAuthenticationService, AuthenticationService, InstantiationType.Delayed);",
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
});

// `IAuthenticationService` already has a registration inside
// `CLEAN_MISSING_SERVICES` itself (S2's original fixture) -- only append the
// seven S3 additions on top, so each kept token's registration line appears
// exactly once and a single `.replace()` genuinely removes it.
const CLEAN_MISSING_SERVICES_WITH_ALL_KEPT_REGISTRATIONS = `${CLEAN_MISSING_SERVICES}\n${KEPT_TOKEN_REGISTRATIONS.filter(
	(kept) => kept.token !== "IAuthenticationService",
)
	.map((kept) => KEPT_REGISTRATION_LINE_BY_TOKEN[kept.token])
	.join("\n")}\n`;

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

	it("reports a violation when a removed chatAgent token reappears", () => {
		const mutated = `${CLEAN_MISSING_SERVICES_WITH_ALL_KEPT_REGISTRATIONS}\nregisterSingleton(IChatService, ChatService, InstantiationType.Delayed);\n`;
		const failures = checkMissingServicesShape(mutated);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain("IChatService");
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
		// the kept IAuthenticationService and the out-of-scope
		// globalCompositeBar.js, which is not a registered token at all) = 34.
		// F110 S3: 89 more tokens covering chat/inlineChat/agentHost/
		// agentEditorComments/agentPlugins/agentsVoice, excluding the seven
		// kept chat-family tokens in KEPT_TOKEN_REGISTRATIONS. 34 + 89 = 123.
		expect(REMOVED_MISSING_SERVICES_TOKENS.length).toBe(123);
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
		// F110 S2: 34 + 2 services.js-only names = 36.
		// F110 S3: 57 of its 89 tokens are also re-exported. 36 + 57 = 93.
		expect(REMOVED_SERVICES_REEXPORT_TOKENS.length).toBe(93);
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
