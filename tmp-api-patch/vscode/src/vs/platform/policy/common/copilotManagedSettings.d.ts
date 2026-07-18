import { Event } from "../../../base/common/event.js";
import { IPolicyData } from "../../../base/common/defaultAccount.js";
import { IManagedSettingsPolicyDefinitions, ManagedSettingValue, ManagedSettingsData } from "../../../base/common/policy.js";
import { IStringDictionary } from "../../../base/common/collections.js";
import { PolicyDefinition } from "./policy.js";
import { INativeManagedSettingsService, type IFileManagedSettingsService } from "./copilotManagedSettings.service.js";
export type { ManagedSettingsData } from "../../../base/common/policy.js";
/** Windows registry root for GitHub Copilot policies. */
export declare const GITHUB_COPILOT_WIN32_REGISTRY_PATH = "SOFTWARE\\Policies\\GitHubCopilot";
/** Windows product name passed to the native policy watcher. */
export declare const GITHUB_COPILOT_WIN32_POLICY_NAME = "GitHubCopilot";
/** macOS CFPreferences application ID for GitHub Copilot managed preferences. */
export declare const GITHUB_COPILOT_MACOS_BUNDLE_ID = "com.github.copilot";
/** MDM key for the V0 managed setting. */
export declare const COPILOT_DISABLE_BYPASS_PERMISSIONS_MODE_KEY = "permissions.disableBypassPermissionsMode";
/** Managed-settings key for enterprise plugin enablement (carried as a JSON-encoded `{ [pluginId]: boolean }`). */
export declare const COPILOT_ENABLED_PLUGINS_KEY = "enabledPlugins";
/** Managed-settings key for enterprise marketplaces (carried as a JSON-encoded `{ [name]: url-or-shorthand }`). */
export declare const COPILOT_EXTRA_MARKETPLACES_KEY = "extraKnownMarketplaces";
/** Managed-settings key for the strict-marketplace allowlist (carried as a JSON-encoded array of source entries; absent = no restrictions, `[]` = lockdown). */
export declare const COPILOT_STRICT_MARKETPLACES_KEY = "strictKnownMarketplaces";
/** Managed-settings key for the default chat model (carried as a plain string: `auto`, a model family name, or a full model id). */
export declare const COPILOT_MODEL_KEY = "model";
/**
 * Enterprise OTel managed-settings keys. These are the scalar leaves of the canonical
 * `telemetry` block from the cross-client managed-settings schema (see the CLI
 * `ManagedTelemetrySettings`); they flatten to dot-path bag keys via
 * {@link normalizeManagedSettings}, so no {@link STRUCTURED_MANAGED_SETTINGS} entry is needed.
 * The `telemetry.resourceAttributes` and `telemetry.headers` map fields are structured
 * ({@link STRUCTURED_MANAGED_SETTINGS} rows carry them as JSON-encoded objects under their nested
 * keys); `telemetry.serviceName` is a scalar.
 */
/** Managed-settings key for enterprise OTel enablement. */
export declare const COPILOT_OTEL_ENABLED_KEY = "telemetry.enabled";
/** Managed-settings key for the enterprise OTLP collector endpoint. */
export declare const COPILOT_OTEL_ENDPOINT_KEY = "telemetry.endpoint";
/** Managed-settings key for the enterprise OTLP protocol (`http/json`, `http/protobuf`, or `grpc`). */
export declare const COPILOT_OTEL_PROTOCOL_KEY = "telemetry.protocol";
/** Managed-settings key for enterprise OTel content capture. */
export declare const COPILOT_OTEL_CAPTURE_CONTENT_KEY = "telemetry.captureContent";
/** Managed-settings key that prevents users from enabling OTel content capture themselves. */
export declare const COPILOT_OTEL_LOCK_CAPTURE_CONTENT_KEY = "telemetry.lockCaptureContent";
/** Managed-settings key for the OTel `service.name` resource attribute. */
export declare const COPILOT_OTEL_SERVICE_NAME_KEY = "telemetry.serviceName";
/** Managed-settings key for additional OTel resource attributes (a `{ [k]: string }` map). */
export declare const COPILOT_OTEL_RESOURCE_ATTRIBUTES_KEY = "telemetry.resourceAttributes";
/** Managed-settings key for extra OTLP exporter headers (a `{ [k]: string }` map). */
export declare const COPILOT_OTEL_HEADERS_KEY = "telemetry.headers";
/**
 * Standard pass-through `value` callback for a managed-settings-driven policy: locks the setting
 * to the managed value when the enterprise has set it, and returns `undefined` otherwise so the
 * user's own setting falls through. Use for the common case; policies that combine the managed
 * value with other conditions (e.g. `chat_preview_features_enabled`) keep a custom callback.
 *
 * The callback is memoized per key, so repeated calls for the same key return the SAME function
 * reference. That reference identity is what lets `isSamePolicyDefinition` skip needless
 * re-registration, and memoizing makes the guarantee hold regardless of where the helper is called.
 */
export declare function managedSettingValue(key: string): (policyData: IPolicyData) => ManagedSettingValue | undefined;
/**
 * `value` callback for the default-chat-model managed setting ({@link COPILOT_MODEL_KEY}). Like
 * {@link managedSettingValue} it locks the setting to the managed value and otherwise falls through
 * to the user's own value, but it additionally trims the string and treats a blank/whitespace-only
 * value as "unset" (returns `undefined`) — an admin clearing the field must not lock the setting to
 * an empty string. The model-specific normalization lives here, alongside the other managed-settings
 * handling, rather than inline at the policy declaration, so every managed-settings control is wired
 * the same way.
 *
 * Memoized (single key) so repeated calls return the SAME function reference, matching the
 * reference-identity contract {@link managedSettingValue} relies on for `isSamePolicyDefinition`.
 */
export declare function managedModelValue(): (policyData: IPolicyData) => ManagedSettingValue | undefined;
export declare class NullNativeManagedSettingsService implements INativeManagedSettingsService {
    readonly _serviceBrand: undefined;
    readonly managedSettings: ManagedSettingsData;
    readonly onDidChangeManagedSettings: Event<any>;
    updatePolicyDefinitions(): Promise<ManagedSettingsData>;
}
/**
 * Aggregate the `managedSettings` declarations of every policy definition into a single
 * key -> definition map. This is the single source of truth for which Copilot managed-settings
 * keys (and their value types) are honored, and it drives both delivery channels: the native
 * MDM watcher and the server `managed_settings` endpoint projection.
 */
export declare function collectManagedSettingsDefinitions(policyDefinitions: IStringDictionary<PolicyDefinition>): IManagedSettingsPolicyDefinitions;
/**
 * Whether any policy in `policyDefinitions` declares at least one managed-settings key. Cheap
 * existence check (short-circuits) used to decide whether the native MDM watcher is needed at all,
 * without aggregating the full {@link collectManagedSettingsDefinitions} map.
 */
export declare function hasManagedSettingsDefinitions(policyDefinitions: IStringDictionary<PolicyDefinition>): boolean;
/**
 * Project a raw managed-settings bag onto the declared schema: keep only keys declared by a
 * policy definition whose runtime value matches the declared type. Undeclared keys and
 * type-mismatched values are dropped (with an optional warning). Values are validated, never
 * coerced, so a key declared as `string` keeps its string value untouched.
 *
 * This keeps the server endpoint and native MDM delivery aligned on the same
 * declaration-driven key set and value types.
 */
export declare function projectManagedSettings(values: ManagedSettingsData, definitions: IManagedSettingsPolicyDefinitions, onWarn?: (msg: string) => void): ManagedSettingsData;
/**
 * A delivery channel that can provide managed settings. Managed settings can be delivered by more
 * than one channel, so this names the known sources to give policy evaluation and the Policy
 * Diagnostics report one shared vocabulary. Extend this union (and {@link MANAGED_SETTINGS_CHANNELS}
 * / {@link pickManagedSettings}) when adding a new channel.
 */
export type ManagedSettingsChannel = 
/** GitHub `/copilot_internal/managed_settings` endpoint (server-delivered). */
"server"
/** Native MDM: OS registry (Windows) / managed preferences (macOS) via `@vscode/policy-watcher`. */
 | "nativeMdm"
/** File on a well-known disk path (`managed-settings.json`). */
 | "file";
/**
 * The source attributed to an effective managed setting (or to the overall report). A
 * {@link ManagedSettingsChannel} once a channel has won, or `'none'` when no channel contributes.
 */
export type ManagedSettingsSource = ManagedSettingsChannel | "none";
/**
 * The delivery channels in fixed precedence order (highest first): native MDM → server-delivered →
 * file on disk. This single ordered list drives the per-key resolution in {@link pickManagedSettings}
 * and is the one place to extend when a new channel is introduced. Rationale for the order: the
 * server is harder to bypass than local MDM, and a local file is the most easily tampered with.
 */
export declare const MANAGED_SETTINGS_CHANNELS: readonly ManagedSettingsChannel[];
/** A single channel's contribution to a managed-settings key, for provenance in the resolution. */
export interface IManagedSettingsContribution {
    /** The channel that supplied this value. */
    readonly channel: ManagedSettingsChannel;
    /** The value the channel supplied for the key. */
    readonly value: ManagedSettingValue;
}
/** How a single managed-settings key was resolved across the delivery channels. */
export interface IManagedSettingResolution {
    /** The effective (winning) value applied for the key. */
    readonly value: ManagedSettingValue;
    /** The channel whose value won (always the first {@link contributions} entry's channel). */
    readonly source: ManagedSettingsChannel;
    /** Every channel that supplied this key, in precedence order (winner first, overridden after). */
    readonly contributions: readonly IManagedSettingsContribution[];
}
/** The result of merging managed settings from every delivery channel on a per-key basis. */
export interface IManagedSettingsPick {
    /** The effective merged bag: the winning value for each key contributed by any channel. */
    readonly values: ManagedSettingsData;
    /** Per-key provenance: how each key resolved and which channels were overridden. */
    readonly resolutions: ReadonlyMap<string, IManagedSettingResolution>;
    /** The channels that supplied at least one *winning* key, in precedence order. */
    readonly activeSources: readonly ManagedSettingsChannel[];
}
/**
 * Merge the managed-settings bags from every delivery channel on a **per-key** basis.
 *
 * Precedence (highest first): native MDM → server-delivered → file on disk. Unlike a single
 * authoritative source, the channels *are* merged key-by-key: for each key the highest-precedence
 * channel that supplies it wins, but a key that the higher channels never set is still filled in by
 * a lower channel. A value an admin locks via native MDM therefore cannot be overwritten by the
 * server or a file, while keys those higher channels leave unset remain available to lower ones.
 *
 * The parameter order matches the precedence so call sites read top-to-bottom. Centralizing the
 * resolution here (rather than inlining it at each call site) keeps policy evaluation
 * ({@link AccountPolicyService.getPolicyData}) and the Policy Diagnostics report from drifting apart,
 * and gives one obvious place to extend when a new channel is introduced. Empty or absent channels
 * contribute nothing.
 */
export declare function pickManagedSettings(nativeMdm: ManagedSettingsData | undefined, server: ManagedSettingsData | undefined, file: ManagedSettingsData | undefined): IManagedSettingsPick;
/** macOS well-known path for file-based managed settings. */
export declare const MANAGED_SETTINGS_MACOS_FILE_PATH = "/Library/Application Support/GitHubCopilot/managed-settings.json";
/** Linux well-known path for file-based managed settings. */
export declare const MANAGED_SETTINGS_LINUX_FILE_PATH = "/etc/github-copilot/managed-settings.json";
/** Windows directory name under %ProgramFiles% for file-based managed settings. */
export declare const MANAGED_SETTINGS_WINDOWS_DIR = "GitHubCopilot";
/** Managed settings file name. */
export declare const MANAGED_SETTINGS_FILE_NAME = "managed-settings.json";
/**
 * Normalize a parsed managed-settings object (from the server `managed_settings` API, a file on
 * disk, or any other source using the managed-settings schema) into the canonical
 * `ManagedSettingsData` bag that the policy framework consumes. This is the **single**
 * normalization path for all delivery channels, so downstream projection and policy `value()`
 * callbacks behave identically regardless of source. It does not enforce the declared
 * `managedSettings` schema — dropping undeclared or type-mismatched keys happens later, at
 * {@link projectManagedSettings}.
 *
 * - Scalar leaves (`permissions.*` and any forward-compatible scalar keys) are flattened into
 *   dot-separated keys.
 * - Structured settings (declared in {@link STRUCTURED_MANAGED_SETTINGS}) are carried as canonical
 *   JSON strings under a single key each — the same shape an admin authors via native MDM.
 *   `PolicyConfiguration` parses the JSON back into the object-typed setting on read.
 *   `extraKnownMarketplaces` is normalized from the schema's `{ [id]: { source } }` map to the
 *   `{ [name]: url-or-shorthand }` dict.
 *
 * Malformed marketplace entries are dropped (with an optional warning via {@link onWarn}) rather
 * than throwing, so a bad enterprise settings file degrades gracefully instead of blocking startup.
 */
export declare function normalizeManagedSettings(parsed: Record<string, unknown>, onWarn?: (msg: string) => void): ManagedSettingsData;
export declare class NullFileManagedSettingsService implements IFileManagedSettingsService {
    readonly _serviceBrand: undefined;
    readonly managedSettings: ManagedSettingsData;
    readonly onDidChangeManagedSettings: Event<any>;
}
