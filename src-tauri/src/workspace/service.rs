use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use crate::error::CommandError;
use crate::path_policy::RelativePath;
use crate::search::dto::{
    search_not_found, SearchId, WorkspaceSearchFilesQuery, WorkspaceSearchFilesResult,
    WorkspaceSearchTextPollResult, WorkspaceSearchTextQuery, WorkspaceSearchTextStartResult,
};
use crate::search::file_search;
use crate::search::text_search::{self, TextSearchHandle};

use super::dto::{
    DeleteConfirmationId, DeleteEntryId, WorkspaceDeleteBatchPlan, WorkspaceDeleteResult,
    WorkspaceEntryStat, WorkspaceMoveResult, WorkspaceOpenFileTarget, WorkspaceOpenFilesResult,
    WorkspacePickRootsMode, WorkspacePickRootsResult, WorkspacePickRootsStatus,
    WorkspaceReadDirectoryResult, WorkspaceRestoreStatus, WorkspaceSnapshot,
    WorkspaceWatchPendingRoot, WorkspaceWatchSyncResult, WorkspaceWriteResult,
};
use super::picker::{DirectoryPicker, DirectoryPickerResult, FilePicker, FilePickerResult};
use super::reader;
use super::watcher::{
    WatchAcknowledgement, WatchRegistration, WatchRegistrationEpoch, WatchScanOutcome,
    WindowWatcher,
};
use super::writer;
use super::{RootId, WorkspaceId, WorkspaceRootLease, WorkspaceRootsIdentity, WorkspaceScope};

#[cfg(any(target_os = "linux", target_os = "macos"))]
use super::delete::{DeleteBatchReceipt, DeleteSelection};

#[cfg(any(target_os = "linux", target_os = "macos"))]
const DELETE_BATCH_IDLE_TTL: Duration = Duration::from_secs(120);

/// How long a naturally-completed (or vacuously-done) text search lingers in
/// its window's single active-search slot after its last poll, so a final
/// `done: true` poll can still observe it. Chosen to match
/// [`DELETE_BATCH_IDLE_TTL`]'s existing precedent and rationale (a generous
/// idle bound with no user-visible countdown, reclaimed lazily on the next
/// search-related call for that window, exactly like
/// `discard_expired_delete_batch`) rather than inventing a second unrelated
/// constant; a *forced* termination (cancel, a new `start` superseding this
/// one, window close, or root revocation) purges the slot immediately
/// instead of waiting out this TTL — see `WindowWorkspace::start_text_search`
/// and `WindowWorkspace::close`.
const SEARCH_TASK_IDLE_TTL: Duration = Duration::from_secs(120);

type WorkspaceWatchWakeSink = Arc<dyn Fn(WorkspaceId) + Send + Sync>;
/// Called with the identity of the search a wake hint belongs to — mirrors
/// [`WorkspaceWatchWakeSink`]'s own shape (a wake sink parameterized over the
/// entity it wakes, not a bare `Fn()`), so a stale wake for a search a window
/// has already superseded stays identifiable by the frontend.
type TextSearchWakeSink = Arc<dyn Fn(SearchId) + Send + Sync>;

pub struct WorkspaceService {
    windows: Mutex<HashMap<String, Arc<WindowWorkspace>>>,
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    delete_clock: Arc<dyn Fn() -> Instant + Send + Sync>,
    search_clock: Arc<dyn Fn() -> Instant + Send + Sync>,
}

impl Default for WorkspaceService {
    fn default() -> Self {
        Self {
            windows: Mutex::new(HashMap::new()),
            #[cfg(any(target_os = "linux", target_os = "macos"))]
            delete_clock: Arc::new(Instant::now),
            search_clock: Arc::new(Instant::now),
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
            search_clock: Arc::new(Instant::now),
        }
    }

    #[cfg(test)]
    fn with_search_clock(clock: Arc<dyn Fn() -> Instant + Send + Sync>) -> Self {
        Self {
            windows: Mutex::new(HashMap::new()),
            #[cfg(any(target_os = "linux", target_os = "macos"))]
            delete_clock: Arc::new(Instant::now),
            search_clock: clock,
        }
    }

    pub fn snapshot(&self, window_label: &str) -> Result<WorkspaceSnapshot, CommandError> {
        self.scope_for_window(window_label)?.snapshot()
    }

    pub(crate) async fn initial_snapshot_with_restore(
        &self,
        window_label: &str,
        last_roots: Result<Option<Vec<std::path::PathBuf>>, CommandError>,
        watch_wake_sink: WorkspaceWatchWakeSink,
    ) -> Result<WorkspaceSnapshot, CommandError> {
        let workspace = self.scope_for_window(window_label)?;
        tauri::async_runtime::spawn_blocking(move || {
            workspace.initial_snapshot(last_roots, watch_wake_sink)
        })
        .await
        .map_err(|_| workspace_operation_failed())?
    }

    pub fn restore_status(
        &self,
        window_label: &str,
    ) -> Result<WorkspaceRestoreStatus, CommandError> {
        self.scope_for_window(window_label)?.restore_status()
    }

    pub(crate) fn history_roots(
        &self,
        window_label: &str,
    ) -> Result<Vec<(std::path::PathBuf, String)>, CommandError> {
        self.scope_for_window(window_label)?.history_roots()
    }

    /// The stable identity of `window_label`'s currently authorized root set
    /// (see [`WorkspaceRootsIdentity`]); `None` when zero roots are
    /// authorized. Used only by the backup domain to key its per-root-set
    /// storage directory; never exposed over IPC.
    pub(crate) fn stable_identity(
        &self,
        window_label: &str,
    ) -> Result<Option<WorkspaceRootsIdentity>, CommandError> {
        self.scope_for_window(window_label)?.stable_identity()
    }

    /// The canonical filesystem path backing each of `window_label`'s
    /// currently authorized roots, in authorization order; see
    /// [`super::WorkspaceScope::root_canonical_paths`] for the exact
    /// contract and why this exists (currently: the terminal domain's `cwd`
    /// validation). Never exposed over IPC.
    pub(crate) fn root_canonical_paths(
        &self,
        window_label: &str,
    ) -> Result<Vec<(RootId, std::path::PathBuf)>, CommandError> {
        self.scope_for_window(window_label)?.root_canonical_paths()
    }

    /// Returns the current random root ids paired with stable Rust-only
    /// per-root storage identities. The backup domain uses this mapping to
    /// keep persisted working-copy content attached to its exact directory
    /// across process restarts and workspace-topology changes.
    pub(crate) fn root_storage_identities(
        &self,
        window_label: &str,
    ) -> Result<Vec<(RootId, WorkspaceRootsIdentity)>, CommandError> {
        self.scope_for_window(window_label)?
            .root_storage_identities()
    }

    /// Resolves one exact authorized root identity to its canonical backing
    /// path. Unlike callers taking `root_canonical_paths().first()`, this is
    /// fail-closed for a stale, foreign-window, or otherwise unauthorized
    /// identity and therefore preserves the root identity chosen by the
    /// WebView across native domain boundaries.
    pub(crate) fn root_canonical_path(
        &self,
        window_label: &str,
        root_id: RootId,
    ) -> Result<std::path::PathBuf, CommandError> {
        self.scope_for_window(window_label)?
            .root_canonical_paths()?
            .into_iter()
            .find_map(|(candidate_id, path)| (candidate_id == root_id).then_some(path))
            .ok_or_else(root_not_authorized)
    }

    pub async fn pick_roots<P: DirectoryPicker>(
        &self,
        window_label: &str,
        picker: P,
        mode: WorkspacePickRootsMode,
    ) -> Result<WorkspacePickRootsResult, CommandError> {
        self.pick_roots_with_watch_sink(window_label, picker, mode, Arc::new(|_workspace_id| {}))
            .await
    }

    pub(crate) async fn pick_roots_with_watch_sink<P: DirectoryPicker>(
        &self,
        window_label: &str,
        picker: P,
        mode: WorkspacePickRootsMode,
        watch_wake_sink: WorkspaceWatchWakeSink,
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
            workspace.finish_picker(picker_token, mode, selection, watch_wake_sink)
        })
        .await
        .map_err(|_| workspace_operation_failed())?
    }

    pub(crate) async fn pick_files_with_watch_sink<P: FilePicker>(
        &self,
        window_label: &str,
        picker: P,
        watch_wake_sink: WorkspaceWatchWakeSink,
    ) -> Result<WorkspaceOpenFilesResult, CommandError> {
        let workspace = self.scope_for_window(window_label)?;
        let picker_token = workspace.begin_picker()?;
        let selection = match picker.pick_files().await {
            Ok(selection) => selection,
            Err(error) => {
                workspace.abort_picker(picker_token)?;
                return Err(error);
            }
        };
        tauri::async_runtime::spawn_blocking(move || {
            workspace.finish_file_picker(picker_token, selection, watch_wake_sink)
        })
        .await
        .map_err(|_| workspace_operation_failed())?
    }

    pub(crate) async fn replace_roots_with_watch_sink(
        &self,
        window_label: &str,
        paths: Vec<std::path::PathBuf>,
        watch_wake_sink: WorkspaceWatchWakeSink,
    ) -> Result<WorkspaceSnapshot, CommandError> {
        let workspace = self.scope_for_window(window_label)?;
        tauri::async_runtime::spawn_blocking(move || {
            workspace.replace_roots(paths, watch_wake_sink)
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

    /// Read-only, multi-root file search. Does not take the mutation gate
    /// (search never writes anything): every named root is leased once up
    /// front, the bounded traversal runs on a blocking thread, and every
    /// leased root is revalidated afterward exactly like [`Self::run_reader`]
    /// does for a single root. If any root was revoked while the traversal
    /// was in flight, the revoked-root error wins over a successful result.
    pub async fn search_files(
        &self,
        window_label: &str,
        query: WorkspaceSearchFilesQuery,
    ) -> Result<WorkspaceSearchFilesResult, CommandError> {
        let workspace = self.scope_for_window(window_label)?;
        let mut leases = Vec::with_capacity(query.roots.len());
        for root_id in &query.roots {
            leases.push(workspace.lease(*root_id)?);
        }
        let leased_root_ids: Vec<RootId> = leases.iter().map(WorkspaceRootLease::root_id).collect();
        let result = tauri::async_runtime::spawn_blocking(move || {
            file_search::search_roots(&leases, &query)
        })
        .await
        .map_err(|_| workspace_read_failed());
        workspace.validate_leases(&leased_root_ids)?;
        result?
    }

    /// Starts one streaming text search for `window_label`, superseding
    /// whatever search (active or lingering-done) that window already had.
    /// Leasing every named root happens synchronously up front (fail closed
    /// if any root is not authorized, exactly like [`Self::search_files`]);
    /// the bounded traversal and grep then run on a dedicated background
    /// thread started by [`text_search::start`], so this method itself never
    /// blocks on disk I/O and does not need `spawn_blocking`.
    pub fn search_text_start(
        &self,
        window_label: &str,
        query: WorkspaceSearchTextQuery,
        wake_sink: TextSearchWakeSink,
    ) -> Result<WorkspaceSearchTextStartResult, CommandError> {
        let workspace = self.scope_for_window(window_label)?;
        let mut leases = Vec::with_capacity(query.roots.len());
        for root_id in &query.roots {
            leases.push(workspace.lease(*root_id)?);
        }
        let compiled = text_search::compile_query(&query)?;
        workspace.start_text_search(leases, compiled, wake_sink, (self.search_clock)())
    }

    /// Drains whatever batches `search_id`'s task has produced since
    /// `cursor`. Never blocks (the channel drain is non-blocking); returns
    /// [`crate::search::dto::search_not_found`] if `search_id` does not match
    /// this window's active or lingering search (including one already
    /// reclaimed by its TTL).
    pub fn search_text_poll(
        &self,
        window_label: &str,
        search_id: SearchId,
        cursor: u64,
    ) -> Result<WorkspaceSearchTextPollResult, CommandError> {
        self.scope_for_window(window_label)?.poll_text_search(
            search_id,
            cursor,
            (self.search_clock)(),
        )
    }

    /// Cancels `search_id`, mirroring `workspace_cancel_delete`'s exact
    /// contract: a request naming a search that is not this window's current
    /// active-or-lingering one (wrong id, already cancelled, already TTL-
    /// reclaimed) reports [`crate::search::dto::search_not_found`] rather
    /// than a silent no-op success — safe to call defensively (it never
    /// panics or corrupts state either way), but not a bare fire-and-forget.
    pub fn search_text_cancel(
        &self,
        window_label: &str,
        search_id: SearchId,
    ) -> Result<(), CommandError> {
        self.scope_for_window(window_label)?
            .cancel_text_search(search_id, (self.search_clock)())
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
    ) -> Result<WorkspaceEntryStat, CommandError> {
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
    ) -> Result<WorkspaceEntryStat, CommandError> {
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

    pub async fn watch_sync(
        &self,
        window_label: &str,
        roots: Vec<(RootId, Option<u32>)>,
    ) -> Result<WorkspaceWatchSyncResult, CommandError> {
        let workspace = self.scope_for_window(window_label)?;
        tauri::async_runtime::spawn_blocking(move || workspace.watch_sync(&roots))
            .await
            .map_err(|_| workspace_operation_failed())?
    }

    pub fn mark_all_watchers_rescan(&self) {
        let windows = match self.windows.lock() {
            Ok(windows) => windows.values().cloned().collect::<Vec<_>>(),
            Err(poisoned) => poisoned.into_inner().values().cloned().collect::<Vec<_>>(),
        };
        for workspace in windows {
            workspace.mark_all_watchers_rescan();
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
    watcher: Mutex<Option<Arc<WindowWatcher>>>,
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    delete_clock: Arc<dyn Fn() -> Instant + Send + Sync>,
}

/// The one active-or-lingering text search a window may have; see
/// [`SEARCH_TASK_IDLE_TTL`]'s doc comment for the lingering/purge contract.
struct ActiveTextSearch {
    search_id: SearchId,
    handle: TextSearchHandle,
    idle_deadline: Instant,
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
                next_watch_epoch: 0,
                watch_registrations: BTreeMap::new(),
                #[cfg(any(target_os = "linux", target_os = "macos"))]
                active_delete_batch: None,
                active_text_search: None,
                initial_restore_status: WorkspaceRestoreStatus::Pending,
                closed: false,
            }),
            watcher: Mutex::new(None),
            #[cfg(any(target_os = "linux", target_os = "macos"))]
            delete_clock,
        }
    }

    /// Starts a text search, immediately dropping (cancelling) whatever
    /// active-or-lingering search this window already had — the frozen
    /// "a new start always supersedes the old one" contract.
    fn start_text_search(
        &self,
        leases: Vec<WorkspaceRootLease>,
        compiled: text_search::CompiledTextQuery,
        wake_sink: TextSearchWakeSink,
        now: Instant,
    ) -> Result<WorkspaceSearchTextStartResult, CommandError> {
        let mut state = lock(&self.state)?;
        ensure_open(&state)?;
        let search_id = SearchId::new();
        let sink = Arc::clone(&wake_sink);
        let handle = text_search::start(leases, compiled, Arc::new(move || sink(search_id)));
        state.active_text_search = Some(ActiveTextSearch {
            search_id,
            handle,
            idle_deadline: search_text_deadline(now)?,
        });
        Ok(WorkspaceSearchTextStartResult::new(search_id))
    }

    fn poll_text_search(
        &self,
        search_id: SearchId,
        cursor: u64,
        now: Instant,
    ) -> Result<WorkspaceSearchTextPollResult, CommandError> {
        let mut state = lock(&self.state)?;
        ensure_open(&state)?;
        discard_expired_text_search(&mut state, now);
        let Some(active) = state.active_text_search.as_mut() else {
            return Err(search_not_found());
        };
        if active.search_id != search_id {
            return Err(search_not_found());
        }
        let result = active.handle.poll(cursor)?;
        active.idle_deadline = search_text_deadline(now)?;
        Ok(result)
    }

    fn cancel_text_search(&self, search_id: SearchId, now: Instant) -> Result<(), CommandError> {
        let mut state = lock(&self.state)?;
        ensure_open(&state)?;
        discard_expired_text_search(&mut state, now);
        let matches = state
            .active_text_search
            .as_ref()
            .is_some_and(|active| active.search_id == search_id);
        if matches {
            state.active_text_search = None;
            Ok(())
        } else {
            Err(search_not_found())
        }
    }

    fn snapshot(&self) -> Result<WorkspaceSnapshot, CommandError> {
        let state = lock(&self.state)?;
        ensure_open(&state)?;
        Ok(state.scope.snapshot())
    }

    fn initial_snapshot(
        self: &Arc<Self>,
        last_roots: Result<Option<Vec<std::path::PathBuf>>, CommandError>,
        watch_wake_sink: WorkspaceWatchWakeSink,
    ) -> Result<WorkspaceSnapshot, CommandError> {
        let mutation = lock(&self.mutation_gate)?;
        let mut state = lock(&self.state)?;
        ensure_open(&state)?;
        if state.initial_restore_status != WorkspaceRestoreStatus::Pending {
            return Ok(state.scope.snapshot());
        }
        if !state.scope.root_ids().is_empty() {
            state.initial_restore_status = WorkspaceRestoreStatus::None;
            return Ok(state.scope.snapshot());
        }

        let mut activated = None;
        match last_roots {
            Ok(None) => state.initial_restore_status = WorkspaceRestoreStatus::None,
            Err(_) => state.initial_restore_status = WorkspaceRestoreStatus::Failed,
            Ok(Some(paths)) => match self.replace_scope_locked(&mut state, &paths, watch_wake_sink)
            {
                Ok(pair) => {
                    state.initial_restore_status = WorkspaceRestoreStatus::Restored;
                    activated = Some(pair);
                }
                Err(_) => state.initial_restore_status = WorkspaceRestoreStatus::Failed,
            },
        }
        let snapshot = state.scope.snapshot();
        drop(state);
        drop(mutation);
        if let Some((watcher, revoked)) = activated {
            for registration in revoked {
                watcher.revoke(registration);
            }
        }
        Ok(snapshot)
    }

    fn restore_status(&self) -> Result<WorkspaceRestoreStatus, CommandError> {
        let state = lock(&self.state)?;
        ensure_open(&state)?;
        Ok(state.initial_restore_status)
    }

    fn history_roots(&self) -> Result<Vec<(std::path::PathBuf, String)>, CommandError> {
        let state = lock(&self.state)?;
        ensure_open(&state)?;
        Ok(state.scope.history_roots())
    }

    fn replace_roots(
        self: &Arc<Self>,
        paths: Vec<std::path::PathBuf>,
        watch_wake_sink: WorkspaceWatchWakeSink,
    ) -> Result<WorkspaceSnapshot, CommandError> {
        let mutation = lock(&self.mutation_gate)?;
        let mut state = lock(&self.state)?;
        ensure_open(&state)?;
        if state.active_picker.is_some() {
            return Err(picker_already_active());
        }
        let (watcher, revoked) = self.replace_scope_locked(&mut state, &paths, watch_wake_sink)?;
        let snapshot = state.scope.snapshot();
        drop(state);
        drop(mutation);
        for registration in revoked {
            watcher.revoke(registration);
        }
        Ok(snapshot)
    }

    fn replace_scope_locked(
        self: &Arc<Self>,
        state: &mut WindowWorkspaceState,
        paths: &[std::path::PathBuf],
        watch_wake_sink: WorkspaceWatchWakeSink,
    ) -> Result<(Arc<WindowWatcher>, Vec<WatchRegistration>), CommandError> {
        let watcher = self.watcher_for(state.scope.workspace_id(), Arc::clone(&watch_wake_sink))?;
        let mut next_watch_epoch = state.next_watch_epoch;
        let mut prepared = Vec::new();
        let mut prepare = |root_id, watch_path: &std::path::Path, _lease| {
            next_watch_epoch = next_watch_epoch
                .checked_add(1)
                .ok_or_else(workspace_conflict)?;
            let epoch = WatchRegistrationEpoch::new(next_watch_epoch)?;
            prepared
                .push(watcher.prepare_root(WatchRegistration::new(root_id, epoch), watch_path)?);
            Ok(())
        };
        let authorization = state
            .scope
            .replace_roots_atomically_with(paths, &mut prepare);
        state.next_watch_epoch = next_watch_epoch;
        authorization?;
        for prepared_watcher in prepared {
            let registration = watcher.activate(prepared_watcher);
            state
                .watch_registrations
                .insert(registration.root_id(), registration);
        }
        let active_root_ids = state.scope.root_ids().into_iter().collect::<BTreeSet<_>>();
        let mut revoked = Vec::new();
        state.watch_registrations.retain(|root_id, registration| {
            let retained = active_root_ids.contains(root_id);
            if !retained {
                revoked.push(*registration);
            }
            retained
        });
        invalidate_delete_batch(state);
        invalidate_text_search(state);
        Ok((watcher, revoked))
    }

    fn stable_identity(&self) -> Result<Option<WorkspaceRootsIdentity>, CommandError> {
        let state = lock(&self.state)?;
        ensure_open(&state)?;
        Ok(state.scope.stable_identity())
    }

    fn root_canonical_paths(&self) -> Result<Vec<(RootId, std::path::PathBuf)>, CommandError> {
        let state = lock(&self.state)?;
        ensure_open(&state)?;
        Ok(state.scope.root_canonical_paths())
    }

    fn root_storage_identities(
        &self,
    ) -> Result<Vec<(RootId, WorkspaceRootsIdentity)>, CommandError> {
        let state = lock(&self.state)?;
        ensure_open(&state)?;
        Ok(state.scope.root_storage_identities())
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
        self: &Arc<Self>,
        token: u64,
        mode: WorkspacePickRootsMode,
        selection: DirectoryPickerResult,
        watch_wake_sink: WorkspaceWatchWakeSink,
    ) -> Result<WorkspacePickRootsResult, CommandError> {
        let mutation = lock(&self.mutation_gate)?;
        let mut state = lock(&self.state)?;
        ensure_active_picker(&state, token)?;

        let (result, watcher, revoked_registrations) = match selection {
            DirectoryPickerResult::Selected(paths) if paths.is_empty() => {
                state.active_picker = None;
                (
                    WorkspacePickRootsResult::new(
                        WorkspacePickRootsStatus::Cancelled,
                        state.scope.snapshot(),
                    ),
                    None,
                    Vec::new(),
                )
            }
            DirectoryPickerResult::Selected(paths) => {
                if matches!(mode, WorkspacePickRootsMode::Replace) && paths.len() != 1 {
                    state.active_picker = None;
                    return Err(invalid_picker_selection());
                }
                let watcher = match self
                    .watcher_for(state.scope.workspace_id(), Arc::clone(&watch_wake_sink))
                {
                    Ok(watcher) => watcher,
                    Err(error) => {
                        state.active_picker = None;
                        return Err(error);
                    }
                };
                let mut next_watch_epoch = state.next_watch_epoch;
                let mut prepared = Vec::new();
                let mut prepare = |root_id, watch_path: &std::path::Path, _lease| {
                    next_watch_epoch = next_watch_epoch
                        .checked_add(1)
                        .ok_or_else(workspace_conflict)?;
                    let epoch = WatchRegistrationEpoch::new(next_watch_epoch)?;
                    prepared.push(
                        watcher.prepare_root(WatchRegistration::new(root_id, epoch), watch_path)?,
                    );
                    Ok(())
                };
                let authorization = match mode {
                    WorkspacePickRootsMode::Add => state
                        .scope
                        .authorize_roots_atomically_with(&paths, &mut prepare)
                        .map(|_| ()),
                    WorkspacePickRootsMode::Replace => state
                        .scope
                        .replace_root_atomically_with(&paths[0], &mut prepare)
                        .map(|_| ()),
                };
                state.next_watch_epoch = next_watch_epoch;
                state.active_picker = None;
                authorization?;
                for prepared_watcher in prepared {
                    let registration = watcher.activate(prepared_watcher);
                    state
                        .watch_registrations
                        .insert(registration.root_id(), registration);
                }
                let active_root_ids = state.scope.root_ids().into_iter().collect::<BTreeSet<_>>();
                let mut revoked_registrations = Vec::new();
                state.watch_registrations.retain(|root_id, registration| {
                    let retained = active_root_ids.contains(root_id);
                    if !retained {
                        revoked_registrations.push(*registration);
                    }
                    retained
                });
                invalidate_delete_batch(&mut state);
                invalidate_text_search(&mut state);
                (
                    WorkspacePickRootsResult::new(
                        WorkspacePickRootsStatus::Selected,
                        state.scope.snapshot(),
                    ),
                    Some(watcher),
                    revoked_registrations,
                )
            }
            DirectoryPickerResult::Cancelled => {
                state.active_picker = None;
                (
                    WorkspacePickRootsResult::new(
                        WorkspacePickRootsStatus::Cancelled,
                        state.scope.snapshot(),
                    ),
                    None,
                    Vec::new(),
                )
            }
        };
        drop(state);
        drop(mutation);
        if let Some(watcher) = watcher {
            for registration in revoked_registrations {
                watcher.revoke(registration);
            }
        }
        Ok(result)
    }

    fn finish_file_picker(
        self: &Arc<Self>,
        token: u64,
        selection: FilePickerResult,
        watch_wake_sink: WorkspaceWatchWakeSink,
    ) -> Result<WorkspaceOpenFilesResult, CommandError> {
        let mutation = lock(&self.mutation_gate)?;
        let mut state = lock(&self.state)?;
        ensure_active_picker(&state, token)?;

        let (result, watcher, revoked_registrations) = match selection {
            FilePickerResult::Selected(paths) if paths.is_empty() => {
                state.active_picker = None;
                (
                    WorkspaceOpenFilesResult::new(
                        WorkspacePickRootsStatus::Cancelled,
                        state.scope.snapshot(),
                        Vec::new(),
                    ),
                    None,
                    Vec::new(),
                )
            }
            FilePickerResult::Cancelled => {
                state.active_picker = None;
                (
                    WorkspaceOpenFilesResult::new(
                        WorkspacePickRootsStatus::Cancelled,
                        state.scope.snapshot(),
                        Vec::new(),
                    ),
                    None,
                    Vec::new(),
                )
            }
            FilePickerResult::Selected(paths) => {
                let files = match super::prepare_open_file_selections(paths) {
                    Ok(files) => files,
                    Err(error) => {
                        state.active_picker = None;
                        return Err(error);
                    }
                };
                let mut parents = Vec::new();
                for file in &files {
                    if !parents.contains(&file.parent) {
                        parents.push(file.parent.clone());
                    }
                }
                let watcher = match self
                    .watcher_for(state.scope.workspace_id(), Arc::clone(&watch_wake_sink))
                {
                    Ok(watcher) => watcher,
                    Err(error) => {
                        state.active_picker = None;
                        return Err(error);
                    }
                };
                let mut next_watch_epoch = state.next_watch_epoch;
                let mut prepared_watchers = Vec::new();
                let mut prepare = |root_id, watch_path: &std::path::Path, _lease| {
                    next_watch_epoch = next_watch_epoch
                        .checked_add(1)
                        .ok_or_else(workspace_conflict)?;
                    let epoch = WatchRegistrationEpoch::new(next_watch_epoch)?;
                    prepared_watchers.push(
                        watcher.prepare_root(WatchRegistration::new(root_id, epoch), watch_path)?,
                    );
                    Ok(())
                };
                let root_ids = state
                    .scope
                    .authorize_roots_atomically_with(&parents, &mut prepare);
                state.next_watch_epoch = next_watch_epoch;
                state.active_picker = None;
                let root_ids = root_ids?;
                for prepared_watcher in prepared_watchers {
                    let registration = watcher.activate(prepared_watcher);
                    state
                        .watch_registrations
                        .insert(registration.root_id(), registration);
                }
                let parent_roots = parents
                    .into_iter()
                    .zip(root_ids)
                    .collect::<BTreeMap<_, _>>();
                let targets = files
                    .into_iter()
                    .map(|file| {
                        let root_id = parent_roots
                            .get(&file.parent)
                            .copied()
                            .ok_or_else(workspace_conflict)?;
                        Ok(WorkspaceOpenFileTarget::new(root_id, file.relative_path))
                    })
                    .collect::<Result<Vec<_>, CommandError>>()?;
                invalidate_delete_batch(&mut state);
                invalidate_text_search(&mut state);
                if state.initial_restore_status == WorkspaceRestoreStatus::Pending {
                    state.initial_restore_status = WorkspaceRestoreStatus::None;
                }
                (
                    WorkspaceOpenFilesResult::new(
                        WorkspacePickRootsStatus::Selected,
                        state.scope.snapshot(),
                        targets,
                    ),
                    Some(watcher),
                    Vec::new(),
                )
            }
        };
        drop(state);
        drop(mutation);
        if let Some(watcher) = watcher {
            for registration in revoked_registrations {
                watcher.revoke(registration);
            }
        }
        Ok(result)
    }

    fn watcher_for(
        self: &Arc<Self>,
        workspace_id: WorkspaceId,
        watch_wake_sink: WorkspaceWatchWakeSink,
    ) -> Result<Arc<WindowWatcher>, CommandError> {
        let mut slot = lock(&self.watcher)?;
        if let Some(watcher) = slot.as_ref() {
            return Ok(Arc::clone(watcher));
        }

        let weak_workspace = Arc::downgrade(self);
        let scanner = move |root_id, epoch| {
            weak_workspace
                .upgrade()
                .map_or(WatchScanOutcome::Stale, |workspace| {
                    workspace.scan_watch_root(root_id, epoch)
                })
        };
        let pending_emitter = move || watch_wake_sink(workspace_id);
        let watcher = Arc::new(WindowWatcher::start(
            workspace_id,
            scanner,
            pending_emitter,
        )?);
        *slot = Some(Arc::clone(&watcher));
        Ok(watcher)
    }

    fn scan_watch_root(&self, root_id: RootId, epoch: WatchRegistrationEpoch) -> WatchScanOutcome {
        let Ok(_mutation) = self.mutation_gate.lock() else {
            return WatchScanOutcome::Failed;
        };
        let lease = {
            let Ok(state) = self.state.lock() else {
                return WatchScanOutcome::Failed;
            };
            if state.closed
                || state
                    .watch_registrations
                    .get(&root_id)
                    .is_none_or(|registration| registration.epoch() != epoch)
            {
                return WatchScanOutcome::Stale;
            }
            match state.scope.lease(root_id) {
                Ok(lease) => lease,
                Err(_) => return WatchScanOutcome::Failed,
            }
        };

        let root_path = RelativePath::parse_wire("")
            .expect("the empty workspace-relative path is always valid");
        let scan_succeeded = reader::read_directory(&lease, &root_path).is_ok();
        let Ok(state) = self.state.lock() else {
            return WatchScanOutcome::Failed;
        };
        let still_current = !state.closed
            && state.scope.contains_root(root_id)
            && state
                .watch_registrations
                .get(&root_id)
                .is_some_and(|registration| registration.epoch() == epoch);
        if !still_current {
            WatchScanOutcome::Stale
        } else if scan_succeeded {
            WatchScanOutcome::Valid
        } else {
            WatchScanOutcome::Failed
        }
    }

    fn watch_sync(
        &self,
        roots: &[(RootId, Option<u32>)],
    ) -> Result<WorkspaceWatchSyncResult, CommandError> {
        let _mutation = lock(&self.mutation_gate)?;
        let (workspace_id, requested) = {
            let state = lock(&self.state)?;
            ensure_open(&state)?;
            let requested = roots
                .iter()
                .filter_map(|(root_id, acknowledged_generation)| {
                    state
                        .watch_registrations
                        .get(root_id)
                        .copied()
                        .map(|registration| (registration, *acknowledged_generation))
                })
                .collect::<Vec<_>>();
            (state.scope.workspace_id(), requested)
        };
        let watcher = lock(&self.watcher)?.clone();
        let Some(watcher) = watcher else {
            return Ok(WorkspaceWatchSyncResult::new(workspace_id, Vec::new()));
        };

        let mut acknowledgements = Vec::new();
        let mut first_subscriptions = Vec::new();
        let mut requested_root_ids = BTreeSet::new();
        for (registration, acknowledged_generation) in requested {
            requested_root_ids.insert(registration.root_id());
            if let Some(generation) = acknowledged_generation {
                acknowledgements.push(WatchAcknowledgement::new(
                    registration.root_id(),
                    generation,
                )?);
            } else {
                first_subscriptions.push(registration);
            }
        }
        let mut snapshot = watcher.sync(&acknowledgements)?;
        if snapshot.workspace_id() != workspace_id {
            return Err(workspace_conflict());
        }
        let already_pending = snapshot
            .pending()
            .iter()
            .map(|root| root.root_id())
            .collect::<BTreeSet<_>>();
        let mut requested_scan = false;
        for registration in first_subscriptions {
            if !already_pending.contains(&registration.root_id()) {
                requested_scan |= watcher.mark_root_rescan(registration);
            }
        }
        if requested_scan {
            snapshot = watcher.sync(&[])?;
            if snapshot.workspace_id() != workspace_id {
                return Err(workspace_conflict());
            }
        }
        let pending = snapshot
            .into_pending()
            .into_iter()
            .filter(|root| requested_root_ids.contains(&root.root_id()))
            .map(|root| {
                WorkspaceWatchPendingRoot::new(
                    root.root_id(),
                    root.generation(),
                    root.rescan_required(),
                )
            })
            .collect();
        Ok(WorkspaceWatchSyncResult::new(workspace_id, pending))
    }

    fn mark_all_watchers_rescan(&self) {
        let watcher = self
            .watcher
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        if let Some(watcher) = watcher {
            watcher.mark_all_rescan();
        }
    }

    fn remove_root(&self, root_id: RootId) -> Result<WorkspaceSnapshot, CommandError> {
        let mutation = lock(&self.mutation_gate)?;
        let mut state = lock(&self.state)?;
        ensure_open(&state)?;
        state.scope.remove(root_id)?;
        let removed_registration = state.watch_registrations.remove(&root_id);
        invalidate_delete_batch(&mut state);
        invalidate_text_search(&mut state);
        let snapshot = state.scope.snapshot();
        let watcher = lock(&self.watcher)?.clone();
        drop(state);
        drop(mutation);
        if let (Some(watcher), Some(registration)) = (watcher, removed_registration) {
            watcher.revoke(registration);
        }
        Ok(snapshot)
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
        let mutation = match self.mutation_gate.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let mut state = match self.state.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        state.closed = true;
        state.active_picker = None;
        state.watch_registrations.clear();
        invalidate_delete_batch(&mut state);
        // Taken (not just cleared) so the search task's thread-join — bounded
        // and fast, but still a blocking operation — happens after the state
        // and mutation locks are released below, the same way `watcher.close()`
        // is deferred past `drop(state)`/`drop(mutation)` a few lines down.
        let active_text_search = state.active_text_search.take();
        let watcher = self
            .watcher
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        drop(state);
        drop(mutation);
        drop(active_text_search);
        if let Some(watcher) = watcher {
            watcher.close();
        }
    }
}

struct WindowWorkspaceState {
    scope: WorkspaceScope,
    next_picker_token: u64,
    active_picker: Option<u64>,
    next_watch_epoch: u64,
    watch_registrations: BTreeMap<RootId, WatchRegistration>,
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    active_delete_batch: Option<DeleteBatchReceipt>,
    active_text_search: Option<ActiveTextSearch>,
    initial_restore_status: WorkspaceRestoreStatus,
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

/// Unconditionally drops (cancelling/reclaiming) a window's active-or-
/// lingering text search: called at every site that already invalidates the
/// delete batch (root add/replace/remove, window close) because a text
/// search's leases were taken from the root set at the moment it started,
/// and any change to that set — even one unrelated to the specific roots the
/// search named — must not leave a task running against authorization that
/// may no longer hold.
fn invalidate_text_search(state: &mut WindowWorkspaceState) {
    state.active_text_search = None;
}

fn discard_expired_text_search(state: &mut WindowWorkspaceState, now: Instant) {
    if state
        .active_text_search
        .as_ref()
        .is_some_and(|active| now >= active.idle_deadline)
    {
        state.active_text_search = None;
    }
}

fn search_text_deadline(now: Instant) -> Result<Instant, CommandError> {
    now.checked_add(SEARCH_TASK_IDLE_TTL)
        .ok_or_else(workspace_operation_failed)
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
