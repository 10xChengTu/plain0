/**
 * Pure DOM-event → `libghostty_vt::key` encoding for `PlainTerminalView`
 * (F070 "WebView DOM 渲染 + trust UX"). Deliberately DOM-free at the type
 * level — every function here takes a small structural interface a real
 * `KeyboardEvent`/`CompositionEvent` satisfies, but a plain object literal
 * satisfies just as well — so this module (and its unit tests) never touch
 * `document`/`window`, matching this repo's Node-only Vitest environment
 * (see `vitest.config.ts`: `environment: "node"`, no jsdom dependency).
 *
 * # Key discriminant mapping
 *
 * `KEY_DISCRIMINANTS` transcribes `libghostty_vt::key::Key`'s exact
 * `#[repr(u32)]` variant list (`libghostty-vt` crate v0.2.1's `src/key.rs`)
 * verbatim — every key name and discriminant value here must match that enum
 * exactly, since Rust's own `TryFrom<u32>` is the authoritative acceptance
 * check (`terminal-codec.ts`'s `frozenTerminalInputKeyRequest` only checks
 * "is an in-range u32", not "names a variant" — see that function's own doc
 * comment for why). The DOM's `KeyboardEvent.code` string (the UI Events
 * spec's physical-key identifier) matches every one of Ghostty's variant
 * names one-for-one *except* the 26 letter keys, where DOM uses a `Key`
 * prefix (`"KeyA"`) Ghostty's enum does not (`A`); `keyDiscriminantForCode`
 * strips that one prefix rather than hand-duplicating all 26 letter entries
 * under two different keys.
 *
 * # `utf8`: single-codepoint heuristic
 *
 * `libghostty_vt::key::Event::set_utf8`'s own doc comment requires "the
 * unmodified character before any Ctrl/Meta transformations" and forbids C0
 * control characters or platform function-key codes — never a named key
 * string like `"Enter"` or `"ArrowUp"`. The DOM's `KeyboardEvent.key` for
 * every *printable* character is already exactly that (browsers report the
 * base, un-Ctrl/Meta-transformed character even while Ctrl/Meta is held —
 * confirmed against `src-tauri/src/terminal/vt/tests.rs`'s
 * `ctrl_c_encodes_as_the_c0_control_byte`, which passes `utf8: "c"` alongside
 * `mods: CTRL` and gets the C0 byte back, i.e. the encoder derives the
 * control transform from `key`+`mods`, never from `utf8`'s literal
 * content), while every named/control key reports a multi-character string
 * (`"Enter"`, `"Backspace"`, `"ArrowUp"`, …). Checking "is exactly one
 * Unicode code point" (via `Array.from`, so a single non-BMP character like
 * an emoji — two UTF-16 code units but one code point — still counts)
 * therefore cleanly separates the two cases without a hand-maintained
 * exclusion list of named-key strings.
 *
 * # `metaKey` is never forwarded
 *
 * `encodeTerminalKeyEvent` returns `null` (skip — do not send, do not
 * `preventDefault`) whenever `event.metaKey` is held. Super/Cmd-modified
 * combinations are reserved, in this MVP slice, for the browser/OS's own
 * shortcuts (Cmd+C copy, Cmd+A select-all, Cmd+F find, …) rather than
 * terminal input — none of `libghostty-vt`'s legacy key encoding actually
 * needs a Super modifier for the key list this slice targets (arrows,
 * Ctrl-C, Enter, Backspace, Tab, Escape, F-keys), and *not* intercepting
 * these keeps `PlainTerminalRenderer`'s native-selection promise (see that
 * module's own doc comment) meaningful in practice — a `preventDefault`
 * on every keydown regardless of modifier would silently break Cmd+C on
 * macOS despite the DOM selection itself remaining intact.
 */

/** Structural subset of a real `KeyboardEvent` this module needs — see the
 * module doc for why this is not literally `KeyboardEvent`. */
export interface TerminalKeyEventLike {
	readonly code: string;
	readonly key: string;
	readonly repeat: boolean;
	readonly shiftKey: boolean;
	readonly ctrlKey: boolean;
	readonly altKey: boolean;
	readonly metaKey: boolean;
	/** `true` while an IME composition is in progress. Some platforms fire a
	 * `keydown` with `key: "Process"` during composition — `encodeTerminalKeyEvent`
	 * refuses to encode any event with this set, as a defensive backstop on
	 * top of the caller (`PlainTerminalView`) already being expected to skip
	 * dispatching key events while composing (see `TerminalImeController`). */
	readonly isComposing: boolean;
}

/** One direction of a key transition this module encodes — deliberately not
 * `"repeat"` as its own direction: a held-down repeat is still a `"down"`
 * transition (`event.repeat` distinguishes it — see `keyEventAction`). */
export type TerminalKeyDirection = "down" | "up";

/** `libghostty_vt::key::Action`'s exact `#[repr(u32)]` discriminants
 * (`ffi::KeyAction::{RELEASE,PRESS,REPEAT}` = 0/1/2 in `libghostty-vt-sys`
 * v0.2.1's generated bindings). */
export const TERMINAL_KEY_ACTION = Object.freeze({
	release: 0,
	press: 1,
	repeat: 2,
});

/** `libghostty_vt::key::Mods` bitmask values (`libghostty-vt-sys` v0.2.1's
 * `MODS_*` constants). Only the four base modifier bits are populated by
 * `terminalModsForEvent` — the side-distinguishing `*_SIDE` bits and the two
 * lock bits are deliberately not derived from a plain `KeyboardEvent` here
 * (no reliable, low-risk DOM signal for them in this MVP slice; a future
 * slice can add `event.getModifierState('CapsLock')`/`event.location`-based
 * side bits without changing this module's shape). */
export const TERMINAL_KEY_MODS = Object.freeze({
	shift: 0x0001,
	ctrl: 0x0002,
	alt: 0x0004,
	super: 0x0008,
});

/** `libghostty_vt::key::Key`'s exact `#[repr(u32)]` variant table — see the
 * module doc's "Key discriminant mapping" section. Keyed by Ghostty's own
 * variant name (not the DOM `code` string) so this table can be transcribed
 * directly from `key.rs` and checked against it line-for-line. */
const KEY_DISCRIMINANTS: Readonly<Record<string, number>> = Object.freeze({
	Unidentified: 0,
	Backquote: 1,
	Backslash: 2,
	BracketLeft: 3,
	BracketRight: 4,
	Comma: 5,
	Digit0: 6,
	Digit1: 7,
	Digit2: 8,
	Digit3: 9,
	Digit4: 10,
	Digit5: 11,
	Digit6: 12,
	Digit7: 13,
	Digit8: 14,
	Digit9: 15,
	Equal: 16,
	IntlBackslash: 17,
	IntlRo: 18,
	IntlYen: 19,
	A: 20,
	B: 21,
	C: 22,
	D: 23,
	E: 24,
	F: 25,
	G: 26,
	H: 27,
	I: 28,
	J: 29,
	K: 30,
	L: 31,
	M: 32,
	N: 33,
	O: 34,
	P: 35,
	Q: 36,
	R: 37,
	S: 38,
	T: 39,
	U: 40,
	V: 41,
	W: 42,
	X: 43,
	Y: 44,
	Z: 45,
	Minus: 46,
	Period: 47,
	Quote: 48,
	Semicolon: 49,
	Slash: 50,
	AltLeft: 51,
	AltRight: 52,
	Backspace: 53,
	CapsLock: 54,
	ContextMenu: 55,
	ControlLeft: 56,
	ControlRight: 57,
	Enter: 58,
	MetaLeft: 59,
	MetaRight: 60,
	ShiftLeft: 61,
	ShiftRight: 62,
	Space: 63,
	Tab: 64,
	Convert: 65,
	KanaMode: 66,
	NonConvert: 67,
	Delete: 68,
	End: 69,
	Help: 70,
	Home: 71,
	Insert: 72,
	PageDown: 73,
	PageUp: 74,
	ArrowDown: 75,
	ArrowLeft: 76,
	ArrowRight: 77,
	ArrowUp: 78,
	NumLock: 79,
	Numpad0: 80,
	Numpad1: 81,
	Numpad2: 82,
	Numpad3: 83,
	Numpad4: 84,
	Numpad5: 85,
	Numpad6: 86,
	Numpad7: 87,
	Numpad8: 88,
	Numpad9: 89,
	NumpadAdd: 90,
	NumpadBackspace: 91,
	NumpadClear: 92,
	NumpadClearEntry: 93,
	NumpadComma: 94,
	NumpadDecimal: 95,
	NumpadDivide: 96,
	NumpadEnter: 97,
	NumpadEqual: 98,
	NumpadMemoryAdd: 99,
	NumpadMemoryClear: 100,
	NumpadMemoryRecall: 101,
	NumpadMemoryStore: 102,
	NumpadMemorySubtract: 103,
	NumpadMultiply: 104,
	NumpadParenLeft: 105,
	NumpadParenRight: 106,
	NumpadSubtract: 107,
	NumpadSeparator: 108,
	NumpadUp: 109,
	NumpadDown: 110,
	NumpadRight: 111,
	NumpadLeft: 112,
	NumpadBegin: 113,
	NumpadHome: 114,
	NumpadEnd: 115,
	NumpadInsert: 116,
	NumpadDelete: 117,
	NumpadPageUp: 118,
	NumpadPageDown: 119,
	Escape: 120,
	F1: 121,
	F2: 122,
	F3: 123,
	F4: 124,
	F5: 125,
	F6: 126,
	F7: 127,
	F8: 128,
	F9: 129,
	F10: 130,
	F11: 131,
	F12: 132,
	F13: 133,
	F14: 134,
	F15: 135,
	F16: 136,
	F17: 137,
	F18: 138,
	F19: 139,
	F20: 140,
	F21: 141,
	F22: 142,
	F23: 143,
	F24: 144,
	F25: 145,
	Fn: 146,
	FnLock: 147,
	PrintScreen: 148,
	ScrollLock: 149,
	Pause: 150,
	BrowserBack: 151,
	BrowserFavorites: 152,
	BrowserForward: 153,
	BrowserHome: 154,
	BrowserRefresh: 155,
	BrowserSearch: 156,
	BrowserStop: 157,
	Eject: 158,
	LaunchApp1: 159,
	LaunchApp2: 160,
	LaunchMail: 161,
	MediaPlayPause: 162,
	MediaSelect: 163,
	MediaStop: 164,
	MediaTrackNext: 165,
	MediaTrackPrevious: 166,
	Power: 167,
	Sleep: 168,
	AudioVolumeDown: 169,
	AudioVolumeMute: 170,
	AudioVolumeUp: 171,
	WakeUp: 172,
	Copy: 173,
	Cut: 174,
	Paste: 175,
});

/** Maps a DOM `KeyboardEvent.code` to its `libghostty_vt::key::Key`
 * discriminant — `Key.Unidentified` (`0`) for anything this table (or its
 * one letter-prefix rule) does not recognize, never `undefined`, so callers
 * never need to separately branch on "unknown key" (Rust's own `TryFrom`
 * happily accepts `0` and the encoder simply produces no key-specific
 * sequence for it, falling back to whatever `utf8` carries). */
export function keyDiscriminantForCode(code: string): number {
	if (code.length === 4 && code.startsWith("Key")) {
		const letter = code.slice(3);
		const discriminant = KEY_DISCRIMINANTS[letter];
		if (discriminant !== undefined) {
			return discriminant;
		}
	}
	return KEY_DISCRIMINANTS[code] ?? KEY_DISCRIMINANTS.Unidentified!;
}

/** `libghostty_vt::key::Mods` bitmask for a key event's held modifiers. Only
 * the four base bits — see `TERMINAL_KEY_MODS`'s own doc comment. */
export function terminalModsForEvent(event: TerminalKeyEventLike): number {
	let mods = 0;
	if (event.shiftKey) {
		mods |= TERMINAL_KEY_MODS.shift;
	}
	if (event.ctrlKey) {
		mods |= TERMINAL_KEY_MODS.ctrl;
	}
	if (event.altKey) {
		mods |= TERMINAL_KEY_MODS.alt;
	}
	if (event.metaKey) {
		mods |= TERMINAL_KEY_MODS.super;
	}
	return mods;
}

/** `event.key` if (and only if) it is exactly one Unicode code point — see
 * the module doc's "`utf8`: single-codepoint heuristic" section. */
export function terminalUtf8ForEvent(
	event: TerminalKeyEventLike,
): string | null {
	const codepoints = Array.from(event.key);
	return codepoints.length === 1 ? event.key : null;
}

/** One structured key event ready for `PlainBridge.terminalInputKey`/
 * `TerminalStream.writeKey`. */
export interface TerminalKeyInput {
	readonly action: number;
	readonly key: number;
	readonly mods: number;
	readonly utf8: string | null;
}

/**
 * Encodes a DOM keyboard event into a [`TerminalKeyInput`], or `null` when
 * the event must not be forwarded at all — currently only while an IME
 * composition is in progress (`event.isComposing`; see this interface's own
 * doc comment). Callers are expected to also gate on their own
 * `TerminalImeController.active` before ever calling this (this check is a
 * defensive backstop, not the primary gate — see `PlainTerminalView`).
 */
export function encodeTerminalKeyEvent(
	event: TerminalKeyEventLike,
	direction: TerminalKeyDirection,
): TerminalKeyInput | null {
	if (event.isComposing || event.metaKey) {
		return null;
	}
	const action =
		direction === "up"
			? TERMINAL_KEY_ACTION.release
			: event.repeat
				? TERMINAL_KEY_ACTION.repeat
				: TERMINAL_KEY_ACTION.press;
	return Object.freeze({
		action,
		key: keyDiscriminantForCode(event.code),
		mods: terminalModsForEvent(event),
		utf8: terminalUtf8ForEvent(event),
	});
}

/** Structural subset of a real `CompositionEvent` this module needs. */
export interface TerminalCompositionEventLike {
	readonly data: string;
}

/**
 * IME composition state machine: while composing, intermediate
 * `compositionupdate` text must never reach the pty (a half-typed Pinyin/
 * Kana/Hangul sequence is not what the user asked to send) — only the final
 * `compositionend` text is a real commit. Mirrors the concrete
 * `compositionstart`/`compositionupdate`/`compositionend` event sequence
 * real browsers fire, one call per event.
 */
export class TerminalImeController {
	#active = false;

	/** `true` between a `compositionstart` and its matching
	 * `compositionend` — `PlainTerminalView` gates its own `keydown`/`keyup`
	 * dispatch on this (not just `encodeTerminalKeyEvent`'s own
	 * `isComposing` backstop), since some platforms do not consistently set
	 * `KeyboardEvent.isComposing` on every event during a composition. */
	get active(): boolean {
		return this.#active;
	}

	start(): void {
		this.#active = true;
	}

	/** No-op by design — see the class doc comment. Kept as an explicit
	 * method (rather than callers simply not wiring `compositionupdate` at
	 * all) so the "intermediate text is intentionally discarded" decision is
	 * visible at the call site, not just an absence. */
	update(_event: TerminalCompositionEventLike): void {
		// Intentionally discarded.
	}

	/** Ends the composition and returns the final committed text (or `""`
	 * for a composition that produced nothing, e.g. Escape-cancelled). */
	end(event: TerminalCompositionEventLike): string {
		this.#active = false;
		return event.data;
	}
}
