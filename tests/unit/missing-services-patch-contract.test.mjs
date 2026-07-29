import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
	checkMissingServicesShape,
	checkServicesReexportShape,
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
		expect(checkMissingServicesShape(CLEAN_MISSING_SERVICES)).toEqual([]);
	});

	it("reports a violation when a removed mcp token reappears", () => {
		const mutated = `${CLEAN_MISSING_SERVICES}\nimport { IMcpGalleryService } from './vscode/src/vs/platform/mcp/common/mcpManagement.service.js';\nregisterSingleton(IMcpGalleryService, McpGalleryService, InstantiationType.Eager);\n`;
		const failures = checkMissingServicesShape(mutated);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain("IMcpGalleryService");
	});

	it("reports a violation when a removed syncEditSessions token reappears", () => {
		const mutated = `${CLEAN_MISSING_SERVICES}\nregisterSingleton(IUserDataSyncService, UserDataSyncService, InstantiationType.Delayed);\n`;
		const failures = checkMissingServicesShape(mutated);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain("IUserDataSyncService");
	});

	it("reports a violation when a removed authAccount token reappears", () => {
		const mutated = `${CLEAN_MISSING_SERVICES}\nregisterSingleton(IAuthenticationAccessService, AuthenticationAccessService, InstantiationType.Delayed);\n`;
		const failures = checkMissingServicesShape(mutated);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain("IAuthenticationAccessService");
	});

	it("reports every reintroduced token at once, not just the first", () => {
		const mutated = `${CLEAN_MISSING_SERVICES}\nregisterSingleton(IMcpService, McpService, InstantiationType.Eager);\nregisterSingleton(IUserDataSyncMachinesService, UserDataSyncMachinesService, InstantiationType.Delayed);\n`;
		const failures = checkMissingServicesShape(mutated);
		expect(failures).toHaveLength(2);
		expect(failures.some((f) => f.includes("IMcpService"))).toBe(true);
		expect(
			failures.some((f) => f.includes("IUserDataSyncMachinesService")),
		).toBe(true);
	});

	// This is the reverse test the "主导会话裁定" mandate requires: proving the
	// contract actually fires when its one deliberately-kept assumption
	// (globalCompositeBar.js's non-optional IAuthenticationService
	// constructor dependency) is violated — not merely that it always
	// passes.
	it("reports a violation when the deliberately-kept IAuthenticationService registration is missing", () => {
		const withoutKeptRegistration = CLEAN_MISSING_SERVICES.replace(
			"registerSingleton(IAuthenticationService, AuthenticationService, InstantiationType.Delayed);",
			"",
		);
		const failures = checkMissingServicesShape(withoutKeptRegistration);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain("IAuthenticationService");
		expect(failures[0]).toContain("globalCompositeBar.js");
	});

	it("does not misfire on an IAuthenticationService registration with different formatting", () => {
		const reformatted = CLEAN_MISSING_SERVICES.replace(
			"registerSingleton(IAuthenticationService, AuthenticationService, InstantiationType.Delayed);",
			"registerSingleton(\n\tIAuthenticationService,\n\tAuthenticationService,\n\tInstantiationType.Delayed,\n);",
		);
		expect(checkMissingServicesShape(reformatted)).toEqual([]);
	});

	it("every removed token is a real, non-empty identifier and the list has no duplicates", () => {
		expect(REMOVED_MISSING_SERVICES_TOKENS.length).toBeGreaterThan(0);
		expect(new Set(REMOVED_MISSING_SERVICES_TOKENS).size).toBe(
			REMOVED_MISSING_SERVICES_TOKENS.length,
		);
		for (const token of REMOVED_MISSING_SERVICES_TOKENS) {
			expect(token).toMatch(/^I[A-Za-z]+Service$|^I[A-Za-z]+$/u);
		}
		// mcp(12) + syncEditSessions(14) + authAccount(8, excluding the kept
		// IAuthenticationService and the out-of-scope globalCompositeBar.js,
		// which is not a registered token at all) = 34.
		expect(REMOVED_MISSING_SERVICES_TOKENS.length).toBe(34);
	});

	it("matches the real, currently-installed missing-services.js with zero violations", async () => {
		const { missingServicesSource } = await realVendorSources();
		expect(checkMissingServicesShape(missingServicesSource)).toEqual([]);
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

	it("REMOVED_SERVICES_REEXPORT_TOKENS is REMOVED_MISSING_SERVICES_TOKENS plus exactly the two services.js-only names", () => {
		expect(REMOVED_SERVICES_REEXPORT_TOKENS.length).toBe(
			REMOVED_MISSING_SERVICES_TOKENS.length + 2,
		);
		for (const token of REMOVED_MISSING_SERVICES_TOKENS) {
			expect(REMOVED_SERVICES_REEXPORT_TOKENS).toContain(token);
		}
		expect(REMOVED_SERVICES_REEXPORT_TOKENS).toContain("IMcpManagementService");
		expect(REMOVED_SERVICES_REEXPORT_TOKENS).toContain(
			"IAuthenticationService",
		);
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
