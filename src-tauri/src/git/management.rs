//! Trusted, root-bound branch/tag/remote/upstream mutations for `F180` S1B.
//!
//! Every public operation is a fixed Git command. Caller-supplied names are
//! first bounded as UTF-8 product inputs, then checked against their exact
//! namespace with `git check-ref-format`; existing refs/remotes are resolved
//! again immediately before the write. No generic argv seam is exposed.

use std::path::Path;
use std::sync::atomic::AtomicBool;

use crate::error::CommandError;
use crate::trust::service::TrustService;

use super::exec::{run_git, run_git_with_stdin, GitExecMode, GitExecOutput};
use super::git_exec_unavailable;
use super::repo::{resolve_repo_toplevel, GitRepositoryScope};

pub(crate) const GIT_BRANCH_CREATE_ARGS: &[&str] = &["branch", "--no-track", "--"];
pub(crate) const GIT_BRANCH_SWITCH_ARGS: &[&str] = &["switch", "--"];
pub(crate) const GIT_BRANCH_RENAME_ARGS: &[&str] = &["branch", "-m", "--"];
pub(crate) const GIT_BRANCH_DELETE_ARGS: &[&str] = &["branch", "-d", "--"];
pub(crate) const GIT_BRANCH_FORCE_DELETE_ARGS: &[&str] = &["branch", "-D", "--"];
pub(crate) const GIT_TAG_CREATE_ARGS: &[&str] = &["tag", "--"];
pub(crate) const GIT_TAG_CREATE_ANNOTATED_ARGS: &[&str] =
    &["tag", "-a", "--cleanup=verbatim", "-F", "-", "--"];
pub(crate) const GIT_TAG_DELETE_ARGS: &[&str] = &["tag", "-d", "--"];
pub(crate) const GIT_REMOTE_ADD_ARGS: &[&str] = &["remote", "add", "--"];
pub(crate) const GIT_REMOTE_RENAME_ARGS: &[&str] = &["remote", "rename", "--"];
pub(crate) const GIT_REMOTE_SET_FETCH_URL_ARGS: &[&str] = &["remote", "set-url", "--"];
pub(crate) const GIT_REMOTE_SET_PUSH_URL_ARGS: &[&str] = &["remote", "set-url", "--push", "--"];
pub(crate) const GIT_REMOTE_REMOVE_ARGS: &[&str] = &["remote", "remove", "--"];
pub(crate) const GIT_UPSTREAM_UNSET_ARGS: &[&str] = &["branch", "--unset-upstream", "--"];
pub(crate) const GIT_UPSTREAM_SET_OPTION_PREFIX: &str = "--set-upstream-to=";

pub(crate) const MAX_GIT_REF_NAME_BYTES: usize = 1_024;
pub(crate) const MAX_GIT_REMOTE_NAME_BYTES: usize = 255;
pub(crate) const MAX_GIT_REMOTE_URL_BYTES: usize = 4_096;
pub(crate) const MAX_GIT_TAG_MESSAGE_BYTES: usize = 100_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RemoteUrlKind {
    Fetch,
    Push,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum BranchDeleteOutcome {
    Deleted,
    NeedsForce,
}

fn error(code: &'static str, message: &'static str) -> CommandError {
    CommandError::new(code, message)
}

fn invalid_branch_name() -> CommandError {
    error("GIT_BRANCH_NAME_INVALID", "The Git branch name is invalid.")
}

fn invalid_tag_name() -> CommandError {
    error("GIT_TAG_NAME_INVALID", "The Git tag name is invalid.")
}

fn invalid_remote_name() -> CommandError {
    error("GIT_REMOTE_NAME_INVALID", "The Git remote name is invalid.")
}

fn invalid_remote_url() -> CommandError {
    error("GIT_REMOTE_URL_INVALID", "The Git remote URL is invalid.")
}

fn invalid_upstream_name() -> CommandError {
    error(
        "GIT_UPSTREAM_NAME_INVALID",
        "The Git upstream branch name is invalid.",
    )
}

fn invalid_commit() -> CommandError {
    error(
        "GIT_MANAGEMENT_COMMIT_INVALID",
        "The requested Git commit does not exist.",
    )
}

fn invalid_tag_message() -> CommandError {
    error(
        "GIT_TAG_MESSAGE_INVALID",
        "The annotated Git tag message is empty or too large.",
    )
}

fn management_state_failed() -> CommandError {
    error(
        "GIT_MANAGEMENT_STATE_FAILED",
        "The current Git reference state could not be read.",
    )
}

fn branch_not_found() -> CommandError {
    error(
        "GIT_BRANCH_NOT_FOUND",
        "The requested Git branch does not exist.",
    )
}

fn branch_already_exists() -> CommandError {
    error(
        "GIT_BRANCH_ALREADY_EXISTS",
        "A Git branch with that name already exists.",
    )
}

fn branch_is_current() -> CommandError {
    error(
        "GIT_BRANCH_IS_CURRENT",
        "The currently checked-out Git branch cannot be deleted.",
    )
}

fn branch_create_failed() -> CommandError {
    error(
        "GIT_BRANCH_CREATE_FAILED",
        "The Git branch could not be created.",
    )
}

fn branch_switch_failed() -> CommandError {
    error(
        "GIT_BRANCH_SWITCH_FAILED",
        "The Git branch could not be switched.",
    )
}

fn branch_switch_would_overwrite() -> CommandError {
    error(
        "GIT_BRANCH_SWITCH_WOULD_OVERWRITE",
        "Local changes would be overwritten by switching Git branches.",
    )
}

fn branch_in_use() -> CommandError {
    error(
        "GIT_BRANCH_IN_USE",
        "The Git branch is checked out in another worktree.",
    )
}

fn branch_rename_failed() -> CommandError {
    error(
        "GIT_BRANCH_RENAME_FAILED",
        "The Git branch could not be renamed.",
    )
}

fn branch_delete_failed() -> CommandError {
    error(
        "GIT_BRANCH_DELETE_FAILED",
        "The Git branch could not be deleted.",
    )
}

fn tag_not_found() -> CommandError {
    error("GIT_TAG_NOT_FOUND", "The requested Git tag does not exist.")
}

fn tag_already_exists() -> CommandError {
    error(
        "GIT_TAG_ALREADY_EXISTS",
        "A Git tag with that name already exists.",
    )
}

fn tag_create_failed() -> CommandError {
    error("GIT_TAG_CREATE_FAILED", "The Git tag could not be created.")
}

fn tag_delete_failed() -> CommandError {
    error("GIT_TAG_DELETE_FAILED", "The Git tag could not be deleted.")
}

fn remote_not_found() -> CommandError {
    error(
        "GIT_REMOTE_NOT_FOUND",
        "The requested Git remote does not exist.",
    )
}

fn remote_already_exists() -> CommandError {
    error(
        "GIT_REMOTE_ALREADY_EXISTS",
        "A Git remote with that name already exists.",
    )
}

fn remote_add_failed() -> CommandError {
    error(
        "GIT_REMOTE_ADD_FAILED",
        "The Git remote could not be added.",
    )
}

fn remote_rename_failed() -> CommandError {
    error(
        "GIT_REMOTE_RENAME_FAILED",
        "The Git remote could not be renamed.",
    )
}

fn remote_set_url_failed() -> CommandError {
    error(
        "GIT_REMOTE_SET_URL_FAILED",
        "The Git remote URL could not be changed.",
    )
}

fn remote_remove_failed() -> CommandError {
    error(
        "GIT_REMOTE_REMOVE_FAILED",
        "The Git remote could not be removed.",
    )
}

fn upstream_not_found() -> CommandError {
    error(
        "GIT_UPSTREAM_NOT_FOUND",
        "The requested remote-tracking branch does not exist.",
    )
}

fn upstream_not_configured() -> CommandError {
    error(
        "GIT_UPSTREAM_NOT_CONFIGURED",
        "The requested local branch has no configured upstream.",
    )
}

fn upstream_set_failed() -> CommandError {
    error(
        "GIT_UPSTREAM_SET_FAILED",
        "The Git upstream could not be set.",
    )
}

fn upstream_unset_failed() -> CommandError {
    error(
        "GIT_UPSTREAM_UNSET_FAILED",
        "The Git upstream could not be unset.",
    )
}

fn is_lowercase_hex40(value: &str) -> bool {
    value.len() == 40
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn validate_name_shape(
    value: &str,
    max_bytes: usize,
    allow_slash: bool,
    on_invalid: fn() -> CommandError,
) -> Result<(), CommandError> {
    if value.is_empty()
        || value.len() > max_bytes
        || value.starts_with('-')
        || value.starts_with("refs/")
        || value.chars().any(char::is_control)
        || (!allow_slash && value.contains('/'))
    {
        return Err(on_invalid());
    }
    Ok(())
}

fn validate_remote_url(value: &str) -> Result<(), CommandError> {
    if value.is_empty()
        || value.len() > MAX_GIT_REMOTE_URL_BYTES
        || value.chars().any(char::is_control)
    {
        return Err(invalid_remote_url());
    }
    Ok(())
}

fn strings(args: &[&str]) -> Vec<String> {
    args.iter().map(|arg| (*arg).to_owned()).collect()
}

fn run_read(repo_dir: &Path, args: Vec<String>) -> Result<GitExecOutput, CommandError> {
    let cancel = AtomicBool::new(false);
    run_git(repo_dir, &args, GitExecMode::BackgroundRead, &cancel)
}

fn run_write(repo_dir: &Path, args: Vec<String>) -> Result<GitExecOutput, CommandError> {
    let cancel = AtomicBool::new(false);
    run_git(repo_dir, &args, GitExecMode::Write, &cancel)
}

fn validate_full_ref(
    repo_dir: &Path,
    full_ref: &str,
    on_invalid: fn() -> CommandError,
) -> Result<(), CommandError> {
    let output = run_read(
        repo_dir,
        vec!["check-ref-format".to_owned(), full_ref.to_owned()],
    )?;
    if output.exit_code == 0 {
        Ok(())
    } else {
        Err(on_invalid())
    }
}

fn ref_exists(repo_dir: &Path, full_ref: &str) -> Result<bool, CommandError> {
    let output = run_read(
        repo_dir,
        vec![
            "show-ref".to_owned(),
            "--verify".to_owned(),
            "--quiet".to_owned(),
            full_ref.to_owned(),
        ],
    )?;
    match output.exit_code {
        0 => Ok(true),
        1 => Ok(false),
        _ => Err(management_state_failed()),
    }
}

fn ensure_commit(repo_dir: &Path, sha: &str) -> Result<(), CommandError> {
    if !is_lowercase_hex40(sha) {
        return Err(invalid_commit());
    }
    let output = run_read(
        repo_dir,
        vec![
            "cat-file".to_owned(),
            "-e".to_owned(),
            format!("{sha}^{{commit}}"),
        ],
    )?;
    if output.exit_code == 0 {
        Ok(())
    } else {
        Err(invalid_commit())
    }
}

fn remote_names(repo_dir: &Path) -> Result<Vec<Vec<u8>>, CommandError> {
    let output = run_read(repo_dir, vec!["remote".to_owned()])?;
    if output.exit_code != 0 {
        return Err(management_state_failed());
    }
    let mut names = Vec::new();
    for line in output.stdout.split(|byte| *byte == b'\n') {
        if line.is_empty() {
            continue;
        }
        if line.iter().any(|byte| *byte == 0 || *byte == b'\r') {
            return Err(management_state_failed());
        }
        names.push(line.to_vec());
    }
    Ok(names)
}

fn remote_exists(repo_dir: &Path, name: &str) -> Result<bool, CommandError> {
    Ok(remote_names(repo_dir)?
        .iter()
        .any(|candidate| candidate.as_slice() == name.as_bytes()))
}

fn current_branch(repo_dir: &Path) -> Result<Option<Vec<u8>>, CommandError> {
    let output = run_read(
        repo_dir,
        vec![
            "symbolic-ref".to_owned(),
            "--quiet".to_owned(),
            "HEAD".to_owned(),
        ],
    )?;
    if output.exit_code == 1 {
        return Ok(None);
    }
    if output.exit_code != 0 {
        return Err(management_state_failed());
    }
    let Some(value) = output.stdout.strip_suffix(b"\n") else {
        return Err(management_state_failed());
    };
    if value.is_empty() || value.contains(&0) || value.contains(&b'\r') {
        return Err(management_state_failed());
    }
    Ok(Some(value.to_vec()))
}

fn combined_output(output: &GitExecOutput) -> String {
    format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
}

async fn resolve_repo(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
) -> Result<std::path::PathBuf, CommandError> {
    resolve_repo_toplevel(trust, workspace, window_label).await
}

pub(crate) async fn create_branch(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    name: &str,
    target_sha: &str,
) -> Result<(), CommandError> {
    validate_name_shape(name, MAX_GIT_REF_NAME_BYTES, true, invalid_branch_name)?;
    if !is_lowercase_hex40(target_sha) {
        return Err(invalid_commit());
    }
    let repo_dir = resolve_repo(trust, workspace, window_label).await?;
    let name = name.to_owned();
    let target_sha = target_sha.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let full_ref = format!("refs/heads/{name}");
        validate_full_ref(&repo_dir, &full_ref, invalid_branch_name)?;
        if ref_exists(&repo_dir, &full_ref)? {
            return Err(branch_already_exists());
        }
        ensure_commit(&repo_dir, &target_sha)?;
        let mut args = strings(GIT_BRANCH_CREATE_ARGS);
        args.extend([name, target_sha]);
        if run_write(&repo_dir, args)?.exit_code == 0 {
            Ok(())
        } else {
            Err(branch_create_failed())
        }
    })
    .await
    .map_err(|_| git_exec_unavailable())?
}

pub(crate) async fn switch_branch(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    name: &str,
) -> Result<(), CommandError> {
    validate_name_shape(name, MAX_GIT_REF_NAME_BYTES, true, invalid_branch_name)?;
    let repo_dir = resolve_repo(trust, workspace, window_label).await?;
    let name = name.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let full_ref = format!("refs/heads/{name}");
        validate_full_ref(&repo_dir, &full_ref, invalid_branch_name)?;
        if !ref_exists(&repo_dir, &full_ref)? {
            return Err(branch_not_found());
        }
        let mut args = strings(GIT_BRANCH_SWITCH_ARGS);
        args.push(name);
        let output = run_write(&repo_dir, args)?;
        if output.exit_code == 0 {
            return Ok(());
        }
        let combined = combined_output(&output);
        if combined.contains("would be overwritten by checkout")
            || combined.contains("would be overwritten by switch")
        {
            Err(branch_switch_would_overwrite())
        } else if combined.contains("already checked out at") {
            Err(branch_in_use())
        } else {
            Err(branch_switch_failed())
        }
    })
    .await
    .map_err(|_| git_exec_unavailable())?
}

pub(crate) async fn rename_branch(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    old_name: &str,
    new_name: &str,
) -> Result<(), CommandError> {
    validate_name_shape(old_name, MAX_GIT_REF_NAME_BYTES, true, invalid_branch_name)?;
    validate_name_shape(new_name, MAX_GIT_REF_NAME_BYTES, true, invalid_branch_name)?;
    let repo_dir = resolve_repo(trust, workspace, window_label).await?;
    let old_name = old_name.to_owned();
    let new_name = new_name.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let old_ref = format!("refs/heads/{old_name}");
        let new_ref = format!("refs/heads/{new_name}");
        validate_full_ref(&repo_dir, &old_ref, invalid_branch_name)?;
        validate_full_ref(&repo_dir, &new_ref, invalid_branch_name)?;
        if !ref_exists(&repo_dir, &old_ref)? {
            return Err(branch_not_found());
        }
        if ref_exists(&repo_dir, &new_ref)? {
            return Err(branch_already_exists());
        }
        let mut args = strings(GIT_BRANCH_RENAME_ARGS);
        args.extend([old_name, new_name]);
        if run_write(&repo_dir, args)?.exit_code == 0 {
            Ok(())
        } else {
            Err(branch_rename_failed())
        }
    })
    .await
    .map_err(|_| git_exec_unavailable())?
}

pub(crate) async fn delete_branch(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    name: &str,
    force: bool,
) -> Result<BranchDeleteOutcome, CommandError> {
    validate_name_shape(name, MAX_GIT_REF_NAME_BYTES, true, invalid_branch_name)?;
    let repo_dir = resolve_repo(trust, workspace, window_label).await?;
    let name = name.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let full_ref = format!("refs/heads/{name}");
        validate_full_ref(&repo_dir, &full_ref, invalid_branch_name)?;
        if !ref_exists(&repo_dir, &full_ref)? {
            return Err(branch_not_found());
        }
        if current_branch(&repo_dir)?.as_deref() == Some(full_ref.as_bytes()) {
            return Err(branch_is_current());
        }
        let mut args = strings(if force {
            GIT_BRANCH_FORCE_DELETE_ARGS
        } else {
            GIT_BRANCH_DELETE_ARGS
        });
        args.push(name);
        let output = run_write(&repo_dir, args)?;
        if output.exit_code == 0 {
            return Ok(BranchDeleteOutcome::Deleted);
        }
        let combined = combined_output(&output);
        if !force && combined.contains("not fully merged") {
            Ok(BranchDeleteOutcome::NeedsForce)
        } else if combined.contains("checked out at") {
            Err(branch_in_use())
        } else {
            Err(branch_delete_failed())
        }
    })
    .await
    .map_err(|_| git_exec_unavailable())?
}

pub(crate) async fn create_tag(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    name: &str,
    target_sha: &str,
    message: Option<&str>,
) -> Result<(), CommandError> {
    validate_name_shape(name, MAX_GIT_REF_NAME_BYTES, true, invalid_tag_name)?;
    if !is_lowercase_hex40(target_sha) {
        return Err(invalid_commit());
    }
    if message
        .is_some_and(|value| value.trim().is_empty() || value.len() > MAX_GIT_TAG_MESSAGE_BYTES)
    {
        return Err(invalid_tag_message());
    }
    let repo_dir = resolve_repo(trust, workspace, window_label).await?;
    let name = name.to_owned();
    let target_sha = target_sha.to_owned();
    let message = message.map(str::to_owned);
    tauri::async_runtime::spawn_blocking(move || {
        let full_ref = format!("refs/tags/{name}");
        validate_full_ref(&repo_dir, &full_ref, invalid_tag_name)?;
        if ref_exists(&repo_dir, &full_ref)? {
            return Err(tag_already_exists());
        }
        ensure_commit(&repo_dir, &target_sha)?;
        let output = if let Some(message) = message {
            let mut args = strings(GIT_TAG_CREATE_ANNOTATED_ARGS);
            args.extend([name, target_sha]);
            let cancel = AtomicBool::new(false);
            run_git_with_stdin(
                &repo_dir,
                &args,
                GitExecMode::Write,
                &cancel,
                message.as_bytes(),
            )?
        } else {
            let mut args = strings(GIT_TAG_CREATE_ARGS);
            args.extend([name, target_sha]);
            run_write(&repo_dir, args)?
        };
        if output.exit_code == 0 {
            Ok(())
        } else {
            Err(tag_create_failed())
        }
    })
    .await
    .map_err(|_| git_exec_unavailable())?
}

pub(crate) async fn delete_tag(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    name: &str,
) -> Result<(), CommandError> {
    validate_name_shape(name, MAX_GIT_REF_NAME_BYTES, true, invalid_tag_name)?;
    let repo_dir = resolve_repo(trust, workspace, window_label).await?;
    let name = name.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let full_ref = format!("refs/tags/{name}");
        validate_full_ref(&repo_dir, &full_ref, invalid_tag_name)?;
        if !ref_exists(&repo_dir, &full_ref)? {
            return Err(tag_not_found());
        }
        let mut args = strings(GIT_TAG_DELETE_ARGS);
        args.push(name);
        if run_write(&repo_dir, args)?.exit_code == 0 {
            Ok(())
        } else {
            Err(tag_delete_failed())
        }
    })
    .await
    .map_err(|_| git_exec_unavailable())?
}

pub(crate) async fn add_remote(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    name: &str,
    url: &str,
) -> Result<(), CommandError> {
    validate_name_shape(name, MAX_GIT_REMOTE_NAME_BYTES, false, invalid_remote_name)?;
    validate_remote_url(url)?;
    let repo_dir = resolve_repo(trust, workspace, window_label).await?;
    let name = name.to_owned();
    let url = url.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        validate_full_ref(
            &repo_dir,
            &format!("refs/remotes/{name}/plain-validation"),
            invalid_remote_name,
        )?;
        if remote_exists(&repo_dir, &name)? {
            return Err(remote_already_exists());
        }
        let mut args = strings(GIT_REMOTE_ADD_ARGS);
        args.extend([name, url]);
        if run_write(&repo_dir, args)?.exit_code == 0 {
            Ok(())
        } else {
            Err(remote_add_failed())
        }
    })
    .await
    .map_err(|_| git_exec_unavailable())?
}

pub(crate) async fn rename_remote(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    old_name: &str,
    new_name: &str,
) -> Result<(), CommandError> {
    validate_name_shape(
        old_name,
        MAX_GIT_REMOTE_NAME_BYTES,
        false,
        invalid_remote_name,
    )?;
    validate_name_shape(
        new_name,
        MAX_GIT_REMOTE_NAME_BYTES,
        false,
        invalid_remote_name,
    )?;
    let repo_dir = resolve_repo(trust, workspace, window_label).await?;
    let old_name = old_name.to_owned();
    let new_name = new_name.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        validate_full_ref(
            &repo_dir,
            &format!("refs/remotes/{old_name}/plain-validation"),
            invalid_remote_name,
        )?;
        validate_full_ref(
            &repo_dir,
            &format!("refs/remotes/{new_name}/plain-validation"),
            invalid_remote_name,
        )?;
        if !remote_exists(&repo_dir, &old_name)? {
            return Err(remote_not_found());
        }
        if remote_exists(&repo_dir, &new_name)? {
            return Err(remote_already_exists());
        }
        let mut args = strings(GIT_REMOTE_RENAME_ARGS);
        args.extend([old_name, new_name]);
        if run_write(&repo_dir, args)?.exit_code == 0 {
            Ok(())
        } else {
            Err(remote_rename_failed())
        }
    })
    .await
    .map_err(|_| git_exec_unavailable())?
}

pub(crate) async fn set_remote_url(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    name: &str,
    kind: RemoteUrlKind,
    url: &str,
) -> Result<(), CommandError> {
    validate_name_shape(name, MAX_GIT_REMOTE_NAME_BYTES, false, invalid_remote_name)?;
    validate_remote_url(url)?;
    let repo_dir = resolve_repo(trust, workspace, window_label).await?;
    let name = name.to_owned();
    let url = url.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        validate_full_ref(
            &repo_dir,
            &format!("refs/remotes/{name}/plain-validation"),
            invalid_remote_name,
        )?;
        if !remote_exists(&repo_dir, &name)? {
            return Err(remote_not_found());
        }
        let mut args = strings(match kind {
            RemoteUrlKind::Fetch => GIT_REMOTE_SET_FETCH_URL_ARGS,
            RemoteUrlKind::Push => GIT_REMOTE_SET_PUSH_URL_ARGS,
        });
        args.extend([name, url]);
        if run_write(&repo_dir, args)?.exit_code == 0 {
            Ok(())
        } else {
            Err(remote_set_url_failed())
        }
    })
    .await
    .map_err(|_| git_exec_unavailable())?
}

pub(crate) async fn remove_remote(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    name: &str,
) -> Result<(), CommandError> {
    validate_name_shape(name, MAX_GIT_REMOTE_NAME_BYTES, false, invalid_remote_name)?;
    let repo_dir = resolve_repo(trust, workspace, window_label).await?;
    let name = name.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        validate_full_ref(
            &repo_dir,
            &format!("refs/remotes/{name}/plain-validation"),
            invalid_remote_name,
        )?;
        if !remote_exists(&repo_dir, &name)? {
            return Err(remote_not_found());
        }
        let mut args = strings(GIT_REMOTE_REMOVE_ARGS);
        args.push(name);
        if run_write(&repo_dir, args)?.exit_code == 0 {
            Ok(())
        } else {
            Err(remote_remove_failed())
        }
    })
    .await
    .map_err(|_| git_exec_unavailable())?
}

pub(crate) async fn set_upstream(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    branch: &str,
    upstream: &str,
) -> Result<(), CommandError> {
    validate_name_shape(branch, MAX_GIT_REF_NAME_BYTES, true, invalid_branch_name)?;
    validate_name_shape(
        upstream,
        MAX_GIT_REF_NAME_BYTES,
        true,
        invalid_upstream_name,
    )?;
    if !upstream.contains('/') || upstream.starts_with('/') || upstream.ends_with('/') {
        return Err(invalid_upstream_name());
    }
    let repo_dir = resolve_repo(trust, workspace, window_label).await?;
    let branch = branch.to_owned();
    let upstream = upstream.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let local_ref = format!("refs/heads/{branch}");
        let upstream_ref = format!("refs/remotes/{upstream}");
        validate_full_ref(&repo_dir, &local_ref, invalid_branch_name)?;
        validate_full_ref(&repo_dir, &upstream_ref, invalid_upstream_name)?;
        if !ref_exists(&repo_dir, &local_ref)? {
            return Err(branch_not_found());
        }
        if !ref_exists(&repo_dir, &upstream_ref)? {
            return Err(upstream_not_found());
        }
        let remote_name = upstream
            .split_once('/')
            .expect("validated upstream contains a slash")
            .0;
        if !remote_exists(&repo_dir, remote_name)? {
            return Err(upstream_not_found());
        }
        let args = vec![
            "branch".to_owned(),
            format!("{GIT_UPSTREAM_SET_OPTION_PREFIX}{upstream}"),
            branch,
        ];
        if run_write(&repo_dir, args)?.exit_code == 0 {
            Ok(())
        } else {
            Err(upstream_set_failed())
        }
    })
    .await
    .map_err(|_| git_exec_unavailable())?
}

pub(crate) async fn unset_upstream(
    trust: &TrustService,
    workspace: &(impl GitRepositoryScope + ?Sized),
    window_label: &str,
    branch: &str,
) -> Result<(), CommandError> {
    validate_name_shape(branch, MAX_GIT_REF_NAME_BYTES, true, invalid_branch_name)?;
    let repo_dir = resolve_repo(trust, workspace, window_label).await?;
    let branch = branch.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let local_ref = format!("refs/heads/{branch}");
        validate_full_ref(&repo_dir, &local_ref, invalid_branch_name)?;
        if !ref_exists(&repo_dir, &local_ref)? {
            return Err(branch_not_found());
        }
        let mut args = strings(GIT_UPSTREAM_UNSET_ARGS);
        args.push(branch);
        let output = run_write(&repo_dir, args)?;
        if output.exit_code == 0 {
            return Ok(());
        }
        if combined_output(&output).contains("has no upstream information") {
            Err(upstream_not_configured())
        } else {
            Err(upstream_unset_failed())
        }
    })
    .await
    .map_err(|_| git_exec_unavailable())?
}

#[cfg(test)]
mod tests;
