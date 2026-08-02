use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use crate::error::CommandError;

use super::dto::{CloseOutcome, CloseReason, CloseRequestEvent, CloseRequestId};
use super::{close_request_expired, invalid_close_request};

// The WebView contract has a five-second preparation budget. Keep the native
// request alive for three additional seconds so the final allow/veto invoke
// can cross the IPC boundary after that bounded preparation completes.
const CLOSE_TIMEOUT: Duration = Duration::from_secs(8);
const CLOSE_TIMEOUT_MS: u32 = 5_000;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum WindowCloseDecision {
    Allow,
    Prevent,
    Emit(CloseRequestEvent),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ExitDecision {
    Allow,
    Prevent,
    Emit(Vec<(String, CloseRequestEvent)>),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CompletionAction {
    None,
    CloseWindow,
    Exit(i32),
}

pub(crate) struct CloseCoordinator {
    state: Mutex<CloseState>,
}

#[derive(Default)]
struct CloseState {
    pending_windows: HashMap<String, PendingWindow>,
    pending_quit: Option<PendingQuit>,
    allow_window_close: HashSet<String>,
    allow_exit_once: bool,
}

struct PendingWindow {
    request_id: CloseRequestId,
    deadline: Instant,
}

struct PendingQuit {
    requests: HashMap<String, CloseRequestId>,
    deadline: Instant,
    exit_code: i32,
}

impl CloseCoordinator {
    pub(crate) fn new() -> Self {
        Self {
            state: Mutex::new(CloseState::default()),
        }
    }

    pub(crate) fn begin_window_close(
        &self,
        window_label: &str,
        now: Instant,
    ) -> Result<WindowCloseDecision, CommandError> {
        let mut state = lock(&self.state)?;
        expire(&mut state, now);
        if state.allow_window_close.remove(window_label) {
            return Ok(WindowCloseDecision::Allow);
        }
        if state.pending_quit.is_some() || state.pending_windows.contains_key(window_label) {
            return Ok(WindowCloseDecision::Prevent);
        }
        let request_id = CloseRequestId::new();
        state.pending_windows.insert(
            window_label.to_owned(),
            PendingWindow {
                request_id,
                deadline: now + CLOSE_TIMEOUT,
            },
        );
        Ok(WindowCloseDecision::Emit(CloseRequestEvent {
            request_id,
            reason: CloseReason::Close,
            timeout_ms: CLOSE_TIMEOUT_MS,
        }))
    }

    pub(crate) fn begin_exit<I>(
        &self,
        window_labels: I,
        exit_code: i32,
        now: Instant,
    ) -> Result<ExitDecision, CommandError>
    where
        I: IntoIterator<Item = String>,
    {
        let mut state = lock(&self.state)?;
        expire(&mut state, now);
        if state.allow_exit_once {
            state.allow_exit_once = false;
            return Ok(ExitDecision::Allow);
        }
        if state.pending_quit.is_some() {
            return Ok(ExitDecision::Prevent);
        }
        let labels: Vec<String> = window_labels.into_iter().collect();
        if labels.is_empty() {
            return Ok(ExitDecision::Allow);
        }
        state.pending_windows.clear();
        let mut requests = HashMap::new();
        let mut events = Vec::with_capacity(labels.len());
        for label in labels {
            let request_id = CloseRequestId::new();
            requests.insert(label.clone(), request_id);
            events.push((
                label,
                CloseRequestEvent {
                    request_id,
                    reason: CloseReason::Quit,
                    timeout_ms: CLOSE_TIMEOUT_MS,
                },
            ));
        }
        state.pending_quit = Some(PendingQuit {
            requests,
            deadline: now + CLOSE_TIMEOUT,
            exit_code,
        });
        Ok(ExitDecision::Emit(events))
    }

    pub(crate) fn complete(
        &self,
        window_label: &str,
        request_id: CloseRequestId,
        outcome: CloseOutcome,
        now: Instant,
    ) -> Result<CompletionAction, CommandError> {
        let mut state = lock(&self.state)?;
        let expired = expire(&mut state, now);

        if state
            .pending_windows
            .get(window_label)
            .is_some_and(|pending| pending.request_id == request_id)
        {
            state.pending_windows.remove(window_label);
            if outcome == CloseOutcome::Allow {
                state.allow_window_close.insert(window_label.to_owned());
                return Ok(CompletionAction::CloseWindow);
            }
            return Ok(CompletionAction::None);
        }

        let Some(pending_quit) = state.pending_quit.as_mut() else {
            return Err(if expired {
                close_request_expired()
            } else {
                invalid_close_request()
            });
        };
        if pending_quit.requests.get(window_label) != Some(&request_id) {
            return Err(invalid_close_request());
        }
        if outcome == CloseOutcome::Veto {
            state.pending_quit = None;
            return Ok(CompletionAction::None);
        }
        pending_quit.requests.remove(window_label);
        if pending_quit.requests.is_empty() {
            let exit_code = pending_quit.exit_code;
            state.pending_quit = None;
            state.allow_exit_once = true;
            return Ok(CompletionAction::Exit(exit_code));
        }
        Ok(CompletionAction::None)
    }

    pub(crate) fn cancel_request(&self, request_id: CloseRequestId) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state
            .pending_windows
            .retain(|_, pending| pending.request_id != request_id);
        if state
            .pending_quit
            .as_ref()
            .is_some_and(|pending| pending.requests.values().any(|id| *id == request_id))
        {
            state.pending_quit = None;
        }
    }

    pub(crate) fn allow_exit_after_last_window_close(&self) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.allow_exit_once = true;
    }

    pub(crate) fn rollback_failed_window_close(&self, window_label: &str) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.allow_window_close.remove(window_label);
        state.allow_exit_once = false;
    }

    pub(crate) fn close_window(&self, window_label: &str) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.pending_windows.remove(window_label);
        state.allow_window_close.remove(window_label);
        if state
            .pending_quit
            .as_ref()
            .is_some_and(|pending| pending.requests.contains_key(window_label))
        {
            state.pending_quit = None;
        }
    }
}

fn expire(state: &mut CloseState, now: Instant) -> bool {
    let before = state.pending_windows.len() + usize::from(state.pending_quit.is_some());
    state
        .pending_windows
        .retain(|_, pending| now < pending.deadline);
    if state
        .pending_quit
        .as_ref()
        .is_some_and(|pending| now >= pending.deadline)
    {
        state.pending_quit = None;
    }
    before != state.pending_windows.len() + usize::from(state.pending_quit.is_some())
}

fn lock<T>(mutex: &Mutex<T>) -> Result<MutexGuard<'_, T>, CommandError> {
    mutex.lock().map_err(|_| invalid_close_request())
}

#[cfg(test)]
mod tests {
    use super::{CloseCoordinator, CompletionAction, ExitDecision, WindowCloseDecision};
    use crate::lifecycle::dto::CloseOutcome;
    use std::time::{Duration, Instant};

    #[test]
    fn window_close_requires_one_matching_allow_and_consumes_it_once() {
        let service = CloseCoordinator::new();
        let now = Instant::now();
        let WindowCloseDecision::Emit(event) = service.begin_window_close("main", now).unwrap()
        else {
            panic!("first close emits");
        };
        assert_eq!(
            service.begin_window_close("main", now).unwrap(),
            WindowCloseDecision::Prevent
        );
        assert_eq!(
            service
                .complete("main", event.request_id, CloseOutcome::Allow, now)
                .unwrap(),
            CompletionAction::CloseWindow
        );
        assert_eq!(
            service.begin_window_close("main", now).unwrap(),
            WindowCloseDecision::Allow
        );
        assert!(matches!(
            service.begin_window_close("main", now).unwrap(),
            WindowCloseDecision::Emit(_)
        ));
    }

    #[test]
    fn veto_clears_the_attempt_without_arming_a_close() {
        let service = CloseCoordinator::new();
        let now = Instant::now();
        let WindowCloseDecision::Emit(event) = service.begin_window_close("main", now).unwrap()
        else {
            panic!("first close emits");
        };
        assert_eq!(
            service
                .complete("main", event.request_id, CloseOutcome::Veto, now)
                .unwrap(),
            CompletionAction::None
        );
        assert!(matches!(
            service.begin_window_close("main", now).unwrap(),
            WindowCloseDecision::Emit(_)
        ));
    }

    #[test]
    fn a_failed_native_close_rolls_back_every_armed_allowance() {
        let service = CloseCoordinator::new();
        let now = Instant::now();
        let WindowCloseDecision::Emit(event) = service.begin_window_close("main", now).unwrap()
        else {
            panic!("first close emits");
        };
        assert_eq!(
            service
                .complete("main", event.request_id, CloseOutcome::Allow, now)
                .unwrap(),
            CompletionAction::CloseWindow
        );
        service.allow_exit_after_last_window_close();
        service.rollback_failed_window_close("main");
        assert!(matches!(
            service.begin_window_close("main", now).unwrap(),
            WindowCloseDecision::Emit(_)
        ));
        assert!(matches!(
            service.begin_exit(["main".to_owned()], 0, now).unwrap(),
            ExitDecision::Emit(_)
        ));
    }

    #[test]
    fn quit_waits_for_every_window_and_any_veto_cancels_the_set() {
        let service = CloseCoordinator::new();
        let now = Instant::now();
        let ExitDecision::Emit(events) = service
            .begin_exit(["a".to_owned(), "b".to_owned()], 7, now)
            .unwrap()
        else {
            panic!("quit emits");
        };
        assert_eq!(
            service
                .complete("a", events[0].1.request_id, CloseOutcome::Allow, now)
                .unwrap(),
            CompletionAction::None
        );
        assert_eq!(
            service
                .complete("b", events[1].1.request_id, CloseOutcome::Allow, now)
                .unwrap(),
            CompletionAction::Exit(7)
        );
        assert_eq!(
            service.begin_exit(["a".to_owned()], 7, now).unwrap(),
            ExitDecision::Allow
        );

        let ExitDecision::Emit(events) = service
            .begin_exit(["a".to_owned(), "b".to_owned()], 0, now)
            .unwrap()
        else {
            panic!("next quit emits");
        };
        assert_eq!(
            service
                .complete("a", events[0].1.request_id, CloseOutcome::Veto, now)
                .unwrap(),
            CompletionAction::None
        );
        assert!(service
            .complete("b", events[1].1.request_id, CloseOutcome::Allow, now)
            .is_err());
    }

    #[test]
    fn expired_and_replayed_requests_never_arm_close() {
        let service = CloseCoordinator::new();
        let now = Instant::now();
        let WindowCloseDecision::Emit(event) = service.begin_window_close("main", now).unwrap()
        else {
            panic!("first close emits");
        };
        assert_eq!(
            service
                .complete(
                    "main",
                    event.request_id,
                    CloseOutcome::Allow,
                    now + Duration::from_secs(9),
                )
                .unwrap_err()
                .code(),
            "CLOSE_REQUEST_EXPIRED"
        );
        let WindowCloseDecision::Emit(next) = service
            .begin_window_close("main", now + Duration::from_secs(9))
            .unwrap()
        else {
            panic!("retry emits");
        };
        assert_ne!(event.request_id, next.request_id);
    }
}
