//! Locking that works on every host.
//!
//! In a browser the main thread may not block (WebAssembly's `memory.atomic.wait` traps there),
//! and a contended `Mutex::lock` would block. There, [`lock`] spins on `try_lock` instead: the
//! locks shared between threads (the engine, between the API and the audio thread) are only
//! ever held for a call. Natively it is `Mutex::lock`.

use std::sync::{Mutex, MutexGuard};

/// Lock `m`; a poisoned lock is taken over (the data under these locks stays consistent: a
/// panic elsewhere does not leave it half-changed).
#[cfg(not(all(target_arch = "wasm32", target_feature = "atomics")))]
#[inline]
pub fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(all(target_arch = "wasm32", target_feature = "atomics"))]
pub fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    use std::sync::TryLockError;
    loop {
        match m.try_lock() {
            Ok(g) => return g,
            Err(TryLockError::Poisoned(e)) => return e.into_inner(),
            Err(TryLockError::WouldBlock) => std::hint::spin_loop(),
        }
    }
}
