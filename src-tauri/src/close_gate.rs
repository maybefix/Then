//! Holds the main window's close until the webview has written its delayed
//! saves (anchors, app state, project files), or until a timeout passes.
//!
//! The first close request starts the wait; the webview answers with
//! `finish_close_preparation`. Requests that arrive while waiting are held too.

use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

/// How long a close waits for the webview before closing anyway.
pub const CLOSE_PREPARATION_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stage {
    Open,
    Waiting { ready: bool },
    Closing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseDecision {
    /// Hold the close, tell the webview, and start waiting.
    StartWaiting,
    /// A wait is already under way: hold this request as well.
    KeepWaiting,
    /// The wait is over and the window is being closed: let it go.
    Allow,
}

pub struct CloseGate {
    stage: Mutex<Stage>,
    changed: Condvar,
}

impl CloseGate {
    pub const fn new() -> Self {
        Self { stage: Mutex::new(Stage::Open), changed: Condvar::new() }
    }

    pub fn request(&self) -> CloseDecision {
        let Ok(mut stage) = self.stage.lock() else { return CloseDecision::Allow };
        match *stage {
            Stage::Open => {
                *stage = Stage::Waiting { ready: false };
                CloseDecision::StartWaiting
            }
            Stage::Waiting { .. } => CloseDecision::KeepWaiting,
            Stage::Closing => CloseDecision::Allow,
        }
    }

    /// The webview has written what it was holding.
    pub fn mark_ready(&self) {
        let Ok(mut stage) = self.stage.lock() else { return };
        if let Stage::Waiting { ready } = &mut *stage {
            *ready = true;
            self.changed.notify_all();
        }
    }

    /// Waits for `mark_ready` or the timeout, then moves on to closing.
    /// Returns whether the webview answered in time.
    pub fn wait_then_close(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let Ok(mut stage) = self.stage.lock() else { return false };
        let answered = loop {
            if let Stage::Waiting { ready: true } = *stage {
                break true;
            }
            let now = Instant::now();
            if now >= deadline {
                break false;
            }
            match self.changed.wait_timeout(stage, deadline - now) {
                Ok((next, _)) => stage = next,
                Err(_) => return false,
            }
        };
        *stage = Stage::Closing;
        answered
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn first_request_waits_and_later_ones_are_held() {
        let gate = CloseGate::new();
        assert_eq!(gate.request(), CloseDecision::StartWaiting);
        assert_eq!(gate.request(), CloseDecision::KeepWaiting);
    }

    #[test]
    fn closes_as_soon_as_the_webview_answers() {
        let gate = Arc::new(CloseGate::new());
        assert_eq!(gate.request(), CloseDecision::StartWaiting);
        let answering = Arc::clone(&gate);
        let answer = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            answering.mark_ready();
        });
        let started = Instant::now();
        assert!(gate.wait_then_close(Duration::from_secs(5)));
        assert!(started.elapsed() < Duration::from_secs(2), "the answer must end the wait");
        answer.join().unwrap();
        assert_eq!(gate.request(), CloseDecision::Allow);
    }

    #[test]
    fn closes_after_the_timeout_without_an_answer() {
        let gate = CloseGate::new();
        assert_eq!(gate.request(), CloseDecision::StartWaiting);
        let started = Instant::now();
        assert!(!gate.wait_then_close(Duration::from_millis(100)));
        assert!(started.elapsed() >= Duration::from_millis(100));
        assert_eq!(gate.request(), CloseDecision::Allow);
    }

    #[test]
    fn an_answer_before_the_wait_starts_is_kept() {
        let gate = CloseGate::new();
        assert_eq!(gate.request(), CloseDecision::StartWaiting);
        gate.mark_ready();
        assert!(gate.wait_then_close(Duration::from_millis(1)));
    }

    #[test]
    fn an_answer_without_a_request_is_ignored() {
        let gate = CloseGate::new();
        gate.mark_ready();
        assert_eq!(gate.request(), CloseDecision::StartWaiting);
        assert!(!gate.wait_then_close(Duration::from_millis(10)));
    }
}
