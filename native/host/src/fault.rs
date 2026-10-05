//! An engine that failed, and rendering that catches the failure.

use std::any::Any;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use supersynth_core::engine::Engine;

use crate::sync::lock;

/// Set once rendering has failed (a panic inside the engine). The engine's state is then
/// unknown: it is not run again, real-time output stays silent and `render()` fails.
#[derive(Default)]
pub struct Fault {
    faulted: AtomicBool,
    message: Mutex<Option<String>>,
}

impl Fault {
    pub fn is_set(&self) -> bool {
        self.faulted.load(Ordering::Acquire)
    }

    pub fn message(&self) -> Option<String> {
        if !self.is_set() {
            return None;
        }
        let m = lock(&self.message).clone();
        Some(m.unwrap_or_else(|| "the audio engine failed".into()))
    }

    fn record(&self, msg: String) {
        // (allocates: this happens once, after the engine has already failed)
        if let Ok(mut m) = self.message.try_lock() {
            m.get_or_insert(msg);
        }
        self.faulted.store(true, Ordering::Release);
    }

    fn record_panic(&self, payload: Box<dyn Any + Send>) {
        let what = payload
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| payload.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "unknown panic".into());
        self.record(format!("the audio engine failed: {what}"));
        // the payload is dropped here, after the message was taken from it
    }
}

/// Render into `out` (interleaved, `ch` channels) unless the engine has failed. A panic is
/// caught here (unwinding out of a C audio callback aborts the process on some platforms),
/// recorded in `fault`, and the buffer is silenced. Returns whether audio was rendered.
pub fn render_guarded(engine: &Mutex<Engine>, fault: &Fault, out: &mut [f32], ch: usize) -> bool {
    if fault.is_set() {
        out.fill(0.0);
        return false;
    }
    if engine.is_poisoned() {
        fault.record("the audio engine failed earlier (lock poisoned)".into());
        out.fill(0.0);
        return false;
    }
    let mut e = lock(engine);
    // the guard lives outside the closure: a caught panic does not poison the lock
    match catch_unwind(AssertUnwindSafe(|| e.process_interleaved(out, ch))) {
        Ok(()) => true,
        Err(payload) => {
            fault.record_panic(payload);
            out.fill(0.0);
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use supersynth_core::engine::{Command, EngineConfig, Instrument};
    use supersynth_core::model::Model;

    #[test]
    fn a_panic_while_rendering_silences_and_faults_the_engine() {
        let path = format!("{}/../../packages/instruments/models/marimba.ssm", env!("CARGO_MANIFEST_DIR"));
        let Ok(bytes) = std::fs::read(path) else { return };
        let mut m = Model::from_bytes(&bytes).unwrap();
        for z in m.zones.iter_mut() {
            z.amps.clear(); // inconsistent with its frame count: the voice indexes out of bounds
        }
        let (eng, mut ctl) = Engine::new(EngineConfig::default());
        ctl.send(0, Command::set_instrument(0, Instrument::single(Arc::new(m)))).unwrap();
        ctl.send(0, Command::NoteOn { part: 0, note: 60, velocity: 100 }).unwrap();
        let eng = Mutex::new(eng);
        let fault = Fault::default();
        let mut buf = vec![1.0f32; 1024];
        assert!(!render_guarded(&eng, &fault, &mut buf, 2));
        assert!(buf.iter().all(|&v| v == 0.0), "the buffer is silenced");
        assert!(fault.is_set());
        assert!(fault.message().unwrap().contains("failed"));
        assert!(!eng.is_poisoned(), "the panic was caught inside the lock");
        buf.fill(1.0);
        assert!(!render_guarded(&eng, &fault, &mut buf, 2), "a failed engine is not run again");
        assert!(buf.iter().all(|&v| v == 0.0));
    }
}
