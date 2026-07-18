import { Event } from "../../../base/common/event.js";
import { Disposable } from "../../../base/common/lifecycle.js";
import { ThemeIcon } from "../../../base/common/themables.js";
/**
 * UI-agnostic, per-origin permission model for the integrated browser, modeled
 * on Chromium's user-friendly Site Settings categories rather than the raw
 * Electron permission strings. This module intentionally ships NO UI and no
 * Electron import so it can load in both the main process (authoritative store)
 * and the workbench renderer (read mirror hydrated from storage).
 *
 * The Electron permission string list is taken from Electron's own source
 * (`shell/common/gin_converters/content_converter.cc`), the single source of
 * truth for the strings passed to the permission handlers. Any
 * `blink::PermissionType` Electron does not explicitly name is reported as
 * `'unknown'`.
 */
/**
 * A decision a user can record for a (origin, category) pair. These are the
 * only two values ever persisted; clearing a decision removes it entirely.
 *   - 'allow' -> grant without prompting
 *   - 'deny'  -> reject without prompting
 */
export type PermissionDecision = "allow" | "deny";
/**
 * The effective state of a (origin, category) pair: either a recorded
 * {@link PermissionDecision}, or 'ask' when no decision has been recorded.
 * 'ask' is only ever a default/effective value -- it is never stored.
 */
export type PermissionState = PermissionDecision | "ask";
/**
 * User-facing permission categories. These are deliberately coarser and more
 * meaningful than Electron's raw permission strings. For example Electron's
 * single `media` permission is split into `Camera` and `Microphone`, and the
 * various clipboard permissions collapse into `Clipboard`.
 */
export declare enum PermissionCategory {
    Location = "location",
    Camera = "camera",
    Microphone = "microphone",
    Notifications = "notifications",
    Sensors = "sensors",
    Clipboard = "clipboard",
    Devices = "devices"
}
/**
 * The kinds of hardware-device chooser flows the {@link PermissionCategory.Devices}
 * category gates. Each maps to a distinct Electron device-selection event but is
 * surfaced to the user through one unified request/selection flow.
 */
export type BrowserDeviceType = "usb" | "serial" | "hid" | "bluetooth";
/**
 * A single hardware device offered to the user during a device-chooser flow.
 * Only plain, user-presentable data crosses the IPC boundary; the opaque
 * `deviceId` is echoed back verbatim to select the device.
 */
export interface IBrowserDeviceCandidate {
    /** Opaque, device-type-specific identifier echoed back to select the device. */
    readonly deviceId: string;
    /** Primary, user-facing label (e.g. product name). */
    readonly label: string;
    /** Optional secondary detail (e.g. manufacturer or vendor:product ids). */
    readonly detail?: string;
}
/**
 * Static metadata describing a category and how it maps to Electron's raw
 * permission strings. A UI can iterate {@link PERMISSION_CATEGORY_DESCRIPTORS}
 * to render a settings list directly from this data.
 */
export interface IPermissionCategoryDescriptor {
    readonly category: PermissionCategory;
    /** Short, human-readable label suitable for a settings row. */
    readonly label: string;
    /** One-line description of what granting this category enables. */
    readonly description: string;
    /** The icon to display for this category. */
    readonly icon: ThemeIcon;
    /** Electron permission strings that map to this category. */
    readonly permissions: string[];
    /** State assumed for this category when an origin has not recorded a decision. */
    readonly defaultState: PermissionState;
}
export declare const PERMISSION_CATEGORY_DESCRIPTORS: Readonly<Record<PermissionCategory, IPermissionCategoryDescriptor>>;
/**
 * Raw Electron permission strings that are granted unconditionally, with no
 * recorded state and no management control. These are low-risk capabilities
 * that Chrome itself also always grants automatically.
 */
export declare const ALWAYS_ALLOWED_PERMISSIONS: ReadonlySet<string>;
/** Whether a raw Electron permission string is granted unconditionally. */
export declare function isAlwaysAllowedPermission(permission: string): boolean;
/** All categories, in a stable display order. */
export declare const ALL_PERMISSION_CATEGORIES: readonly PermissionCategory[];
/**
 * Map a raw Electron permission string (from either handler, or a device type)
 * to the user-friendly category/categories it represents.
 *
 * Notes:
 *   - `media` resolves to `Camera`, `Microphone`, or both depending on the
 *     normalized `mediaKinds` hint extracted by the caller from Electron's
 *     details. With no hint it conservatively resolves to both, so the caller
 *     can require the strictest decision.
 *   - `unknown` (and anything unrecognized) resolves to an empty array.
 */
export declare function electronPermissionToCategories(permission: string, mediaKinds?: ReadonlyArray<"video" | "audio">): PermissionCategory[];
/**
 * Normalize a full URL down to a stable permission key.
 *
 * For URLs with a real origin (http/https/etc.) this returns the origin
 * (scheme + host + port), e.g. "https://example.com:8443". Host-less URLs such
 * as `file:` have no meaningful origin, so they key off the scheme and full
 * path instead (query and fragment removed), e.g. "file:///home/user/page.html".
 * Falls back to the trimmed raw input if it cannot be parsed.
 */
export declare function toOriginKey(url: string | undefined | null): string;
/** A single recorded grant: which origin, which category, what decision. */
export interface IPermissionGrant {
    readonly origin: string;
    readonly category: PermissionCategory;
    readonly state: PermissionDecision;
}
/**
 * A (category, decision) pair for one (implied) origin; the write API payload.
 * A `null` decision clears any recorded choice, falling back to the default.
 */
export interface IPermissionCategoryState {
    readonly category: PermissionCategory;
    readonly state: PermissionDecision | null;
}
/**
 * On-disk shape of the whole store: `{ origin: { category: decision } }`.
 */
export interface ISerializedBrowserPermissionsSnapshot {
    readonly origins: Readonly<Record<string, Partial<Record<PermissionCategory, PermissionDecision>>>>;
}
/**
 * In-memory, serializable tracker of permission state keyed by (origin,
 * category). The main process owns the authoritative instance; the workbench
 * keeps a read mirror hydrated from storage. Mutate with `set` / `setMany`,
 * observe with `onDidChange`, persist with `serialize` / `hydrate`.
 */
export declare class BrowserPermissionStore extends Disposable {
    private readonly _data;
    private readonly _onDidChange;
    readonly onDidChange: Event<void>;
    /**
     * The default state assumed for a category when an origin has recorded no decision.
     */
    defaultStateFor(category: PermissionCategory): PermissionState;
    /** Get the recorded decision for a (origin, category) pair. */
    getDecision(origin: string, category: PermissionCategory): PermissionDecision | undefined;
    /**
     * Resolve the effective boolean decision for a (origin, category) pair,
     * applying {@link defaultStateFor} when the recorded state is 'ask'.
     */
    isAllowed(origin: string, category: PermissionCategory): boolean;
    /** Set (or clear, via `null`) the decision for a (origin, category) pair. */
    set(origin: string, category: PermissionCategory, decision: PermissionDecision | null): void;
    /** Set (or clear) the decision for several categories of one origin at once. */
    setMany(origin: string, grants: Iterable<IPermissionCategoryState>): void;
    /** Remove all recorded state for an origin. */
    clearOrigin(origin: string): void;
    /** Remove all recorded state for every origin. */
    clear(): void;
    /**
     * Return the full category->state map for one origin, including categories
     * with no recorded decision. Ideal for rendering a
     * per-site settings page.
     */
    getOrigin(origin: string): Record<PermissionCategory, PermissionState>;
    /** All origins that have at least one recorded decision. */
    origins(): string[];
    /** Flat list of every recorded grant. */
    list(): IPermissionGrant[];
    serialize(): ISerializedBrowserPermissionsSnapshot;
    hydrate(snapshot: ISerializedBrowserPermissionsSnapshot | undefined): void;
}
