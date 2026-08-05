import { describe, expect, it } from "vitest";

import {
	decodeWorkspaceOpenFilesResult,
	decodeWorkspaceRecentListResult,
	frozenWorkspaceRecentRequest,
} from "../../app/platform/tauri/workspace-codec";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const rootId = "00000000-0000-4000-8000-000000000101";
const recentId = "00000000-0000-4000-8000-000000000201";
const snapshot = {
	workspaceId,
	revision: 1,
	roots: [
		{
			rootId,
			displayName: "workspace",
			uri: `plain-workspace://${rootId}/`,
		},
	],
};
const contractError = {
	code: "IPC_CONTRACT_VIOLATION",
	message: "Native IPC returned a payload that violates the Plain contract.",
};

describe("workspace local workflow codec", () => {
	it("decodes a selected Open File result into frozen path-free targets", () => {
		const decoded = decodeWorkspaceOpenFilesResult({
			status: "selected",
			snapshot,
			files: [{ rootId, relativePath: "src/编辑器.ts" }],
		});
		expect(decoded).toEqual({
			status: "selected",
			snapshot,
			files: [{ rootId, relativePath: "src/编辑器.ts" }],
		});
		expect(Object.isFrozen(decoded)).toBe(true);
		expect(Object.isFrozen(decoded.files)).toBe(true);
		expect(Object.isFrozen(decoded.files[0])).toBe(true);
	});

	it("rejects malformed, ambient, duplicate, accessor and Proxy Open File payloads", () => {
		const vectors: unknown[] = [
			{ status: "selected", snapshot, files: [] },
			{
				status: "cancelled",
				snapshot,
				files: [{ rootId, relativePath: "README.md" }],
			},
			{
				status: "selected",
				snapshot,
				files: [{ rootId, relativePath: "/tmp/private" }],
			},
			{
				status: "selected",
				snapshot,
				files: [
					{ rootId, relativePath: "README.md" },
					{ rootId, relativePath: "README.md" },
				],
			},
			{
				status: "selected",
				snapshot,
				files: [
					{
						rootId: "00000000-0000-4000-8000-000000000999",
						relativePath: "README.md",
					},
				],
			},
			{ status: "selected", snapshot, files: [], path: "/tmp/private" },
		];
		const accessor = { rootId, relativePath: "README.md" };
		Object.defineProperty(accessor, "relativePath", { get: () => "README.md" });
		vectors.push({ status: "selected", snapshot, files: [accessor] });
		vectors.push(
			new Proxy(
				{
					status: "selected",
					snapshot,
					files: [{ rootId, relativePath: "README.md" }],
				},
				{},
			),
		);

		for (const vector of vectors) {
			expect(() => decodeWorkspaceOpenFilesResult(vector)).toThrowError(
				expect.objectContaining(contractError),
			);
		}
	});

	it("decodes only opaque Recent ids and display labels", () => {
		const decoded = decodeWorkspaceRecentListResult({
			revision: 2,
			restoreStatus: "restored",
			entries: [
				{
					recentId,
					label: "workspace + 1 folders",
					rootLabels: ["workspace", "library"],
					remoteRoots: [],
				},
			],
		});
		expect(decoded.entries[0]).toEqual({
			recentId,
			label: "workspace + 1 folders",
			rootLabels: ["workspace", "library"],
			remoteRoots: [],
		});
		expect(JSON.stringify(decoded)).not.toContain("/Users/");
		expect(Object.isFrozen(decoded.entries[0]?.rootLabels)).toBe(true);
		expect(Object.isFrozen(decoded.entries[0]?.remoteRoots)).toBe(true);
	});

	// `F220` S4 (ADR 0007 §4): `remoteRoots` — a Recent entry can carry remote
	// roots alongside (or, for a purely remote workspace, instead of) local
	// ones; never anything credential-shaped.
	it("decodes a purely remote entry (zero local roots) and a mixed entry with both backends", () => {
		const remoteOnly = decodeWorkspaceRecentListResult({
			revision: 3,
			restoreStatus: "restored",
			entries: [
				{
					recentId,
					label: "project",
					rootLabels: [],
					remoteRoots: [
						{
							host: "build.example.com",
							port: 22,
							user: "dev",
							path: "/srv/project",
							label: "project",
						},
					],
				},
			],
		});
		expect(remoteOnly.entries[0]).toEqual({
			recentId,
			label: "project",
			rootLabels: [],
			remoteRoots: [
				{
					host: "build.example.com",
					port: 22,
					user: "dev",
					path: "/srv/project",
					label: "project",
				},
			],
		});
		expect(Object.isFrozen(remoteOnly.entries[0]?.remoteRoots)).toBe(true);
		expect(Object.isFrozen(remoteOnly.entries[0]?.remoteRoots[0])).toBe(true);

		const mixed = decodeWorkspaceRecentListResult({
			revision: 4,
			restoreStatus: "restored",
			entries: [
				{
					recentId,
					label: "workspace + 1 folders",
					rootLabels: ["workspace"],
					remoteRoots: [
						{
							host: "10.0.0.5",
							port: 2222,
							user: "root",
							path: "/",
							label: "root-fs",
						},
					],
				},
			],
		});
		expect(mixed.entries[0]?.rootLabels).toEqual(["workspace"]);
		expect(mixed.entries[0]?.remoteRoots).toEqual([
			{
				host: "10.0.0.5",
				port: 2222,
				user: "root",
				path: "/",
				label: "root-fs",
			},
		]);
	});

	it("rejects duplicate ids, empty roots, extra native paths and hostile arrays", () => {
		const valid = {
			recentId,
			label: "workspace",
			rootLabels: ["workspace"],
			remoteRoots: [],
		};
		const validRemoteRoot = {
			host: "example.com",
			port: 22,
			user: "dev",
			path: "/srv/project",
			label: "project",
		};
		const sparse: unknown[] = [];
		sparse.length = 1;
		for (const vector of [
			{ revision: 0, restoreStatus: "none", entries: [] },
			{ revision: 1, restoreStatus: "unknown", entries: [] },
			{
				revision: 1,
				restoreStatus: "none",
				entries: [valid, { ...valid }],
			},
			// Both halves empty at once — an entry must name at least one root
			// of *some* backend (mirrors `recent::service::validate_stored`'s
			// Rust-side identical invariant).
			{
				revision: 1,
				restoreStatus: "none",
				entries: [{ ...valid, rootLabels: [] }],
			},
			{
				revision: 1,
				restoreStatus: "none",
				entries: [{ ...valid, path: "/Users/private" }],
			},
			// `remoteRoots` missing entirely — every field in this contract is
			// mandatory, not `#[serde(default)]` on the wire the frontend sees.
			{
				revision: 1,
				restoreStatus: "none",
				entries: [{ recentId, label: "workspace", rootLabels: ["workspace"] }],
			},
			// A remote root missing a required field.
			{
				revision: 1,
				restoreStatus: "none",
				entries: [
					{
						...valid,
						rootLabels: [],
						remoteRoots: [
							{
								host: "example.com",
								port: 22,
								user: "dev",
								path: "/srv/project",
							},
						],
					},
				],
			},
			// A remote root with an extra, unexpected field (host-key material
			// or anything else — ADR 0007 §4 forbids it on the wire).
			{
				revision: 1,
				restoreStatus: "none",
				entries: [
					{
						...valid,
						rootLabels: [],
						remoteRoots: [
							{ ...validRemoteRoot, hostKeyFingerprint: "SHA256:deadbeef" },
						],
					},
				],
			},
			// A remote root path that is not POSIX-absolute.
			{
				revision: 1,
				restoreStatus: "none",
				entries: [
					{
						...valid,
						rootLabels: [],
						remoteRoots: [{ ...validRemoteRoot, path: "relative/path" }],
					},
				],
			},
			// A remote root port outside the valid 1..=65535 range.
			{
				revision: 1,
				restoreStatus: "none",
				entries: [
					{
						...valid,
						rootLabels: [],
						remoteRoots: [{ ...validRemoteRoot, port: 0 }],
					},
				],
			},
			{
				revision: 1,
				restoreStatus: "none",
				entries: [
					{
						...valid,
						rootLabels: [],
						remoteRoots: [{ ...validRemoteRoot, port: 70_000 }],
					},
				],
			},
			// A remote root host that is an empty string.
			{
				revision: 1,
				restoreStatus: "none",
				entries: [
					{
						...valid,
						rootLabels: [],
						remoteRoots: [{ ...validRemoteRoot, host: "" }],
					},
				],
			},
			{ revision: 1, restoreStatus: "none", entries: sparse },
		]) {
			expect(() => decodeWorkspaceRecentListResult(vector)).toThrowError(
				expect.objectContaining(contractError),
			);
		}
	});

	it("freezes exact recent-id requests and rejects any path-shaped input", () => {
		expect(frozenWorkspaceRecentRequest(recentId)).toEqual({ recentId });
		expect(Object.isFrozen(frozenWorkspaceRecentRequest(recentId))).toBe(true);
		for (const value of [
			"00000000-0000-1000-8000-000000000201",
			"00000000000040008000000000000201",
			"/Users/private",
		]) {
			expect(() => frozenWorkspaceRecentRequest(value)).toThrowError(
				expect.objectContaining({ code: "WORKSPACE_RECENT_REQUEST_INVALID" }),
			);
		}
	});
});
