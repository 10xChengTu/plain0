import { IReaderWithStore, IReader, IObservable } from "../base.js";
import { IChangeTracker } from "../changeTracker.js";
import { DisposableStore, IDisposable } from "../commonFacade/deps.js";
import { IDebugNameData } from "../debugName.js";
import { DebugLocation } from "../debugLocation.js";
/**
 * Runs immediately and whenever a transaction ends and an observed observable changed.
 * {@link fn} should start with a JS Doc using `@description` to name the autorun.
 */
export declare function autorun(fn: (reader: IReaderWithStore) => void, debugLocation?: DebugLocation): IDisposable;
/**
 * Runs immediately and whenever a transaction ends and an observed observable changed.
 * {@link fn} should start with a JS Doc using `@description` to name the autorun.
 */
export declare function autorunOpts(options: IDebugNameData & {}, fn: (reader: IReaderWithStore) => void, debugLocation?: DebugLocation): IDisposable;
/**
 * Runs immediately and whenever a transaction ends and an observed observable changed.
 * {@link fn} should start with a JS Doc using `@description` to name the autorun.
 *
 * Use `changeTracker.createChangeSummary` to create a "change summary" that can collect the changes.
 * Use `changeTracker.handleChange` to add a reported change to the change summary.
 * The run function is given the last change summary.
 * The change summary is discarded after the run function was called.
 *
 * @see autorun
 */
export declare function autorunHandleChanges<TChangeSummary>(options: IDebugNameData & {
    changeTracker: IChangeTracker<TChangeSummary>;
}, fn: (reader: IReader, changeSummary: TChangeSummary) => void, debugLocation?: DebugLocation): IDisposable;
/**
 * @see autorunHandleChanges (but with a disposable store that is cleared before the next run or on dispose)
 */
export declare function autorunWithStoreHandleChanges<TChangeSummary>(options: IDebugNameData & {
    changeTracker: IChangeTracker<TChangeSummary>;
}, fn: (reader: IReader, changeSummary: TChangeSummary, store: DisposableStore) => void): IDisposable;
/**
 * @see autorun (but with a disposable store that is cleared before the next run or on dispose)
 *
 * @deprecated Use `autorun(reader => { reader.store.add(...) })` instead!
 */
export declare function autorunWithStore(fn: (reader: IReader, store: DisposableStore) => void): IDisposable;
export declare function autorunDelta<T>(observable: IObservable<T>, handler: (args: {
    lastValue: T | undefined;
    newValue: T;
}) => void): IDisposable;
export declare function autorunIterableDelta<T>(getValue: (reader: IReader) => Iterable<T>, handler: (args: {
    addedValues: T[];
    removedValues: T[];
}) => void, getUniqueIdentifier?: (value: T) => unknown): IDisposable;
/**
 * For each key-stable item in {@link items}, runs {@link setup} once when the
 * key is first observed and disposes the per-key {@link DisposableStore} when
 * the key is no longer present in the array (or when the returned disposable
 * is disposed).
 *
 * The {@link IObservable} handed to {@link setup} fires whenever the array
 * still contains an item with the same key but the item value itself has
 * changed (e.g. because the upstream state is immutable and produced a new
 * object with the same id). All per-key value updates triggered by a single
 * change to {@link items} are batched into one transaction, so dependent
 * autoruns observe a consistent snapshot.
 *
 * Per-key state should be stored in closures or in disposables registered
 * against the per-key {@link DisposableStore}. {@link setup} should not call
 * `.read()` on the outer {@link items} observable from its body (use the
 * provided per-key value observable, or create inner autoruns).
 */
export declare function autorunPerKeyedItem<TIn, TKey>(items: IObservable<readonly TIn[]>, keyFn: (input: TIn) => TKey, setup: (key: TKey, value: IObservable<TIn>, store: DisposableStore) => void, debugLocation?: DebugLocation): IDisposable;
export interface IReaderWithDispose extends IReaderWithStore, IDisposable {
}
/**
 * An autorun with a `dispose()` method on its `reader` which cancels the autorun.
 * It it safe to call `dispose()` synchronously.
 * @deprecated Use autorunSelfDisposable2
 */
export declare function autorunSelfDisposable(fn: (reader: IReaderWithDispose) => void, debugLocation?: DebugLocation): IDisposable;
/**
 * An autorun with a `dispose()` method on its `reader` which cancels the autorun.
 * It it safe to call `dispose()` synchronously.
 * TODO@hediet/copilot: rename to delete autorunSelfDisposable, and rename autorunSelfDisposable2 to autorunSelfDisposable.
 */
export declare function registerAutorunSelfDisposable(store: DisposableStore, fn: (reader: IReaderWithDispose) => void, debugLocation?: DebugLocation): void;
