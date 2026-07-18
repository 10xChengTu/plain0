use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use crate::error::CommandError;
use crate::path_policy::RelativePath;

use super::dto::{
    WorkspaceEntryStat, WorkspacePickRootsMode, WorkspacePickRootsResult, WorkspacePickRootsStatus,
    WorkspaceReadDirectoryResult, WorkspaceSnapshot,
};
use super::picker::{DirectoryPicker, DirectoryPickerResult};
use super::reader;
use super::{RootId, WorkspaceRootLease, WorkspaceScope};

#[derive(Default)]
pub struct WorkspaceService {
    windows: Mutex<HashMap<String, Arc<WindowWorkspace>>>,
}

impl WorkspaceService {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn snapshot(&self, window_label: &str) -> Result<WorkspaceSnapshot, CommandError> {
        self.scope_for_window(window_label)?.snapshot()
    }

    pub async fn pick_roots<P: DirectoryPicker>(
        &self,
        window_label: &str,
        picker: P,
        mode: WorkspacePickRootsMode,
    ) -> Result<WorkspacePickRootsResult, CommandError> {
        let workspace = self.scope_for_window(window_label)?;
        let picker_token = workspace.begin_picker()?;
        let selection = match picker.pick_directories(mode.allows_multiple()).await {
            Ok(selection) => selection,
            Err(error) => {
                workspace.abort_picker(picker_token)?;
                return Err(error);
            }
        };

        tauri::async_runtime::spawn_blocking(move || {
            workspace.finish_picker(picker_token, mode, selection)
        })
        .await
        .map_err(|_| workspace_operation_failed())?
    }

    pub fn remove_root(
        &self,
        window_label: &str,
        root_id: RootId,
    ) -> Result<WorkspaceSnapshot, CommandError> {
        self.scope_for_window(window_label)?.remove_root(root_id)
    }

    pub async fn stat(
        &self,
        window_label: &str,
        root_id: RootId,
        relative_path: RelativePath,
    ) -> Result<WorkspaceEntryStat, CommandError> {
        self.run_reader(window_label, root_id, move |lease| {
            reader::stat(&lease, &relative_path)
        })
        .await
    }

    pub async fn read_directory(
        &self,
        window_label: &str,
        root_id: RootId,
        relative_path: RelativePath,
    ) -> Result<WorkspaceReadDirectoryResult, CommandError> {
        self.run_reader(window_label, root_id, move |lease| {
            reader::read_directory(&lease, &relative_path)
        })
        .await
    }

    pub fn close_window(&self, window_label: &str) {
        let Ok(mut windows) = self.windows.lock() else {
            return;
        };
        if let Some(workspace) = windows.get(window_label) {
            workspace.close();
        }
        windows.remove(window_label);
    }

    fn scope_for_window(&self, window_label: &str) -> Result<Arc<WindowWorkspace>, CommandError> {
        let mut windows = lock(&self.windows)?;
        Ok(windows
            .entry(window_label.to_owned())
            .or_insert_with(|| Arc::new(WindowWorkspace::new()))
            .clone())
    }

    async fn run_reader<T, F>(
        &self,
        window_label: &str,
        root_id: RootId,
        operation: F,
    ) -> Result<T, CommandError>
    where
        T: Send + 'static,
        F: FnOnce(WorkspaceRootLease) -> Result<T, CommandError> + Send + 'static,
    {
        let workspace = self.scope_for_window(window_label)?;
        let lease = workspace.lease(root_id)?;
        let leased_root_id = lease.root_id();
        let result = tauri::async_runtime::spawn_blocking(move || operation(lease))
            .await
            .map_err(|_| workspace_read_failed());
        workspace.validate_lease(leased_root_id)?;
        result?
    }
}

struct WindowWorkspace {
    state: Mutex<WindowWorkspaceState>,
}

impl WindowWorkspace {
    fn new() -> Self {
        Self {
            state: Mutex::new(WindowWorkspaceState {
                scope: WorkspaceScope::new(),
                next_picker_token: 0,
                active_picker: None,
                closed: false,
            }),
        }
    }

    fn snapshot(&self) -> Result<WorkspaceSnapshot, CommandError> {
        let state = lock(&self.state)?;
        ensure_open(&state)?;
        Ok(state.scope.snapshot())
    }

    fn begin_picker(&self) -> Result<u64, CommandError> {
        let mut state = lock(&self.state)?;
        ensure_open(&state)?;
        if state.active_picker.is_some() {
            return Err(picker_already_active());
        }
        state.next_picker_token = state
            .next_picker_token
            .checked_add(1)
            .ok_or_else(workspace_conflict)?;
        let token = state.next_picker_token;
        state.active_picker = Some(token);
        Ok(token)
    }

    fn abort_picker(&self, token: u64) -> Result<(), CommandError> {
        let mut state = lock(&self.state)?;
        ensure_active_picker(&state, token)?;
        state.active_picker = None;
        Ok(())
    }

    fn finish_picker(
        &self,
        token: u64,
        mode: WorkspacePickRootsMode,
        selection: DirectoryPickerResult,
    ) -> Result<WorkspacePickRootsResult, CommandError> {
        let mut state = lock(&self.state)?;
        ensure_active_picker(&state, token)?;

        let status = match selection {
            DirectoryPickerResult::Selected(paths) if paths.is_empty() => {
                WorkspacePickRootsStatus::Cancelled
            }
            DirectoryPickerResult::Selected(paths) => {
                let authorization = match mode {
                    WorkspacePickRootsMode::Add => {
                        state.scope.authorize_roots_atomically(&paths).map(|_| ())
                    }
                    WorkspacePickRootsMode::Replace => match paths.as_slice() {
                        [path] => state.scope.replace_root_atomically(path).map(|_| ()),
                        _ => Err(invalid_picker_selection()),
                    },
                };
                state.active_picker = None;
                authorization?;
                return Ok(WorkspacePickRootsResult::new(
                    WorkspacePickRootsStatus::Selected,
                    state.scope.snapshot(),
                ));
            }
            DirectoryPickerResult::Cancelled => WorkspacePickRootsStatus::Cancelled,
        };
        state.active_picker = None;
        Ok(WorkspacePickRootsResult::new(
            status,
            state.scope.snapshot(),
        ))
    }

    fn remove_root(&self, root_id: RootId) -> Result<WorkspaceSnapshot, CommandError> {
        let mut state = lock(&self.state)?;
        ensure_open(&state)?;
        state.scope.remove(root_id)?;
        Ok(state.scope.snapshot())
    }

    fn lease(&self, root_id: RootId) -> Result<WorkspaceRootLease, CommandError> {
        let state = lock(&self.state)?;
        ensure_open(&state)?;
        state.scope.lease(root_id)
    }

    fn validate_lease(&self, root_id: RootId) -> Result<(), CommandError> {
        let state = lock(&self.state)?;
        ensure_open(&state)?;
        if state.scope.contains_root(root_id) {
            Ok(())
        } else {
            Err(root_not_authorized())
        }
    }

    fn close(&self) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        state.closed = true;
        state.active_picker = None;
    }
}

struct WindowWorkspaceState {
    scope: WorkspaceScope,
    next_picker_token: u64,
    active_picker: Option<u64>,
    closed: bool,
}

fn ensure_open(state: &WindowWorkspaceState) -> Result<(), CommandError> {
    if state.closed {
        Err(window_closed())
    } else {
        Ok(())
    }
}

fn ensure_active_picker(state: &WindowWorkspaceState, token: u64) -> Result<(), CommandError> {
    ensure_open(state)?;
    if state.active_picker == Some(token) {
        Ok(())
    } else {
        Err(window_closed())
    }
}

fn lock<T>(mutex: &Mutex<T>) -> Result<MutexGuard<'_, T>, CommandError> {
    mutex.lock().map_err(|_| workspace_operation_failed())
}

fn picker_already_active() -> CommandError {
    CommandError::new(
        "WORKSPACE_CONFLICT",
        "A workspace folder picker is already active for this window.",
    )
}

fn workspace_conflict() -> CommandError {
    CommandError::new(
        "WORKSPACE_CONFLICT",
        "The workspace changed while the operation was in progress.",
    )
}

fn window_closed() -> CommandError {
    CommandError::new(
        "WORKSPACE_WINDOW_CLOSED",
        "The workspace window is no longer available.",
    )
}

fn workspace_operation_failed() -> CommandError {
    CommandError::new(
        "WORKSPACE_CONFLICT",
        "The workspace operation could not be completed.",
    )
}

fn workspace_read_failed() -> CommandError {
    CommandError::new("IO_FAILED", "The workspace entry could not be read.")
}

fn root_not_authorized() -> CommandError {
    CommandError::new(
        "ROOT_NOT_AUTHORIZED",
        "The workspace root is not authorized.",
    )
}

fn invalid_picker_selection() -> CommandError {
    CommandError::new(
        "WORKSPACE_PICK_INVALID_SELECTION",
        "The workspace folder picker returned an invalid selection.",
    )
}

#[cfg(test)]
mod tests;
