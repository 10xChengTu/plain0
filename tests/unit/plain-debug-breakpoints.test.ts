import { describe, expect, it } from "vitest";

import { DebugBreakpointStore } from "../../app/features/debug/plain-debug-breakpoints";

describe("DebugBreakpointStore", () => {
	it("toggle adds a plain breakpoint then removes it on a second call", () => {
		const store = new DebugBreakpointStore();
		const changes: string[] = [];
		store.onDidChange((path) => changes.push(path));

		store.toggle("a.py", 5);
		expect(store.descriptorsForPath("a.py")).toEqual([
			{ line: 5, condition: null, logMessage: null },
		]);
		expect(store.pathsWithBreakpoints()).toEqual(["a.py"]);

		store.toggle("a.py", 5);
		expect(store.descriptorsForPath("a.py")).toEqual([]);
		expect(store.pathsWithBreakpoints()).toEqual([]);

		expect(changes).toEqual(["a.py", "a.py"]);
	});

	it("descriptorsForPath returns entries sorted by line regardless of insertion order", () => {
		const store = new DebugBreakpointStore();
		store.toggle("a.py", 20);
		store.toggle("a.py", 5);
		store.toggle("a.py", 10);
		expect(store.descriptorsForPath("a.py").map((entry) => entry.line)).toEqual(
			[5, 10, 20],
		);
	});

	it("remove deletes a breakpoint and its verification, and is a no-op for a line with none", () => {
		const store = new DebugBreakpointStore();
		store.toggle("a.py", 5);
		store.setVerification("a.py", [
			{ verified: true, actualLine: 5, message: null },
		]);
		let changeCount = 0;
		store.onDidChange(() => (changeCount += 1));

		store.remove("a.py", 5);
		expect(store.descriptorsForPath("a.py")).toEqual([]);
		expect(store.viewsForPath("a.py")).toEqual([]);
		expect(changeCount).toBe(1);

		store.remove("a.py", 5);
		expect(changeCount).toBe(1);
	});

	it("setCondition/setLogMessage update an existing breakpoint and no-op for a missing one", () => {
		const store = new DebugBreakpointStore();
		store.toggle("a.py", 5);

		store.setCondition("a.py", 5, "x > 1");
		store.setLogMessage("a.py", 5, "hit line 5");
		expect(store.descriptorsForPath("a.py")).toEqual([
			{ line: 5, condition: "x > 1", logMessage: "hit line 5" },
		]);

		let changeCount = 0;
		store.onDidChange(() => (changeCount += 1));
		store.setCondition("a.py", 999, "never");
		store.setLogMessage("b.py", 1, "never");
		expect(changeCount).toBe(0);
	});

	it("setDetails updates both condition and logMessage in exactly one notification", () => {
		const store = new DebugBreakpointStore();
		store.toggle("a.py", 5);

		const changes: string[] = [];
		store.onDidChange((path) => changes.push(path));
		store.setDetails("a.py", 5, "x > 1", "hit line 5");

		expect(store.descriptorsForPath("a.py")).toEqual([
			{ line: 5, condition: "x > 1", logMessage: "hit line 5" },
		]);
		expect(changes).toEqual(["a.py"]);
	});

	it("setDetails is a no-op for a line with no existing breakpoint", () => {
		const store = new DebugBreakpointStore();
		let changeCount = 0;
		store.onDidChange(() => (changeCount += 1));
		store.setDetails("a.py", 5, "x > 1", "hit line 5");
		expect(changeCount).toBe(0);
		expect(store.descriptorsForPath("a.py")).toEqual([]);
	});

	it("setVerification correlates positionally with descriptorsForPath's own order", () => {
		const store = new DebugBreakpointStore();
		store.toggle("a.py", 20);
		store.toggle("a.py", 5);

		store.setVerification("a.py", [
			{ verified: true, actualLine: 105, message: null },
			{ verified: false, actualLine: null, message: "no code on this line" },
		]);

		const views = store.viewsForPath("a.py");
		expect(views[0]).toEqual({
			line: 5,
			condition: null,
			logMessage: null,
			verification: { verified: true, actualLine: 105, message: null },
		});
		expect(views[1]).toEqual({
			line: 20,
			condition: null,
			logMessage: null,
			verification: {
				verified: false,
				actualLine: null,
				message: "no code on this line",
			},
		});
	});

	it("setVerification with the wrong length is ignored rather than misattributed", () => {
		const store = new DebugBreakpointStore();
		store.toggle("a.py", 5);
		store.toggle("a.py", 10);

		store.setVerification("a.py", [
			{ verified: true, actualLine: 5, message: null },
		]);

		for (const view of store.viewsForPath("a.py")) {
			expect(view.verification).toBeNull();
		}
	});

	it("viewsForPath reports null verification until one has actually been recorded", () => {
		const store = new DebugBreakpointStore();
		store.toggle("a.py", 5);
		expect(store.viewsForPath("a.py")).toEqual([
			{ line: 5, condition: null, logMessage: null, verification: null },
		]);
	});

	it("clearVerification only clears the named path's verification, not its breakpoints", () => {
		const store = new DebugBreakpointStore();
		store.toggle("a.py", 5);
		store.toggle("b.py", 7);
		store.setVerification("a.py", [
			{ verified: true, actualLine: 5, message: null },
		]);
		store.setVerification("b.py", [
			{ verified: true, actualLine: 7, message: null },
		]);

		store.clearVerification("a.py");
		expect(store.viewsForPath("a.py")[0]?.verification).toBeNull();
		expect(store.viewsForPath("b.py")[0]?.verification).not.toBeNull();
		expect(store.descriptorsForPath("a.py")).toHaveLength(1);
	});

	it("clearAllVerification clears every path's verification and notifies once per affected path", () => {
		const store = new DebugBreakpointStore();
		store.toggle("a.py", 5);
		store.toggle("b.py", 7);
		store.setVerification("a.py", [
			{ verified: true, actualLine: 5, message: null },
		]);
		store.setVerification("b.py", [
			{ verified: true, actualLine: 7, message: null },
		]);

		const changed: string[] = [];
		store.onDidChange((path) => changed.push(path));
		store.clearAllVerification();

		expect(store.viewsForPath("a.py")[0]?.verification).toBeNull();
		expect(store.viewsForPath("b.py")[0]?.verification).toBeNull();
		expect(new Set(changed)).toEqual(new Set(["a.py", "b.py"]));
	});

	it("pathsWithBreakpoints omits a path whose only breakpoint was removed", () => {
		const store = new DebugBreakpointStore();
		store.toggle("a.py", 5);
		store.toggle("a.py", 5);
		expect(store.pathsWithBreakpoints()).toEqual([]);
	});
});
