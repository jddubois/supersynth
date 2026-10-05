//! Starting threads, natively and in WebAssembly.
//!
//! Natively a thread is a `std` thread. WebAssembly has no way to start a thread of its own:
//! with shared memory (`atomics`), [`spawn`] queues the thread's function here and the host
//! starts it, a Web Worker instantiating the same module on the same memory and calling
//! [`run_queued`] (see the `supersynth-wasm` crate). Without shared memory, [`spawn`] fails and
//! callers do the work on fewer threads.
//!
//! A [`Handle`] wakes a parked thread and joins it; in WebAssembly it is usable as soon as
//! [`spawn`] returns, before the host has started the thread (a wake-up then has nobody to wake,
//! and the thread finds the work when it starts).

#[cfg(not(target_arch = "wasm32"))]
mod imp {
    use std::thread::{JoinHandle, Thread};

    pub struct Handle {
        join: JoinHandle<()>,
        thread: Thread,
    }

    impl Handle {
        #[inline]
        pub fn unpark(&self) {
            self.thread.unpark();
        }

        pub fn join(self) {
            let _ = self.join.join();
        }
    }

    pub fn spawn(name: String, f: Box<dyn FnOnce() + Send>) -> std::io::Result<Handle> {
        let join = std::thread::Builder::new().name(name).spawn(f)?;
        let thread = join.thread().clone();
        Ok(Handle { join, thread })
    }
}

#[cfg(all(target_arch = "wasm32", target_feature = "atomics"))]
mod imp {
    use std::cell::UnsafeCell;
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, OnceLock};
    use std::thread::Thread;

    type Start = Box<dyn FnOnce() + Send>;

    /// Threads to start. A spin lock, not a `Mutex`: the browser's main thread (which queues
    /// them) must never block, and the critical sections are a push or a pop.
    struct Queue {
        locked: AtomicBool,
        items: UnsafeCell<VecDeque<Start>>,
    }

    // SAFETY: `items` is only touched with `locked` held.
    unsafe impl Sync for Queue {}

    static QUEUE: Queue = Queue { locked: AtomicBool::new(false), items: UnsafeCell::new(VecDeque::new()) };

    fn with_queue<R>(f: impl FnOnce(&mut VecDeque<Start>) -> R) -> R {
        while QUEUE.locked.swap(true, Ordering::Acquire) {
            std::hint::spin_loop();
        }
        // SAFETY: the lock is held
        let r = f(unsafe { &mut *QUEUE.items.get() });
        QUEUE.locked.store(false, Ordering::Release);
        r
    }

    pub struct Handle {
        thread: Arc<OnceLock<Thread>>,
    }

    impl Handle {
        #[inline]
        pub fn unpark(&self) {
            if let Some(t) = self.thread.get() {
                t.unpark();
            }
        }

        /// (A Web Worker cannot be waited for: the thread ends on its own once told to.)
        pub fn join(self) {}
    }

    pub fn spawn(_name: String, f: Start) -> std::io::Result<Handle> {
        let thread = Arc::new(OnceLock::new());
        let slot = Arc::clone(&thread);
        with_queue(|q| {
            q.push_back(Box::new(move || {
                let _ = slot.set(std::thread::current());
                f();
            }))
        });
        Ok(Handle { thread })
    }

    pub fn queued() -> usize {
        with_queue(|q| q.len())
    }

    pub fn run_queued() -> bool {
        match with_queue(|q| q.pop_front()) {
            Some(f) => {
                f();
                true
            }
            None => false,
        }
    }
}

#[cfg(all(target_arch = "wasm32", not(target_feature = "atomics")))]
mod imp {
    pub struct Handle;

    impl Handle {
        #[inline]
        pub fn unpark(&self) {}

        pub fn join(self) {}
    }

    pub fn spawn(_name: String, _f: Box<dyn FnOnce() + Send>) -> std::io::Result<Handle> {
        Err(std::io::Error::new(std::io::ErrorKind::Unsupported, "no threads without shared memory"))
    }

    pub fn queued() -> usize {
        0
    }

    pub fn run_queued() -> bool {
        false
    }
}

pub use imp::Handle;

/// Start a thread running `f` (in WebAssembly: queue it for the host to start).
pub fn spawn(name: String, f: impl FnOnce() + Send + 'static) -> std::io::Result<Handle> {
    imp::spawn(name, Box::new(f))
}

/// WebAssembly: threads queued by [`spawn`] that the host has not started yet.
#[cfg(target_arch = "wasm32")]
pub fn queued() -> usize {
    imp::queued()
}

/// WebAssembly: run the next queued thread on the calling thread (a Web Worker), returning
/// when it ends; `false` if none was queued.
#[cfg(target_arch = "wasm32")]
pub fn run_queued() -> bool {
    imp::run_queued()
}
