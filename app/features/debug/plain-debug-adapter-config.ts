/**
 * `F100` S1 adapter-config parsing — pure, DOM/bridge-free functions that
 * turn the raw bytes of `.plain/debug-adapters.json`/`.vscode/launch.json`
 * (already read via the existing `workspace_read_file` bridge method — see
 * the frozen research doc's "决策 1": "读取这两份配置完全复用既有的
 * `workspace_read_file` 能力,不新增任何 Rust 端文件读取代码") into validated,
 * strongly-typed descriptors. Nothing in this file ever touches the network,
 * a bridge, or spawns/connects anything — it is pure data transformation,
 * exactly like `app/features/scm/plain-git-graph-layout.ts`'s own
 * "self-contained pure function" precedent for non-DOM business logic.
 *
 * # `.plain/debug-adapters.json` is strict JSON; `.vscode/launch.json` is JSONC
 *
 * `.plain/debug-adapters.json` is a Plain-native file with no VS Code
 * compatibility expectation, so [`parseDebugAdapterRegistry`] parses it as
 * plain `JSON.parse` — no comment tolerance. `.vscode/launch.json`, by
 * contrast, is meant to be a real, possibly-hand-copied VS Code
 * configuration file, and VS Code's own tooling treats `launch.json` as JSONC
 * (`//` line comments, `/* *\/` block comments, and trailing commas before a
 * closing `}`/`]`). **This repository has no existing JSONC support on the
 * `workspace_read_file` read path to reuse** — verified empirically before
 * writing this module: `workspace_read_file` (`src-tauri/src/workspace/reader.rs`)
 * returns raw bytes with zero content-aware parsing, and a plain
 * `JSON.parse('{"a":1 // comment\n}')` throws
 * `SyntaxError: Unexpected token '/'` in this project's actual Node/V8
 * runtime (confirmed via a throwaway `node -e` invocation, not assumed). A
 * `jsonc-parser` **Rust** crate does exist as a pinned dependency
 * (`src-tauri/Cargo.toml`), but it is consumed only by `theme::manifest`/
 * `theme::theme_json`'s own native, `cap_std`-direct file-reading path for
 * unpacked theme manifests — an entirely different read path from
 * `workspace_read_file`, and not reachable from `app/` at all. So this module
 * ships its own small, dependency-free JSONC-tolerant preprocessing
 * ([`stripJsonComments`]/[`stripTrailingCommas`]) rather than assuming (or
 * silently doing without) comment support.
 *
 * # Adapter-specific launch arguments are opaque, per ADR 0003
 *
 * ADR 0003's "adapter-specific 配置透明透传" means the VS Code-compatible
 * fields a `launch.json` entry carries beyond `type`/`request`/`name`
 * (`program`/`args`/`cwd`/`env`/`stopOnEntry`/anything else a given adapter
 * defines) are not this module's concern to validate field-by-field — they
 * are carried through verbatim as [`LaunchConfiguration.launchArguments`], an
 * opaque JSON object a later slice (S2) will forward unchanged into the DAP
 * `launch`/`attach` request's own `arguments` field. This module only cares
 * about the fields it actually needs to resolve *which adapter executable*
 * to run: `type` (for a registry lookup) and the inline `plainAdapter`
 * override.
 *
 * # `preLaunchTask`/`postDebugTask` are recognized, not silently forwarded
 *
 * Per the frozen research doc's "排除项": `AGENTS.md` already excludes any
 * build-system/task-runner integration, so a `launch.json` entry naming
 * `preLaunchTask`/`postDebugTask` must be "ignored, with a clear notice — not
 * a silent failure". This module detects their presence
 * (`hasUnsupportedTaskIntegration`) and excludes them from
 * `launchArguments`; [`resolveAdapterDescriptor`] turns that into a
 * human-readable warning string rather than silently dropping the fields
 * with no trace.
 */

// ---------------------------------------------------------------------
// JSONC preprocessing — string-literal-aware, dependency-free.
// ---------------------------------------------------------------------

/**
 * Strips `//` line comments and `/* *\/` block comments, leaving everything
 * inside a JSON string literal untouched (a `"//not a comment"` string value
 * must survive intact). An unterminated block comment is treated as
 * extending to end-of-input — a deterministic, bounded outcome (the
 * subsequent `JSON.parse` will then reject the truncated result), never an
 * unbounded scan.
 */
export function stripJsonComments(text: string): string {
	let out = "";
	let index = 0;
	let inString = false;
	while (index < text.length) {
		const character = text.charAt(index);
		if (inString) {
			out += character;
			if (character === "\\" && index + 1 < text.length) {
				out += text.charAt(index + 1);
				index += 2;
				continue;
			}
			if (character === '"') {
				inString = false;
			}
			index += 1;
			continue;
		}
		if (character === '"') {
			inString = true;
			out += character;
			index += 1;
			continue;
		}
		if (character === "/" && text.charAt(index + 1) === "/") {
			index += 2;
			while (index < text.length && text.charAt(index) !== "\n") {
				index += 1;
			}
			continue;
		}
		if (character === "/" && text.charAt(index + 1) === "*") {
			index += 2;
			while (
				index < text.length &&
				!(text.charAt(index) === "*" && text.charAt(index + 1) === "/")
			) {
				if (text.charAt(index) === "\n") {
					out += "\n";
				}
				index += 1;
			}
			index += 2;
			continue;
		}
		out += character;
		index += 1;
	}
	return out;
}

/**
 * Removes a trailing comma immediately before a closing `}`/`]` (only
 * whitespace may separate them), leaving string-literal content untouched.
 * Expected to run *after* [`stripJsonComments`] — comments are assumed
 * already gone, so the only thing this needs to track is string-literal
 * state.
 */
export function stripTrailingCommas(text: string): string {
	let out = "";
	let index = 0;
	let inString = false;
	while (index < text.length) {
		const character = text.charAt(index);
		if (inString) {
			out += character;
			if (character === "\\" && index + 1 < text.length) {
				out += text.charAt(index + 1);
				index += 2;
				continue;
			}
			if (character === '"') {
				inString = false;
			}
			index += 1;
			continue;
		}
		if (character === '"') {
			inString = true;
			out += character;
			index += 1;
			continue;
		}
		if (character === ",") {
			let lookahead = index + 1;
			while (lookahead < text.length && /\s/.test(text.charAt(lookahead))) {
				lookahead += 1;
			}
			const nextMeaningful = text.charAt(lookahead);
			if (
				lookahead < text.length &&
				(nextMeaningful === "}" || nextMeaningful === "]")
			) {
				index += 1;
				continue;
			}
		}
		out += character;
		index += 1;
	}
	return out;
}

function parseJsonc(text: string): unknown {
	return JSON.parse(stripTrailingCommas(stripJsonComments(text)));
}

// ---------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------

export type AdapterTransport = "stdio" | "tcp" | "tcpSpawn";

/** The exact shape both `.plain/debug-adapters.json` registry entries and
 * `.vscode/launch.json`'s inline `plainAdapter` block resolve to — matches
 * `src-tauri/src/debug/dto.rs`'s `AdapterSpawnDescriptor`/
 * `TcpConnectDescriptor`/`AdapterTransportKind` field-for-field. `host`/`port`
 * are present if and only if `transport === "tcp"`. `port` (never `host`) is
 * present if and only if `transport === "tcpSpawn"` (`F210` S6,
 * `docs/research/2026-08-04-complete-debug.md`'s "架构裁定 §6") — spawn `command`/
 * `args` as a companion process, then connect to it on the fixed `127.0.0.1`
 * loopback address at `port`; see [`parseAdapterDescriptorFields`]'s own
 * `"tcpSpawn"` branch for why `host` is rejected outright (never merely
 * ignored) rather than accepted as a field this shape happens to carry. */
export interface AdapterDescriptor {
	readonly command: string;
	readonly args: readonly string[];
	readonly transport: AdapterTransport;
	readonly host?: string;
	readonly port?: number;
}

export interface DebugAdapterRegistryEntry {
	readonly type: string;
	readonly descriptor: AdapterDescriptor;
}

export interface LaunchConfiguration {
	readonly type: string;
	readonly request: string;
	readonly name: string;
	readonly plainAdapter?: AdapterDescriptor;
	readonly hasUnsupportedTaskIntegration: boolean;
	/** Every other field this configuration entry carried, verbatim and
	 * unvalidated (`program`/`args`/`cwd`/`env`/`stopOnEntry`/anything
	 * adapter-specific) — see the module doc's "adapter-specific launch
	 * arguments are opaque" section. */
	readonly launchArguments: Readonly<Record<string, unknown>>;
}

export type ConfigParseResult<T> =
	| Readonly<{ kind: "ok"; value: T }>
	| Readonly<{ kind: "error"; reason: string }>;

// ---------------------------------------------------------------------
// Defensive ceilings — hostile-input bounds, not expected values (mirrors
// `search-codec.ts`'s own precedent, cited by `git-codec.ts`).
// ---------------------------------------------------------------------

const MAX_ADAPTER_ARGS = 256;
const MAX_ADAPTER_STRING_LENGTH = 4_096;
const MAX_REGISTRY_ENTRIES = 256;
const MAX_LAUNCH_CONFIGURATIONS = 256;

function errorResult(
	reason: string,
): Readonly<{ kind: "error"; reason: string }> {
	return Object.freeze({ kind: "error", reason });
}

function isAbsolutePath(value: string): boolean {
	return (
		value.startsWith("/") ||
		/^[A-Za-z]:[\\/]/.test(value) ||
		value.startsWith("\\\\")
	);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates the shared `{transport, command, args, host?, port?}` shape both
 * a registry entry (after its own `type` field is stripped) and an inline
 * `plainAdapter` block use — `command` must be a non-empty absolute path
 * (per `docs/research/2026-07-28-generic-dap.md`'s "决策 1": "可执行文件绝对
 * 路径,用户自己填"), never PATH-resolved; unrecognized extra fields are
 * rejected outright (deny-unknown-fields, mirroring every Rust wire DTO in
 * this codebase) rather than silently ignored.
 */
function parseAdapterDescriptorFields(
	value: unknown,
): ConfigParseResult<AdapterDescriptor> {
	if (!isPlainRecord(value)) {
		return errorResult("adapter descriptor must be a JSON object");
	}
	const transport = value.transport;
	if (
		transport !== "stdio" &&
		transport !== "tcp" &&
		transport !== "tcpSpawn"
	) {
		return errorResult(
			'adapter descriptor "transport" must be "stdio", "tcp" or "tcpSpawn"',
		);
	}
	const command = value.command;
	if (
		typeof command !== "string" ||
		command.length === 0 ||
		command.length > MAX_ADAPTER_STRING_LENGTH ||
		!isAbsolutePath(command)
	) {
		return errorResult(
			'adapter descriptor "command" must be a non-empty absolute path',
		);
	}
	const argsRaw = value.args;
	if (!Array.isArray(argsRaw) || argsRaw.length > MAX_ADAPTER_ARGS) {
		return errorResult('adapter descriptor "args" must be an array of strings');
	}
	const args: string[] = [];
	for (const element of argsRaw) {
		if (
			typeof element !== "string" ||
			element.length > MAX_ADAPTER_STRING_LENGTH
		) {
			return errorResult('adapter descriptor "args" must contain only strings');
		}
		args.push(element);
	}

	if (transport === "tcp") {
		const host = value.host;
		const port = value.port;
		if (
			typeof host !== "string" ||
			host.length === 0 ||
			host.length > MAX_ADAPTER_STRING_LENGTH
		) {
			return errorResult(
				'a "tcp" transport adapter descriptor requires a non-empty "host" string',
			);
		}
		if (
			typeof port !== "number" ||
			!Number.isInteger(port) ||
			port < 1 ||
			port > 65_535
		) {
			return errorResult(
				'a "tcp" transport adapter descriptor requires a "port" integer between 1 and 65535',
			);
		}
		const allowedKeys = new Set([
			"transport",
			"command",
			"args",
			"host",
			"port",
		]);
		for (const key of Object.keys(value)) {
			if (!allowedKeys.has(key)) {
				return errorResult(
					`adapter descriptor has an unrecognized field "${key}"`,
				);
			}
		}
		return Object.freeze({
			kind: "ok",
			value: Object.freeze({
				command,
				args: Object.freeze(args),
				transport: "tcp",
				host,
				port,
			}),
		});
	}

	if (transport === "tcpSpawn") {
		const port = value.port;
		if (
			typeof port !== "number" ||
			!Number.isInteger(port) ||
			port < 1 ||
			port > 65_535
		) {
			return errorResult(
				'a "tcpSpawn" transport adapter descriptor requires a "port" integer between 1 and 65535',
			);
		}
		// Deliberately stricter than `"tcp"` above (which requires an
		// explicit `host`): the connect target here is always the fixed
		// `127.0.0.1` loopback address (see `AdapterDescriptor`'s own doc
		// comment), never caller-configurable, so a `host` field is rejected
		// outright rather than silently accepted-and-ignored — mirrors
		// `src-tauri/src/debug/dto.rs`'s identical `into_parts` rejection for
		// the wire-level counterpart of this same descriptor.
		const allowedKeys = new Set(["transport", "command", "args", "port"]);
		for (const key of Object.keys(value)) {
			if (!allowedKeys.has(key)) {
				return errorResult(
					`adapter descriptor has an unrecognized field "${key}"`,
				);
			}
		}
		return Object.freeze({
			kind: "ok",
			value: Object.freeze({
				command,
				args: Object.freeze(args),
				transport: "tcpSpawn",
				port,
			}),
		});
	}

	const allowedKeys = new Set(["transport", "command", "args"]);
	for (const key of Object.keys(value)) {
		if (!allowedKeys.has(key)) {
			return errorResult(
				`adapter descriptor has an unrecognized field "${key}"`,
			);
		}
	}
	return Object.freeze({
		kind: "ok",
		value: Object.freeze({
			command,
			args: Object.freeze(args),
			transport: "stdio",
		}),
	});
}

function decodeUtf8Strict(
	bytes: Uint8Array,
	label: string,
): ConfigParseResult<string> {
	try {
		return Object.freeze({
			kind: "ok",
			value: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
		});
	} catch {
		return errorResult(`${label} is not valid UTF-8`);
	}
}

// ---------------------------------------------------------------------
// `.plain/debug-adapters.json`
// ---------------------------------------------------------------------

/**
 * Parses `.plain/debug-adapters.json` — a strict (non-JSONC) JSON array of
 * `{type, transport, command, args, host?, port?}` entries. Rejects: a
 * non-array top level, a non-object entry, a missing/malformed `type`, a
 * `type` repeated by more than one entry (ambiguous — which one would
 * `resolveAdapterDescriptor` pick?), and any adapter-descriptor-field
 * violation [`parseAdapterDescriptorFields`] reports. Deliberately does
 * **not** special-case a single object with a duplicated JSON key within one
 * entry (e.g. `{"type":"a","type":"b"}`) — `JSON.parse` itself resolves that
 * deterministically (the last occurrence wins), which this module's own test
 * suite pins as an observed, intentional behavior rather than leaving it
 * ambiguous.
 */
export function parseDebugAdapterRegistry(
	bytes: Uint8Array,
): ConfigParseResult<readonly DebugAdapterRegistryEntry[]> {
	const decoded = decodeUtf8Strict(bytes, ".plain/debug-adapters.json");
	if (decoded.kind === "error") {
		return decoded;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(decoded.value);
	} catch {
		return errorResult(".plain/debug-adapters.json is not valid JSON");
	}
	if (!Array.isArray(parsed)) {
		return errorResult(".plain/debug-adapters.json must be a JSON array");
	}
	if (parsed.length > MAX_REGISTRY_ENTRIES) {
		return errorResult(".plain/debug-adapters.json has too many entries");
	}

	const entries: DebugAdapterRegistryEntry[] = [];
	const seenTypes = new Set<string>();
	for (const [index, rawEntry] of parsed.entries()) {
		if (!isPlainRecord(rawEntry)) {
			return errorResult(
				`.plain/debug-adapters.json entry ${index} must be a JSON object`,
			);
		}
		const type = rawEntry.type;
		if (
			typeof type !== "string" ||
			type.length === 0 ||
			type.length > MAX_ADAPTER_STRING_LENGTH
		) {
			return errorResult(
				`.plain/debug-adapters.json entry ${index} must have a non-empty "type" string`,
			);
		}
		const { type: _type, ...rest } = rawEntry;
		const descriptorResult = parseAdapterDescriptorFields(rest);
		if (descriptorResult.kind === "error") {
			return errorResult(
				`.plain/debug-adapters.json entry ${index} ("${type}"): ${descriptorResult.reason}`,
			);
		}
		if (seenTypes.has(type)) {
			return errorResult(
				`.plain/debug-adapters.json has more than one entry for type "${type}"`,
			);
		}
		seenTypes.add(type);
		entries.push(Object.freeze({ type, descriptor: descriptorResult.value }));
	}
	return Object.freeze({ kind: "ok", value: Object.freeze(entries) });
}

// ---------------------------------------------------------------------
// `.vscode/launch.json`
// ---------------------------------------------------------------------

const LAUNCH_CONFIGURATION_RESERVED_KEYS = Object.freeze([
	"type",
	"request",
	"name",
	"plainAdapter",
	"preLaunchTask",
	"postDebugTask",
]);

function parseLaunchConfiguration(
	value: unknown,
	index: number,
): ConfigParseResult<LaunchConfiguration> {
	if (!isPlainRecord(value)) {
		return errorResult(
			`launch.json configurations[${index}] must be a JSON object`,
		);
	}
	const type = value.type;
	if (typeof type !== "string" || type.length === 0) {
		return errorResult(
			`launch.json configurations[${index}] must have a non-empty "type" string`,
		);
	}
	const request = value.request;
	if (typeof request !== "string" || request.length === 0) {
		return errorResult(
			`launch.json configurations[${index}] must have a non-empty "request" string`,
		);
	}
	const name = value.name;
	if (typeof name !== "string" || name.length === 0) {
		return errorResult(
			`launch.json configurations[${index}] must have a non-empty "name" string`,
		);
	}

	let plainAdapter: AdapterDescriptor | undefined;
	if (value.plainAdapter !== undefined) {
		const result = parseAdapterDescriptorFields(value.plainAdapter);
		if (result.kind === "error") {
			return errorResult(
				`launch.json configurations[${index}] "plainAdapter": ${result.reason}`,
			);
		}
		plainAdapter = result.value;
	}

	const hasUnsupportedTaskIntegration =
		value.preLaunchTask !== undefined || value.postDebugTask !== undefined;

	const launchArguments: Record<string, unknown> = {};
	for (const [key, entryValue] of Object.entries(value)) {
		if (!LAUNCH_CONFIGURATION_RESERVED_KEYS.includes(key)) {
			launchArguments[key] = entryValue;
		}
	}

	return Object.freeze({
		kind: "ok",
		value: Object.freeze({
			type,
			request,
			name,
			plainAdapter,
			hasUnsupportedTaskIntegration,
			launchArguments: Object.freeze(launchArguments),
		}),
	});
}

/**
 * Parses `.vscode/launch.json` — a JSONC object with a `configurations`
 * array. See the module doc for the JSONC-tolerance rationale and the
 * `launchArguments` opaque-passthrough rationale.
 */
export function parseLaunchConfigurations(
	bytes: Uint8Array,
): ConfigParseResult<readonly LaunchConfiguration[]> {
	const decoded = decodeUtf8Strict(bytes, ".vscode/launch.json");
	if (decoded.kind === "error") {
		return decoded;
	}
	let parsed: unknown;
	try {
		parsed = parseJsonc(decoded.value);
	} catch {
		return errorResult(
			".vscode/launch.json is not valid JSON (after stripping // and /* */ comments and trailing commas)",
		);
	}
	if (!isPlainRecord(parsed)) {
		return errorResult(".vscode/launch.json must be a JSON object");
	}
	const configurationsRaw = parsed.configurations;
	if (!Array.isArray(configurationsRaw)) {
		return errorResult(
			'.vscode/launch.json must have a "configurations" array',
		);
	}
	if (configurationsRaw.length > MAX_LAUNCH_CONFIGURATIONS) {
		return errorResult(".vscode/launch.json has too many configurations");
	}

	const configurations: LaunchConfiguration[] = [];
	for (const [index, rawConfiguration] of configurationsRaw.entries()) {
		const result = parseLaunchConfiguration(rawConfiguration, index);
		if (result.kind === "error") {
			return result;
		}
		configurations.push(result.value);
	}
	return Object.freeze({ kind: "ok", value: Object.freeze(configurations) });
}

// ---------------------------------------------------------------------
// Resolution: launch configuration + registry → one concrete descriptor
// ---------------------------------------------------------------------

export const PLAIN_ADAPTERS_CONFIG_SOURCE = ".plain/debug-adapters.json";
export const LAUNCH_JSON_INLINE_CONFIG_SOURCE =
	".vscode/launch.json (inline plainAdapter override)";

export type ResolvedAdapterDescriptorResult =
	| Readonly<{
			kind: "resolved";
			descriptor: AdapterDescriptor;
			configSource: string;
			warnings: readonly string[];
	  }>
	| Readonly<{ kind: "adapter-not-found"; type: string }>;

/**
 * Resolves one already-parsed [`LaunchConfiguration`] against the parsed
 * `.plain/debug-adapters.json` registry: an inline `plainAdapter` block
 * always wins outright (never even consults the registry — matches the
 * frozen doc's "决策 1": "优先级高于按 type 查注册表"); otherwise looks up
 * `configuration.type` in `registry` by exact string match, reporting
 * `"adapter-not-found"` (acceptance criterion 4's "missing adapter" case) if
 * no entry matches.
 */
export function resolveAdapterDescriptor(
	configuration: LaunchConfiguration,
	registry: readonly DebugAdapterRegistryEntry[],
): ResolvedAdapterDescriptorResult {
	const warnings: string[] = [];
	if (configuration.hasUnsupportedTaskIntegration) {
		warnings.push(
			"preLaunchTask/postDebugTask are not supported by Plain and will be ignored.",
		);
	}
	if (configuration.plainAdapter !== undefined) {
		return Object.freeze({
			kind: "resolved",
			descriptor: configuration.plainAdapter,
			configSource: LAUNCH_JSON_INLINE_CONFIG_SOURCE,
			warnings: Object.freeze(warnings),
		});
	}
	const entry = registry.find(
		(candidate) => candidate.type === configuration.type,
	);
	if (entry === undefined) {
		return Object.freeze({
			kind: "adapter-not-found",
			type: configuration.type,
		});
	}
	return Object.freeze({
		kind: "resolved",
		descriptor: entry.descriptor,
		configSource: PLAIN_ADAPTERS_CONFIG_SOURCE,
		warnings: Object.freeze(warnings),
	});
}
