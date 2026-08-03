//! Bounded, read-only HEAD reflog inventory for `F180` S1A.

use std::sync::atomic::AtomicBool;

use crate::error::CommandError;
use crate::trust::service::TrustService;

use super::exec::{run_git, GitExecMode};
use super::git_exec_unavailable;
use super::remote::redact_remote_location;
use super::repo::{resolve_repo_toplevel, GitRepositoryScope};

pub(crate) const GIT_REFLOG_HEAD_CHECK_ARGS: &[&str] =
    &["rev-parse", "--verify", "--quiet", "HEAD"];
pub(crate) const GIT_REFLOG_ARGS: &[&str] =
    &["reflog", "show", "-z", "--format=%H%x1f%gD%x1f%ct%x1f%gs"];

const MAX_REFLOG_ENTRIES: usize = 500;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ReflogEntry {
    pub(crate) sha: String,
    pub(crate) selector: String,
    pub(crate) committer_time: i64,
    pub(crate) summary: String,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct ReflogList {
    pub(crate) entries: Vec<ReflogEntry>,
    pub(crate) truncated: bool,
}

fn git_reflog_list_failed() -> CommandError {
    CommandError::new(
        "GIT_REFLOG_LIST_FAILED",
        "The Git reflog could not be listed.",
    )
}

fn git_reflog_parse_failed() -> CommandError {
    CommandError::new(
        "GIT_REFLOG_PARSE_FAILED",
        "The Git reflog output could not be parsed.",
    )
}

fn is_lowercase_hex40(value: &[u8]) -> bool {
    value.len() == 40
        && value
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

fn sanitize_summary(raw: &[u8]) -> String {
    let summary = String::from_utf8_lossy(raw);
    if let Some(location) = summary.strip_prefix("clone: from ") {
        return format!(
            "clone: from {}",
            redact_remote_location(location.as_bytes())
        );
    }
    summary.into_owned()
}

fn parse_reflog(output: &[u8], max_entries: usize) -> Result<ReflogList, CommandError> {
    let mut entries = Vec::new();
    for record in output.split(|byte| *byte == 0) {
        if record.is_empty() {
            continue;
        }
        let mut fields = record.splitn(4, |byte| *byte == 0x1f);
        let sha = fields.next().ok_or_else(git_reflog_parse_failed)?;
        let selector = fields.next().ok_or_else(git_reflog_parse_failed)?;
        let committer_time = fields.next().ok_or_else(git_reflog_parse_failed)?;
        let summary = fields.next().ok_or_else(git_reflog_parse_failed)?;
        if !is_lowercase_hex40(sha) || selector.is_empty() {
            return Err(git_reflog_parse_failed());
        }
        let committer_time = std::str::from_utf8(committer_time)
            .ok()
            .and_then(|value| value.parse::<i64>().ok())
            .ok_or_else(git_reflog_parse_failed)?;
        entries.push(ReflogEntry {
            sha: String::from_utf8(sha.to_vec()).map_err(|_| git_reflog_parse_failed())?,
            selector: String::from_utf8_lossy(selector).into_owned(),
            committer_time,
            summary: sanitize_summary(summary),
        });
    }
    let truncated = entries.len() > max_entries;
    if truncated {
        entries.truncate(max_entries);
    }
    Ok(ReflogList { entries, truncated })
}

pub(crate) async fn list_reflog(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
) -> Result<ReflogList, CommandError> {
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    let head_args = GIT_REFLOG_HEAD_CHECK_ARGS
        .iter()
        .map(|arg| (*arg).to_owned())
        .collect::<Vec<_>>();
    let mut reflog_args = GIT_REFLOG_ARGS
        .iter()
        .map(|arg| (*arg).to_owned())
        .collect::<Vec<_>>();
    reflog_args.push(format!("--max-count={}", MAX_REFLOG_ENTRIES + 1));
    let cancel = AtomicBool::new(false);
    let output = tauri::async_runtime::spawn_blocking(move || {
        let head = run_git(&repo_dir, &head_args, GitExecMode::BackgroundRead, &cancel)?;
        if head.exit_code == 1 {
            return Ok::<_, CommandError>(None);
        }
        if head.exit_code != 0 || !is_lowercase_hex40(head.stdout.trim_ascii()) {
            return Err(git_reflog_list_failed());
        }
        let reflog = run_git(
            &repo_dir,
            &reflog_args,
            GitExecMode::BackgroundRead,
            &cancel,
        )?;
        Ok(Some(reflog))
    })
    .await
    .map_err(|_| git_exec_unavailable())??;

    let Some(output) = output else {
        return Ok(ReflogList::default());
    };
    if output.exit_code != 0 {
        return Err(git_reflog_list_failed());
    }
    parse_reflog(&output.stdout, MAX_REFLOG_ENTRIES)
}

#[cfg(test)]
mod tests;
