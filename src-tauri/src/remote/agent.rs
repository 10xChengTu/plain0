//! Agent-only authentication — ADR 0006 §2: "唯一支持的认证方法是 ssh-agent
//! 签名"; Plain never implements password auth, never reads a private key
//! file off disk, never prompts for a passphrase, and never caches any
//! credential material itself. This module is the *only* place in the crate
//! that speaks the SSH agent protocol (`russh::keys::agent::client::AgentClient`)
//! — `session.rs`'s connect flow calls [`authenticate_with_agent`] and never
//! touches the agent client directly.
//!
//! # Production vs. test: same real agent-protocol client either way
//!
//! The only thing that differs between production and a hermetic test is
//! *which Unix socket path* this module connects to — [`authenticate_with_agent`]
//! takes `agent_socket_path` as an explicit parameter rather than reading
//! `SSH_AUTH_SOCK` itself, so `commands::remote_session_connect` (the real
//! production caller) resolves it once from the environment and a test can
//! instead point it at a real, hermetic `russh::keys::agent::server::serve`
//! instance listening on a temp-directory socket (see `session::tests`). The
//! agent wire protocol itself — `AgentClient::connect_uds`, `request_identities`,
//! and `Handle::authenticate_publickey_with`'s own `SignRequest`/`Signed`
//! round trip — is exactly the same code path in both cases; nothing here is
//! mocked.

use std::path::Path;
use std::time::Duration;

use russh::client::{AuthResult, Handle, Handler};
use russh::keys::agent::client::AgentClient;
use russh::keys::agent::AgentIdentity;
use russh::MethodKind;
use tokio::net::UnixStream;

use crate::error::CommandError;

use super::{
    remote_agent_auth_rejected, remote_agent_no_identities, remote_agent_timed_out,
    remote_agent_unavailable,
};

/// Wall-clock ceiling on the whole agent-authentication phase (connecting to
/// the agent, listing identities, and trying each one in turn) — independent
/// of [`super::session::REMOTE_CONNECT_TIMEOUT`]'s own TCP+handshake budget,
/// per ADR 0006 §5's "连接建立、认证…都有独立超时".
pub(crate) const REMOTE_AGENT_AUTH_TIMEOUT: Duration = Duration::from_secs(10);

/// Extracts the bare public key a `Handle::authenticate_publickey_with` call
/// needs from one agent-reported identity — a certificate identity is
/// authenticated by its own embedded public key (russh does not offer a
/// `Signer`-based certificate-authentication entry point; only the plain
/// public-key one), which is a disclosed narrowing this slice accepts: an
/// agent offering only certificate identities for a host is an uncommon
/// setup, and S1's job is proving the ordinary agent-key path end to end.
fn identity_public_key(identity: &AgentIdentity) -> russh::keys::ssh_key::PublicKey {
    match identity {
        AgentIdentity::PublicKey { key, .. } => key.clone(),
        AgentIdentity::Certificate { certificate, .. } => {
            russh::keys::ssh_key::PublicKey::from(certificate.public_key().clone())
        }
    }
}

/// Authenticates `handle` as `user`, trying every identity the agent at
/// `agent_socket_path` offers, in the order the agent reported them, until
/// one succeeds. Fails closed — [`remote_agent_unavailable`] if the socket
/// cannot be reached at all, [`remote_agent_no_identities`] if the agent has
/// no identities loaded, [`remote_agent_auth_rejected`] if every identity the
/// agent offered was rejected by the server — never leaking any key material
/// into an error message (only algorithm/comment-free identity counts).
pub(crate) async fn authenticate_with_agent<H: Handler>(
    handle: &mut Handle<H>,
    agent_socket_path: &Path,
    user: &str,
) -> Result<(), CommandError> {
    tokio::time::timeout(
        REMOTE_AGENT_AUTH_TIMEOUT,
        authenticate_with_agent_inner(handle, agent_socket_path, user),
    )
    .await
    .map_err(|_| remote_agent_timed_out())?
}

async fn authenticate_with_agent_inner<H: Handler>(
    handle: &mut Handle<H>,
    agent_socket_path: &Path,
    user: &str,
) -> Result<(), CommandError> {
    let stream = UnixStream::connect(agent_socket_path)
        .await
        .map_err(|_| remote_agent_unavailable())?;
    let mut agent = AgentClient::connect(stream);
    let identities = agent
        .request_identities()
        .await
        .map_err(|_| remote_agent_unavailable())?;
    if identities.is_empty() {
        return Err(remote_agent_no_identities());
    }

    // `Option<Option<HashAlg>>`: the outer `Option` is "did the server report
    // the `server-sig-algs` extension at all", the inner one is "does the
    // reported set include an rsa-sha2-* variant" — see
    // `Handle::best_supported_rsa_hash`'s own doc comment. Either "extension
    // absent" or a lookup error collapses to `None` (try without pinning a
    // hash algorithm, i.e. plain `ssh-rsa`), never a hard failure on its own:
    // this call is a best-effort optimization for RSA identities, not a
    // precondition for authenticating at all.
    let hash_alg = match handle.best_supported_rsa_hash().await {
        Ok(Some(algorithm)) => algorithm,
        Ok(None) | Err(_) => None,
    };

    for identity in &identities {
        let public_key = identity_public_key(identity);
        match handle
            .authenticate_publickey_with(user, public_key, hash_alg, &mut agent)
            .await
        {
            Ok(AuthResult::Success) => return Ok(()),
            Ok(AuthResult::Failure {
                remaining_methods, ..
            }) => {
                if !remaining_methods.contains(&MethodKind::PublicKey) {
                    // The server has ruled out public-key auth entirely for
                    // this user — trying the remaining identities can only
                    // ever reach the identical rejection, so stop early
                    // rather than paying for N more doomed round trips.
                    break;
                }
            }
            Err(_) => {
                // A single identity's own signing/protocol error does not
                // abort the whole loop — the agent (or this one key) may be
                // in a bad state while another identity still works, exactly
                // like a real OpenSSH client keeps trying its remaining
                // configured keys after one `IdentityFile` fails to sign.
            }
        }
    }
    Err(remote_agent_auth_rejected())
}
