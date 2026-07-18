export declare function deepClone<T>(obj: T): T;
export declare function deepFreeze<T>(obj: T): T;
export declare function cloneAndChange(obj: any, changer: (orig: any) => any): any;
/**
 * Copies all properties of source into destination. The optional parameter "overwrite" allows to control
 * if existing properties on the destination should be overwritten or not. Defaults to true (overwrite).
 */
export declare function mixin(destination: any, source: any, overwrite?: boolean): any;
export declare function equals(one: any, other: any): boolean;
/**
 * Calls `JSON.Stringify` with a replacer to break apart any circular references.
 * This prevents `JSON`.stringify` from throwing the exception
 *  "Uncaught TypeError: Converting circular structure to JSON"
 */
export declare function safeStringify(obj: any): string;
/**
 * Like `JSON.stringify`, but with deterministic ordering of object keys so that
 * structurally equal inputs always produce the same string. Useful for cache
 * keys derived from arbitrary object payloads.
 *
 * - Object keys are sorted at every level of nesting.
 * - Properties whose value is `undefined` are omitted (matching `JSON.stringify`).
 * - Circular references are replaced with the string `"[Circular]"` to avoid
 *   throwing.
 * - A top-level `undefined` returns the string `'undefined'`; any other
 *   stringification failure returns the empty string.
 */
export declare function stableStringify(value: unknown): string;
type obj = {
    [key: string]: any;
};
/**
 * Returns an object that has keys for each value that is different in the base object. Keys
 * that do not exist in the target but in the base object are not considered.
 *
 * Note: This is not a deep-diffing method, so the values are strictly taken into the resulting
 * object if they differ.
 *
 * @param base the object to diff against
 * @param obj the object to use for diffing
 */
export declare function distinct(base: obj, target: obj): obj;
export declare function getCaseInsensitive(target: obj, key: string): unknown;
export declare function filter(obj: obj, predicate: (key: string, value: any) => boolean): obj;
export declare function mapValues<T extends {}, R>(obj: T, fn: (value: T[keyof T], key: string) => R): {
    [K in keyof T]: R;
};
export {};
