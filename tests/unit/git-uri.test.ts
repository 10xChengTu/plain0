import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { describe, expect, it } from "vitest";

import {
	decodeGitResourceUri,
	encodeGitResourceUri,
	GIT_URI_SCHEME,
} from "../../app/features/scm/git-uri";

const ROOT_A = "11111111-1111-4111-8111-111111111111";
const ROOT_B = "22222222-2222-4222-8222-222222222222";

describe("git-uri", () => {
	it("round-trips a HEAD revision through encode/decode", () => {
		const uri = encodeGitResourceUri(ROOT_A, "head", "src/main.rs");
		expect(uri.scheme).toBe(GIT_URI_SCHEME);
		expect(uri.authority).toBe(ROOT_A);
		expect(decodeGitResourceUri(uri)).toEqual({
			rootId: ROOT_A,
			rev: "head",
			path: "src/main.rs",
		});
	});

	it("round-trips an index revision", () => {
		const uri = encodeGitResourceUri(ROOT_A, "index", "a b/c.txt");
		expect(decodeGitResourceUri(uri)).toEqual({
			rootId: ROOT_A,
			rev: "index",
			path: "a b/c.txt",
		});
	});

	it("round-trips a path containing characters that would be ambiguous as a bare URI path segment", () => {
		const path = 'weird/-leading-dash/emoji-😀/quote".txt';
		const uri = encodeGitResourceUri(ROOT_A, "head", path);
		expect(decodeGitResourceUri(uri)).toEqual({
			rootId: ROOT_A,
			rev: "head",
			path,
		});
	});

	it("keeps otherwise-identical historical resources distinct across roots", () => {
		const first = encodeGitResourceUri(ROOT_A, "head", "same.txt");
		const second = encodeGitResourceUri(ROOT_B, "head", "same.txt");
		expect(first.toString()).not.toBe(second.toString());
		expect(decodeGitResourceUri(first)?.rootId).toBe(ROOT_A);
		expect(decodeGitResourceUri(second)?.rootId).toBe(ROOT_B);
	});

	it("returns undefined for a non-git scheme", () => {
		const uri = URI.from({ scheme: "file", path: "/a.txt" });
		expect(decodeGitResourceUri(uri)).toBeUndefined();
	});

	it("returns undefined for a git: URI whose query is not the exact encoded shape", () => {
		expect(
			decodeGitResourceUri(
				URI.from({ scheme: GIT_URI_SCHEME, authority: ROOT_A, path: "/x" }),
			),
		).toBeUndefined();
		expect(
			decodeGitResourceUri(
				URI.from({
					scheme: GIT_URI_SCHEME,
					authority: ROOT_A,
					path: "/x",
					query: "not json",
				}),
			),
		).toBeUndefined();
		expect(
			decodeGitResourceUri(
				URI.from({
					scheme: GIT_URI_SCHEME,
					authority: ROOT_A,
					path: "/x",
					query: JSON.stringify({ rev: "worktree", path: "x" }),
				}),
			),
		).toBeUndefined();
		expect(
			decodeGitResourceUri(
				URI.from({
					scheme: GIT_URI_SCHEME,
					authority: ROOT_A,
					path: "/x",
					query: JSON.stringify({ rev: "head", path: "" }),
				}),
			),
		).toBeUndefined();
		expect(
			decodeGitResourceUri(
				URI.from({
					scheme: GIT_URI_SCHEME,
					authority: ROOT_A,
					path: "/x",
					query: JSON.stringify(["head", "x"]),
				}),
			),
		).toBeUndefined();
		expect(
			decodeGitResourceUri(
				URI.from({
					scheme: GIT_URI_SCHEME,
					authority: "not-a-root-id",
					path: "/x",
					query: JSON.stringify({ rev: "head", path: "x" }),
				}),
			),
		).toBeUndefined();
	});
});
