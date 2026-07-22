import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { describe, expect, it } from "vitest";

import { PlainWorkingCopyBackupService } from "../../app/services/plain-workspace-backup-service";

// Deliberately its own file, never calling `configurePlainWorkingCopyBackupBridge`:
// the module's bridge is process/module-scoped state, so this is the only
// reliable way to observe the service's behavior before it is ever configured
// without a `resetModules()` dance that would also disturb sibling tests.
describe("PlainWorkingCopyBackupService before configuration", () => {
	it("throws a clear error rather than silently resolving", async () => {
		const service = new PlainWorkingCopyBackupService();
		const identifier = {
			resource: URI.parse("plain-workspace://root/a.txt"),
			typeId: "",
		};
		await expect(service.backup(identifier)).rejects.toThrow(
			"PlainWorkingCopyBackupService was used before configurePlainWorkingCopyBackupBridge",
		);
		await expect(service.getBackups()).rejects.toThrow(
			"PlainWorkingCopyBackupService was used before configurePlainWorkingCopyBackupBridge",
		);
		expect(service.hasBackupSync(identifier)).toBe(false);
	});
});
