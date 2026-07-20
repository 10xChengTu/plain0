use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::num::NonZeroU64;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TryRecvError, TrySendError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use notify::event::ModifyKind;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use crate::error::CommandError;

use super::{RootId, WorkspaceId};

const WATCH_WAKE_QUEUE_CAPACITY: usize = 1;
const WATCH_WORKER_THROTTLE: Duration = Duration::from_millis(75);
const MAX_WATCH_ACKNOWLEDGEMENTS: usize = 256;

const SIGNAL_INACTIVE: u8 = 0;
const SIGNAL_ACTIVE: u8 = 1;
const SIGNAL_REVOKED: u8 = 2;

/// An authorization-independent identity for one watcher registration.
///
/// The service owns epoch allocation. Keeping it separate from the workspace
/// revision lets a late scan be rejected without treating a watcher event as
/// authorization.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub(crate) struct WatchRegistrationEpoch(NonZeroU64);

impl WatchRegistrationEpoch {
    pub(crate) fn new(value: u64) -> Result<Self, CommandError> {
        NonZeroU64::new(value)
            .map(Self)
            .ok_or_else(invalid_watch_request)
    }
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub(crate) struct WatchRegistration {
    root_id: RootId,
    epoch: WatchRegistrationEpoch,
}

impl WatchRegistration {
    pub(crate) const fn new(root_id: RootId, epoch: WatchRegistrationEpoch) -> Self {
        Self { root_id, epoch }
    }

    pub(crate) const fn root_id(self) -> RootId {
        self.root_id
    }

    pub(crate) const fn epoch(self) -> WatchRegistrationEpoch {
        self.epoch
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WatchScanOutcome {
    Valid,
    Failed,
    /// The service's post-scan gate/state check found that the window, root,
    /// or registration epoch was revoked while the scan was in flight.
    Stale,
}

/// The service injects the capability scan and the gate/state revalidation.
/// It deliberately receives no filesystem path.
pub(crate) trait WatchRootScanner: Send + Sync + 'static {
    fn scan_and_revalidate(
        &self,
        root_id: RootId,
        epoch: WatchRegistrationEpoch,
    ) -> WatchScanOutcome;
}

impl<F> WatchRootScanner for F
where
    F: Fn(RootId, WatchRegistrationEpoch) -> WatchScanOutcome + Send + Sync + 'static,
{
    fn scan_and_revalidate(
        &self,
        root_id: RootId,
        epoch: WatchRegistrationEpoch,
    ) -> WatchScanOutcome {
        self(root_id, epoch)
    }
}

/// A window-targeted hint that pending state can now be pulled.
pub(crate) trait WatchPendingEmitter: Send + Sync + 'static {
    fn emit_pending_hint(&self);
}

impl<F> WatchPendingEmitter for F
where
    F: Fn() + Send + Sync + 'static,
{
    fn emit_pending_hint(&self) {
        self();
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct WatchAcknowledgement {
    root_id: RootId,
    generation: u32,
}

impl WatchAcknowledgement {
    pub(crate) fn new(root_id: RootId, generation: u32) -> Result<Self, CommandError> {
        if generation == 0 {
            return Err(invalid_watch_request());
        }
        Ok(Self {
            root_id,
            generation,
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct PendingRootInvalidation {
    root_id: RootId,
    generation: u32,
    rescan_required: bool,
}

impl PendingRootInvalidation {
    pub(crate) const fn root_id(self) -> RootId {
        self.root_id
    }

    pub(crate) const fn generation(self) -> u32 {
        self.generation
    }

    pub(crate) const fn rescan_required(self) -> bool {
        self.rescan_required
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WatchSyncSnapshot {
    workspace_id: WorkspaceId,
    pending: Vec<PendingRootInvalidation>,
}

impl WatchSyncSnapshot {
    pub(crate) const fn workspace_id(&self) -> WorkspaceId {
        self.workspace_id
    }

    pub(crate) fn pending(&self) -> &[PendingRootInvalidation] {
        &self.pending
    }

    pub(crate) fn into_pending(self) -> Vec<PendingRootInvalidation> {
        self.pending
    }
}

/// A prepared watcher is already registered with the operating system, but its
/// callback cannot mutate window state until `WindowWatcher::activate` commits
/// the corresponding root registration.
pub(crate) struct PreparedRootWatcher {
    registration: WatchRegistration,
    signal: Arc<RootSignal>,
    watcher: Box<dyn RootWatcherHandle>,
}

#[cfg(test)]
impl PreparedRootWatcher {
    pub(crate) const fn registration(&self) -> WatchRegistration {
        self.registration
    }
}

impl fmt::Debug for PreparedRootWatcher {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PreparedRootWatcher")
            .field("registration", &self.registration)
            .finish_non_exhaustive()
    }
}

/// One watcher coordinator belongs to exactly one WebView window. It owns one
/// capacity-one wake queue and one worker, regardless of the number of roots.
pub(crate) struct WindowWatcher {
    factory: Arc<dyn RootWatcherFactory>,
    shared: Arc<WindowWatchShared>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl WindowWatcher {
    pub(crate) fn start<S, E>(
        workspace_id: WorkspaceId,
        scanner: S,
        pending_emitter: E,
    ) -> Result<Self, CommandError>
    where
        S: WatchRootScanner,
        E: WatchPendingEmitter,
    {
        Self::start_with_components(
            workspace_id,
            Arc::new(NotifyRootWatcherFactory),
            Arc::new(scanner),
            Arc::new(pending_emitter),
            Arc::new(FixedWorkerPacer),
        )
    }

    fn start_with_components(
        workspace_id: WorkspaceId,
        factory: Arc<dyn RootWatcherFactory>,
        scanner: Arc<dyn WatchRootScanner>,
        pending_emitter: Arc<dyn WatchPendingEmitter>,
        pacer: Arc<dyn WorkerPacer>,
    ) -> Result<Self, CommandError> {
        let (wake_sender, wake_receiver) = mpsc::sync_channel(WATCH_WAKE_QUEUE_CAPACITY);
        let shared = Arc::new(WindowWatchShared {
            workspace_id,
            wake_sender,
            state: Mutex::new(WindowWatchState::default()),
            scanner,
            pending_emitter,
            pacer,
        });
        let worker_shared = Arc::clone(&shared);
        let worker = thread::Builder::new()
            .name("plain-workspace-watch".to_owned())
            .spawn(move || run_worker(worker_shared, wake_receiver))
            .map_err(|_| watcher_start_failed())?;
        Ok(Self {
            factory,
            shared,
            worker: Mutex::new(Some(worker)),
        })
    }

    /// Creates and starts the OS watcher without making callbacks authoritative.
    /// The watch path is borrowed for this call and is never retained by the
    /// coordinator, scanner, state machine, or sync result.
    pub(crate) fn prepare_root(
        &self,
        registration: WatchRegistration,
        watch_path: &Path,
    ) -> Result<PreparedRootWatcher, CommandError> {
        if recover_lock(&self.shared.state).closed {
            return Err(watcher_closed());
        }
        let signal = Arc::new(RootSignal::new(self.shared.wake_sender.clone()));
        let callback_signal = Arc::clone(&signal);
        let watcher = self.factory.prepare(
            watch_path,
            Arc::new(move |observation| callback_signal.observe(observation)),
        )?;
        if recover_lock(&self.shared.state).closed {
            signal.revoke();
            drop(watcher);
            return Err(watcher_closed());
        }
        Ok(PreparedRootWatcher {
            registration,
            signal,
            watcher,
        })
    }

    /// Activates a prepared watcher after the service commits its root scope.
    /// Replacing the same root detaches and revokes the old epoch first; its
    /// handle is dropped only after the state lock has been released.
    ///
    /// The caller must hold the window mutation gate across scope commit and
    /// this call. That lock excludes window close, making activation an
    /// intentionally infallible second half of the prepared transaction.
    pub(crate) fn activate(&self, prepared: PreparedRootWatcher) -> WatchRegistration {
        let PreparedRootWatcher {
            registration,
            signal,
            watcher,
        } = prepared;
        let old_record = {
            let mut state = recover_lock(&self.shared.state);
            assert!(
                !state.closed,
                "prepared watcher activated after window close"
            );
            let old_record = state.roots.remove(&registration.root_id);
            if let Some(old_record) = old_record.as_ref() {
                old_record.signal.revoke();
            }
            state.roots.insert(
                registration.root_id,
                RootWatchRecord::new(registration.epoch, Arc::clone(&signal), watcher),
            );
            old_record
        };
        signal.activate_and_rescan();
        drop(old_record);
        registration
    }

    /// Forces a conservative root scan without granting mutation authority.
    pub(crate) fn mark_root_rescan(&self, registration: WatchRegistration) -> bool {
        let signal = {
            let state = recover_lock(&self.shared.state);
            state
                .roots
                .get(&registration.root_id)
                .filter(|record| record.epoch == registration.epoch)
                .map(|record| Arc::clone(&record.signal))
        };
        signal.is_some_and(|signal| {
            signal.mark(true);
            true
        })
    }

    /// Used for resume and explicit refresh. All roots share one wake token.
    pub(crate) fn mark_all_rescan(&self) {
        let signals = {
            let state = recover_lock(&self.shared.state);
            if state.closed {
                return;
            }
            state
                .roots
                .values()
                .map(|record| Arc::clone(&record.signal))
                .collect::<Vec<_>>()
        };
        for signal in &signals {
            signal.mark_without_wake(true);
        }
        wake_window(&self.shared.wake_sender);
    }

    /// Removes one exact epoch. A stale caller cannot revoke its replacement.
    pub(crate) fn revoke(&self, registration: WatchRegistration) -> bool {
        let removed = {
            let mut state = recover_lock(&self.shared.state);
            if state
                .roots
                .get(&registration.root_id)
                .is_some_and(|record| record.epoch == registration.epoch)
            {
                let removed = state.roots.remove(&registration.root_id);
                if let Some(record) = removed.as_ref() {
                    record.signal.revoke();
                }
                removed
            } else {
                None
            }
        };
        let did_remove = removed.is_some();
        drop(removed);
        did_remove
    }

    /// Retains only the exact root/epoch registrations still authorized by the
    /// workspace scope. Detached watcher handles are dropped outside the lock.
    #[cfg(test)]
    pub(crate) fn retain(&self, registrations: &[WatchRegistration]) {
        let retained = registrations.iter().copied().collect::<BTreeSet<_>>();
        let removed = {
            let mut state = recover_lock(&self.shared.state);
            let removed_ids = state
                .roots
                .iter()
                .filter_map(|(root_id, record)| {
                    let registration = WatchRegistration::new(*root_id, record.epoch);
                    (!retained.contains(&registration)).then_some(*root_id)
                })
                .collect::<Vec<_>>();
            removed_ids
                .into_iter()
                .filter_map(|root_id| {
                    let record = state.roots.remove(&root_id)?;
                    record.signal.revoke();
                    Some(record)
                })
                .collect::<Vec<_>>()
        };
        drop(removed);
    }

    /// Applies exact acknowledgements and returns all sticky pending roots.
    /// Wrong/old generations are harmless; duplicate root acknowledgements are
    /// rejected so acknowledgement order cannot alter the result.
    pub(crate) fn sync(
        &self,
        acknowledgements: &[WatchAcknowledgement],
    ) -> Result<WatchSyncSnapshot, CommandError> {
        if acknowledgements.len() > MAX_WATCH_ACKNOWLEDGEMENTS {
            return Err(invalid_watch_request());
        }
        let mut acknowledged_roots = BTreeSet::new();
        if acknowledgements
            .iter()
            .any(|acknowledgement| !acknowledged_roots.insert(acknowledgement.root_id))
        {
            return Err(invalid_watch_request());
        }

        let mut needs_worker_wake = false;
        let pending = {
            let mut state = recover_lock(&self.shared.state);
            if state.closed {
                return Err(watcher_closed());
            }
            for acknowledgement in acknowledgements {
                let Some(record) = state.roots.get_mut(&acknowledgement.root_id) else {
                    continue;
                };
                if record
                    .pending
                    .is_some_and(|pending| pending.generation == acknowledgement.generation)
                {
                    if acknowledgement.generation == u32::MAX {
                        // Generation reuse would let a delayed acknowledgement
                        // clear new state. Keep the final generation sticky.
                        if let Some(pending) = record.pending.as_mut() {
                            pending.rescan_required = true;
                        }
                    } else {
                        record.pending = None;
                        needs_worker_wake |= record.signal.is_dirty();
                    }
                }
            }
            state
                .roots
                .iter()
                .filter_map(|(root_id, record)| {
                    record.pending.map(|pending| PendingRootInvalidation {
                        root_id: *root_id,
                        generation: pending.generation,
                        rescan_required: pending.rescan_required,
                    })
                })
                .collect::<Vec<_>>()
        };
        if needs_worker_wake {
            wake_window(&self.shared.wake_sender);
        }
        Ok(WatchSyncSnapshot {
            workspace_id: self.shared.workspace_id,
            pending,
        })
    }

    /// Idempotently detaches every watcher, then joins the sole worker without
    /// holding the watcher-state lock.
    pub(crate) fn close(&self) {
        let removed = {
            let mut state = recover_lock(&self.shared.state);
            if !state.closed {
                state.closed = true;
            }
            let removed = std::mem::take(&mut state.roots)
                .into_values()
                .collect::<Vec<_>>();
            for record in &removed {
                record.signal.revoke();
            }
            removed
        };
        wake_window(&self.shared.wake_sender);
        drop(removed);

        let worker = recover_lock(&self.worker).take();
        if let Some(worker) = worker {
            if worker.thread().id() == thread::current().id() {
                drop(worker);
            } else {
                let _ = worker.join();
            }
        }
    }
}

impl fmt::Debug for WindowWatcher {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("WindowWatcher")
            .field("workspace_id", &self.shared.workspace_id)
            .finish_non_exhaustive()
    }
}

impl Drop for WindowWatcher {
    fn drop(&mut self) {
        self.close();
    }
}

struct WindowWatchShared {
    workspace_id: WorkspaceId,
    wake_sender: SyncSender<()>,
    state: Mutex<WindowWatchState>,
    scanner: Arc<dyn WatchRootScanner>,
    pending_emitter: Arc<dyn WatchPendingEmitter>,
    pacer: Arc<dyn WorkerPacer>,
}

#[derive(Default)]
struct WindowWatchState {
    roots: BTreeMap<RootId, RootWatchRecord>,
    closed: bool,
}

struct RootWatchRecord {
    epoch: WatchRegistrationEpoch,
    signal: Arc<RootSignal>,
    _watcher: Box<dyn RootWatcherHandle>,
    scanning: bool,
    pending: Option<PendingState>,
    next_generation: u32,
}

impl RootWatchRecord {
    fn new(
        epoch: WatchRegistrationEpoch,
        signal: Arc<RootSignal>,
        watcher: Box<dyn RootWatcherHandle>,
    ) -> Self {
        Self {
            epoch,
            signal,
            _watcher: watcher,
            scanning: false,
            pending: None,
            next_generation: 1,
        }
    }
}

#[derive(Clone, Copy)]
struct PendingState {
    generation: u32,
    rescan_required: bool,
}

struct ScanWork {
    root_id: RootId,
    epoch: WatchRegistrationEpoch,
    rescan_required: bool,
}

struct RootSignal {
    phase: AtomicU8,
    dirty: AtomicBool,
    rescan_required: AtomicBool,
    wake_sender: SyncSender<()>,
}

impl RootSignal {
    fn new(wake_sender: SyncSender<()>) -> Self {
        Self {
            phase: AtomicU8::new(SIGNAL_INACTIVE),
            dirty: AtomicBool::new(false),
            rescan_required: AtomicBool::new(false),
            wake_sender,
        }
    }

    fn activate_and_rescan(&self) {
        if self
            .phase
            .compare_exchange(
                SIGNAL_INACTIVE,
                SIGNAL_ACTIVE,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
        {
            self.mark(true);
        }
    }

    fn revoke(&self) {
        self.phase.store(SIGNAL_REVOKED, Ordering::Release);
        self.dirty.store(false, Ordering::Release);
        self.rescan_required.store(false, Ordering::Release);
    }

    fn observe(&self, observation: WatchObservation) {
        match observation {
            WatchObservation::Ignore => {}
            WatchObservation::Dirty { rescan_required } => self.mark(rescan_required),
        }
    }

    fn mark(&self, rescan_required: bool) {
        self.mark_without_wake(rescan_required);
        if self.phase.load(Ordering::Acquire) != SIGNAL_ACTIVE {
            return;
        }
        match self.wake_sender.try_send(()) {
            Ok(()) => {}
            Err(TrySendError::Full(())) => {
                // A full queue is itself evidence that fine-grained delivery
                // was coalesced. Preserve that fact in authoritative state.
                self.rescan_required.store(true, Ordering::Release);
                self.dirty.store(true, Ordering::Release);
            }
            Err(TrySendError::Disconnected(())) => {}
        }
    }

    fn mark_without_wake(&self, rescan_required: bool) {
        if self.phase.load(Ordering::Acquire) != SIGNAL_ACTIVE {
            return;
        }
        if rescan_required {
            self.rescan_required.store(true, Ordering::Release);
        }
        self.dirty.store(true, Ordering::Release);
        if self.phase.load(Ordering::Acquire) != SIGNAL_ACTIVE {
            self.dirty.store(false, Ordering::Release);
            self.rescan_required.store(false, Ordering::Release);
        }
    }

    fn is_dirty(&self) -> bool {
        self.dirty.load(Ordering::Acquire)
    }

    fn take_dirty(&self) -> Option<bool> {
        if self.phase.load(Ordering::Acquire) != SIGNAL_ACTIVE
            || !self.dirty.swap(false, Ordering::AcqRel)
        {
            return None;
        }
        Some(self.rescan_required.swap(false, Ordering::AcqRel))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WatchObservation {
    Ignore,
    Dirty { rescan_required: bool },
}

type WatchCallback = Arc<dyn Fn(WatchObservation) + Send + Sync>;

trait RootWatcherHandle: Send {}

trait RootWatcherFactory: Send + Sync {
    fn prepare(
        &self,
        watch_path: &Path,
        callback: WatchCallback,
    ) -> Result<Box<dyn RootWatcherHandle>, CommandError>;
}

struct NotifyRootWatcherFactory;

impl RootWatcherFactory for NotifyRootWatcherFactory {
    fn prepare(
        &self,
        watch_path: &Path,
        callback: WatchCallback,
    ) -> Result<Box<dyn RootWatcherHandle>, CommandError> {
        let mut watcher = RecommendedWatcher::new(
            move |result: notify::Result<Event>| callback(classify_notify_event(result)),
            Config::default().with_follow_symlinks(false),
        )
        .map_err(|_| watcher_prepare_failed())?;
        watcher
            .watch(watch_path, RecursiveMode::Recursive)
            .map_err(|_| watcher_prepare_failed())?;
        Ok(Box::new(watcher))
    }
}

impl RootWatcherHandle for RecommendedWatcher {}

fn classify_notify_event(result: notify::Result<Event>) -> WatchObservation {
    let Ok(event) = result else {
        return WatchObservation::Dirty {
            rescan_required: true,
        };
    };
    if event.kind.is_access() {
        return WatchObservation::Ignore;
    }
    let conservative_namespace_rescan = matches!(
        event.kind,
        EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(_))
    );
    WatchObservation::Dirty {
        rescan_required: event.need_rescan() || conservative_namespace_rescan,
    }
}

trait WorkerPacer: Send + Sync {
    fn pace(&self);
}

struct FixedWorkerPacer;

impl WorkerPacer for FixedWorkerPacer {
    fn pace(&self) {
        thread::sleep(WATCH_WORKER_THROTTLE);
    }
}

fn run_worker(shared: Arc<WindowWatchShared>, wake_receiver: Receiver<()>) {
    while wake_receiver.recv().is_ok() {
        if recover_lock(&shared.state).closed {
            return;
        }
        shared.pacer.pace();
        drain_wake_tokens(&wake_receiver);
        // Close may enqueue its token while this worker is pacing. Do not
        // drain that final token and then block forever on the next recv.
        if recover_lock(&shared.state).closed {
            return;
        }
        let work = collect_scan_work(&shared);
        if work.is_empty() {
            continue;
        }
        let mut created_pending = false;
        for item in work {
            let outcome = shared.scanner.scan_and_revalidate(item.root_id, item.epoch);
            created_pending |= finish_scan(&shared, item, outcome);
        }
        if created_pending {
            shared.pending_emitter.emit_pending_hint();
        }
    }
}

fn collect_scan_work(shared: &WindowWatchShared) -> Vec<ScanWork> {
    let mut state = recover_lock(&shared.state);
    if state.closed {
        return Vec::new();
    }
    state
        .roots
        .iter_mut()
        .filter_map(|(root_id, record)| {
            if record.scanning || record.pending.is_some() {
                return None;
            }
            let rescan_required = record.signal.take_dirty()?;
            record.scanning = true;
            Some(ScanWork {
                root_id: *root_id,
                epoch: record.epoch,
                rescan_required,
            })
        })
        .collect()
}

fn finish_scan(shared: &WindowWatchShared, work: ScanWork, outcome: WatchScanOutcome) -> bool {
    let mut state = recover_lock(&shared.state);
    if state.closed {
        return false;
    }
    let Some(record) = state.roots.get_mut(&work.root_id) else {
        return false;
    };
    if record.epoch != work.epoch || record.signal.phase.load(Ordering::Acquire) != SIGNAL_ACTIVE {
        return false;
    }
    record.scanning = false;
    if outcome == WatchScanOutcome::Stale {
        return false;
    }
    if record.pending.is_some() {
        return false;
    }
    let generation = record.next_generation;
    record.next_generation = generation.saturating_add(1);
    record.pending = Some(PendingState {
        generation,
        rescan_required: work.rescan_required || outcome == WatchScanOutcome::Failed,
    });
    true
}

fn drain_wake_tokens(wake_receiver: &Receiver<()>) {
    loop {
        match wake_receiver.try_recv() {
            Ok(()) => {}
            Err(TryRecvError::Empty | TryRecvError::Disconnected) => return,
        }
    }
}

fn wake_window(sender: &SyncSender<()>) {
    match sender.try_send(()) {
        Ok(()) | Err(TrySendError::Full(())) | Err(TrySendError::Disconnected(())) => {}
    }
}

fn recover_lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn invalid_watch_request() -> CommandError {
    CommandError::new(
        "WORKSPACE_WATCH_REQUEST_INVALID",
        "The workspace watch request is invalid.",
    )
}

fn watcher_start_failed() -> CommandError {
    CommandError::new(
        "WORKSPACE_WATCH_UNAVAILABLE",
        "Workspace change monitoring is unavailable.",
    )
}

fn watcher_prepare_failed() -> CommandError {
    CommandError::new(
        "WORKSPACE_WATCH_UNAVAILABLE",
        "The workspace root could not be monitored.",
    )
}

fn watcher_closed() -> CommandError {
    CommandError::new("WORKSPACE_WINDOW_CLOSED", "The workspace window is closed.")
}

#[cfg(test)]
mod tests;
