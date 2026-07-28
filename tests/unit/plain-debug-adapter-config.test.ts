import { describe, expect, it } from "vitest";

import {
	LAUNCH_JSON_INLINE_CONFIG_SOURCE,
	PLAIN_ADAPTERS_CONFIG_SOURCE,
	parseDebugAdapterRegistry,
	parseLaunchConfigurations,
	resolveAdapterDescriptor,
	stripJsonComments,
	stripTrailingCommas,
	type LaunchConfiguration,
} from "../../app/features/debug/plain-debug-adapter-config";

function utf8(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

// ---------------------------------------------------------------------
// JSONC preprocessing
// ---------------------------------------------------------------------

describe("stripJsonComments", () => {
	it("strips line comments but leaves string content with // intact", () => {
		const input = '{\n  "a": 1, // trailing comment\n  "b": "http://x"\n}';
		const stripped = stripJsonComments(input);
		expect(stripped).not.toContain("trailing comment");
		expect(stripped).toContain('"http://x"');
		expect(JSON.parse(stripped)).toEqual({ a: 1, b: "http://x" });
	});

	it("strips block comments spanning multiple lines", () => {
		const input = '{\n  /* this is\n     a block comment */\n  "a": 1\n}';
		const stripped = stripJsonComments(input);
		expect(stripped).not.toContain("block comment");
		expect(JSON.parse(stripped)).toEqual({ a: 1 });
	});

	it("leaves a block-comment-like sequence inside a string untouched", () => {
		const input = '{ "a": "/* not a comment */" }';
		expect(JSON.parse(stripJsonComments(input))).toEqual({
			a: "/* not a comment */",
		});
	});

	it("does not let an escaped quote inside a string end the string early", () => {
		const input = '{ "a": "she said \\"// not a comment\\"" }';
		const stripped = stripJsonComments(input);
		expect(JSON.parse(stripped)).toEqual({ a: 'she said "// not a comment"' });
	});

	it("treats an unterminated block comment as extending to end-of-input, deterministically", () => {
		const input = '{ "a": 1 /* never closes';
		// Must not hang; must produce a bounded, parseable-or-rejectable result.
		const stripped = stripJsonComments(input);
		expect(stripped).toBe('{ "a": 1 ');
		expect(() => JSON.parse(stripped)).toThrow();
	});
});

describe("stripTrailingCommas", () => {
	it("removes a trailing comma before } or ]", () => {
		expect(stripTrailingCommas('{"a":1,}')).toBe('{"a":1}');
		expect(stripTrailingCommas("[1,2,]")).toBe("[1,2]");
		expect(stripTrailingCommas('{"a":1,   \n }')).toBe('{"a":1   \n }');
	});

	it("leaves a comma that is not trailing untouched", () => {
		expect(stripTrailingCommas('{"a":1,"b":2}')).toBe('{"a":1,"b":2}');
	});

	it("leaves a comma-like sequence inside a string untouched", () => {
		expect(stripTrailingCommas('{"a":"x,}"}')).toBe('{"a":"x,}"}');
	});
});

// ---------------------------------------------------------------------
// `.plain/debug-adapters.json`
// ---------------------------------------------------------------------

describe("parseDebugAdapterRegistry", () => {
	it("parses a well-formed stdio and tcp entry", () => {
		const result = parseDebugAdapterRegistry(
			utf8(
				JSON.stringify([
					{
						type: "debugpy",
						transport: "stdio",
						command: "/usr/bin/python3",
						args: ["-m", "debugpy.adapter"],
					},
					{
						type: "lldb",
						transport: "tcp",
						command: "/usr/bin/lldb-dap",
						args: [],
						host: "127.0.0.1",
						port: 1234,
					},
				]),
			),
		);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") {
			return;
		}
		expect(result.value).toEqual([
			{
				type: "debugpy",
				descriptor: {
					command: "/usr/bin/python3",
					args: ["-m", "debugpy.adapter"],
					transport: "stdio",
				},
			},
			{
				type: "lldb",
				descriptor: {
					command: "/usr/bin/lldb-dap",
					args: [],
					transport: "tcp",
					host: "127.0.0.1",
					port: 1234,
				},
			},
		]);
	});

	it("rejects invalid UTF-8", () => {
		const invalidUtf8 = new Uint8Array([0xff, 0xfe, 0xfd]);
		const result = parseDebugAdapterRegistry(invalidUtf8);
		expect(result.kind).toBe("error");
	});

	it("rejects malformed JSON", () => {
		const result = parseDebugAdapterRegistry(utf8("{not json"));
		expect(result.kind).toBe("error");
	});

	it("rejects a non-array top level", () => {
		const result = parseDebugAdapterRegistry(utf8('{"type":"a"}'));
		expect(result.kind).toBe("error");
	});

	it("rejects a non-object entry", () => {
		const result = parseDebugAdapterRegistry(utf8('["not-an-object"]'));
		expect(result.kind).toBe("error");
	});

	it("rejects a missing type field", () => {
		const result = parseDebugAdapterRegistry(
			utf8(
				JSON.stringify([
					{ transport: "stdio", command: "/usr/bin/python3", args: [] },
				]),
			),
		);
		expect(result.kind).toBe("error");
	});

	it("rejects a relative (non-absolute) command path", () => {
		const result = parseDebugAdapterRegistry(
			utf8(
				JSON.stringify([
					{ type: "x", transport: "stdio", command: "python3", args: [] },
				]),
			),
		);
		expect(result.kind).toBe("error");
	});

	it("rejects a tcp entry missing host/port", () => {
		const result = parseDebugAdapterRegistry(
			utf8(
				JSON.stringify([
					{
						type: "x",
						transport: "tcp",
						command: "/usr/bin/x",
						args: [],
					},
				]),
			),
		);
		expect(result.kind).toBe("error");
	});

	it("rejects a port outside 1-65535", () => {
		const result = parseDebugAdapterRegistry(
			utf8(
				JSON.stringify([
					{
						type: "x",
						transport: "tcp",
						command: "/usr/bin/x",
						args: [],
						host: "127.0.0.1",
						port: 0,
					},
				]),
			),
		);
		expect(result.kind).toBe("error");
	});

	it("rejects an unrecognized extra field (deny-unknown-fields)", () => {
		const result = parseDebugAdapterRegistry(
			utf8(
				JSON.stringify([
					{
						type: "x",
						transport: "stdio",
						command: "/usr/bin/x",
						args: [],
						extra: true,
					},
				]),
			),
		);
		expect(result.kind).toBe("error");
	});

	it("rejects more than one entry for the same type", () => {
		const result = parseDebugAdapterRegistry(
			utf8(
				JSON.stringify([
					{ type: "x", transport: "stdio", command: "/usr/bin/a", args: [] },
					{ type: "x", transport: "stdio", command: "/usr/bin/b", args: [] },
				]),
			),
		);
		expect(result.kind).toBe("error");
	});

	it("resolves a duplicated JSON key within one entry deterministically (last value wins)", () => {
		// JSON.parse itself (not this module) resolves duplicate keys within a
		// single object — pinned here as an observed, intentional behavior.
		const raw =
			'[{"type":"a","type":"b","transport":"stdio","command":"/usr/bin/x","args":[]}]';
		const result = parseDebugAdapterRegistry(utf8(raw));
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") {
			return;
		}
		expect(result.value[0]?.type).toBe("b");
	});

	it("rejects a pathologically large number of entries", () => {
		const entries = Array.from({ length: 1000 }, (_, index) => ({
			type: `type-${index}`,
			transport: "stdio" as const,
			command: "/usr/bin/x",
			args: [],
		}));
		const result = parseDebugAdapterRegistry(utf8(JSON.stringify(entries)));
		expect(result.kind).toBe("error");
	});
});

// ---------------------------------------------------------------------
// `.vscode/launch.json`
// ---------------------------------------------------------------------

describe("parseLaunchConfigurations", () => {
	it("tolerates // and /* */ comments and trailing commas (JSONC)", () => {
		const raw = `{
			// a top-level comment
			"version": "0.2.0",
			"configurations": [
				{
					"type": "debugpy",
					"request": "launch",
					"name": "My Config", /* trailing */
					"program": "\${workspaceFolder}/main.py",
				},
			],
		}`;
		const result = parseLaunchConfigurations(utf8(raw));
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") {
			return;
		}
		expect(result.value).toHaveLength(1);
		expect(result.value[0]?.name).toBe("My Config");
		expect(result.value[0]?.launchArguments.program).toBe(
			"${workspaceFolder}/main.py",
		);
	});

	it("rejects malformed JSON even after JSONC stripping", () => {
		const result = parseLaunchConfigurations(utf8("{not json at all"));
		expect(result.kind).toBe("error");
	});

	it("rejects a missing configurations array", () => {
		const result = parseLaunchConfigurations(utf8('{"version":"0.2.0"}'));
		expect(result.kind).toBe("error");
	});

	it("rejects a configuration entry missing type/request/name", () => {
		expect(
			parseLaunchConfigurations(
				utf8(
					JSON.stringify({
						configurations: [{ request: "launch", name: "x" }],
					}),
				),
			).kind,
		).toBe("error");
		expect(
			parseLaunchConfigurations(
				utf8(
					JSON.stringify({
						configurations: [{ type: "debugpy", name: "x" }],
					}),
				),
			).kind,
		).toBe("error");
		expect(
			parseLaunchConfigurations(
				utf8(
					JSON.stringify({
						configurations: [{ type: "debugpy", request: "launch" }],
					}),
				),
			).kind,
		).toBe("error");
	});

	it("parses a valid inline plainAdapter override", () => {
		const result = parseLaunchConfigurations(
			utf8(
				JSON.stringify({
					configurations: [
						{
							type: "debugpy",
							request: "launch",
							name: "x",
							plainAdapter: {
								transport: "stdio",
								command: "/usr/bin/python3",
								args: ["-m", "debugpy.adapter"],
							},
						},
					],
				}),
			),
		);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") {
			return;
		}
		expect(result.value[0]?.plainAdapter).toEqual({
			command: "/usr/bin/python3",
			args: ["-m", "debugpy.adapter"],
			transport: "stdio",
		});
	});

	it("rejects an invalid inline plainAdapter override", () => {
		const result = parseLaunchConfigurations(
			utf8(
				JSON.stringify({
					configurations: [
						{
							type: "debugpy",
							request: "launch",
							name: "x",
							plainAdapter: { transport: "stdio", command: "relative" },
						},
					],
				}),
			),
		);
		expect(result.kind).toBe("error");
	});

	it("detects preLaunchTask/postDebugTask and excludes them from launchArguments", () => {
		const result = parseLaunchConfigurations(
			utf8(
				JSON.stringify({
					configurations: [
						{
							type: "debugpy",
							request: "launch",
							name: "x",
							preLaunchTask: "build",
							program: "main.py",
						},
					],
				}),
			),
		);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") {
			return;
		}
		const [configuration] = result.value;
		expect(configuration?.hasUnsupportedTaskIntegration).toBe(true);
		expect(configuration?.launchArguments).not.toHaveProperty("preLaunchTask");
		expect(configuration?.launchArguments.program).toBe("main.py");
	});

	it("reports no task integration when neither field is present", () => {
		const result = parseLaunchConfigurations(
			utf8(
				JSON.stringify({
					configurations: [{ type: "debugpy", request: "launch", name: "x" }],
				}),
			),
		);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") {
			return;
		}
		expect(result.value[0]?.hasUnsupportedTaskIntegration).toBe(false);
	});

	it("rejects a pathologically large number of configurations", () => {
		const configurations = Array.from({ length: 1000 }, (_, index) => ({
			type: "debugpy",
			request: "launch",
			name: `config-${index}`,
		}));
		const result = parseLaunchConfigurations(
			utf8(JSON.stringify({ configurations })),
		);
		expect(result.kind).toBe("error");
	});
});

// ---------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------

describe("resolveAdapterDescriptor", () => {
	function configuration(
		overrides: Partial<LaunchConfiguration> = {},
	): LaunchConfiguration {
		return {
			type: "debugpy",
			request: "launch",
			name: "x",
			hasUnsupportedTaskIntegration: false,
			launchArguments: {},
			...overrides,
		};
	}

	it("prefers an inline plainAdapter over the registry, even when the type also matches a registry entry", () => {
		const inlineDescriptor = {
			command: "/usr/bin/override",
			args: [],
			transport: "stdio" as const,
		};
		const result = resolveAdapterDescriptor(
			configuration({ plainAdapter: inlineDescriptor }),
			[
				{
					type: "debugpy",
					descriptor: {
						command: "/usr/bin/registry",
						args: [],
						transport: "stdio",
					},
				},
			],
		);
		expect(result).toEqual({
			kind: "resolved",
			descriptor: inlineDescriptor,
			configSource: LAUNCH_JSON_INLINE_CONFIG_SOURCE,
			warnings: [],
		});
	});

	it("resolves via the registry when no inline override is present", () => {
		const registryDescriptor = {
			command: "/usr/bin/registry",
			args: [],
			transport: "stdio" as const,
		};
		const result = resolveAdapterDescriptor(configuration(), [
			{ type: "debugpy", descriptor: registryDescriptor },
		]);
		expect(result).toEqual({
			kind: "resolved",
			descriptor: registryDescriptor,
			configSource: PLAIN_ADAPTERS_CONFIG_SOURCE,
			warnings: [],
		});
	});

	it("reports adapter-not-found when the type has no registry entry and no inline override", () => {
		const result = resolveAdapterDescriptor(
			configuration({ type: "missing" }),
			[],
		);
		expect(result).toEqual({ kind: "adapter-not-found", type: "missing" });
	});

	it("surfaces a warning for unsupported task integration without failing resolution", () => {
		const registryDescriptor = {
			command: "/usr/bin/registry",
			args: [],
			transport: "stdio" as const,
		};
		const result = resolveAdapterDescriptor(
			configuration({ hasUnsupportedTaskIntegration: true }),
			[{ type: "debugpy", descriptor: registryDescriptor }],
		);
		expect(result.kind).toBe("resolved");
		if (result.kind !== "resolved") {
			return;
		}
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toMatch(/preLaunchTask/);
	});
});
