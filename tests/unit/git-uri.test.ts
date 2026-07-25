import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { describe, expect, it } from "vitest";

import {
	decodeGitResourceUri,
	encodeGitResourceUri,
	GIT_URI_SCHEME,
} from "../../app/features/scm/git-uri";

describe("git-uri", () => {
	it("round-trips a HEAD revision through encode/decode", () => {
		const uri = encodeGitResourceUri("head", "src/main.rs");
		expect(uri.scheme).toBe(GIT_URI_SCHEME);
		expect(decodeGitResourceUri(uri)).toEqual({
			rev: "head",
			path: "src/main.rs",
		});
	});

	it("round-trips an index revision", () => {
		const uri = encodeGitResourceUri("index", "a b/c.txt");
		expect(decodeGitResourceUri(uri)).toEqual({
			rev: "index",
			path: "a b/c.txt",
		});
	});

	it("round-trips a path containing characters that would be ambiguous as a bare URI path segment", () => {
		const path = 'weird/-leading-dash/emoji-😀/quote".txt';
		const uri = encodeGitResourceUri("head", path);
		expect(decodeGitResourceUri(uri)).toEqual({ rev: "head", path });
	});

	it("returns undefined for a non-git scheme", () => {
		const uri = URI.from({ scheme: "file", path: "/a.txt" });
		expect(decodeGitResourceUri(uri)).toBeUndefined();
	});

	it("returns undefined for a git: URI whose query is not the exact encoded shape", () => {
		expect(
			decodeGitResourceUri(URI.from({ scheme: GIT_URI_SCHEME, path: "/x" })),
		).toBeUndefined();
		expect(
			decodeGitResourceUri(
				URI.from({ scheme: GIT_URI_SCHEME, path: "/x", query: "not json" }),
			),
		).toBeUndefined();
		expect(
			decodeGitResourceUri(
				URI.from({
					scheme: GIT_URI_SCHEME,
					path: "/x",
					query: JSON.stringify({ rev: "worktree", path: "x" }),
				}),
			),
		).toBeUndefined();
		expect(
			decodeGitResourceUri(
				URI.from({
					scheme: GIT_URI_SCHEME,
					path: "/x",
					query: JSON.stringify({ rev: "head", path: "" }),
				}),
			),
		).toBeUndefined();
		expect(
			decodeGitResourceUri(
				URI.from({
					scheme: GIT_URI_SCHEME,
					path: "/x",
					query: JSON.stringify(["head", "x"]),
				}),
			),
		).toBeUndefined();
	});
});
