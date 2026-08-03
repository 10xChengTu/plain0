//! Bounded contributor aggregation from machine-safe `git log` output.

use std::collections::BTreeMap;
use std::sync::atomic::AtomicBool;

use crate::error::CommandError;
use crate::trust::service::TrustService;

use super::exec::{run_git, GitExecMode};
use super::git_exec_unavailable;
use super::repo::{resolve_repo_toplevel, GitRepositoryScope};

pub(crate) const GIT_CONTRIBUTORS_ARGS: &[&str] = &["log", "--all", "-z", "--format=%aN%x00%aE"];

const MAX_CONTRIBUTOR_COMMITS: usize = 100_000;
const MAX_CONTRIBUTOR_ENTRIES: usize = 10_000;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ContributorEntry {
    pub(crate) name: String,
    pub(crate) email: String,
    pub(crate) commits: u32,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct ContributorList {
    pub(crate) entries: Vec<ContributorEntry>,
    pub(crate) truncated: bool,
}

fn git_contributors_list_failed() -> CommandError {
    CommandError::new(
        "GIT_CONTRIBUTORS_LIST_FAILED",
        "Git contributors could not be listed.",
    )
}

fn git_contributors_parse_failed() -> CommandError {
    CommandError::new(
        "GIT_CONTRIBUTORS_PARSE_FAILED",
        "The Git contributor output could not be parsed.",
    )
}

fn parse_contributors(
    output: &[u8],
    max_commits: usize,
    max_entries: usize,
) -> Result<ContributorList, CommandError> {
    if output.is_empty() {
        return Ok(ContributorList::default());
    }
    let Some(records) = output.strip_suffix(&[0]) else {
        return Err(git_contributors_parse_failed());
    };
    let fields = records.split(|byte| *byte == 0).collect::<Vec<_>>();
    if fields.len() % 2 != 0 {
        return Err(git_contributors_parse_failed());
    }

    let total_commits = fields.len() / 2;
    let mut counts: BTreeMap<(String, String), u32> = BTreeMap::new();
    for pair in fields.chunks_exact(2).take(max_commits) {
        let name = String::from_utf8_lossy(pair[0]).into_owned();
        let email = String::from_utf8_lossy(pair[1]).into_owned();
        let count = counts.entry((name, email)).or_default();
        *count = count.saturating_add(1);
    }

    let mut entries = counts
        .into_iter()
        .map(|((name, email), commits)| ContributorEntry {
            name,
            email,
            commits,
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| {
        right
            .commits
            .cmp(&left.commits)
            .then_with(|| left.name.cmp(&right.name))
            .then_with(|| left.email.cmp(&right.email))
    });
    let truncated = total_commits > max_commits || entries.len() > max_entries;
    entries.truncate(max_entries);
    Ok(ContributorList { entries, truncated })
}

pub(crate) async fn list_contributors(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
) -> Result<ContributorList, CommandError> {
    let repo_dir = resolve_repo_toplevel(trust, workspace, window_label).await?;
    let mut args = GIT_CONTRIBUTORS_ARGS
        .iter()
        .map(|arg| (*arg).to_owned())
        .collect::<Vec<_>>();
    args.push(format!("--max-count={}", MAX_CONTRIBUTOR_COMMITS + 1));
    let cancel = AtomicBool::new(false);
    let output = tauri::async_runtime::spawn_blocking(move || {
        run_git(&repo_dir, &args, GitExecMode::BackgroundRead, &cancel)
    })
    .await
    .map_err(|_| git_exec_unavailable())??;

    if output.exit_code != 0 {
        return Err(git_contributors_list_failed());
    }
    parse_contributors(
        &output.stdout,
        MAX_CONTRIBUTOR_COMMITS,
        MAX_CONTRIBUTOR_ENTRIES,
    )
}

#[cfg(test)]
mod tests;
