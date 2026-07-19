#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::collections::BTreeMap;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};
#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::time::{Duration, Instant};

use crate::error::CommandError;
use crate::path_policy::RelativePath;

use super::dto::{
    DeleteConfirmationId, DeleteEntryId, WorkspaceDeleteBatchPlan, WorkspaceDeleteResult,
    WorkspaceEntryStat, WorkspaceMoveResult, WorkspacePickRootsMode, WorkspacePickRootsResult,
    WorkspacePickRootsStatus, WorkspaceReadDirectoryResult, WorkspaceSnapshot,
    WorkspaceWriteResult,
};
use super::picker::{DirectoryPicker, DirectoryPickerResult};
use super::reader;
use super::writer;
use super::{RootId, WorkspaceRootLease, WorkspaceScope};

#[cfg(any(target_os = "linux", target_os = "macos"))]
use super::delete::{DeleteBatchReceipt, DeleteSelection};

#[cfg(any(target_os = "linux", target_os = "macos"))]
const DELETE_BATCH_IDLE_TTL: Duration = Duration::from_secs(120);

pub struct WorkspaceService {
    windows: Mutex<HashMap<String, Arc<WindowWorkspace>>>,
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    delete_clock: Arc<dyn Fn() -> Instant + Send + Sync>,
}

impl Default for WorkspaceService {
    fn default() -> Self {
        Self {
            windows: Mutex::new(HashMap::new()),
            #[cfg(any(target_os = "linux", target_os = "macos"))]
            delete_clock: Arc::new(Instant::now),
        }
    }
}

impl WorkspaceService {
    pub fn new() -> Self {
        Self::default()
    }

    #[cfg(all(test, any(target_os = "linux", target_os = "macos")))]
    fn with_delete_clock(clock: Arc<dyn Fn() -> Instant + Send + Sync>) -> Self {
        Self {
            windows: Mutex::new(HashMap::new()),
            delete_clock: clock,
        }
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

    pub async fn read_file(
        &self,
        window_label: &str,
        root_id: RootId,
        relative_path: RelativePath,
    ) -> Result<Vec<u8>, CommandError> {
        self.run_reader(window_label, root_id, move |lease| {
            reader::read_file(&lease, &relative_path)?.into_plr1_frame()
        })
        .await
    }

    pub async fn write_file(
        &self,
        window_label: &str,
        root_id: RootId,
        relative_path: RelativePath,
        expected_version: String,
        content: Vec<u8>,
    ) -> Result<WorkspaceWriteResult, CommandError> {
        self.run_versioned_write(window_label, root_id, move |lease| {
            #[cfg(any(target_os = "linux", target_os = "macos"))]
            {
                super::versioned_writer::write_file(
                    &lease,
                    &relative_path,
                    &expected_version,
                    &content,
                )
            }
            #[cfg(not(any(target_os = "linux", target_os = "macos")))]
            {
                let _ = (lease, relative_path, expected_version, content);
                Err(CommandError::new(
                    "WORKSPACE_WRITE_UNSUPPORTED",
                    "Versioned workspace writes are not supported on this platform.",
                ))
            }
        })
        .await
    }

    pub async fn create_file(
        &self,
        window_label: &str,
        root_id: RootId,
        relative_path: RelativePath,
    ) -> Result<(), CommandError> {
        self.run_mutation(window_label, root_id, move |lease| {
            writer::create_file(&lease, &relative_path)
        })
        .await
    }

    pub async fn create_directory(
        &self,
        window_label: &str,
        root_id: RootId,
        relative_path: RelativePath,
    ) -> Result<(), CommandError> {
        self.run_mutation(window_label, root_id, move |lease| {
            writer::create_directory(&lease, &relative_path)
        })
        .await
    }

    pub async fn rename(
        &self,
        window_label: &str,
        root_id: RootId,
        source_path: RelativePath,
        target_path: RelativePath,
    ) -> Result<(), CommandError> {
        self.run_mutation(window_label, root_id, move |lease| {
            writer::rename(&lease, &source_path, &target_path)
        })
        .await
    }

    pub async fn copy_entry(
        &self,
        window_label: &str,
        source_root_id: RootId,
        source_path: RelativePath,
        target_root_id: RootId,
        target_path: RelativePath,
    ) -> Result<(), CommandError> {
        self.run_dual_root_mutation(
            window_label,
            source_root_id,
            target_root_id,
            move |source_lease, target_lease| {
                writer::copy_entry(&source_lease, &source_path, &target_lease, &target_path)
            },
        )
        .await
    }

    pub async fn move_entry(
        &self,
        window_label: &str,
        source_root_id: RootId,
        source_path: RelativePath,
        target_root_id: RootId,
        target_path: RelativePath,
    ) -> Result<WorkspaceMoveResult, CommandError> {
        if source_root_id == target_root_id {
            return Err(CommandError::new(
                "WORKSPACE_CONFLICT",
                "A cross-root move requires two different workspace roots.",
            ));
        }
        self.run_dual_root_mutation(
            window_label,
            source_root_id,
            target_root_id,
            move |source_lease, target_lease| {
                #[cfg(any(target_os = "linux", target_os = "macos"))]
                {
                    super::move_entry::move_entry(
                        &source_lease,
                        &source_path,
                        &target_lease,
                        &target_path,
                    )
                }
                #[cfg(not(any(target_os = "linux", target_os = "macos")))]
                {
                    let _ = (source_lease, source_path, target_lease, target_path);
                    Err(CommandError::new(
                        "IO_FAILED",
                        "Cross-root workspace move is not supported on this platform.",
                    ))
                }
            },
        )
        .await
    }

    pub async fn prepare_delete(
        &self,
        window_label: &str,
        entries: Vec<(RootId, RelativePath, bool)>,
    ) -> Result<WorkspaceDeleteBatchPlan, CommandError> {
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        {
            let workspace = self.scope_for_window(window_label)?;
            tauri::async_runtime::spawn_blocking(move || workspace.prepare_delete(entries))
                .await
                .map_err(|_| workspace_delete_failed())?
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos")))]
        {
            let _ = (window_label, entries);
            Err(workspace_delete_unsupported())
        }
    }

    pub async fn cancel_delete(
        &self,
        window_label: &str,
        confirmation_id: DeleteConfirmationId,
    ) -> Result<(), CommandError> {
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        {
            let workspace = self.scope_for_window(window_label)?;
            tauri::async_runtime::spawn_blocking(move || workspace.cancel_delete(confirmation_id))
                .await
                .map_err(|_| workspace_delete_failed())?
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos")))]
        {
            let _ = (window_label, confirmation_id);
            Err(workspace_delete_unsupported())
        }
    }

    pub async fn begin_delete(
        &self,
        window_label: &str,
        confirmation_id: DeleteConfirmationId,
    ) -> Result<(), CommandError> {
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        {
            let workspace = self.scope_for_window(window_label)?;
            tauri::async_runtime::spawn_blocking(move || workspace.begin_delete(confirmation_id))
                .await
                .map_err(|_| workspace_delete_failed())?
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos")))]
        {
            let _ = (window_label, confirmation_id);
            Err(workspace_delete_unsupported())
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn commit_delete_entry(
        &self,
        window_label: &str,
        confirmation_id: DeleteConfirmationId,
        entry_id: DeleteEntryId,
        root_id: RootId,
        relative_path: RelativePath,
        recursive: bool,
    ) -> Result<WorkspaceDeleteResult, CommandError> {
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        {
            let workspace = self.scope_for_window(window_label)?;
            tauri::async_runtime::spawn_blocking(move || {
                workspace.commit_delete_entry(
                    confirmation_id,
                    entry_id,
                    root_id,
                    relative_path,
                    recursive,
                )
            })
            .await
            .map_err(|_| workspace_delete_failed())?
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos")))]
        {
            let _ = (
                window_label,
                confirmation_id,
                entry_id,
                root_id,
                relative_path,
                recursive,
            );
            Err(workspace_delete_unsupported())
        }
    }

    pub fn close_window(&self, window_label: &str) {
        if let Some(workspace) = self.detach_window(window_label) {
            workspace.close();
        }
    }

    fn scope_for_window(&self, window_label: &str) -> Result<Arc<WindowWorkspace>, CommandError> {
        let mut windows = lock(&self.windows)?;
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        let delete_clock = Arc::clone(&self.delete_clock);
        Ok(windows
            .entry(window_label.to_owned())
            .or_insert_with(|| {
                #[cfg(any(target_os = "linux", target_os = "macos"))]
                {
                    Arc::new(WindowWorkspace::new(delete_clock))
                }
                #[cfg(not(any(target_os = "linux", target_os = "macos")))]
                {
                    Arc::new(WindowWorkspace::new())
                }
            })
            .clone())
    }

    fn detach_window(&self, window_label: &str) -> Option<Arc<WindowWorkspace>> {
        let Ok(mut windows) = self.windows.lock() else {
            return None;
        };
        windows.remove(window_label)
    }

    #[cfg(test)]
    fn close_window_with_hook<F>(&self, window_label: &str, after_detach: F)
    where
        F: FnOnce(),
    {
        let workspace = self.detach_window(window_label);
        after_detach();
        if let Some(workspace) = workspace {
            workspace.close();
        }
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

    async fn run_mutation<T, F>(
        &self,
        window_label: &str,
        root_id: RootId,
        operation: F,
    ) -> Result<T, CommandError>
    where
        T: Send + 'static,
        F: FnOnce(WorkspaceRootLease) -> Result<T, CommandError> + Send + 'static,
    {
        self.run_mutation_with_hook(window_label, root_id, || {}, operation)
            .await
    }

    async fn run_versioned_write<F>(
        &self,
        window_label: &str,
        root_id: RootId,
        operation: F,
    ) -> Result<WorkspaceWriteResult, CommandError>
    where
        F: FnOnce(WorkspaceRootLease) -> Result<WorkspaceWriteResult, CommandError>
            + Send
            + 'static,
    {
        let workspace = self.scope_for_window(window_label)?;
        let lease = workspace.lease(root_id)?;
        let leased_root_id = lease.root_id();
        let joined = tauri::async_runtime::spawn_blocking(move || {
            let _mutation = lock(&workspace.mutation_gate)?;
            workspace.validate_lease(leased_root_id)?;
            match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| operation(lease))) {
                Ok(result) => result,
                Err(_) => Err(workspace_write_response_unavailable()),
            }
        })
        .await;
        classify_versioned_write_join(joined)
    }

    async fn run_mutation_with_hook<T, B, F>(
        &self,
        window_label: &str,
        root_id: RootId,
        before_gate: B,
        operation: F,
    ) -> Result<T, CommandError>
    where
        T: Send + 'static,
        B: FnOnce() + Send + 'static,
        F: FnOnce(WorkspaceRootLease) -> Result<T, CommandError> + Send + 'static,
    {
        let workspace = self.scope_for_window(window_label)?;
        let lease = workspace.lease(root_id)?;
        let leased_root_id = lease.root_id();
        tauri::async_runtime::spawn_blocking(move || {
            before_gate();
            let _mutation = lock(&workspace.mutation_gate)?;
            workspace.validate_lease(leased_root_id)?;
            operation(lease)
        })
        .await
        .map_err(|_| workspace_mutation_failed())?
    }

    async fn run_dual_root_mutation<T, F>(
        &self,
        window_label: &str,
        source_root_id: RootId,
        target_root_id: RootId,
        operation: F,
    ) -> Result<T, CommandError>
    where
        T: Send + 'static,
        F: FnOnce(WorkspaceRootLease, WorkspaceRootLease) -> Result<T, CommandError>
            + Send
            + 'static,
    {
        self.run_dual_root_mutation_with_hook(
            window_label,
            source_root_id,
            target_root_id,
            || {},
            operation,
        )
        .await
    }

    async fn run_dual_root_mutation_with_hook<T, B, F>(
        &self,
        window_label: &str,
        source_root_id: RootId,
        target_root_id: RootId,
        before_gate: B,
        operation: F,
    ) -> Result<T, CommandError>
    where
        T: Send + 'static,
        B: FnOnce() + Send + 'static,
        F: FnOnce(WorkspaceRootLease, WorkspaceRootLease) -> Result<T, CommandError>
            + Send
            + 'static,
    {
        let workspace = self.scope_for_window(window_label)?;
        let source_lease = workspace.lease(source_root_id)?;
        let target_lease = workspace.lease(target_root_id)?;
        let leased_root_ids = [source_lease.root_id(), target_lease.root_id()];
        tauri::async_runtime::spawn_blocking(move || {
            before_gate();
            let _mutation = lock(&workspace.mutation_gate)?;
            workspace.validate_leases(&leased_root_ids)?;
            operation(source_lease, target_lease)
        })
        .await
        .map_err(|_| workspace_copy_failed())?
    }
}

fn workspace_write_response_unavailable() -> CommandError {
    CommandError::new(
        "WORKSPACE_WRITE_RESPONSE_UNAVAILABLE",
        "The workspace write result is unavailable.",
    )
}

fn classify_versioned_write_join<E>(
    result: Result<Result<WorkspaceWriteResult, CommandError>, E>,
) -> Result<WorkspaceWriteResult, CommandError> {
    match result {
        Ok(result) => result,
        Err(_) => Err(workspace_write_response_unavailable()),
    }
}

struct WindowWorkspace {
    mutation_gate: Mutex<()>,
    state: Mutex<WindowWorkspaceState>,
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    delete_clock: Arc<dyn Fn() -> Instant + Send + Sync>,
}

impl WindowWorkspace {
    fn new(
        #[cfg(any(target_os = "linux", target_os = "macos"))] delete_clock: Arc<
            dyn Fn() -> Instant + Send + Sync,
        >,
    ) -> Self {
        Self {
            mutation_gate: Mutex::new(()),
            state: Mutex::new(WindowWorkspaceState {
                scope: WorkspaceScope::new(),
                next_picker_token: 0,
                active_picker: None,
                #[cfg(any(target_os = "linux", target_os = "macos"))]
                active_delete_batch: None,
                closed: false,
            }),
            #[cfg(any(target_os = "linux", target_os = "macos"))]
            delete_clock,
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
        let _mutation = lock(&self.mutation_gate)?;
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
                invalidate_delete_batch(&mut state);
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
        let _mutation = lock(&self.mutation_gate)?;
        let mut state = lock(&self.state)?;
        ensure_open(&state)?;
        state.scope.remove(root_id)?;
        invalidate_delete_batch(&mut state);
        Ok(state.scope.snapshot())
    }

    fn lease(&self, root_id: RootId) -> Result<WorkspaceRootLease, CommandError> {
        let state = lock(&self.state)?;
        ensure_open(&state)?;
        state.scope.lease(root_id)
    }

    fn validate_lease(&self, root_id: RootId) -> Result<(), CommandError> {
        self.validate_leases(&[root_id])
    }

    fn validate_leases(&self, root_ids: &[RootId]) -> Result<(), CommandError> {
        let state = lock(&self.state)?;
        ensure_open(&state)?;
        if root_ids
            .iter()
            .all(|root_id| state.scope.contains_root(*root_id))
        {
            Ok(())
        } else {
            Err(root_not_authorized())
        }
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    fn prepare_delete(
        &self,
        entries: Vec<(RootId, RelativePath, bool)>,
    ) -> Result<WorkspaceDeleteBatchPlan, CommandError> {
        let _mutation = lock(&self.mutation_gate)?;
        let (workspace_revision, selected) = {
            let mut state = lock(&self.state)?;
            ensure_open(&state)?;
            discard_expired_delete_batch(&mut state, (self.delete_clock)());
            if state.active_delete_batch.is_some() {
                return Err(workspace_delete_conflict());
            }
            let selected = entries
                .into_iter()
                .map(|(root_id, relative_path, recursive)| {
                    let lease = state.scope.lease(root_id)?;
                    Ok((
                        DeleteSelection::new(root_id, relative_path, recursive),
                        lease,
                    ))
                })
                .collect::<Result<Vec<_>, CommandError>>()?;
            (state.scope.revision(), selected)
        };
        let deadline = delete_deadline((self.delete_clock)())?;
        let mut receipt = super::delete::prepare_batch(workspace_revision, deadline, selected)?;
        let plan = receipt.plan()?;
        receipt.refresh_deadline(delete_deadline((self.delete_clock)())?);
        let mut state = lock(&self.state)?;
        ensure_open(&state)?;
        if state.scope.revision() != workspace_revision || state.active_delete_batch.is_some() {
            return Err(workspace_delete_conflict());
        }
        state.active_delete_batch = Some(receipt);
        Ok(plan)
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    fn cancel_delete(&self, confirmation_id: DeleteConfirmationId) -> Result<(), CommandError> {
        let _mutation = lock(&self.mutation_gate)?;
        let mut state = lock(&self.state)?;
        ensure_open(&state)?;
        discard_expired_delete_batch(&mut state, (self.delete_clock)());
        if state
            .active_delete_batch
            .as_ref()
            .is_some_and(|batch| batch.confirmation_id() == confirmation_id)
        {
            state.active_delete_batch = None;
            Ok(())
        } else {
            Err(workspace_delete_plan_invalid())
        }
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    fn begin_delete(&self, confirmation_id: DeleteConfirmationId) -> Result<(), CommandError> {
        let _mutation = lock(&self.mutation_gate)?;
        let (mut receipt, leases) = {
            let mut state = lock(&self.state)?;
            ensure_open(&state)?;
            discard_expired_delete_batch(&mut state, (self.delete_clock)());
            let matches = state.active_delete_batch.as_ref().is_some_and(|batch| {
                batch.confirmation_id() == confirmation_id
                    && batch.is_prepared()
                    && batch.workspace_revision() == state.scope.revision()
            });
            if !matches {
                return Err(workspace_delete_plan_invalid());
            }
            let receipt = state
                .active_delete_batch
                .take()
                .ok_or_else(workspace_delete_plan_invalid)?;
            let mut leases = BTreeMap::new();
            for selection in receipt.selections() {
                if let std::collections::btree_map::Entry::Vacant(entry) =
                    leases.entry(selection.root_id())
                {
                    entry.insert(state.scope.lease(selection.root_id())?);
                }
            }
            (receipt, leases)
        };
        // Any failure here invalidates the complete batch and performs no
        // remove syscall. The receipt was taken from state before I/O.
        receipt.revalidate_all(&leases)?;
        receipt.begin();
        receipt.refresh_deadline(delete_deadline((self.delete_clock)())?);
        let mut state = lock(&self.state)?;
        ensure_open(&state)?;
        if state.scope.revision() != receipt.workspace_revision()
            || state.active_delete_batch.is_some()
        {
            return Err(workspace_delete_plan_invalid());
        }
        state.active_delete_batch = Some(receipt);
        Ok(())
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    #[allow(clippy::too_many_arguments)]
    fn commit_delete_entry(
        &self,
        confirmation_id: DeleteConfirmationId,
        entry_id: DeleteEntryId,
        root_id: RootId,
        relative_path: RelativePath,
        recursive: bool,
    ) -> Result<WorkspaceDeleteResult, CommandError> {
        let _mutation = lock(&self.mutation_gate)?;
        let (mut receipt, lease) = {
            let mut state = lock(&self.state)?;
            ensure_open(&state)?;
            discard_expired_delete_batch(&mut state, (self.delete_clock)());
            let Some(batch) = state.active_delete_batch.as_ref() else {
                return Err(workspace_delete_plan_invalid());
            };
            if batch.confirmation_id() != confirmation_id {
                return Err(workspace_delete_plan_invalid());
            }
            if !batch.is_executing()
                || batch.workspace_revision() != state.scope.revision()
                || !batch.matches_next(entry_id, root_id, &relative_path, recursive)
            {
                state.active_delete_batch = None;
                return Err(workspace_delete_plan_invalid());
            }
            if batch.next_root_id() != Some(root_id) {
                state.active_delete_batch = None;
                return Err(workspace_delete_plan_invalid());
            }
            let lease = match state.scope.lease(root_id) {
                Ok(lease) => lease,
                Err(error) => {
                    state.active_delete_batch = None;
                    return Err(error);
                }
            };
            let receipt = state
                .active_delete_batch
                .take()
                .ok_or_else(workspace_delete_plan_invalid)?;
            (receipt, lease)
        };

        // Taking the receipt marks the exact next entry as the sole in-flight
        // authorization while this window's mutation gate remains held.
        let result = receipt.commit_next(&lease);
        let mut state = match self.state.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        if result.is_deleted() && !receipt.is_complete() && !state.closed {
            if let Ok(deadline) = delete_deadline((self.delete_clock)()) {
                receipt.refresh_deadline(deadline);
                state.active_delete_batch = Some(receipt);
            }
        }
        Ok(result)
    }

    fn close(&self) {
        let _mutation = match self.mutation_gate.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let mut state = match self.state.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        state.closed = true;
        state.active_picker = None;
        invalidate_delete_batch(&mut state);
    }
}

struct WindowWorkspaceState {
    scope: WorkspaceScope,
    next_picker_token: u64,
    active_picker: Option<u64>,
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    active_delete_batch: Option<DeleteBatchReceipt>,
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

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn invalidate_delete_batch(state: &mut WindowWorkspaceState) {
    state.active_delete_batch = None;
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn invalidate_delete_batch(_state: &mut WindowWorkspaceState) {}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn discard_expired_delete_batch(state: &mut WindowWorkspaceState, now: Instant) {
    if state
        .active_delete_batch
        .as_ref()
        .is_some_and(|batch| batch.is_expired(now))
    {
        state.active_delete_batch = None;
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn delete_deadline(now: Instant) -> Result<Instant, CommandError> {
    now.checked_add(DELETE_BATCH_IDLE_TTL)
        .ok_or_else(workspace_delete_failed)
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

fn workspace_mutation_failed() -> CommandError {
    CommandError::new("IO_FAILED", "The workspace entry could not be created.")
}

fn workspace_copy_failed() -> CommandError {
    CommandError::new("IO_FAILED", "The workspace entry could not be copied.")
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn workspace_delete_failed() -> CommandError {
    CommandError::new("IO_FAILED", "The workspace entry could not be deleted.")
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn workspace_delete_conflict() -> CommandError {
    CommandError::new(
        "WORKSPACE_CONFLICT",
        "A delete confirmation is already active for this window.",
    )
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn workspace_delete_plan_invalid() -> CommandError {
    CommandError::new(
        "WORKSPACE_DELETE_PLAN_INVALID",
        "The delete confirmation is no longer valid.",
    )
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn workspace_delete_unsupported() -> CommandError {
    CommandError::new(
        "IO_FAILED",
        "Permanent workspace delete is not supported on this platform.",
    )
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
