import { IObservable, ITransaction } from "../observable.js";
export declare class ObservableMap<K, V> implements Map<K, V> {
    private readonly _data;
    private readonly _obs;
    readonly observable: IObservable<Map<K, V>>;
    get size(): number;
    has(key: K): boolean;
    get(key: K): V | undefined;
    set(key: K, value: V, tx?: ITransaction): this;
    delete(key: K, tx?: ITransaction): boolean;
    clear(tx?: ITransaction): void;
    forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: unknown): void;
    entries(): MapIterator<[
        K,
        V
    ]>;
    keys(): MapIterator<K>;
    values(): MapIterator<V>;
    [Symbol.iterator](): MapIterator<[
        K,
        V
    ]>;
    get [Symbol.toStringTag](): string;
}
