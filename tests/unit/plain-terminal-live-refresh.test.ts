import { describe, expect, it } from "vitest";

import { TerminalLiveScrollbackRefreshController } from "../../app/features/terminal/plain-terminal-live-refresh";

describe("TerminalLiveScrollbackRefreshController", () => {
	it("starts idle", () => {
		const controller = new TerminalLiveScrollbackRefreshController();

		expect(controller.isFetching).toBe(false);
	});

	it("markDirty starts a fetch when none is in flight", () => {
		const controller = new TerminalLiveScrollbackRefreshController();

		expect(controller.markDirty()).toBe(true);
		expect(controller.isFetching).toBe(true);
	});

	it("markDirty while already fetching does not start a second fetch (merges into one follow-up)", () => {
		const controller = new TerminalLiveScrollbackRefreshController();
		controller.markDirty(); // starts the first fetch

		expect(controller.markDirty()).toBe(false);
		expect(controller.markDirty()).toBe(false);
		expect(controller.markDirty()).toBe(false);
		// Still just "fetching" — no separate queue of three follow-ups.
		expect(controller.isFetching).toBe(true);
	});

	it("fetchCompleted with no dirty arrivals returns to idle", () => {
		const controller = new TerminalLiveScrollbackRefreshController();
		controller.markDirty();

		expect(controller.fetchCompleted()).toBe(false);
		expect(controller.isFetching).toBe(false);
	});

	it("fetchCompleted after one or more dirty arrivals reports exactly one required follow-up, staying fetching", () => {
		const controller = new TerminalLiveScrollbackRefreshController();
		controller.markDirty(); // fetch #1 starts
		controller.markDirty(); // arrives during fetch #1 — merged, no new fetch
		controller.markDirty(); // arrives during fetch #1 — still merged

		expect(controller.fetchCompleted()).toBe(true); // fetch #1 done: exactly one follow-up needed
		expect(controller.isFetching).toBe(true);

		// The follow-up fetch itself must not report yet another follow-up
		// unless something new arrived during *it*.
		expect(controller.fetchCompleted()).toBe(false);
		expect(controller.isFetching).toBe(false);
	});

	it("a dirty arrival during the follow-up fetch itself queues exactly one more follow-up", () => {
		const controller = new TerminalLiveScrollbackRefreshController();
		controller.markDirty(); // fetch #1
		controller.markDirty(); // dirty during fetch #1

		expect(controller.fetchCompleted()).toBe(true); // fetch #2 (the follow-up) starts
		controller.markDirty(); // dirty during fetch #2 — merges into a third follow-up
		controller.markDirty(); // more arrivals during fetch #2 — still just one more follow-up

		expect(controller.fetchCompleted()).toBe(true); // fetch #3 starts
		expect(controller.fetchCompleted()).toBe(false); // fetch #3 caught up, no more pending
		expect(controller.isFetching).toBe(false);
	});

	it("reset returns to idle even mid-fetch, discarding any pending dirty flag", () => {
		const controller = new TerminalLiveScrollbackRefreshController();
		controller.markDirty();
		controller.markDirty(); // dirty flag set

		controller.reset();

		expect(controller.isFetching).toBe(false);
		// A late fetchCompleted() call for the fetch that was in flight before
		// reset() must not resurrect a follow-up from the discarded dirty flag.
		expect(controller.fetchCompleted()).toBe(false);
		expect(controller.isFetching).toBe(false);
	});

	it("reset while idle is a no-op", () => {
		const controller = new TerminalLiveScrollbackRefreshController();

		controller.reset();

		expect(controller.isFetching).toBe(false);
	});

	it("a fresh markDirty after returning to idle starts a brand new fetch", () => {
		const controller = new TerminalLiveScrollbackRefreshController();
		controller.markDirty();
		controller.fetchCompleted(); // back to idle

		expect(controller.markDirty()).toBe(true);
		expect(controller.isFetching).toBe(true);
	});

	it("a fresh markDirty after reset starts a brand new fetch", () => {
		const controller = new TerminalLiveScrollbackRefreshController();
		controller.markDirty();
		controller.reset();

		expect(controller.markDirty()).toBe(true);
		expect(controller.isFetching).toBe(true);
	});
});
