/**
 * Parses a simplified YAML-like input from a single string.
 * Supports objects, arrays, primitive types (string, number, boolean, null).
 * Tracks positions for error reporting and node locations.
 *
 * Limitations:
 * - No anchors or references
 * - No complex types (dates, binary)
 * - No single pair implicit entries
 *
 * @param input A string containing the YAML-like input
 * @param errors Array to collect parsing errors
 * @returns The parsed representation (YamlMapNode, YamlSequenceNode, or YamlScalarNode)
 */
export declare function parse(input: string, errors?: YamlParseError[], options?: ParseOptions): YamlNode | undefined;
/**
 * Helper to parse a Markdown with YAML frontmatter document
 * @returns
 */
export declare function parseFrontMatter(input: string, errors?: YamlParseError[], options?: ParseOptions): MarkdownNode | undefined;
export declare class MarkdownNode {
    readonly header: YamlNode | undefined;
    readonly body: string;
    constructor(header: YamlNode | undefined, body: string);
    getStringValue(name: string): string | undefined;
    getStringArrayValue(name: string): string[] | undefined;
    getBooleanValue(name: string): boolean | undefined;
}
/**
 * Parses a comma-separated list from a scalar node's value into an array of scalars.
 * Handles single-quoted and double-quoted items, trimming surrounding whitespace for
 * unquoted items. Offsets on each produced scalar node are relative to the original
 * document that the input scalar was parsed from.
 *
 * Internally wraps the scalar value in `[…]` and delegates to the full YAML parser so
 * that quoting, whitespace, and escape handling are consistent with the rest of the parser.
 *
 * @param scalar A scalar node whose value contains a comma-separated list.
 */
export declare function parseCommaSeparatedList(value: string, offset?: number): YamlScalarNode[];
export interface YamlScalarNode {
    readonly type: "scalar";
    readonly value: string;
    readonly rawValue: string;
    readonly startOffset: number;
    readonly endOffset: number;
    readonly format: "single" | "double" | "none" | "literal" | "folded";
}
export interface YamlMapNode {
    readonly type: "map";
    readonly properties: {
        key: YamlScalarNode;
        value: YamlNode;
    }[];
    readonly style: "block" | "flow";
    readonly startOffset: number;
    readonly endOffset: number;
}
export interface YamlSequenceNode {
    readonly type: "sequence";
    readonly items: YamlNode[];
    readonly style: "block" | "flow";
    readonly startOffset: number;
    readonly endOffset: number;
}
export type YamlNode = YamlSequenceNode | YamlMapNode | YamlScalarNode;
export interface YamlParseError {
    readonly message: string;
    readonly startOffset: number;
    readonly endOffset: number;
    readonly code: string;
}
export interface ParseOptions {
    readonly allowDuplicateKeys?: boolean;
}
