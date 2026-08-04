import { describe, expect, it } from "vitest";

import {
	decodeRemoteHostKeyListResult,
	decodeRemoteSessionConnectResult,
	decodeRemoteSessionEventPayload,
	decodeRemoteSessionStateResult,
	decodeRemoteVoid,
	frozenRemoteHostKeyConfirmRequest,
	frozenRemoteHostTargetRequest,
	frozenRemoteSessionConnectRequest,
	frozenRemoteSessionIdRequest,
} from "../../app/platform/tauri/remote-codec";

const sessionId = "00000000-0000-4000-8000-000000000101";
const otherSessionId = "00000000-0000-4000-8000-000000000102";
const contractError = { code: "IPC_CONTRACT_VIOLATION" };
const requestError = { code: "REMOTE_REQUEST_INVALID" };
const fingerprint = "SHA256:Nh0Me49Zh9fDw/VYUfq43IJmI1T+XrjiYONPND8GzaM";

describe("remote-codec", () => {
	describe("frozenRemoteSessionConnectRequest", () => {
		it("builds a frozen own-data request from valid inputs", () => {
			const request = frozenRemoteSessionConnectRequest(
				"example.com",
				22,
				"octocat",
			);
			expect(request).toEqual({
				host: "example.com",
				port: 22,
				user: "octocat",
			});
			expect(Object.isFrozen(request)).toBe(true);
		});

		it("accepts an IPv6 literal host", () => {
			const request = frozenRemoteSessionConnectRequest(
				"2001:db8::1",
				22,
				"root",
			);
			expect(request.host).toBe("2001:db8::1");
		});

		it("rejects an empty host", () => {
			expect(() =>
				frozenRemoteSessionConnectRequest("", 22, "root"),
			).toThrowError(expect.objectContaining(requestError));
		});

		it("rejects an oversized host", () => {
			expect(() =>
				frozenRemoteSessionConnectRequest("a".repeat(256), 22, "root"),
			).toThrowError(expect.objectContaining(requestError));
			expect(() =>
				frozenRemoteSessionConnectRequest("a".repeat(255), 22, "root"),
			).not.toThrowError();
		});

		it("rejects a host containing a shell metacharacter", () => {
			for (const host of ["evil; rm -rf /", "host name", "host/../etc"]) {
				expect(() =>
					frozenRemoteSessionConnectRequest(host, 22, "root"),
				).toThrowError(expect.objectContaining(requestError));
			}
		});

		it("rejects port zero and ports above the u16 max", () => {
			for (const port of [0, -1, 65_536, 1.5, Number.NaN]) {
				expect(() =>
					frozenRemoteSessionConnectRequest("example.com", port, "root"),
				).toThrowError(expect.objectContaining(requestError));
			}
			expect(() =>
				frozenRemoteSessionConnectRequest("example.com", 1, "root"),
			).not.toThrowError();
			expect(() =>
				frozenRemoteSessionConnectRequest("example.com", 65_535, "root"),
			).not.toThrowError();
		});

		it("rejects an empty or oversized user", () => {
			expect(() =>
				frozenRemoteSessionConnectRequest("example.com", 22, ""),
			).toThrowError(expect.objectContaining(requestError));
			expect(() =>
				frozenRemoteSessionConnectRequest("example.com", 22, "a".repeat(257)),
			).toThrowError(expect.objectContaining(requestError));
		});

		it("rejects a user containing a control character", () => {
			for (const user of ["roo\nt", "roo\tt", "roo\x7ft", "roo\x00t"]) {
				expect(() =>
					frozenRemoteSessionConnectRequest("example.com", 22, user),
				).toThrowError(expect.objectContaining(requestError));
			}
		});
	});

	describe("frozenRemoteHostKeyConfirmRequest", () => {
		it("builds a frozen own-data request from valid inputs", () => {
			const request = frozenRemoteHostKeyConfirmRequest(
				"example.com",
				22,
				"octocat",
				"ssh-ed25519",
				fingerprint,
			);
			expect(request).toEqual({
				host: "example.com",
				port: 22,
				user: "octocat",
				algorithm: "ssh-ed25519",
				sha256Fingerprint: fingerprint,
			});
			expect(Object.isFrozen(request)).toBe(true);
		});

		it("rejects an empty or oversized algorithm", () => {
			expect(() =>
				frozenRemoteHostKeyConfirmRequest(
					"example.com",
					22,
					"octocat",
					"",
					fingerprint,
				),
			).toThrowError(expect.objectContaining(requestError));
			expect(() =>
				frozenRemoteHostKeyConfirmRequest(
					"example.com",
					22,
					"octocat",
					"a".repeat(65),
					fingerprint,
				),
			).toThrowError(expect.objectContaining(requestError));
		});

		it("rejects an algorithm containing a disallowed character", () => {
			expect(() =>
				frozenRemoteHostKeyConfirmRequest(
					"example.com",
					22,
					"octocat",
					"ssh ed25519",
					fingerprint,
				),
			).toThrowError(expect.objectContaining(requestError));
		});

		it("rejects a fingerprint missing the SHA256: prefix", () => {
			expect(() =>
				frozenRemoteHostKeyConfirmRequest(
					"example.com",
					22,
					"octocat",
					"ssh-ed25519",
					fingerprint.slice("SHA256:".length),
				),
			).toThrowError(expect.objectContaining(requestError));
		});

		it("rejects a fingerprint with an invalid character in the digest", () => {
			expect(() =>
				frozenRemoteHostKeyConfirmRequest(
					"example.com",
					22,
					"octocat",
					"ssh-ed25519",
					"SHA256:not a valid base64 string!!",
				),
			).toThrowError(expect.objectContaining(requestError));
		});

		it("rejects a bare SHA256: prefix with an empty digest", () => {
			expect(() =>
				frozenRemoteHostKeyConfirmRequest(
					"example.com",
					22,
					"octocat",
					"ssh-ed25519",
					"SHA256:",
				),
			).toThrowError(expect.objectContaining(requestError));
		});

		it("rejects an oversized fingerprint", () => {
			expect(() =>
				frozenRemoteHostKeyConfirmRequest(
					"example.com",
					22,
					"octocat",
					"ssh-ed25519",
					`SHA256:${"A".repeat(128)}`,
				),
			).toThrowError(expect.objectContaining(requestError));
		});
	});

	describe("frozenRemoteHostTargetRequest", () => {
		it("builds a frozen own-data request from valid inputs", () => {
			const request = frozenRemoteHostTargetRequest("example.com", 2222);
			expect(request).toEqual({ host: "example.com", port: 2222 });
			expect(Object.isFrozen(request)).toBe(true);
		});

		it("rejects an invalid host or port", () => {
			expect(() => frozenRemoteHostTargetRequest("", 22)).toThrowError(
				expect.objectContaining(requestError),
			);
			expect(() =>
				frozenRemoteHostTargetRequest("example.com", 0),
			).toThrowError(expect.objectContaining(requestError));
		});
	});

	describe("frozenRemoteSessionIdRequest", () => {
		it("builds a frozen own-data request from a valid UUID v4", () => {
			const request = frozenRemoteSessionIdRequest(sessionId);
			expect(request).toEqual({ sessionId });
			expect(Object.isFrozen(request)).toBe(true);
		});

		it("rejects a non-UUID or non-v4 session id", () => {
			for (const value of [
				"",
				"not-a-uuid",
				"00000000-0000-0000-0000-000000000000",
			]) {
				expect(() => frozenRemoteSessionIdRequest(value)).toThrowError(
					expect.objectContaining(requestError),
				);
			}
		});
	});

	describe("decodeRemoteVoid", () => {
		it("accepts null and rejects anything else", () => {
			expect(() => decodeRemoteVoid(null)).not.toThrow();
			for (const value of [undefined, {}, "null", 0, false]) {
				expect(() => decodeRemoteVoid(value)).toThrowError(
					expect.objectContaining(contractError),
				);
			}
		});
	});

	describe("decodeRemoteSessionConnectResult", () => {
		it("decodes a connected result", () => {
			const decoded = decodeRemoteSessionConnectResult({
				status: "connected",
				sessionId,
			});
			expect(decoded).toEqual({ status: "connected", sessionId });
			expect(Object.isFrozen(decoded)).toBe(true);
		});

		it("decodes a hostKeyPendingConfirmation result", () => {
			const decoded = decodeRemoteSessionConnectResult({
				status: "hostKeyPendingConfirmation",
				algorithm: "ssh-ed25519",
				sha256Fingerprint: fingerprint,
				knownHostsHit: true,
			});
			expect(decoded).toEqual({
				status: "hostKeyPendingConfirmation",
				algorithm: "ssh-ed25519",
				sha256Fingerprint: fingerprint,
				knownHostsHit: true,
			});
		});

		it("rejects an unknown status tag", () => {
			expect(() =>
				decodeRemoteSessionConnectResult({ status: "somethingElse" }),
			).toThrowError(expect.objectContaining(contractError));
		});

		it("rejects a connected result with an extra or missing key", () => {
			expect(() =>
				decodeRemoteSessionConnectResult({
					status: "connected",
					sessionId,
					extra: true,
				}),
			).toThrowError(expect.objectContaining(contractError));
			expect(() =>
				decodeRemoteSessionConnectResult({ status: "connected" }),
			).toThrowError(expect.objectContaining(contractError));
		});

		it("rejects a connected result whose sessionId is not a valid UUID v4", () => {
			expect(() =>
				decodeRemoteSessionConnectResult({
					status: "connected",
					sessionId: "not-a-uuid",
				}),
			).toThrowError(expect.objectContaining(contractError));
		});

		it("rejects a hostKeyPendingConfirmation result with a wrong-typed field", () => {
			expect(() =>
				decodeRemoteSessionConnectResult({
					status: "hostKeyPendingConfirmation",
					algorithm: "ssh-ed25519",
					sha256Fingerprint: fingerprint,
					knownHostsHit: "yes",
				}),
			).toThrowError(expect.objectContaining(contractError));
		});

		it("rejects a non-object payload", () => {
			for (const value of [null, undefined, "connected", 1, []]) {
				expect(() => decodeRemoteSessionConnectResult(value)).toThrowError(
					expect.objectContaining(contractError),
				);
			}
		});

		it("rejects a Proxy standing in for the response object", () => {
			const target = {
				status: "connected",
				sessionId,
			};
			const proxy = new Proxy(target, {});
			expect(() => decodeRemoteSessionConnectResult(proxy)).toThrowError(
				expect.objectContaining(contractError),
			);
		});
	});

	describe("decodeRemoteSessionStateResult", () => {
		it("decodes an empty and a populated session list", () => {
			expect(decodeRemoteSessionStateResult({ sessions: [] })).toEqual({
				sessions: [],
			});
			const decoded = decodeRemoteSessionStateResult({
				sessions: [
					{ sessionId, host: "example.com", port: 22, user: "octocat" },
					{
						sessionId: otherSessionId,
						host: "example.org",
						port: 2222,
						user: "root",
					},
				],
			});
			expect(decoded.sessions).toHaveLength(2);
			expect(Object.isFrozen(decoded)).toBe(true);
			expect(Object.isFrozen(decoded.sessions)).toBe(true);
		});

		it("rejects a malformed entry", () => {
			expect(() =>
				decodeRemoteSessionStateResult({
					sessions: [{ sessionId, host: "example.com", port: 0, user: "x" }],
				}),
			).toThrowError(expect.objectContaining(contractError));
		});

		it("rejects a sparse array standing in for sessions", () => {
			const sparse: unknown[] = [];
			sparse.length = 2;
			sparse[1] = { sessionId, host: "example.com", port: 22, user: "x" };
			expect(() =>
				decodeRemoteSessionStateResult({ sessions: sparse }),
			).toThrowError(expect.objectContaining(contractError));
		});
	});

	describe("decodeRemoteHostKeyListResult", () => {
		it("decodes an empty and a populated entry list", () => {
			expect(decodeRemoteHostKeyListResult({ entries: [] })).toEqual({
				entries: [],
			});
			const decoded = decodeRemoteHostKeyListResult({
				entries: [
					{
						host: "example.com",
						port: 22,
						algorithm: "ssh-ed25519",
						sha256Fingerprint: fingerprint,
					},
				],
			});
			expect(decoded.entries).toHaveLength(1);
			expect(Object.isFrozen(decoded.entries)).toBe(true);
		});

		it("rejects a malformed entry", () => {
			expect(() =>
				decodeRemoteHostKeyListResult({
					entries: [{ host: "example.com", port: 22, algorithm: "x" }],
				}),
			).toThrowError(expect.objectContaining(contractError));
		});
	});

	describe("decodeRemoteSessionEventPayload", () => {
		it("decodes a connected event", () => {
			const decoded = decodeRemoteSessionEventPayload({
				event: "connected",
				sessionId,
				host: "example.com",
				port: 22,
				user: "octocat",
			});
			expect(decoded).toEqual({
				event: "connected",
				sessionId,
				host: "example.com",
				port: 22,
				user: "octocat",
			});
		});

		it("decodes a disconnected event with each audited reason", () => {
			for (const reason of ["userRequested", "windowClosed"]) {
				const decoded = decodeRemoteSessionEventPayload({
					event: "disconnected",
					sessionId,
					host: "example.com",
					port: 22,
					user: "octocat",
					reason,
				});
				expect(decoded).toMatchObject({ reason });
			}
		});

		it("rejects a disconnected event with an unrecognized reason", () => {
			expect(() =>
				decodeRemoteSessionEventPayload({
					event: "disconnected",
					sessionId,
					host: "example.com",
					port: 22,
					user: "octocat",
					reason: "somethingElse",
				}),
			).toThrowError(expect.objectContaining(contractError));
		});

		it("rejects an unknown event tag", () => {
			expect(() =>
				decodeRemoteSessionEventPayload({ event: "somethingElse" }),
			).toThrowError(expect.objectContaining(contractError));
		});

		it("rejects an event payload with an extra key", () => {
			expect(() =>
				decodeRemoteSessionEventPayload({
					event: "connected",
					sessionId,
					host: "example.com",
					port: 22,
					user: "octocat",
					extra: true,
				}),
			).toThrowError(expect.objectContaining(contractError));
		});
	});
});
