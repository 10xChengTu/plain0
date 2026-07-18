import { describe, expect, it } from "vitest";

import { EmptyLanguageStatusService } from "../../app/services/empty-language-status";

describe("empty language status boundary", () => {
	it("keeps the Workbench read path inert without registering providers", () => {
		const service = new EmptyLanguageStatusService();
		const changeEvents: unknown[] = [];
		const listener = service.onDidChange((event: void) =>
			changeEvents.push(event),
		);
		const statusRegistration = service.addStatus();

		expect(service.getLanguageStatus()).toEqual([]);
		expect(service.getLanguageStatus()).not.toBe(service.getLanguageStatus());
		expect(changeEvents).toEqual([]);
		expect(() => statusRegistration.dispose()).not.toThrow();
		listener.dispose();
	});
});
