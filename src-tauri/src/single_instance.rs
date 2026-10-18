//! One running Then per application identifier.
//!
//! The first Then holds a named mutex and waits on a named event. A second
//! launch finds the mutex taken, sets the event and quits; the first brings
//! its window forward. Names carry the identifier, so a QA build with its own
//! identifier runs beside the everyday Then.

#[cfg(windows)]
mod imp {
    use windows::core::HSTRING;
    use windows::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE, WAIT_OBJECT_0};
    use windows::Win32::System::Threading::{
        CreateEventW, CreateMutexW, OpenEventW, SetEvent, WaitForSingleObject, EVENT_MODIFY_STATE, INFINITE,
    };

    pub struct First {
        mutex: isize,
        event: isize,
    }

    fn names(identifier: &str) -> (HSTRING, HSTRING) {
        let safe: String = identifier
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' { c } else { '_' })
            .collect();
        (
            HSTRING::from(format!("Local\\then-{safe}-instance")),
            HSTRING::from(format!("Local\\then-{safe}-activate")),
        )
    }

    /// None when another Then with this identifier runs (it has been asked
    /// to come forward). If the names cannot be created, this Then runs.
    pub fn claim(identifier: &str) -> Option<First> {
        let (mutex_name, event_name) = names(identifier);
        unsafe {
            let Ok(mutex) = CreateMutexW(None, false, &mutex_name) else {
                return Some(First { mutex: 0, event: 0 });
            };
            if GetLastError() == ERROR_ALREADY_EXISTS {
                let _ = CloseHandle(mutex);
                if let Ok(event) = OpenEventW(EVENT_MODIFY_STATE, false, &event_name) {
                    let _ = SetEvent(event);
                    let _ = CloseHandle(event);
                }
                return None;
            }
            let event = CreateEventW(None, false, false, &event_name).map(|h| h.0 as isize).unwrap_or(0);
            Some(First { mutex: mutex.0 as isize, event })
        }
    }

    impl First {
        /// Calls `activate` each time another launch asks this Then to come
        /// forward. The mutex stays held for the life of the process.
        pub fn listen(self, activate: impl Fn() + Send + 'static) {
            let (mutex, event) = (self.mutex, self.event);
            if event == 0 {
                return;
            }
            std::thread::spawn(move || {
                let _held = mutex;
                let event = HANDLE(event as _);
                while unsafe { WaitForSingleObject(event, INFINITE) } == WAIT_OBJECT_0 {
                    activate();
                }
            });
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub struct First;
    pub fn claim(_identifier: &str) -> Option<First> {
        Some(First)
    }
    impl First {
        pub fn listen(self, _activate: impl Fn() + Send + 'static) {}
    }
}

pub use imp::{claim, First};

#[cfg(all(test, windows))]
mod tests {
    use super::claim;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn a_second_launch_quits_and_brings_the_first_forward() {
        let identifier = format!("test.single-instance.{}", std::process::id());
        let first = claim(&identifier).expect("the first launch runs");
        let (sender, receiver) = mpsc::channel();
        first.listen(move || {
            let _ = sender.send(());
        });

        assert!(claim(&identifier).is_none(), "a second launch must not run");
        receiver.recv_timeout(Duration::from_secs(5)).expect("the first launch is asked to come forward");

        assert!(claim(&format!("{identifier}.qa")).is_some(), "another identifier runs beside it");
    }
}
