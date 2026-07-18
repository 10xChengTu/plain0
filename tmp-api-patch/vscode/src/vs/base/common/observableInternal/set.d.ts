import { IObservable, ITransaction } from "../observable.js";
export declare class ObservableSet<T> implements Set<T> {
    private readonly _data;
    private _obs;
    readonly observable: IObservable<Set<T>>;
    get size(): number;
    has(value: T): boolean;
    add(value: T, tx?: ITransaction): this;
    delete(value: T, tx?: ITransaction): boolean;
    clear(tx?: ITransaction): void;
    forEach(callbackfn: (value: T, value2: T, set: Set<T>) => void, thisArg?: unknown): void;
    entries(): SetIterator<[
        T,
        T
    ]>;
    keys(): SetIterator<T>;
    values(): SetIterator<T>;
    [Symbol.iterator](): SetIterator<T>;
    get [Symbol.toStringTag](): string;
}
