export declare function isUUID(value: string): boolean;
export declare const generateUuid: () => string;
/** Namespace should be 3 letters, e.g. `abc-<uuid>`. */
export declare function prefixedUuid(namespace: string): string;
