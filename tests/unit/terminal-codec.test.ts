import { describe, expect, it } from "vitest";

import {
	decodeTerminalDataEvent,
	decodeTerminalExitEvent,
	decodeTerminalProfilesResult,
	decodeTerminalScrollbackResult,
	decodeTerminalStartResult,
	decodeTerminalVoid,
	decodeWorkspaceTrustState,
	frozenTerminalAckRequest,
	frozenTerminalDataEvent,
	frozenTerminalExitEvent,
	frozenTerminalFocusRequest,
	frozenTerminalInputKeyRequest,
	frozenTerminalInputTextRequest,
	frozenTerminalKillRequest,
	frozenTerminalProfilesRequest,
	frozenTerminalResizeRequest,
	frozenTerminalScrollbackRequest,
	frozenTerminalStartRequest,
} from "../../app/platform/tauri/terminal-codec";

const VALID_ID = "0d3f4b0e-6f1a-4c9d-9c3a-1a2b3c4d5e6f";

const DEFAULT_STYLE = Object.freeze({
	bold: false,
	italic: false,
	faint: false,
	blink: false,
	inverse: false,
	invisible: false,
	strikethrough: false,
	overline: false,
	underline: "none",
});

function sampleFrame(): unknown {
	return {
		dirty: "partial",
		cols: 80,
		rows: 24,
		cursor: {
			visible: true,
			blinking: false,
			viewport: { x: 2, y: 0, atWideTail: false },
			style: "block",
		},
		colors: {
			background: { r: 0, g: 0, b: 0 },
			foreground: { r: 229, g: 229, b: 229 },
			cursor: null,
		},
		rowsData: [
			{
				rowIndex: 0,
				cells: [
					{ graphemes: "h", fg: null, bg: null, style: DEFAULT_STYLE },
					{
						graphemes: "i",
						fg: { r: 0xcc, g: 0x66, b: 0x66 },
						bg: null,
						style: DEFAULT_STYLE,
					},
				],
			},
		],
	};
}

describe("terminal_start request/result codec", () => {
	it("builds a frozen own-data request from valid inputs, defaulting a missing cwd to null", () => {
		expect(
			frozenTerminalStartRequest(VALID_ID, "systemDefault", null, 80, 24),
		).toEqual({
			rootId: VALID_ID,
			profileId: "systemDefault",
			cwd: null,
			cols: 80,
			rows: 24,
		});
		expect(
			frozenTerminalStartRequest(VALID_ID, "systemDefault", undefined, 80, 24),
		).toEqual({
			rootId: VALID_ID,
			profileId: "systemDefault",
			cwd: null,
			cols: 80,
			rows: 24,
		});
		expect(
			frozenTerminalStartRequest(VALID_ID, "zsh", "nested/project", 80, 24),
		).toEqual({
			rootId: VALID_ID,
			profileId: "zsh",
			cwd: "nested/project",
			cols: 80,
			rows: 24,
		});
		expect(
			Object.isFrozen(
				frozenTerminalStartRequest(VALID_ID, "systemDefault", null, 80, 24),
			),
		).toBe(true);
	});

	it("rejects a missing, malformed, or non-v4 root id", () => {
		for (const rootId of [
			undefined,
			"not-a-root",
			"0d3f4b0e-6f1a-3c9d-9c3a-1a2b3c4d5e6f",
		]) {
			expect(() =>
				frozenTerminalStartRequest(rootId, "systemDefault", null, 80, 24),
			).toThrow();
		}
	});

	it("rejects malformed profile ids and absolute or oversized cwd values", () => {
		for (const profileId of [undefined, "", "bad/profile", "a".repeat(65)]) {
			expect(() =>
				frozenTerminalStartRequest(VALID_ID, profileId, null, 80, 24),
			).toThrow();
		}
		for (const cwd of ["", "/tmp/project", "C:\\project", "a".repeat(4097)]) {
			expect(() =>
				frozenTerminalStartRequest(VALID_ID, "systemDefault", cwd, 80, 24),
			).toThrow();
		}
	});

	it("rejects zero, negative, non-integer, or oversized dimensions", () => {
		for (const [cols, rows] of [
			[0, 24],
			[80, 0],
			[-1, 24],
			[80, 24.5],
			[2_001, 24],
			[80, 2_001],
		] as const) {
			expect(() =>
				frozenTerminalStartRequest(VALID_ID, "systemDefault", null, cols, rows),
			).toThrow();
		}
	});

	it("rejects a non-string cwd", () => {
		expect(() =>
			frozenTerminalStartRequest(VALID_ID, "systemDefault", 123, 80, 24),
		).toThrow();
	});

	it("decodes a well-formed start result and rejects a non-UUID or extra field", () => {
		expect(decodeTerminalStartResult({ sessionId: VALID_ID })).toEqual({
			sessionId: VALID_ID,
		});
		expect(() =>
			decodeTerminalStartResult({ sessionId: "not-a-uuid" }),
		).toThrow();
		expect(() =>
			decodeTerminalStartResult({ sessionId: VALID_ID, extra: true }),
		).toThrow();
		expect(() => decodeTerminalStartResult(null)).toThrow();
	});

	it("rejects a Proxy-wrapped start result", () => {
		const proxied = new Proxy(
			{ sessionId: VALID_ID },
			{ get: (target, key) => Reflect.get(target, key) },
		);
		expect(() => decodeTerminalStartResult(proxied)).toThrow();
	});
});

describe("terminal_profiles codec", () => {
	it("builds an empty frozen request and decodes a bounded unique snapshot", () => {
		const request = frozenTerminalProfilesRequest();
		expect(request).toEqual({});
		expect(Object.isFrozen(request)).toBe(true);
		const result = decodeTerminalProfilesResult({
			profiles: [
				{ id: "systemDefault", label: "zsh (System Default)" },
				{ id: "bash", label: "bash" },
			],
			defaultProfileId: "systemDefault",
		});
		expect(result.defaultProfileId).toBe("systemDefault");
		expect(result.profiles.map((profile) => profile.id)).toEqual([
			"systemDefault",
			"bash",
		]);
		expect(Object.isFrozen(result.profiles)).toBe(true);
	});

	it("rejects missing defaults, duplicate ids, invalid labels, and extra fields", () => {
		for (const value of [
			{ profiles: [], defaultProfileId: "systemDefault" },
			{
				profiles: [{ id: "bash", label: "bash" }],
				defaultProfileId: "systemDefault",
			},
			{
				profiles: [
					{ id: "bash", label: "bash" },
					{ id: "bash", label: "duplicate" },
				],
				defaultProfileId: "bash",
			},
			{
				profiles: [{ id: "bash", label: "bad\nlabel" }],
				defaultProfileId: "bash",
			},
			{
				profiles: [{ id: "bash", label: "bash" }],
				defaultProfileId: "bash",
				extra: true,
			},
		]) {
			expect(() => decodeTerminalProfilesResult(value)).toThrow();
		}
	});
});

describe("terminal_input_text request codec", () => {
	it("builds a frozen request from a valid session and text", () => {
		const request = frozenTerminalInputTextRequest(VALID_ID, "hi");
		expect(request).toEqual({ sessionId: VALID_ID, text: "hi" });
		expect(Object.isFrozen(request)).toBe(true);
	});

	it("accepts an empty string", () => {
		expect(frozenTerminalInputTextRequest(VALID_ID, "")).toEqual({
			sessionId: VALID_ID,
			text: "",
		});
	});

	it("rejects text over the 1 MiB UTF-8 byte bound", () => {
		const oversized = "a".repeat(1_024 * 1_024 + 1);
		expect(() => frozenTerminalInputTextRequest(VALID_ID, oversized)).toThrow();
	});

	it("rejects a non-string text and a malformed sessionId", () => {
		expect(() => frozenTerminalInputTextRequest(VALID_ID, 123)).toThrow();
		expect(() => frozenTerminalInputTextRequest("not-a-uuid", "hi")).toThrow();
	});
});

describe("terminal_input_key request codec", () => {
	it("builds a frozen request from valid numeric action/key/mods and optional utf8", () => {
		const request = frozenTerminalInputKeyRequest(VALID_ID, 0, 20, 0, "a");
		expect(request).toEqual({
			sessionId: VALID_ID,
			action: 0,
			key: 20,
			mods: 0,
			utf8: "a",
		});
		expect(Object.isFrozen(request)).toBe(true);
	});

	it("normalizes a missing/null utf8 to null", () => {
		expect(frozenTerminalInputKeyRequest(VALID_ID, 0, 20, 0, null)).toEqual({
			sessionId: VALID_ID,
			action: 0,
			key: 20,
			mods: 0,
			utf8: null,
		});
		expect(
			frozenTerminalInputKeyRequest(VALID_ID, 0, 20, 0, undefined),
		).toEqual({ sessionId: VALID_ID, action: 0, key: 20, mods: 0, utf8: null });
	});

	it("rejects out-of-range action/key/mods", () => {
		expect(() =>
			frozenTerminalInputKeyRequest(VALID_ID, -1, 20, 0, null),
		).toThrow();
		expect(() =>
			frozenTerminalInputKeyRequest(VALID_ID, 1.5, 20, 0, null),
		).toThrow();
		expect(() =>
			frozenTerminalInputKeyRequest(VALID_ID, 0, 0xff_ff_ff_ff + 1, 0, null),
		).toThrow();
		expect(() =>
			frozenTerminalInputKeyRequest(VALID_ID, 0, 20, 0xff_ff + 1, null),
		).toThrow();
		expect(() =>
			frozenTerminalInputKeyRequest(VALID_ID, 0, 20, -1, null),
		).toThrow();
	});

	it("rejects oversized utf8 and a non-string utf8", () => {
		expect(() =>
			frozenTerminalInputKeyRequest(VALID_ID, 0, 20, 0, "a".repeat(65)),
		).toThrow();
		expect(() =>
			frozenTerminalInputKeyRequest(VALID_ID, 0, 20, 0, 42),
		).toThrow();
	});
});

describe("terminal_focus request codec", () => {
	it("builds a frozen request and rejects a non-boolean focused", () => {
		expect(frozenTerminalFocusRequest(VALID_ID, true)).toEqual({
			sessionId: VALID_ID,
			focused: true,
		});
		expect(() => frozenTerminalFocusRequest(VALID_ID, "true")).toThrow();
	});
});

describe("terminal_resize/ack/kill request codecs", () => {
	it("builds frozen resize requests and rejects invalid dimensions", () => {
		expect(frozenTerminalResizeRequest(VALID_ID, 100, 40)).toEqual({
			sessionId: VALID_ID,
			cols: 100,
			rows: 40,
		});
		expect(() => frozenTerminalResizeRequest(VALID_ID, 0, 40)).toThrow();
	});

	it("builds frozen ack requests keyed by sequence (not byteCount) and rejects a negative/non-integer sequence", () => {
		expect(frozenTerminalAckRequest(VALID_ID, 5)).toEqual({
			sessionId: VALID_ID,
			sequence: 5,
		});
		expect(frozenTerminalAckRequest(VALID_ID, 0)).toEqual({
			sessionId: VALID_ID,
			sequence: 0,
		});
		expect(() => frozenTerminalAckRequest(VALID_ID, -1)).toThrow();
		expect(() => frozenTerminalAckRequest(VALID_ID, 1.5)).toThrow();
	});

	it("builds frozen kill requests and rejects a non-boolean immediate", () => {
		expect(frozenTerminalKillRequest(VALID_ID, true)).toEqual({
			sessionId: VALID_ID,
			immediate: true,
		});
		expect(() => frozenTerminalKillRequest(VALID_ID, "true")).toThrow();
	});
});

describe("terminal_scrollback request/result codec", () => {
	it("builds a frozen request from valid start/count", () => {
		expect(frozenTerminalScrollbackRequest(VALID_ID, 0, 100)).toEqual({
			sessionId: VALID_ID,
			start: 0,
			count: 100,
		});
	});

	it("rejects a negative start and a zero/oversized/non-integer count", () => {
		expect(() => frozenTerminalScrollbackRequest(VALID_ID, -1, 10)).toThrow();
		expect(() => frozenTerminalScrollbackRequest(VALID_ID, 0, 0)).toThrow();
		expect(() =>
			frozenTerminalScrollbackRequest(VALID_ID, 0, 10_001),
		).toThrow();
		expect(() => frozenTerminalScrollbackRequest(VALID_ID, 0, 1.5)).toThrow();
	});

	it("decodes a well-formed scrollback result", () => {
		const result = decodeTerminalScrollbackResult({
			rows: [
				{
					rowIndex: 0,
					cells: [{ graphemes: "x", style: DEFAULT_STYLE }],
				},
			],
		});
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]).toEqual({
			rowIndex: 0,
			cells: [{ graphemes: "x", style: DEFAULT_STYLE }],
		});
		expect(Object.isFrozen(result)).toBe(true);
	});

	it("decodes an empty scrollback result", () => {
		expect(decodeTerminalScrollbackResult({ rows: [] })).toEqual({
			rows: [],
		});
	});

	it("rejects extra fields, a non-array rows, and a scrollback cell missing fg/bg-free shape guarantees (no fg/bg keys allowed)", () => {
		expect(() =>
			decodeTerminalScrollbackResult({ rows: [], extra: true }),
		).toThrow();
		expect(() => decodeTerminalScrollbackResult({ rows: "x" })).toThrow();
		expect(() =>
			decodeTerminalScrollbackResult({
				rows: [
					{
						rowIndex: 0,
						cells: [{ graphemes: "x", style: DEFAULT_STYLE, fg: null }],
					},
				],
			}),
		).toThrow();
	});
});

describe("terminal_input_text/input_key/focus/resize/ack/scrollback/kill void result codec", () => {
	it("accepts JSON null and rejects anything else", () => {
		expect(decodeTerminalVoid(null)).toBeUndefined();
		expect(() => decodeTerminalVoid(undefined)).toThrow();
		expect(() => decodeTerminalVoid({})).toThrow();
	});
});

describe("plain://terminal-data event codec", () => {
	it("decodes a well-formed render-state frame field by field", () => {
		const event = decodeTerminalDataEvent({
			sessionId: VALID_ID,
			sequence: 7,
			frame: sampleFrame(),
		});
		expect(event.sessionId).toBe(VALID_ID);
		expect(event.sequence).toBe(7);
		expect(event.frame.dirty).toBe("partial");
		expect(event.frame.cols).toBe(80);
		expect(event.frame.rows).toBe(24);
		expect(event.frame.cursor).toEqual({
			visible: true,
			blinking: false,
			viewport: { x: 2, y: 0, atWideTail: false },
			style: "block",
		});
		expect(event.frame.colors.cursor).toBeNull();
		expect(event.frame.rowsData).toHaveLength(1);
		expect(event.frame.rowsData[0]!.cells).toHaveLength(2);
		expect(event.frame.rowsData[0]!.cells[0]).toEqual({
			graphemes: "h",
			fg: null,
			bg: null,
			style: DEFAULT_STYLE,
		});
		expect(event.frame.rowsData[0]!.cells[1]!.fg).toEqual({
			r: 0xcc,
			g: 0x66,
			b: 0x66,
		});
		expect(Object.isFrozen(event)).toBe(true);
		expect(Object.isFrozen(event.frame)).toBe(true);
		expect(Object.isFrozen(event.frame.rowsData)).toBe(true);
	});

	it("decodes a null cursor viewport and a frame with no dirty rows", () => {
		const frame = sampleFrame() as Record<string, unknown>;
		frame.cursor = {
			visible: false,
			blinking: false,
			viewport: null,
			style: "bar",
		};
		frame.rowsData = [];
		const event = decodeTerminalDataEvent({
			sessionId: VALID_ID,
			sequence: 0,
			frame,
		});
		expect(event.frame.cursor.viewport).toBeNull();
		expect(event.frame.rowsData).toEqual([]);
	});

	it("rejects extra/missing top-level fields, a non-UUID sessionId, and a negative/non-integer sequence", () => {
		expect(() =>
			decodeTerminalDataEvent({
				sessionId: VALID_ID,
				sequence: 0,
				frame: sampleFrame(),
				extra: true,
			}),
		).toThrow();
		expect(() =>
			decodeTerminalDataEvent({
				sessionId: "bad",
				sequence: 0,
				frame: sampleFrame(),
			}),
		).toThrow();
		expect(() =>
			decodeTerminalDataEvent({
				sessionId: VALID_ID,
				sequence: -1,
				frame: sampleFrame(),
			}),
		).toThrow();
		expect(() =>
			decodeTerminalDataEvent({
				sessionId: VALID_ID,
				sequence: 1.5,
				frame: sampleFrame(),
			}),
		).toThrow();
	});

	it("rejects an invalid dirty value and an extra field on the frame itself", () => {
		const badDirty = sampleFrame() as Record<string, unknown>;
		badDirty.dirty = "somewhat";
		expect(() =>
			decodeTerminalDataEvent({
				sessionId: VALID_ID,
				sequence: 0,
				frame: badDirty,
			}),
		).toThrow();

		const extraField = sampleFrame() as Record<string, unknown>;
		extraField.extra = true;
		expect(() =>
			decodeTerminalDataEvent({
				sessionId: VALID_ID,
				sequence: 0,
				frame: extraField,
			}),
		).toThrow();
	});

	it("rejects an invalid cursor style and a cursor viewport missing a field", () => {
		const badCursorStyle = sampleFrame() as Record<
			string,
			Record<string, unknown>
		>;
		badCursorStyle.cursor!.style = "square";
		expect(() =>
			decodeTerminalDataEvent({
				sessionId: VALID_ID,
				sequence: 0,
				frame: badCursorStyle,
			}),
		).toThrow();

		const badViewport = sampleFrame() as Record<
			string,
			Record<string, unknown>
		>;
		badViewport.cursor!.viewport = { x: 0, y: 0 };
		expect(() =>
			decodeTerminalDataEvent({
				sessionId: VALID_ID,
				sequence: 0,
				frame: badViewport,
			}),
		).toThrow();
	});

	it("rejects a colors object missing the required RGB shape", () => {
		const badColors = sampleFrame() as Record<string, Record<string, unknown>>;
		badColors.colors!.background = { r: 0, g: 0 };
		expect(() =>
			decodeTerminalDataEvent({
				sessionId: VALID_ID,
				sequence: 0,
				frame: badColors,
			}),
		).toThrow();
	});

	it("rejects an out-of-range RGB component and an invalid underline value", () => {
		const badRgb = sampleFrame() as Record<string, Record<string, unknown>>;
		badRgb.colors!.background = { r: 256, g: 0, b: 0 };
		expect(() =>
			decodeTerminalDataEvent({
				sessionId: VALID_ID,
				sequence: 0,
				frame: badRgb,
			}),
		).toThrow();

		const badUnderline = sampleFrame() as {
			rowsData: Array<{ cells: Array<{ style: Record<string, unknown> }> }>;
		};
		badUnderline.rowsData[0]!.cells[0]!.style = {
			...DEFAULT_STYLE,
			underline: "squiggly",
		};
		expect(() =>
			decodeTerminalDataEvent({
				sessionId: VALID_ID,
				sequence: 0,
				frame: badUnderline,
			}),
		).toThrow();
	});

	it("rejects a cell missing a required field and a row missing rowIndex", () => {
		const missingCellField = sampleFrame() as {
			rowsData: Array<{ cells: unknown[] }>;
		};
		missingCellField.rowsData[0]!.cells = [{ graphemes: "x" }];
		expect(() =>
			decodeTerminalDataEvent({
				sessionId: VALID_ID,
				sequence: 0,
				frame: missingCellField,
			}),
		).toThrow();

		const missingRowIndex = sampleFrame() as { rowsData: unknown[] };
		missingRowIndex.rowsData = [{ cells: [] }];
		expect(() =>
			decodeTerminalDataEvent({
				sessionId: VALID_ID,
				sequence: 0,
				frame: missingRowIndex,
			}),
		).toThrow();
	});

	it("rejects an oversized rowsData array and an oversized cells array", () => {
		const oversizedRows = sampleFrame() as { rowsData: unknown[] };
		oversizedRows.rowsData = Array.from({ length: 2_001 }, (_, index) => ({
			rowIndex: index,
			cells: [],
		}));
		expect(() =>
			decodeTerminalDataEvent({
				sessionId: VALID_ID,
				sequence: 0,
				frame: oversizedRows,
			}),
		).toThrow();

		const oversizedCells = sampleFrame() as {
			rowsData: Array<{ cells: unknown[] }>;
		};
		oversizedCells.rowsData[0]!.cells = Array.from({ length: 2_001 }, () => ({
			graphemes: "x",
			fg: null,
			bg: null,
			style: DEFAULT_STYLE,
		}));
		expect(() =>
			decodeTerminalDataEvent({
				sessionId: VALID_ID,
				sequence: 0,
				frame: oversizedCells,
			}),
		).toThrow();
	});

	it("rejects a Proxy-wrapped event payload and a Proxy-wrapped nested frame", () => {
		const proxiedEvent = new Proxy(
			{ sessionId: VALID_ID, sequence: 0, frame: sampleFrame() },
			{},
		);
		expect(() => decodeTerminalDataEvent(proxiedEvent)).toThrow();

		const proxiedFrame = new Proxy(sampleFrame() as object, {});
		expect(() =>
			decodeTerminalDataEvent({
				sessionId: VALID_ID,
				sequence: 0,
				frame: proxiedFrame,
			}),
		).toThrow();
	});
});

describe("plain://terminal-exit event codec", () => {
	it("decodes a well-formed payload and omits any signal field", () => {
		expect(
			decodeTerminalExitEvent({ sessionId: VALID_ID, exitCode: 130 }),
		).toEqual({ sessionId: VALID_ID, exitCode: 130 });
	});

	it("rejects extra/missing fields and an invalid exitCode", () => {
		expect(() =>
			decodeTerminalExitEvent({
				sessionId: VALID_ID,
				exitCode: 0,
				signal: "SIGKILL",
			}),
		).toThrow();
		expect(() => decodeTerminalExitEvent({ sessionId: VALID_ID })).toThrow();
		expect(() =>
			decodeTerminalExitEvent({ sessionId: VALID_ID, exitCode: -1 }),
		).toThrow();
	});
});

describe("frozenTerminalDataEvent/frozenTerminalExitEvent (browser mock helpers)", () => {
	it("builds a frozen data event directly from an already-shaped frame value, with no wire round trip", () => {
		const event = frozenTerminalDataEvent(VALID_ID, 3, sampleFrame());
		expect(event.sessionId).toBe(VALID_ID);
		expect(event.sequence).toBe(3);
		expect(event.frame.dirty).toBe("partial");
		expect(Object.isFrozen(event)).toBe(true);
	});

	it("rejects a hostile frame value and a non-UUID sessionId", () => {
		expect(() =>
			frozenTerminalDataEvent(VALID_ID, 0, { dirty: "bogus" }),
		).toThrow();
		expect(() => frozenTerminalDataEvent("bad", 0, sampleFrame())).toThrow();
	});

	it("builds a frozen exit event directly", () => {
		expect(frozenTerminalExitEvent(VALID_ID, 0)).toEqual({
			sessionId: VALID_ID,
			exitCode: 0,
		});
	});
});

describe("workspace_trust_state/grant response codec", () => {
	it("decodes a well-formed state and rejects extra/mistyped fields", () => {
		expect(decodeWorkspaceTrustState({ trusted: true })).toEqual({
			trusted: true,
		});
		expect(decodeWorkspaceTrustState({ trusted: false })).toEqual({
			trusted: false,
		});
		expect(() =>
			decodeWorkspaceTrustState({ trusted: true, extra: 1 }),
		).toThrow();
		expect(() => decodeWorkspaceTrustState({ trusted: "yes" })).toThrow();
	});
});
