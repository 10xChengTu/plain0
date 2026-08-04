//! Strict wire DTOs for the `remote` (SSH) domain — `F220` S1. Mirrors
//! `debug::dto`'s own discipline: every request carries an `into_parts`
//! validator that fails closed with [`super::remote_request_invalid`] on
//! anything structurally wrong (empty/oversized/out-of-charset fields), and
//! every response is a plain `#[derive(Serialize)]` type with an explicit
//! `#[serde(rename_all = "camelCase")]` wire shape.

use std::fmt;

use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use uuid::{Uuid, Variant};

use crate::error::CommandError;

use super::remote_request_invalid;

/// Defensive ceiling on `host` — generous above any real DNS name (253
/// octets, RFC 1035) or IPv6 literal, purely a hostile-input backstop.
pub(crate) const MAX_REMOTE_HOST_CHARS: usize = 255;
/// Defensive ceiling on `user` — real POSIX usernames are far shorter (32
/// bytes is a common kernel limit); generous above that.
pub(crate) const MAX_REMOTE_USER_CHARS: usize = 256;
/// Defensive ceiling on the host-key `algorithm` name (e.g. `"ssh-ed25519"`,
/// `"ecdsa-sha2-nistp256"`) — real algorithm names are under 32 bytes.
pub(crate) const MAX_REMOTE_ALGORITHM_CHARS: usize = 64;
/// Defensive ceiling on the `SHA256:<base64>` fingerprint string — a real
/// SHA-256 fingerprint is `7 + 43 = 50` characters; generous above that.
pub(crate) const MAX_REMOTE_FINGERPRINT_CHARS: usize = 128;
/// Every window may hold at most this many live SSH sessions at once — the
/// ADR 0006 "每窗口会话数上限如 8" ceiling.
pub(crate) const MAX_REMOTE_SESSIONS_PER_WINDOW: usize = 8;

fn is_allowed_host_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_' | b':' | b'%')
}

/// Validates `host` — non-empty, within [`MAX_REMOTE_HOST_CHARS`], and every
/// byte drawn from the set a DNS name, IPv4 literal, IPv6 literal (including
/// a `%`-separated zone id) can legitimately contain. Rejects anything with
/// embedded whitespace, control characters, or shell/path metacharacters —
/// this string is never interpreted by a shell (russh's own
/// `tokio::net::TcpStream::connect` resolves it directly), but the same
/// narrow charset also keeps it safe to interpolate into an error message or
/// a known-hosts store key without further escaping.
fn validate_host(host: &str) -> Result<(), CommandError> {
    if host.is_empty() || host.len() > MAX_REMOTE_HOST_CHARS {
        return Err(remote_request_invalid());
    }
    if !host.bytes().all(is_allowed_host_byte) {
        return Err(remote_request_invalid());
    }
    Ok(())
}

fn validate_port(port: u32) -> Result<u16, CommandError> {
    if port == 0 || port > u32::from(u16::MAX) {
        return Err(remote_request_invalid());
    }
    Ok(port as u16)
}

fn validate_user(user: &str) -> Result<(), CommandError> {
    if user.is_empty() || user.chars().count() > MAX_REMOTE_USER_CHARS {
        return Err(remote_request_invalid());
    }
    if user.bytes().any(|byte| byte.is_ascii_control()) {
        return Err(remote_request_invalid());
    }
    Ok(())
}

fn validate_algorithm(algorithm: &str) -> Result<(), CommandError> {
    if algorithm.is_empty() || algorithm.len() > MAX_REMOTE_ALGORITHM_CHARS {
        return Err(remote_request_invalid());
    }
    if !algorithm
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'@' | b'.'))
    {
        return Err(remote_request_invalid());
    }
    Ok(())
}

/// Validates the wire `SHA256:<base64url-nopad>` fingerprint shape a
/// [`super::remote_host_key_confirm`] request carries — deliberately not a
/// full base64 alphabet/padding re-implementation, just a defensive shape
/// check (`"SHA256:"` prefix, remainder within the printable base64
/// character set, non-empty, bounded) since this string is only ever
/// byte-compared against the store's own value, never decoded.
fn validate_fingerprint(fingerprint: &str) -> Result<(), CommandError> {
    if fingerprint.is_empty() || fingerprint.len() > MAX_REMOTE_FINGERPRINT_CHARS {
        return Err(remote_request_invalid());
    }
    let Some(digest) = fingerprint.strip_prefix("SHA256:") else {
        return Err(remote_request_invalid());
    };
    if digest.is_empty()
        || !digest
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='))
    {
        return Err(remote_request_invalid());
    }
    Ok(())
}

/// An opaque, window-bound identity for one live SSH session — validated
/// exactly like `debug::dto::DebugSessionId` (exact-length, version-4,
/// RFC4122 hyphenated string) and redacted in `Debug` for the same reason
/// (never let a session id leak into a log/panic message unredacted).
#[derive(Clone, Copy, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct RemoteSessionId(Uuid);

impl RemoteSessionId {
    pub(crate) fn new() -> Self {
        Self(Uuid::new_v4())
    }

    pub fn as_wire(self) -> String {
        self.0.hyphenated().to_string()
    }
}

impl fmt::Debug for RemoteSessionId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_tuple("remote session id")
            .field(&"<redacted>")
            .finish()
    }
}

impl Serialize for RemoteSessionId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.as_wire())
    }
}

impl<'de> Deserialize<'de> for RemoteSessionId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = String::deserialize(deserializer)?;
        let value =
            Uuid::parse_str(&wire).map_err(|_| D::Error::custom("invalid remote session id"))?;
        if value.get_version_num() != 4
            || value.get_variant() != Variant::RFC4122
            || value.hyphenated().to_string() != wire
        {
            return Err(D::Error::custom("invalid remote session id"));
        }
        Ok(Self(value))
    }
}

/// A validated, immutable `(host, port, user)` connect target — the common
/// payload [`RemoteSessionConnectRequest`] and [`RemoteHostKeyConfirmRequest`]
/// both resolve to via their own `into_parts`.
#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct RemoteConnectTarget {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) user: String,
}

/// `remote_session_connect`'s request — host/port/user are not credentials
/// (ADR 0006 §2's own "连接目标…可经产品 UI 输入并保存于 recent 记录" carve-out),
/// so this DTO carries them as plain strings/integers, not anything
/// secret-shaped.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSessionConnectRequest {
    host: String,
    port: u32,
    user: String,
}

impl RemoteSessionConnectRequest {
    pub(crate) fn into_parts(self) -> Result<RemoteConnectTarget, CommandError> {
        validate_host(&self.host)?;
        let port = validate_port(self.port)?;
        validate_user(&self.user)?;
        Ok(RemoteConnectTarget {
            host: self.host,
            port,
            user: self.user,
        })
    }
}

/// `remote_host_key_confirm`'s request — the exact `(host, port, user)`
/// target plus the exact `(algorithm, fingerprint)` pair the pending-
/// confirmation response just showed the user. Binding the confirmation to
/// this precise fingerprint (rather than a bare "yes, trust this host") is
/// ADR 0006 §3's own requirement — see `session::RemoteSessionService::confirm_host_key`'s
/// doc comment for how the live re-handshake re-validates it before this
/// pin is ever actually used to authenticate.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHostKeyConfirmRequest {
    host: String,
    port: u32,
    user: String,
    algorithm: String,
    sha256_fingerprint: String,
}

pub(crate) struct RemoteHostKeyConfirmParts {
    pub(crate) target: RemoteConnectTarget,
    pub(crate) algorithm: String,
    pub(crate) sha256_fingerprint: String,
}

impl RemoteHostKeyConfirmRequest {
    pub(crate) fn into_parts(self) -> Result<RemoteHostKeyConfirmParts, CommandError> {
        validate_host(&self.host)?;
        let port = validate_port(self.port)?;
        validate_user(&self.user)?;
        validate_algorithm(&self.algorithm)?;
        validate_fingerprint(&self.sha256_fingerprint)?;
        Ok(RemoteHostKeyConfirmParts {
            target: RemoteConnectTarget {
                host: self.host,
                port,
                user: self.user,
            },
            algorithm: self.algorithm,
            sha256_fingerprint: self.sha256_fingerprint,
        })
    }
}

/// `remote_host_key_forget`/`remote_session_connect_cancel`'s shared
/// `(host, port)` request shape.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHostTarget {
    host: String,
    port: u32,
}

impl RemoteHostTarget {
    pub(crate) fn into_parts(self) -> Result<(String, u16), CommandError> {
        validate_host(&self.host)?;
        let port = validate_port(self.port)?;
        Ok((self.host, port))
    }
}

/// `remote_session_disconnect`'s request.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSessionIdRequest {
    session_id: RemoteSessionId,
}

impl RemoteSessionIdRequest {
    pub(crate) fn into_parts(self) -> RemoteSessionId {
        self.session_id
    }
}

/// `remote_session_connect`/`remote_host_key_confirm`'s shared response — see
/// the module doc for why an unknown host never silently authenticates: this
/// is the type that carries "no session yet, here is what the host key looks
/// like" back to the caller instead.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum RemoteSessionConnectResult {
    #[serde(rename_all = "camelCase")]
    Connected { session_id: RemoteSessionId },
    #[serde(rename_all = "camelCase")]
    HostKeyPendingConfirmation {
        algorithm: String,
        sha256_fingerprint: String,
        /// `true` when this exact `(host, port, algorithm, key)` also
        /// matches an entry in the user's own read-only `~/.ssh/known_hosts`
        /// reference (ADR 0006 §3) — purely informational; Plain's own
        /// pinned store is still what actually governs trust.
        known_hosts_hit: bool,
    },
}

/// One live session, as reported by `remote_session_state` — enough for the
/// `Plain: Disconnect SSH Session…` QuickPick to render a `user@host:port`
/// label without a second round trip.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSessionStateEntry {
    pub session_id: RemoteSessionId,
    pub host: String,
    pub port: u16,
    pub user: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSessionStateResult {
    pub sessions: Vec<RemoteSessionStateEntry>,
}

/// One pinned known-hosts entry, as reported by `remote_host_key_list` — the
/// `Plain: Forget SSH Host Key…` QuickPick's own data source.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHostKeyEntry {
    pub host: String,
    pub port: u16,
    pub algorithm: String,
    pub sha256_fingerprint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHostKeyListResult {
    pub entries: Vec<RemoteHostKeyEntry>,
}

/// `plain://remote-session-event`'s payload — see `commands::REMOTE_SESSION_EVENT`'s
/// own doc comment for the event name and emission sites.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum RemoteSessionEventPayload {
    #[serde(rename_all = "camelCase")]
    Connected {
        session_id: RemoteSessionId,
        host: String,
        port: u16,
        user: String,
    },
    #[serde(rename_all = "camelCase")]
    Disconnected {
        session_id: RemoteSessionId,
        host: String,
        port: u16,
        user: String,
        reason: RemoteSessionDisconnectReason,
    },
}

/// Why a session ended — carried on every `"disconnected"` event so the
/// frontend can render an accurate notification instead of a bare "session
/// ended". `S1` only ever produces the first two (an explicit
/// `remote_session_disconnect` call, or the owning window closing); detecting
/// a passive/unexpected transport closure needs a live channel or keepalive
/// to observe, which this slice deliberately does not open yet (no FS/PTY/Git
/// traffic exists until S2+) — a disclosed narrowing, not an oversight; see
/// the module doc.
#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RemoteSessionDisconnectReason {
    UserRequested,
    WindowClosed,
}

/// `F220` S3: the remote directory picker's own bounds — a page cannot be
/// larger than this, and a raw picker/add-root `path` string cannot be
/// longer than this either (mirrors `remote::remote_fs::MAX_REMOTE_PATH_CHARS`
/// numerically; kept as its own constant rather than importing that one
/// since `dto` intentionally never depends on `remote_fs`).
pub(crate) const MAX_REMOTE_PICK_PATH_CHARS: usize = 8_192;
pub(crate) const MAX_REMOTE_PICK_PAGE_SIZE: u32 = 500;

/// `remote_workspace_pick_directory`'s request — `path` is an absolute
/// remote path (not workspace-relative: this browses *before* any root
/// exists), `offset`/`limit` page through the (bounded) directory listing.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteWorkspacePickDirectoryRequest {
    session_id: RemoteSessionId,
    path: String,
    offset: u32,
    limit: u32,
}

pub(crate) struct RemoteWorkspacePickDirectoryParts {
    pub(crate) session_id: RemoteSessionId,
    pub(crate) path: String,
    pub(crate) offset: usize,
    pub(crate) limit: usize,
}

impl RemoteWorkspacePickDirectoryRequest {
    pub(crate) fn into_parts(self) -> Result<RemoteWorkspacePickDirectoryParts, CommandError> {
        if self.path.is_empty() || self.path.len() > MAX_REMOTE_PICK_PATH_CHARS {
            return Err(remote_request_invalid());
        }
        if self.limit == 0 || self.limit > MAX_REMOTE_PICK_PAGE_SIZE {
            return Err(remote_request_invalid());
        }
        Ok(RemoteWorkspacePickDirectoryParts {
            session_id: self.session_id,
            path: self.path,
            offset: self.offset as usize,
            limit: self.limit as usize,
        })
    }
}

/// `remote_workspace_pick_directory`'s response — every entry is a
/// directory (or a symlink resolving to one) by construction; there is
/// nothing else worth listing in a *root* picker.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteWorkspaceDirectoryPage {
    pub canonical_path: String,
    /// `None` only when `canonical_path` is the filesystem root (`"/"`).
    pub parent_path: Option<String>,
    pub entries: Vec<String>,
    pub total: u32,
    pub offset: u32,
    pub has_more: bool,
}

/// `remote_workspace_add_root`'s request — `path` is an absolute remote
/// path (typically the `canonicalPath` a prior `remote_workspace_pick_directory`
/// page reported); `display_name` is optional (defaults to the path's own
/// last segment, mirroring the local root picker's own default).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteWorkspaceAddRootRequest {
    session_id: RemoteSessionId,
    path: String,
    display_name: Option<String>,
}

pub(crate) struct RemoteWorkspaceAddRootParts {
    pub(crate) session_id: RemoteSessionId,
    pub(crate) path: String,
    pub(crate) display_name: Option<String>,
}

impl RemoteWorkspaceAddRootRequest {
    pub(crate) fn into_parts(self) -> Result<RemoteWorkspaceAddRootParts, CommandError> {
        if self.path.is_empty() || self.path.len() > MAX_REMOTE_PICK_PATH_CHARS {
            return Err(remote_request_invalid());
        }
        if let Some(name) = &self.display_name {
            if name.is_empty() || name.len() > 512 {
                return Err(remote_request_invalid());
            }
        }
        Ok(RemoteWorkspaceAddRootParts {
            session_id: self.session_id,
            path: self.path,
            display_name: self.display_name,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connect_request(host: &str, port: u32, user: &str) -> RemoteSessionConnectRequest {
        RemoteSessionConnectRequest {
            host: host.to_owned(),
            port,
            user: user.to_owned(),
        }
    }

    #[test]
    fn a_well_formed_connect_request_parses() {
        let target = connect_request("example.com", 22, "octocat")
            .into_parts()
            .unwrap();
        assert_eq!(target.host, "example.com");
        assert_eq!(target.port, 22);
        assert_eq!(target.user, "octocat");
    }

    #[test]
    fn an_ipv6_literal_host_is_accepted() {
        let target = connect_request("2001:db8::1", 2222, "root")
            .into_parts()
            .unwrap();
        assert_eq!(target.host, "2001:db8::1");
    }

    #[test]
    fn an_empty_host_is_rejected() {
        assert_eq!(
            connect_request("", 22, "root")
                .into_parts()
                .unwrap_err()
                .code(),
            "REMOTE_REQUEST_INVALID"
        );
    }

    #[test]
    fn an_oversized_host_is_rejected() {
        let host = "a".repeat(MAX_REMOTE_HOST_CHARS + 1);
        assert!(connect_request(&host, 22, "root").into_parts().is_err());
    }

    #[test]
    fn a_host_with_a_shell_metacharacter_is_rejected() {
        assert!(connect_request("evil; rm -rf /", 22, "root")
            .into_parts()
            .is_err());
    }

    #[test]
    fn port_zero_is_rejected() {
        assert!(connect_request("example.com", 0, "root")
            .into_parts()
            .is_err());
    }

    #[test]
    fn port_above_u16_max_is_rejected() {
        assert!(connect_request("example.com", 70_000, "root")
            .into_parts()
            .is_err());
    }

    #[test]
    fn port_at_the_u16_max_boundary_is_accepted() {
        let target = connect_request("example.com", 65_535, "root")
            .into_parts()
            .unwrap();
        assert_eq!(target.port, 65_535);
    }

    #[test]
    fn an_empty_user_is_rejected() {
        assert!(connect_request("example.com", 22, "").into_parts().is_err());
    }

    #[test]
    fn a_user_with_a_control_character_is_rejected() {
        assert!(connect_request("example.com", 22, "roo\nt")
            .into_parts()
            .is_err());
    }

    #[test]
    fn a_well_formed_host_key_confirm_request_parses() {
        let request = RemoteHostKeyConfirmRequest {
            host: "example.com".to_owned(),
            port: 22,
            user: "octocat".to_owned(),
            algorithm: "ssh-ed25519".to_owned(),
            sha256_fingerprint: "SHA256:Nh0Me49Zh9fDw/VYUfq43IJmI1T+XrjiYONPND8GzaM".to_owned(),
        };
        let parts = request.into_parts().unwrap();
        assert_eq!(parts.target.host, "example.com");
        assert_eq!(parts.algorithm, "ssh-ed25519");
    }

    #[test]
    fn a_fingerprint_missing_the_sha256_prefix_is_rejected() {
        let request = RemoteHostKeyConfirmRequest {
            host: "example.com".to_owned(),
            port: 22,
            user: "octocat".to_owned(),
            algorithm: "ssh-ed25519".to_owned(),
            sha256_fingerprint: "Nh0Me49Zh9fDw/VYUfq43IJmI1T+XrjiYONPND8GzaM".to_owned(),
        };
        assert!(request.into_parts().is_err());
    }

    #[test]
    fn a_fingerprint_with_an_invalid_character_is_rejected() {
        let request = RemoteHostKeyConfirmRequest {
            host: "example.com".to_owned(),
            port: 22,
            user: "octocat".to_owned(),
            algorithm: "ssh-ed25519".to_owned(),
            sha256_fingerprint: "SHA256:not a valid base64 string!!".to_owned(),
        };
        assert!(request.into_parts().is_err());
    }

    #[test]
    fn an_empty_algorithm_is_rejected() {
        let request = RemoteHostKeyConfirmRequest {
            host: "example.com".to_owned(),
            port: 22,
            user: "octocat".to_owned(),
            algorithm: String::new(),
            sha256_fingerprint: "SHA256:Nh0Me49Zh9fDw/VYUfq43IJmI1T+XrjiYONPND8GzaM".to_owned(),
        };
        assert!(request.into_parts().is_err());
    }

    #[test]
    fn remote_session_id_round_trips_through_json() {
        let id = RemoteSessionId::new();
        let wire = serde_json::to_string(&id).unwrap();
        let decoded: RemoteSessionId = serde_json::from_str(&wire).unwrap();
        assert_eq!(decoded, id);
    }

    #[test]
    fn remote_session_id_rejects_a_non_v4_uuid() {
        let nil = serde_json::to_string("00000000-0000-0000-0000-000000000000").unwrap();
        assert!(serde_json::from_str::<RemoteSessionId>(&nil).is_err());
    }

    #[test]
    fn remote_session_id_debug_is_redacted() {
        let id = RemoteSessionId::new();
        assert!(!format!("{id:?}").contains(&id.as_wire()));
    }

    #[test]
    fn connect_result_serializes_with_the_audited_tag_and_case() {
        let connected = RemoteSessionConnectResult::Connected {
            session_id: RemoteSessionId::new(),
        };
        let value = serde_json::to_value(connected).unwrap();
        assert_eq!(value["status"], "connected");
        assert!(value.get("sessionId").is_some());

        let pending = RemoteSessionConnectResult::HostKeyPendingConfirmation {
            algorithm: "ssh-ed25519".to_owned(),
            sha256_fingerprint: "SHA256:abc".to_owned(),
            known_hosts_hit: true,
        };
        let value = serde_json::to_value(pending).unwrap();
        assert_eq!(value["status"], "hostKeyPendingConfirmation");
        assert_eq!(value["sha256Fingerprint"], "SHA256:abc");
        assert_eq!(value["knownHostsHit"], true);
    }

    #[test]
    fn disconnect_event_serializes_with_the_audited_reason_case() {
        let event = RemoteSessionEventPayload::Disconnected {
            session_id: RemoteSessionId::new(),
            host: "example.com".to_owned(),
            port: 22,
            user: "octocat".to_owned(),
            reason: RemoteSessionDisconnectReason::WindowClosed,
        };
        let value = serde_json::to_value(event).unwrap();
        assert_eq!(value["event"], "disconnected");
        assert_eq!(value["reason"], "windowClosed");
        assert!(value.get("sessionId").is_some());
        assert!(value.get("session_id").is_none());
    }
}
