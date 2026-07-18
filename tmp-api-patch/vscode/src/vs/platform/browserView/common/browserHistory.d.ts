import { Event } from "../../../base/common/event.js";
import { Disposable } from "../../../base/common/lifecycle.js";
/**
 * On-disk shape of a single history entry.
 * BACKWARDS COMPATIBILE. When evolving this interface, ensure older versions can still be handled gracefully.
 */
export interface ISerializedBrowserHistoryEntry {
    readonly id: number;
    readonly url: string;
    /** Epoch ms when the entry was most recently visited. */
    readonly time: number;
    readonly title: string;
    /** Content hash key into the sibling favicons map. */
    readonly icon?: string;
    /**
     * Set when the navigation was initiated by the user (typing in the URL
     * bar, picking a suggestion, opening a new tab with a URL) rather than by
     * page script or link clicks. Always omitted when false to keep entries
     * small.
     */
    readonly explicit?: true;
}
/**
 * In-memory representation of a history entry. Currently identical to the
 * on-disk shape; the split exists so future in-memory-only fields can be
 * added here without changing the wire format.
 */
export interface IBrowserHistoryEntry extends ISerializedBrowserHistoryEntry {
}
export interface IBrowserHistoryUpdate {
    /** URL may be updated e.g. during a redirect or in-page navigation. */
    readonly url?: string;
    readonly title?: string;
    /** Favicon data URI; hashed and deduped against the sibling favicons store. Pass `null` to explicitly clear. */
    readonly favicon?: string | null;
}
/**
 * Handle returned by {@link BrowserHistoryStore.add}. `update` and `delete`
 * are no-ops once the underlying entry has been evicted.
 */
export interface IBrowserHistoryItemHandle {
    readonly id: number;
    update(patch: IBrowserHistoryUpdate): void;
    delete(): void;
}
/**
 * On-disk shape of an entries snapshot. See {@link ISerializedBrowserHistoryEntry}
 * for the backwards-compatibility rules; the same constraints apply here.
 */
export interface ISerializedBrowserHistoryEntriesSnapshot {
    readonly items: readonly ISerializedBrowserHistoryEntry[];
}
/**
 * On-disk shape of a favicons snapshot. See {@link ISerializedBrowserHistoryEntry}
 * for the backwards-compatibility rules; the same constraints apply here.
 */
export interface ISerializedBrowserFaviconsSnapshot {
    /** Map from content hash to data URI. */
    readonly map: Readonly<Record<string, string>>;
}
export declare class BrowserHistoryEntriesStore extends Disposable {
    private _nextId;
    private _items;
    private _maxEntries;
    private readonly _onDidChange;
    readonly onDidChange: Event<void>;
    constructor(maxEntries?: number);
    get items(): readonly IBrowserHistoryEntry[];
    get maxEntries(): number;
    setMaxEntries(max: number): void;
    add(url: string, title: string, faviconHash: string | undefined, userInitiated: boolean): IBrowserHistoryEntry;
    update(id: number, patch: {
        url?: string;
        title?: string;
        faviconHash?: string | null;
    }): boolean;
    delete(id: number): boolean;
    clear(): void;
    serialize(): ISerializedBrowserHistoryEntriesSnapshot;
    hydrate(snapshot: ISerializedBrowserHistoryEntriesSnapshot | undefined): void;
    private _indexOf;
    private _evictIfNeeded;
}
/**
 * Lives separately from {@link BrowserHistoryEntriesStore} so the (large)
 * favicon map is only rewritten when an image is added or removed, not on
 * every navigation.
 */
export declare class BrowserFaviconsStore extends Disposable {
    private readonly _byHash;
    private readonly _onDidChange;
    readonly onDidChange: Event<void>;
    get(hash: string): string | undefined;
    register(dataUri: string): string;
    gc(referenced: ReadonlySet<string>): void;
    clear(): void;
    serialize(): ISerializedBrowserFaviconsSnapshot;
    hydrate(snapshot: ISerializedBrowserFaviconsSnapshot | undefined): void;
}
/**
 * Per-session browser history. The two sub-stores are exposed directly so
 * persistence layers can flush them independently.
 */
export declare class BrowserHistoryStore extends Disposable {
    readonly entries: BrowserHistoryEntriesStore;
    readonly favicons: BrowserFaviconsStore;
    private readonly _onDidChange;
    readonly onDidChange: Event<void>;
    constructor(maxEntries?: number);
    add(url: string, title: string, favicon?: string, userInitiated?: boolean): IBrowserHistoryItemHandle;
    setMaxEntries(max: number): void;
    clear(): void;
    private _handleFor;
    private _gcFavicons;
}
