import { describe, expect, it } from "vitest";

import {
	applyRemoteSessionDisconnectedEvent,
	coldStartPendingRemoteRootCandidates,
	existingDisconnectedRemoteRootCandidates,
	remoteRootColdStartNeedsReconnectMessage,
	remoteRootReconnectFailureMessage,
	remoteRootReconnectSuccessMessage,
	remoteRootTransportClosedNotificationMessage,
	selectRemoteRootToReconnect,
	type KnownRemoteRootRecord,
	type RemoteRootReconnectCandidate,
} from "../../app/features/remote/plain-remote-workspace-lifecycle";

function record(
	overrides: Partial<KnownRemoteRootRecord> = {},
): KnownRemoteRootRecord {
	return {
		label: "project",
		sessionId: "00000000-0000-4000-8000-000000000101",
		host: "example.com",
		port: 22,
		user: "octocat",
		path: "/home/octocat/project",
		disconnected: false,
		...overrides,
	};
}

const existingCandidate: RemoteRootReconnectCandidate = Object.freeze({
	kind: "existing",
	rootId: "00000000-0000-4000-8000-000000000201",
	label: "project",
	host: "example.com",
	port: 22,
	user: "octocat",
});

const pendingCandidate: RemoteRootReconnectCandidate = Object.freeze({
	kind: "pending",
	path: "/srv/project",
	label: "project",
	host: "build.example.com",
	port: 2222,
	user: "dev",
});

describe("plain-remote-workspace-lifecycle", () => {
	describe("selectRemoteRootToReconnect", () => {
		it("resolves undefined and never calls pick when there are zero candidates", async () => {
			let pickCalls = 0;
			const picked = await selectRemoteRootToReconnect([], async () => {
				pickCalls += 1;
				return undefined;
			});
			expect(picked).toBeUndefined();
			expect(pickCalls).toBe(0);
		});

		it("still shows the picker for exactly one candidate (never auto-selects)", async () => {
			let receivedItems: readonly unknown[] = [];
			const picked = await selectRemoteRootToReconnect(
				[existingCandidate],
				async (items) => {
					receivedItems = items;
					return items[0];
				},
			);
			expect(receivedItems).toHaveLength(1);
			expect(picked).toEqual(existingCandidate);
		});

		it("passes every candidate through to the picker for multiple candidates", async () => {
			let receivedItems: readonly unknown[] = [];
			const picked = await selectRemoteRootToReconnect(
				[existingCandidate, pendingCandidate],
				async (items) => {
					receivedItems = items;
					return items[1];
				},
			);
			expect(receivedItems).toHaveLength(2);
			expect(picked).toEqual(pendingCandidate);
		});

		it("resolves undefined when the picker itself is cancelled", async () => {
			const picked = await selectRemoteRootToReconnect(
				[existingCandidate],
				async () => undefined,
			);
			expect(picked).toBeUndefined();
		});

		it("labels each item with the connection identity as its description", async () => {
			let receivedItems: readonly { description: string }[] = [];
			await selectRemoteRootToReconnect([existingCandidate], async (items) => {
				receivedItems = items;
				return undefined;
			});
			expect(receivedItems[0]?.description).toBe("octocat@example.com:22");
		});
	});

	describe("existingDisconnectedRemoteRootCandidates", () => {
		it("offers only disconnected roots, never a live one", () => {
			const known = new Map([
				["root-live", record({ disconnected: false, label: "live" })],
				["root-dead", record({ disconnected: true, label: "dead" })],
			]);
			const candidates = existingDisconnectedRemoteRootCandidates(known);
			expect(candidates).toEqual([
				{
					kind: "existing",
					rootId: "root-dead",
					label: "dead",
					host: "example.com",
					port: 22,
					user: "octocat",
				},
			]);
		});

		it("returns an empty list when nothing is known or nothing is disconnected", () => {
			expect(existingDisconnectedRemoteRootCandidates(new Map())).toEqual([]);
			const allLive = new Map([["root-a", record({ disconnected: false })]]);
			expect(existingDisconnectedRemoteRootCandidates(allLive)).toEqual([]);
		});
	});

	describe("coldStartPendingRemoteRootCandidates", () => {
		it("offers a remote root the Recent entry names that is not already known", () => {
			const candidates = coldStartPendingRemoteRootCandidates(new Map(), [
				{
					host: "build.example.com",
					port: 2222,
					user: "dev",
					path: "/srv/project",
					label: "project",
				},
			]);
			expect(candidates).toEqual([pendingCandidate]);
		});

		it("excludes a remote root that is already known by identity", () => {
			const known = new Map([
				[
					"root-a",
					record({
						host: "build.example.com",
						port: 2222,
						user: "dev",
						path: "/srv/project",
					}),
				],
			]);
			const candidates = coldStartPendingRemoteRootCandidates(known, [
				{
					host: "build.example.com",
					port: 2222,
					user: "dev",
					path: "/srv/project",
					label: "project",
				},
			]);
			expect(candidates).toEqual([]);
		});

		it("does not exclude a remote root whose label alone differs from the known one", () => {
			// Label is deliberately excluded from the identity key — a rename is
			// not a different workspace, mirroring the Rust-side identity.
			const known = new Map([
				[
					"root-a",
					record({
						host: "build.example.com",
						port: 2222,
						user: "dev",
						path: "/srv/project",
						label: "renamed",
					}),
				],
			]);
			const candidates = coldStartPendingRemoteRootCandidates(known, [
				{
					host: "build.example.com",
					port: 2222,
					user: "dev",
					path: "/srv/project",
					label: "project",
				},
			]);
			expect(candidates).toEqual([]);
		});

		it("still offers a remote root that differs by even one identity field", () => {
			const known = new Map([
				[
					"root-a",
					record({
						host: "build.example.com",
						port: 2222,
						user: "dev",
						path: "/srv/project",
					}),
				],
			]);
			const candidates = coldStartPendingRemoteRootCandidates(known, [
				{
					host: "build.example.com",
					port: 2222,
					user: "dev",
					path: "/srv/different-project",
					label: "project",
				},
			]);
			expect(candidates).toHaveLength(1);
		});
	});

	describe("applyRemoteSessionDisconnectedEvent", () => {
		it("returns the same reference unchanged for a non-transportClosed reason", () => {
			const known = new Map([
				["root-a", record({ sessionId: "session-a", disconnected: false })],
			]);
			const next = applyRemoteSessionDisconnectedEvent(known, {
				sessionId: "session-a",
				reason: "userRequested",
			});
			expect(next).toBe(known);
		});

		it("returns the same reference unchanged when no entry matches the sessionId", () => {
			const known = new Map([
				["root-a", record({ sessionId: "session-a", disconnected: false })],
			]);
			const next = applyRemoteSessionDisconnectedEvent(known, {
				sessionId: "session-unrelated",
				reason: "transportClosed",
			});
			expect(next).toBe(known);
		});

		it("returns the same reference unchanged when the matching entry is already disconnected", () => {
			const known = new Map([
				["root-a", record({ sessionId: "session-a", disconnected: true })],
			]);
			const next = applyRemoteSessionDisconnectedEvent(known, {
				sessionId: "session-a",
				reason: "transportClosed",
			});
			expect(next).toBe(known);
		});

		it("flips every entry bound to the disconnected session to disconnected: true", () => {
			const known = new Map([
				[
					"root-a",
					record({ sessionId: "session-shared", disconnected: false }),
				],
				[
					"root-b",
					record({ sessionId: "session-shared", disconnected: false }),
				],
				["root-c", record({ sessionId: "session-other", disconnected: false })],
			]);
			const next = applyRemoteSessionDisconnectedEvent(known, {
				sessionId: "session-shared",
				reason: "transportClosed",
			});
			expect(next).not.toBe(known);
			expect(next.get("root-a")?.disconnected).toBe(true);
			expect(next.get("root-b")?.disconnected).toBe(true);
			expect(next.get("root-c")?.disconnected).toBe(false);
			// The original map is untouched — a pure transform.
			expect(known.get("root-a")?.disconnected).toBe(false);
		});
	});

	describe("reconnect outcome messages", () => {
		it("names the root and its connection identity on success", () => {
			const message = remoteRootReconnectSuccessMessage(existingCandidate);
			expect(message).toContain("project");
			expect(message).toContain("octocat@example.com:22");
		});

		it("gives a distinct, accurate message for REMOTE_ROOT_IDENTITY_CHANGED", () => {
			const message = remoteRootReconnectFailureMessage(existingCandidate, {
				code: "REMOTE_ROOT_IDENTITY_CHANGED",
				message: "generic backend message",
			});
			expect(message).toContain("project");
			expect(message).toContain("host identity");
			expect(message).not.toContain("generic backend message");
		});

		it("gives a distinct, accurate message for REMOTE_ROOT_PATH_CHANGED", () => {
			const message = remoteRootReconnectFailureMessage(existingCandidate, {
				code: "REMOTE_ROOT_PATH_CHANGED",
				message: "generic backend message",
			});
			expect(message).toContain("project");
			expect(message).toContain("no longer resolves");
			expect(message).not.toContain("generic backend message");
		});

		it("falls back to the thrown error's own message for anything else", () => {
			const message = remoteRootReconnectFailureMessage(existingCandidate, {
				code: "REMOTE_SESSION_NOT_FOUND",
				message: "The requested SSH session does not exist for this window.",
			});
			expect(message).toContain("project");
			expect(message).toContain(
				"The requested SSH session does not exist for this window.",
			);
		});

		it("distinguishes the three failure branches from one another", () => {
			const identity = remoteRootReconnectFailureMessage(existingCandidate, {
				code: "REMOTE_ROOT_IDENTITY_CHANGED",
				message: "x",
			});
			const path = remoteRootReconnectFailureMessage(existingCandidate, {
				code: "REMOTE_ROOT_PATH_CHANGED",
				message: "x",
			});
			const other = remoteRootReconnectFailureMessage(existingCandidate, {
				code: "SOMETHING_ELSE",
				message: "x",
			});
			const messages = new Set([identity, path, other]);
			expect(messages.size).toBe(3);
		});
	});

	describe("notification text", () => {
		it("names the root, host, and points at the recovery command for a transport-closed loss", () => {
			const message = remoteRootTransportClosedNotificationMessage(
				record({ label: "project" }),
			);
			expect(message).toContain("project");
			expect(message).toContain("octocat@example.com:22");
			expect(message).toContain("Plain: Reconnect Remote Session…");
		});

		it("names the root, host, and points at the recovery command for a cold-start pending root", () => {
			const message = remoteRootColdStartNeedsReconnectMessage({
				host: "build.example.com",
				port: 2222,
				user: "dev",
				label: "project",
			});
			expect(message).toContain("project");
			expect(message).toContain("dev@build.example.com:2222");
			expect(message).toContain("Plain: Reconnect Remote Session…");
		});
	});
});
