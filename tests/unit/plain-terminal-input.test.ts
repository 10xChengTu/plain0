import { describe, expect, it } from "vitest";

import {
	encodeTerminalKeyEvent,
	keyDiscriminantForCode,
	TerminalImeController,
	TERMINAL_KEY_ACTION,
	TERMINAL_KEY_MODS,
	terminalModsForEvent,
	terminalUtf8ForEvent,
	type TerminalKeyEventLike,
} from "../../app/features/terminal/plain-terminal-input";

function keyEvent(
	overrides: Partial<TerminalKeyEventLike> = {},
): TerminalKeyEventLike {
	return {
		code: "KeyA",
		key: "a",
		repeat: false,
		shiftKey: false,
		ctrlKey: false,
		altKey: false,
		metaKey: false,
		isComposing: false,
		...overrides,
	};
}

describe("keyDiscriminantForCode", () => {
	it("strips the DOM 'Key' prefix for letter codes", () => {
		expect(keyDiscriminantForCode("KeyA")).toBe(20);
		expect(keyDiscriminantForCode("KeyZ")).toBe(45);
	});

	it("matches non-letter codes verbatim against the Ghostty Key enum", () => {
		expect(keyDiscriminantForCode("Digit0")).toBe(6);
		expect(keyDiscriminantForCode("ArrowUp")).toBe(78);
		expect(keyDiscriminantForCode("ArrowDown")).toBe(75);
		expect(keyDiscriminantForCode("ArrowLeft")).toBe(76);
		expect(keyDiscriminantForCode("ArrowRight")).toBe(77);
		expect(keyDiscriminantForCode("Enter")).toBe(58);
		expect(keyDiscriminantForCode("Backspace")).toBe(53);
		expect(keyDiscriminantForCode("Tab")).toBe(64);
		expect(keyDiscriminantForCode("Escape")).toBe(120);
		expect(keyDiscriminantForCode("F1")).toBe(121);
		expect(keyDiscriminantForCode("ControlLeft")).toBe(56);
	});

	it("falls back to Unidentified (0) for an unrecognized code", () => {
		expect(keyDiscriminantForCode("SomeFutureKey")).toBe(0);
		expect(keyDiscriminantForCode("")).toBe(0);
	});
});

describe("terminalModsForEvent", () => {
	it("is zero when no modifier is held", () => {
		expect(terminalModsForEvent(keyEvent())).toBe(0);
	});

	it("combines every held modifier's bit", () => {
		const mods = terminalModsForEvent(
			keyEvent({ shiftKey: true, ctrlKey: true, altKey: true, metaKey: true }),
		);
		expect(mods).toBe(
			TERMINAL_KEY_MODS.shift |
				TERMINAL_KEY_MODS.ctrl |
				TERMINAL_KEY_MODS.alt |
				TERMINAL_KEY_MODS.super,
		);
	});

	it("sets only the ctrl bit for a plain Ctrl combo", () => {
		expect(terminalModsForEvent(keyEvent({ ctrlKey: true }))).toBe(
			TERMINAL_KEY_MODS.ctrl,
		);
	});
});

describe("terminalUtf8ForEvent", () => {
	it("returns the character for a single-codepoint key", () => {
		expect(terminalUtf8ForEvent(keyEvent({ key: "a" }))).toBe("a");
		expect(terminalUtf8ForEvent(keyEvent({ key: "!" }))).toBe("!");
		expect(terminalUtf8ForEvent(keyEvent({ key: " " }))).toBe(" ");
	});

	it("returns the character for a single non-BMP codepoint (surrogate pair)", () => {
		expect(terminalUtf8ForEvent(keyEvent({ key: "😀" }))).toBe("😀");
	});

	it("returns null for a named/control key", () => {
		expect(terminalUtf8ForEvent(keyEvent({ key: "Enter" }))).toBeNull();
		expect(terminalUtf8ForEvent(keyEvent({ key: "ArrowUp" }))).toBeNull();
		expect(terminalUtf8ForEvent(keyEvent({ key: "Backspace" }))).toBeNull();
		expect(terminalUtf8ForEvent(keyEvent({ key: "Shift" }))).toBeNull();
	});
});

describe("encodeTerminalKeyEvent", () => {
	it("encodes a plain character press with its own utf8 text", () => {
		const encoded = encodeTerminalKeyEvent(
			keyEvent({ code: "KeyA", key: "a" }),
			"down",
		);
		expect(encoded).toEqual({
			action: TERMINAL_KEY_ACTION.press,
			key: 20,
			mods: 0,
			utf8: "a",
		});
	});

	it("encodes Ctrl-C with the ctrl mods bit and the base (unmodified) letter as utf8", () => {
		const encoded = encodeTerminalKeyEvent(
			keyEvent({ code: "KeyC", key: "c", ctrlKey: true }),
			"down",
		);
		expect(encoded).toEqual({
			action: TERMINAL_KEY_ACTION.press,
			key: 22,
			mods: TERMINAL_KEY_MODS.ctrl,
			utf8: "c",
		});
	});

	it("encodes a repeat as the repeat action, not press", () => {
		const encoded = encodeTerminalKeyEvent(
			keyEvent({ code: "KeyA", key: "a", repeat: true }),
			"down",
		);
		expect(encoded?.action).toBe(TERMINAL_KEY_ACTION.repeat);
	});

	it("encodes a keyup as the release action", () => {
		const encoded = encodeTerminalKeyEvent(
			keyEvent({ code: "KeyA", key: "a" }),
			"up",
		);
		expect(encoded?.action).toBe(TERMINAL_KEY_ACTION.release);
	});

	it("encodes Enter/Backspace/Tab/Escape/arrows/F-keys with null utf8", () => {
		for (const [code, key] of [
			["Enter", "Enter"],
			["Backspace", "Backspace"],
			["Tab", "Tab"],
			["Escape", "Escape"],
			["ArrowUp", "ArrowUp"],
			["F5", "F5"],
		] as const) {
			const encoded = encodeTerminalKeyEvent(keyEvent({ code, key }), "down");
			expect(encoded?.utf8).toBeNull();
			expect(encoded?.key).toBe(keyDiscriminantForCode(code));
		}
	});

	it("returns null (do not forward) while composing", () => {
		expect(
			encodeTerminalKeyEvent(keyEvent({ isComposing: true }), "down"),
		).toBeNull();
	});

	it("returns null (do not forward) whenever metaKey is held", () => {
		expect(
			encodeTerminalKeyEvent(keyEvent({ metaKey: true, key: "c" }), "down"),
		).toBeNull();
	});
});

describe("TerminalImeController", () => {
	it("is inactive before compositionstart", () => {
		const ime = new TerminalImeController();
		expect(ime.active).toBe(false);
	});

	it("becomes active on start and inactive again after end", () => {
		const ime = new TerminalImeController();
		ime.start();
		expect(ime.active).toBe(true);
		const text = ime.end({ data: "你好" });
		expect(ime.active).toBe(false);
		expect(text).toBe("你好");
	});

	it("discards intermediate compositionupdate text — it never affects the final commit", () => {
		const ime = new TerminalImeController();
		ime.start();
		ime.update({ data: "n" });
		ime.update({ data: "ni" });
		ime.update({ data: "nihao" });
		const text = ime.end({ data: "你好" });
		expect(text).toBe("你好");
	});

	it("returns an empty string for a composition that produced nothing", () => {
		const ime = new TerminalImeController();
		ime.start();
		expect(ime.end({ data: "" })).toBe("");
	});
});
