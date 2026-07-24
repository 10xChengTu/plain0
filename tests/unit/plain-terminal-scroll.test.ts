import { describe, expect, it } from "vitest";

import { TerminalScrollController } from "../../app/features/terminal/plain-terminal-scroll";

describe("TerminalScrollController", () => {
	it("starts live and is unaffected by non-positive scroll amounts", () => {
		const controller = new TerminalScrollController();

		expect(controller.position).toEqual({ kind: "live" });
		expect(controller.isFollowingLive).toBe(true);

		expect(controller.scrollUp(0)).toEqual({ kind: "live" });
		expect(controller.scrollUp(-3)).toEqual({ kind: "live" });
		expect(controller.scrollDown(5)).toEqual({ kind: "live" });
		expect(controller.position).toEqual({ kind: "live" });
	});

	it("scrolling up from live enters history at the requested offset", () => {
		const controller = new TerminalScrollController();

		const position = controller.scrollUp(3);

		expect(position).toEqual({ kind: "history", offset: 3 });
		expect(controller.isFollowingLive).toBe(false);
	});

	it("accumulates offset across repeated scroll-up calls", () => {
		const controller = new TerminalScrollController();

		controller.scrollUp(3);
		controller.scrollUp(4);
		const position = controller.scrollUp(2);

		expect(position).toEqual({ kind: "history", offset: 9 });
	});

	it("scrolling down decrements offset without crossing the live boundary", () => {
		const controller = new TerminalScrollController();
		controller.scrollUp(10);

		const position = controller.scrollDown(4);

		expect(position).toEqual({ kind: "history", offset: 6 });
	});

	it("scrolling down past the live boundary returns exactly to live", () => {
		const controller = new TerminalScrollController();
		controller.scrollUp(5);

		expect(controller.scrollDown(5)).toEqual({ kind: "live" });
	});

	it("scrolling down further than the current offset still lands exactly on live, never negative", () => {
		const controller = new TerminalScrollController();
		controller.scrollUp(5);

		expect(controller.scrollDown(50)).toEqual({ kind: "live" });
		expect(controller.isFollowingLive).toBe(true);
	});

	it("scrolling down while already live is a no-op", () => {
		const controller = new TerminalScrollController();

		expect(controller.scrollDown(3)).toEqual({ kind: "live" });
	});

	it("scrollToBottom returns to live from any history offset", () => {
		const controller = new TerminalScrollController();
		controller.scrollUp(20);

		controller.scrollToBottom();

		expect(controller.position).toEqual({ kind: "live" });
	});

	it("scrollToBottom is a no-op when already live", () => {
		const controller = new TerminalScrollController();

		controller.scrollToBottom();

		expect(controller.position).toEqual({ kind: "live" });
	});

	it("clampOffset is a no-op while live", () => {
		const controller = new TerminalScrollController();

		expect(controller.clampOffset(5)).toEqual({ kind: "live" });
	});

	it("clampOffset is a no-op when the current offset is already within bounds", () => {
		const controller = new TerminalScrollController();
		controller.scrollUp(3);

		expect(controller.clampOffset(10)).toEqual({ kind: "history", offset: 3 });
	});

	it("clampOffset reduces an over-large offset down to the given bound", () => {
		const controller = new TerminalScrollController();
		controller.scrollUp(100);

		expect(controller.clampOffset(12)).toEqual({
			kind: "history",
			offset: 12,
		});
		expect(controller.position).toEqual({ kind: "history", offset: 12 });
	});

	it("clampOffset to zero (or below) returns to live", () => {
		const controllerZero = new TerminalScrollController();
		controllerZero.scrollUp(10);
		expect(controllerZero.clampOffset(0)).toEqual({ kind: "live" });

		const controllerNegative = new TerminalScrollController();
		controllerNegative.scrollUp(10);
		expect(controllerNegative.clampOffset(-1)).toEqual({ kind: "live" });
	});

	it("scrolling up again after a clamp continues from the clamped offset", () => {
		const controller = new TerminalScrollController();
		controller.scrollUp(100);
		controller.clampOffset(10);

		expect(controller.scrollUp(2)).toEqual({ kind: "history", offset: 12 });
	});
});
