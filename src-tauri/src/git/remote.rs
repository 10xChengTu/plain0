//! Read-only remote configuration inventory for `F180` S1A.
//!
//! This module deliberately does not use `git remote -v`: its human table is
//! whitespace-delimited and would make a URL containing whitespace
//! ambiguous. The remote-name command is line-safe because Git rejects LF in
//! remote names; URL values come from `git config -z --get-regexp`, whose
//! real Git 2.50.1 shape is `key\nvalue\0`. Native/local paths and URL
//! credentials are redacted before any value reaches the wire DTO.

use std::collections::BTreeMap;
use std::sync::atomic::AtomicBool;

use crate::error::CommandError;
use crate::trust::service::TrustService;

use super::exec::{run_git, GitExecMode};
use super::git_exec_unavailable;
use super::repo::{resolve_repo_toplevel, GitRepositoryScope};

pub(crate) const GIT_REMOTE_LIST_ARGS: &[&str] = &["remote"];
pub(crate) const GIT_REMOTE_CONFIG_ARGS: &[&str] = &[
    "config",
    "-z",
    "--get-regexp",
    "^remote\\..*\\.(url|pushurl)$",
];

const MAX_REMOTE_ENTRIES: usize = 256;
const MAX_URLS_PER_KIND: usize = 32;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RemoteEntry {
    pub(crate) name: String,
    pub(crate) fetch_urls: Vec<String>,
    pub(crate) push_urls: Vec<String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct RemoteList {
    pub(crate) entries: Vec<RemoteEntry>,
    pub(crate) truncated: bool,
}

#[derive(Default)]
struct RemoteAccumulator {
    fetch_urls: Vec<String>,
    push_urls: Vec<String>,
}

fn git_remote_list_failed() -> CommandError {
    CommandError::new(
        "GIT_REMOTE_LIST_FAILED",
        "The configured Git remotes could not be listed.",
    )
}

fn git_remote_parse_failed() -> CommandError {
    CommandError::new(
        "GIT_REMOTE_PARSE_FAILED",
        "The configured Git remote output could not be parsed.",
    )
}

fn looks_like_local_path(value: &str) -> bool {
    value.starts_with('/')
        || value.starts_with("./")
        || value.starts_with("../")
        || value.starts_with("file://")
        || value.starts_with("\\\\")
        || (value.len() >= 3
            && value.as_bytes()[0].is_ascii_alphabetic()
            && value.as_bytes()[1] == b':'
            && matches!(value.as_bytes()[2], b'\\' | b'/'))
}

/// Removes native paths, URL query/fragment values and URL/scp-style
/// userinfo. This is display-only output; mutations later receive the user's
/// newly-entered URL in a dedicated one-shot request and never round-trip a
/// redacted value back into Git.
pub(crate) fn redact_remote_location(raw: &[u8]) -> String {
    let value = String::from_utf8_lossy(raw);
    if looks_like_local_path(&value) {
        return if value.starts_with("file://") {
            "file://<local-path>".to_owned()
        } else {
            "<local-path>".to_owned()
        };
    }

    let sensitive_suffix = value
        .char_indices()
        .find_map(|(index, character)| matches!(character, '?' | '#').then_some(index));
    let (base, had_sensitive_suffix) = match sensitive_suffix {
        Some(index) => (&value[..index], true),
        None => (value.as_ref(), false),
    };

    let mut redacted = if let Some(scheme_end) = base.find("://") {
        let authority_start = scheme_end + 3;
        let authority_end = base[authority_start..]
            .find('/')
            .map_or(base.len(), |offset| authority_start + offset);
        let authority = &base[authority_start..authority_end];
        if let Some(at) = authority.rfind('@') {
            format!(
                "{}<redacted>@{}{}",
                &base[..authority_start],
                &authority[at + 1..],
                &base[authority_end..]
            )
        } else {
            base.to_owned()
        }
    } else if let Some(at) = base.find('@') {
        let after = &base[at + 1..];
        if after.contains(':') {
            format!("<redacted>@{after}")
        } else {
            base.to_owned()
        }
    } else {
        base.to_owned()
    };
    if had_sensitive_suffix {
        redacted.push_str("?<redacted>");
    }
    redacted
}

fn parse_remote_names(output: &[u8]) -> Result<Vec<Vec<u8>>, CommandError> {
    let mut names = Vec::new();
    for line in output.split(|byte| *byte == b'\n') {
        if line.is_empty() {
            continue;
        }
        if line.iter().any(|byte| *byte == 0 || *byte == b'\r') {
            return Err(git_remote_parse_failed());
        }
        names.push(line.to_vec());
    }
    Ok(names)
}

fn parse_remote_config(names: Vec<Vec<u8>>, output: &[u8]) -> Result<RemoteList, CommandError> {
    let mut remotes: BTreeMap<Vec<u8>, RemoteAccumulator> = names
        .into_iter()
        .map(|name| (name, RemoteAccumulator::default()))
        .collect();

    for record in output.split(|byte| *byte == 0) {
        if record.is_empty() {
            continue;
        }
        let Some(separator) = record.iter().position(|byte| *byte == b'\n') else {
            return Err(git_remote_parse_failed());
        };
        let key = &record[..separator];
        let value = &record[separator + 1..];
        let Some(rest) = key.strip_prefix(b"remote.") else {
            return Err(git_remote_parse_failed());
        };
        let (name, is_push) = if let Some(name) = rest.strip_suffix(b".pushurl") {
            (name, true)
        } else if let Some(name) = rest.strip_suffix(b".url") {
            (name, false)
        } else {
            return Err(git_remote_parse_failed());
        };
        if name.is_empty() {
            return Err(git_remote_parse_failed());
        }
        if value.is_empty() {
            continue;
        }
        let entry = remotes.entry(name.to_vec()).or_default();
        let urls = if is_push {
            &mut entry.push_urls
        } else {
            &mut entry.fetch_urls
        };
        if urls.len() < MAX_URLS_PER_KIND {
            urls.push(redact_remote_location(value));
        }
    }

    let truncated = remotes.len() > MAX_REMOTE_ENTRIES;
    let entries = remotes
        .into_iter()
        .take(MAX_REMOTE_ENTRIES)
        .map(|(name, value)| RemoteEntry {
            name: String::from_utf8_lossy(&name).into_owned(),
            fetch_urls: value.fetch_urls,
            push_urls: value.push_urls,
        })
        .collect();
    Ok(RemoteList { entries, truncated })
}

pub(crate) async fn list_remotes(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
) -> Result<RemoteList, CommandError> {
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    let list_args = GIT_REMOTE_LIST_ARGS
        .iter()
        .map(|arg| (*arg).to_owned())
        .collect::<Vec<_>>();
    let config_args = GIT_REMOTE_CONFIG_ARGS
        .iter()
        .map(|arg| (*arg).to_owned())
        .collect::<Vec<_>>();
    let cancel = AtomicBool::new(false);
    let (names_output, config_output) = tauri::async_runtime::spawn_blocking(move || {
        let names = run_git(&repo_dir, &list_args, GitExecMode::BackgroundRead, &cancel)?;
        let config = run_git(
            &repo_dir,
            &config_args,
            GitExecMode::BackgroundRead,
            &cancel,
        )?;
        Ok::<_, CommandError>((names, config))
    })
    .await
    .map_err(|_| git_exec_unavailable())??;

    if names_output.exit_code != 0 || !matches!(config_output.exit_code, 0 | 1) {
        return Err(git_remote_list_failed());
    }
    parse_remote_config(
        parse_remote_names(&names_output.stdout)?,
        &config_output.stdout,
    )
}

#[cfg(test)]
mod tests;
