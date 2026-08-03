import { describe, expect, it, vi } from "vitest";

import { plainGitInvalidation } from "../../app/features/scm/plain-git-invalidation";

describe("plainGitInvalidation", () => {
	it("emits only a frozen root identity and stops after listener disposal", () => {
		const listener = vi.fn();
		const registration = plainGitInvalidation.onDidInvalidate(listener);
		plainGitInvalidation.invalidate("root-a");
		expect(listener).toHaveBeenCalledOnce();
		expect(listener).toHaveBeenCalledWith({ rootId: "root-a" });
		expect(Object.isFrozen(listener.mock.calls[0]![0])).toBe(true);
		registration.dispose();
		plainGitInvalidation.invalidate("root-b");
		expect(listener).toHaveBeenCalledOnce();
	});
});
