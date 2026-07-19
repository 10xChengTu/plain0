use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use notify::event::{AccessKind, CreateKind, Flag, ModifyKind, RemoveKind, RenameMode};

use super::*;

const WAIT_LIMIT: Duration = Duration::from_secs(3);

#[derive(Default)]
struct FakeFactory {
    callbacks: Mutex<Vec<WatchCallback>>,
    fail_next: AtomicBool,
    dropped_handles: Arc<AtomicUsize>,
}

impl FakeFactory {
    fn callback(&self, index: usize) -> WatchCallback {
        recover_lock(&self.callbacks)[index].clone()
    }

    fn prepared_count(&self) -> usize {
        recover_lock(&self.callbacks).len()
    }

    fn fail_next(&self) {
        self.fail_next.store(true, Ordering::Release);
    }

    fn dropped_handles(&self) -> usize {
        self.dropped_handles.load(Ordering::Acquire)
    }
}

impl RootWatcherFactory for FakeFactory {
    fn prepare(
        &self,
        _watch_path: &Path,
        callback: WatchCallback,
    ) -> Result<Box<dyn RootWatcherHandle>, CommandError> {
        if self.fail_next.swap(false, Ordering::AcqRel) {
            return Err(watcher_prepare_failed());
        }
        recover_lock(&self.callbacks).push(callback);
        Ok(Box::new(FakeHandle {
            dropped: Arc::clone(&self.dropped_handles),
        }))
    }
}

struct FakeHandle {
    dropped: Arc<AtomicUsize>,
}

impl RootWatcherHandle for FakeHandle {}

impl Drop for FakeHandle {
    fn drop(&mut self) {
        self.dropped.fetch_add(1, Ordering::AcqRel);
    }
}

struct NoopPacer;

impl WorkerPacer for NoopPacer {
    fn pace(&self) {}
}

struct BlockingPacer {
    entered: Mutex<bool>,
    entered_signal: Condvar,
    released: Mutex<bool>,
    release_signal: Condvar,
}

impl BlockingPacer {
    fn new() -> Self {
        Self {
            entered: Mutex::new(false),
            entered_signal: Condvar::new(),
            released: Mutex::new(false),
            release_signal: Condvar::new(),
        }
    }

    fn wait_until_entered(&self) {
        let deadline = Instant::now() + WAIT_LIMIT;
        let mut entered = recover_lock(&self.entered);
        while !*entered {
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .expect("worker did not enter its pacing phase");
            let (next, timeout) = self
                .entered_signal
                .wait_timeout(entered, remaining)
                .expect("pacer entered mutex remains available");
            entered = next;
            assert!(!timeout.timed_out(), "worker pacing phase timed out");
        }
    }

    fn release(&self) {
        *recover_lock(&self.released) = true;
        self.release_signal.notify_all();
    }
}

impl WorkerPacer for BlockingPacer {
    fn pace(&self) {
        *recover_lock(&self.entered) = true;
        self.entered_signal.notify_all();
        let mut released = recover_lock(&self.released);
        while !*released {
            released = self
                .release_signal
                .wait(released)
                .expect("pacer release mutex remains available");
        }
    }
}

#[derive(Default)]
struct RecordingScanner {
    calls: Mutex<Vec<WatchRegistration>>,
    fail: AtomicBool,
}

impl RecordingScanner {
    fn calls(&self) -> Vec<WatchRegistration> {
        recover_lock(&self.calls).clone()
    }

    fn call_count(&self) -> usize {
        recover_lock(&self.calls).len()
    }

    fn fail(&self) {
        self.fail.store(true, Ordering::Release);
    }
}

impl WatchRootScanner for RecordingScanner {
    fn scan_and_revalidate(
        &self,
        root_id: RootId,
        epoch: WatchRegistrationEpoch,
    ) -> WatchScanOutcome {
        recover_lock(&self.calls).push(WatchRegistration::new(root_id, epoch));
        if self.fail.load(Ordering::Acquire) {
            WatchScanOutcome::Failed
        } else {
            WatchScanOutcome::Valid
        }
    }
}

struct BlockingScanner {
    calls: Mutex<Vec<WatchRegistration>>,
    entered: Condvar,
    released: Mutex<bool>,
    release: Condvar,
    completed: AtomicUsize,
}

impl BlockingScanner {
    fn new() -> Self {
        Self {
            calls: Mutex::new(Vec::new()),
            entered: Condvar::new(),
            released: Mutex::new(false),
            release: Condvar::new(),
            completed: AtomicUsize::new(0),
        }
    }

    fn wait_for_calls(&self, count: usize) {
        let deadline = Instant::now() + WAIT_LIMIT;
        let mut calls = recover_lock(&self.calls);
        while calls.len() < count {
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .expect("scanner did not receive the expected call");
            let (next, timeout) = self
                .entered
                .wait_timeout(calls, remaining)
                .expect("scanner call mutex remains available");
            calls = next;
            assert!(!timeout.timed_out(), "scanner call timed out");
        }
    }

    fn release(&self) {
        *recover_lock(&self.released) = true;
        self.release.notify_all();
    }

    fn wait_for_completed(&self, count: usize) {
        wait_until(|| self.completed.load(Ordering::Acquire) >= count);
    }
}

impl WatchRootScanner for BlockingScanner {
    fn scan_and_revalidate(
        &self,
        root_id: RootId,
        epoch: WatchRegistrationEpoch,
    ) -> WatchScanOutcome {
        recover_lock(&self.calls).push(WatchRegistration::new(root_id, epoch));
        self.entered.notify_all();
        let mut released = recover_lock(&self.released);
        while !*released {
            released = self
                .release
                .wait(released)
                .expect("scanner release mutex remains available");
        }
        self.completed.fetch_add(1, Ordering::AcqRel);
        WatchScanOutcome::Valid
    }
}

struct Harness {
    watcher: WindowWatcher,
    factory: Arc<FakeFactory>,
    emitted: Arc<AtomicUsize>,
}

fn harness(scanner: Arc<dyn WatchRootScanner>) -> Harness {
    harness_with_pacer(scanner, Arc::new(NoopPacer))
}

fn harness_with_pacer(scanner: Arc<dyn WatchRootScanner>, pacer: Arc<dyn WorkerPacer>) -> Harness {
    let factory = Arc::new(FakeFactory::default());
    let emitted = Arc::new(AtomicUsize::new(0));
    let emitted_for_worker = Arc::clone(&emitted);
    let watcher = WindowWatcher::start_with_components(
        WorkspaceId::new(),
        factory.clone(),
        scanner,
        Arc::new(move || {
            emitted_for_worker.fetch_add(1, Ordering::AcqRel);
        }),
        pacer,
    )
    .expect("fake watcher worker starts");
    Harness {
        watcher,
        factory,
        emitted,
    }
}

fn registration(root_id: RootId, epoch: u64) -> WatchRegistration {
    WatchRegistration::new(
        root_id,
        WatchRegistrationEpoch::new(epoch).expect("non-zero epoch"),
    )
}

fn prepare(watcher: &WindowWatcher, registration: WatchRegistration) -> PreparedRootWatcher {
    watcher
        .prepare_root(registration, Path::new("/path-is-factory-only"))
        .expect("fake watcher prepares")
}

fn wait_for_pending(watcher: &WindowWatcher, expected: usize) -> WatchSyncSnapshot {
    let deadline = Instant::now() + WAIT_LIMIT;
    loop {
        let snapshot = watcher.sync(&[]).expect("watcher sync succeeds");
        if snapshot.pending().len() == expected {
            return snapshot;
        }
        assert!(
            Instant::now() < deadline,
            "pending root count did not converge to {expected}"
        );
        thread::yield_now();
    }
}

fn acknowledge(watcher: &WindowWatcher, pending: PendingRootInvalidation) -> WatchSyncSnapshot {
    watcher
        .sync(&[
            WatchAcknowledgement::new(pending.root_id(), pending.generation())
                .expect("positive generation"),
        ])
        .expect("acknowledgement succeeds")
}

fn wait_until(mut predicate: impl FnMut() -> bool) {
    let deadline = Instant::now() + WAIT_LIMIT;
    while !predicate() {
        assert!(Instant::now() < deadline, "condition did not become true");
        thread::yield_now();
    }
}

#[test]
fn notify_classifier_ignores_access_even_with_rescan_and_discards_paths() {
    let outside = PathBuf::from("/outside/sentinel-do-not-touch");
    let access = Event::new(EventKind::Access(AccessKind::Read))
        .add_path(outside.clone())
        .set_flag(Flag::Rescan);
    assert_eq!(classify_notify_event(Ok(access)), WatchObservation::Ignore);

    let create = Event::new(EventKind::Create(CreateKind::File)).add_path(outside.clone());
    assert_eq!(
        classify_notify_event(Ok(create)),
        WatchObservation::Dirty {
            rescan_required: false
        }
    );

    let overflow = Event::new(EventKind::Create(CreateKind::Any))
        .add_path(outside.clone())
        .set_flag(Flag::Rescan);
    assert_eq!(
        classify_notify_event(Ok(overflow)),
        WatchObservation::Dirty {
            rescan_required: true
        }
    );

    let remove = Event::new(EventKind::Remove(RemoveKind::Folder)).add_path(outside.clone());
    assert_eq!(
        classify_notify_event(Ok(remove)),
        WatchObservation::Dirty {
            rescan_required: true
        }
    );

    let rename =
        Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both))).add_path(outside.clone());
    assert_eq!(
        classify_notify_event(Ok(rename)),
        WatchObservation::Dirty {
            rescan_required: true
        }
    );

    let error = notify::Error::generic("secret native failure").add_path(outside);
    assert_eq!(
        classify_notify_event(Err(error)),
        WatchObservation::Dirty {
            rescan_required: true
        }
    );
}

#[test]
fn config_explicitly_disables_symlink_following() {
    assert!(!Config::default()
        .with_follow_symlinks(false)
        .follow_symlinks());
}

#[test]
fn inactive_prepare_is_atomic_and_activation_forces_initial_rescan() {
    let scanner = Arc::new(RecordingScanner::default());
    let harness = harness(scanner.clone());
    let root_id = RootId::new();
    let registration = registration(root_id, 1);
    let prepared = prepare(&harness.watcher, registration);
    assert_eq!(prepared.registration(), registration);
    assert_eq!(harness.factory.prepared_count(), 1);

    harness.factory.callback(0)(WatchObservation::Dirty {
        rescan_required: false,
    });
    thread::yield_now();
    assert_eq!(scanner.call_count(), 0);
    assert!(harness.watcher.sync(&[]).unwrap().pending().is_empty());

    assert_eq!(harness.watcher.activate(prepared), registration);
    let snapshot = wait_for_pending(&harness.watcher, 1);
    assert_eq!(snapshot.workspace_id(), harness.watcher.shared.workspace_id);
    assert_eq!(snapshot.pending()[0].root_id(), root_id);
    assert_eq!(snapshot.pending()[0].generation(), 1);
    assert!(snapshot.pending()[0].rescan_required());
    assert_eq!(scanner.calls(), vec![registration]);
    wait_until(|| harness.emitted.load(Ordering::Acquire) == 1);
    assert_eq!(harness.emitted.load(Ordering::Acquire), 1);
}

#[test]
fn failed_prepare_is_sanitized_and_never_changes_active_state() {
    let scanner = Arc::new(RecordingScanner::default());
    let harness = harness(scanner.clone());
    harness.factory.fail_next();
    let secret_path = Path::new("/private/secret/root-name");
    let error = harness
        .watcher
        .prepare_root(registration(RootId::new(), 1), secret_path)
        .expect_err("factory failure is returned");
    assert_eq!(error.code(), "WORKSPACE_WATCH_UNAVAILABLE");
    assert!(!error.message().contains("secret"));
    assert!(!error.message().contains("root-name"));
    assert!(harness.watcher.sync(&[]).unwrap().pending().is_empty());
    assert_eq!(scanner.call_count(), 0);
}

#[test]
fn access_observations_never_dirty_an_active_root() {
    let scanner = Arc::new(RecordingScanner::default());
    let harness = harness(scanner.clone());
    let prepared = prepare(&harness.watcher, registration(RootId::new(), 1));
    harness.watcher.activate(prepared);
    let initial = wait_for_pending(&harness.watcher, 1).pending()[0];
    assert!(acknowledge(&harness.watcher, initial).pending().is_empty());
    let call_count = scanner.call_count();

    harness.factory.callback(0)(WatchObservation::Ignore);
    thread::sleep(Duration::from_millis(10));
    assert!(harness.watcher.sync(&[]).unwrap().pending().is_empty());
    assert_eq!(scanner.call_count(), call_count);
}

#[test]
fn sticky_pending_requires_exact_ack_and_storms_remain_bounded() {
    let scanner = Arc::new(RecordingScanner::default());
    let harness = harness(scanner.clone());
    let root_id = RootId::new();
    harness
        .watcher
        .activate(prepare(&harness.watcher, registration(root_id, 7)));
    let initial = wait_for_pending(&harness.watcher, 1).pending()[0];
    acknowledge(&harness.watcher, initial);

    for _ in 0..1_000 {
        harness.factory.callback(0)(WatchObservation::Dirty {
            rescan_required: false,
        });
    }
    let second = wait_for_pending(&harness.watcher, 1).pending()[0];
    assert_eq!(second.generation(), 2);
    let calls_after_second = scanner.call_count();
    for _ in 0..1_000 {
        harness.factory.callback(0)(WatchObservation::Dirty {
            rescan_required: false,
        });
    }

    let wrong_ack = WatchAcknowledgement::new(root_id, second.generation() + 1).unwrap();
    let still_second = harness.watcher.sync(&[wrong_ack]).unwrap();
    assert_eq!(still_second.pending(), &[second]);
    assert_eq!(scanner.call_count(), calls_after_second);

    let after_ack = acknowledge(&harness.watcher, second);
    assert!(after_ack.pending().is_empty());
    let third = wait_for_pending(&harness.watcher, 1).pending()[0];
    assert_eq!(third.generation(), 3);
    assert_eq!(third.root_id(), root_id);
}

#[test]
fn saturated_generation_remains_a_conservative_sticky_rescan() {
    let scanner = Arc::new(RecordingScanner::default());
    let pacer = Arc::new(BlockingPacer::new());
    let harness = harness_with_pacer(scanner, pacer.clone());
    let root_id = RootId::new();
    harness
        .watcher
        .activate(prepare(&harness.watcher, registration(root_id, 1)));
    pacer.wait_until_entered();
    recover_lock(&harness.watcher.shared.state)
        .roots
        .get_mut(&root_id)
        .expect("active root record exists")
        .next_generation = u32::MAX;
    pacer.release();

    let saturated = wait_for_pending(&harness.watcher, 1).pending()[0];
    assert_eq!(saturated.generation(), u32::MAX);
    assert!(saturated.rescan_required());
    let acknowledgement = WatchAcknowledgement::new(root_id, u32::MAX).unwrap();
    let replay = harness.watcher.sync(&[acknowledgement]).unwrap();
    assert_eq!(replay.pending().len(), 1);
    assert_eq!(replay.pending()[0].generation(), u32::MAX);
    assert!(replay.pending()[0].rescan_required());
}

#[test]
fn capacity_one_queue_still_converges_every_dirty_root() {
    let scanner = Arc::new(BlockingScanner::new());
    let harness = harness(scanner.clone());
    let registrations = (1..=3)
        .map(|epoch| registration(RootId::new(), epoch))
        .collect::<Vec<_>>();

    harness
        .watcher
        .activate(prepare(&harness.watcher, registrations[0]));
    scanner.wait_for_calls(1);

    harness
        .watcher
        .activate(prepare(&harness.watcher, registrations[1]));
    // The first activation fills the sole wake slot while root one is scanning.
    // Further observations cannot enqueue, so queue-full must become rescan state.
    harness.factory.callback(1)(WatchObservation::Dirty {
        rescan_required: false,
    });
    harness
        .watcher
        .activate(prepare(&harness.watcher, registrations[2]));

    scanner.release();
    let pending = wait_for_pending(&harness.watcher, 3);
    assert_eq!(pending.pending().len(), 3);
    assert!(pending
        .pending()
        .iter()
        .all(|invalidation| invalidation.rescan_required()));
    assert_eq!(scanner.calls.lock().unwrap().len(), 3);
}

#[test]
fn dirty_during_scan_waits_for_ack_before_allocating_the_next_generation() {
    let scanner = Arc::new(BlockingScanner::new());
    let harness = harness(scanner.clone());
    let registration = registration(RootId::new(), 1);
    harness
        .watcher
        .activate(prepare(&harness.watcher, registration));
    scanner.wait_for_calls(1);

    harness.factory.callback(0)(WatchObservation::Dirty {
        rescan_required: false,
    });
    scanner.release();
    let first = wait_for_pending(&harness.watcher, 1).pending()[0];
    assert_eq!(first.generation(), 1);
    assert_eq!(scanner.calls.lock().unwrap().len(), 1);

    assert!(acknowledge(&harness.watcher, first).pending().is_empty());
    let second = wait_for_pending(&harness.watcher, 1).pending()[0];
    assert_eq!(second.generation(), 2);
    assert_eq!(scanner.calls.lock().unwrap().len(), 2);
}

#[test]
fn scan_failure_forces_rescan_without_exposing_the_error() {
    let scanner = Arc::new(RecordingScanner::default());
    scanner.fail();
    let harness = harness(scanner);
    harness
        .watcher
        .activate(prepare(&harness.watcher, registration(RootId::new(), 1)));
    let pending = wait_for_pending(&harness.watcher, 1).pending()[0];
    assert!(pending.rescan_required());
}

#[test]
fn service_reported_stale_scan_never_creates_pending_state() {
    let completed = Arc::new(AtomicUsize::new(0));
    let completed_for_scan = Arc::clone(&completed);
    let scanner = Arc::new(move |_root_id, _epoch| {
        completed_for_scan.fetch_add(1, Ordering::AcqRel);
        WatchScanOutcome::Stale
    });
    let harness = harness(scanner);
    harness
        .watcher
        .activate(prepare(&harness.watcher, registration(RootId::new(), 1)));
    wait_until(|| completed.load(Ordering::Acquire) == 1);
    assert!(harness.watcher.sync(&[]).unwrap().pending().is_empty());
    assert_eq!(harness.emitted.load(Ordering::Acquire), 0);
}

#[test]
fn mark_all_rescan_uses_one_window_state_and_reaches_all_roots() {
    let scanner = Arc::new(RecordingScanner::default());
    let harness = harness(scanner);
    for epoch in 1..=3 {
        harness.watcher.activate(prepare(
            &harness.watcher,
            registration(RootId::new(), epoch),
        ));
    }
    let initial = wait_for_pending(&harness.watcher, 3);
    let acks = initial
        .pending()
        .iter()
        .map(|pending| WatchAcknowledgement::new(pending.root_id(), pending.generation()).unwrap())
        .collect::<Vec<_>>();
    assert!(harness.watcher.sync(&acks).unwrap().pending().is_empty());

    harness.watcher.mark_all_rescan();
    let rescans = wait_for_pending(&harness.watcher, 3);
    assert!(rescans
        .pending()
        .iter()
        .all(|pending| pending.generation() == 2 && pending.rescan_required()));
}

#[test]
fn late_scan_and_late_callback_are_discarded_after_revoke() {
    let scanner = Arc::new(BlockingScanner::new());
    let harness = harness(scanner.clone());
    let registration = registration(RootId::new(), 1);
    harness
        .watcher
        .activate(prepare(&harness.watcher, registration));
    scanner.wait_for_calls(1);

    assert!(harness.watcher.revoke(registration));
    assert_eq!(harness.factory.dropped_handles(), 1);
    harness.factory.callback(0)(WatchObservation::Dirty {
        rescan_required: true,
    });
    scanner.release();
    scanner.wait_for_completed(1);
    assert!(harness.watcher.sync(&[]).unwrap().pending().is_empty());
    assert!(!harness.watcher.revoke(registration));
}

#[test]
fn stale_epoch_cannot_revoke_or_publish_for_its_replacement() {
    let scanner = Arc::new(BlockingScanner::new());
    let harness = harness(scanner.clone());
    let root_id = RootId::new();
    let old = registration(root_id, 1);
    let replacement = registration(root_id, 2);
    harness.watcher.activate(prepare(&harness.watcher, old));
    scanner.wait_for_calls(1);

    harness
        .watcher
        .activate(prepare(&harness.watcher, replacement));
    assert!(!harness.watcher.revoke(old));
    assert!(harness.watcher.mark_root_rescan(replacement));
    assert!(!harness.watcher.mark_root_rescan(old));
    scanner.release();

    let pending = wait_for_pending(&harness.watcher, 1).pending()[0];
    assert_eq!(pending.root_id(), root_id);
    assert_eq!(pending.generation(), 1);
    wait_until(|| recover_lock(&scanner.calls).contains(&replacement));
    assert_eq!(
        scanner
            .calls
            .lock()
            .unwrap()
            .iter()
            .filter(|call| **call == old)
            .count(),
        1
    );
}

#[test]
fn retain_revokes_unlisted_epochs_and_drops_handles_outside_state() {
    let scanner = Arc::new(RecordingScanner::default());
    let harness = harness(scanner);
    let first = registration(RootId::new(), 1);
    let second = registration(RootId::new(), 2);
    harness.watcher.activate(prepare(&harness.watcher, first));
    harness.watcher.activate(prepare(&harness.watcher, second));
    wait_for_pending(&harness.watcher, 2);

    harness.watcher.retain(&[second]);
    assert_eq!(harness.factory.dropped_handles(), 1);
    let remaining = harness.watcher.sync(&[]).unwrap();
    assert_eq!(remaining.pending().len(), 1);
    assert_eq!(remaining.pending()[0].root_id(), second.root_id());
    harness.factory.callback(0)(WatchObservation::Dirty {
        rescan_required: true,
    });
    assert_eq!(harness.watcher.sync(&[]).unwrap(), remaining);
}

#[test]
fn sync_rejects_zero_duplicate_and_oversized_acknowledgements() {
    let scanner = Arc::new(RecordingScanner::default());
    let harness = harness(scanner);
    let root_id = RootId::new();
    assert_eq!(
        WatchRegistrationEpoch::new(0).unwrap_err().code(),
        "WORKSPACE_WATCH_REQUEST_INVALID"
    );
    assert_eq!(
        WatchAcknowledgement::new(root_id, 0).unwrap_err().code(),
        "WORKSPACE_WATCH_REQUEST_INVALID"
    );
    let acknowledgement = WatchAcknowledgement::new(root_id, 1).unwrap();
    assert_eq!(
        harness
            .watcher
            .sync(&[acknowledgement, acknowledgement])
            .unwrap_err()
            .code(),
        "WORKSPACE_WATCH_REQUEST_INVALID"
    );
    assert_eq!(
        harness
            .watcher
            .sync(&vec![acknowledgement; MAX_WATCH_ACKNOWLEDGEMENTS + 1])
            .unwrap_err()
            .code(),
        "WORKSPACE_WATCH_REQUEST_INVALID"
    );
}

#[test]
fn separate_windows_never_share_roots_scans_or_pending_state() {
    let first_scanner = Arc::new(RecordingScanner::default());
    let second_scanner = Arc::new(RecordingScanner::default());
    let first = harness(first_scanner.clone());
    let second = harness(second_scanner.clone());
    let first_root = registration(RootId::new(), 1);
    let second_root = registration(RootId::new(), 1);

    first.watcher.activate(prepare(&first.watcher, first_root));
    second
        .watcher
        .activate(prepare(&second.watcher, second_root));
    let first_pending = wait_for_pending(&first.watcher, 1);
    let second_pending = wait_for_pending(&second.watcher, 1);
    assert_ne!(first_pending.workspace_id(), second_pending.workspace_id());
    assert_eq!(first_scanner.calls(), vec![first_root]);
    assert_eq!(second_scanner.calls(), vec![second_root]);

    acknowledge(&first.watcher, first_pending.pending()[0]);
    assert_eq!(second.watcher.sync(&[]).unwrap(), second_pending);
}

#[test]
fn close_revokes_every_callback_drops_handles_and_joins_once() {
    let scanner = Arc::new(RecordingScanner::default());
    let harness = harness(scanner.clone());
    for epoch in 1..=2 {
        harness.watcher.activate(prepare(
            &harness.watcher,
            registration(RootId::new(), epoch),
        ));
    }
    wait_for_pending(&harness.watcher, 2);
    harness.watcher.close();
    assert_eq!(harness.factory.dropped_handles(), 2);
    let calls = scanner.call_count();
    for index in 0..2 {
        harness.factory.callback(index)(WatchObservation::Dirty {
            rescan_required: true,
        });
    }
    thread::sleep(Duration::from_millis(10));
    assert_eq!(scanner.call_count(), calls);
    assert_eq!(
        harness.watcher.sync(&[]).unwrap_err().code(),
        "WORKSPACE_WINDOW_CLOSED"
    );
    assert_eq!(
        harness
            .watcher
            .prepare_root(registration(RootId::new(), 3), Path::new("/never-observed"),)
            .unwrap_err()
            .code(),
        "WORKSPACE_WINDOW_CLOSED"
    );
    harness.watcher.close();
    assert_eq!(harness.factory.dropped_handles(), 2);
}

#[test]
fn close_during_scan_detaches_before_waiting_and_discards_the_late_result() {
    let scanner = Arc::new(BlockingScanner::new());
    let harness = harness(scanner.clone());
    harness
        .watcher
        .activate(prepare(&harness.watcher, registration(RootId::new(), 1)));
    scanner.wait_for_calls(1);

    thread::scope(|scope| {
        let close = scope.spawn(|| harness.watcher.close());
        wait_until(|| harness.factory.dropped_handles() == 1);
        harness.factory.callback(0)(WatchObservation::Dirty {
            rescan_required: true,
        });
        scanner.release();
        close.join().expect("window close joins its worker");
    });

    assert_eq!(scanner.completed.load(Ordering::Acquire), 1);
    assert_eq!(harness.emitted.load(Ordering::Acquire), 0);
    assert_eq!(
        harness.watcher.sync(&[]).unwrap_err().code(),
        "WORKSPACE_WINDOW_CLOSED"
    );
}

#[test]
fn close_token_drained_during_pacing_still_stops_the_worker() {
    let scanner = Arc::new(RecordingScanner::default());
    let pacer = Arc::new(BlockingPacer::new());
    let harness = harness_with_pacer(scanner.clone(), pacer.clone());
    harness
        .watcher
        .activate(prepare(&harness.watcher, registration(RootId::new(), 1)));
    pacer.wait_until_entered();

    thread::scope(|scope| {
        let close = scope.spawn(|| harness.watcher.close());
        wait_until(|| harness.factory.dropped_handles() == 1);
        pacer.release();
        close
            .join()
            .expect("draining the close token cannot strand the worker");
    });

    assert_eq!(scanner.call_count(), 0);
    assert_eq!(harness.emitted.load(Ordering::Acquire), 0);
}

#[test]
fn production_factory_constructs_a_recursive_watcher_without_retaining_a_path() {
    let directory = tempfile::tempdir().expect("temporary watched directory");
    let handle = NotifyRootWatcherFactory
        .prepare(directory.path(), Arc::new(|_| {}))
        .expect("platform watcher prepares with notify 8.2");
    drop(handle);
}
