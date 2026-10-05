//! Rendering on several cores: a pool of worker threads, spawned with the engine.
//!
//! The rendering thread (the audio callback, or the caller of an offline render) hands out a
//! job of `n` independent items (voices, or parts) and works on it itself. Workers claim
//! items one at a time from a shared atomic counter, so whoever is free takes the next one
//! and a big chord's voice starts spread over all cores. Every item writes only its own
//! output, and results are combined afterwards in a fixed order: the output does not depend
//! on the number of threads or on which thread rendered what.
//!
//! Nothing here allocates, locks or creates threads once the pool exists. Idle workers spin
//! briefly (blocks of one buffer follow each other within microseconds) and then park; the
//! dispatcher wakes parked workers with `unpark` (a futex wake, which never blocks). The
//! dispatcher never waits for a worker to wake up: if none is awake it does the whole job
//! itself; it only waits for items that have been claimed to finish.

use std::cell::UnsafeCell;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;
use std::time::Duration;

use crate::dsp::denormal::FlushDenormals;
use crate::thread::Handle;

/// Most threads (the rendering thread included) the engine renders with.
pub const MAX_THREADS: usize = 16;

/// How long an idle worker spins before it parks.
#[cfg_attr(target_arch = "wasm32", allow(dead_code))]
const SPIN: Duration = Duration::from_micros(60);

/// A job: called with (item, thread index); thread 0 is the dispatching thread.
type JobFn = dyn Fn(usize, usize) + Sync;

struct Shared {
    /// generation (high 32 bits) | next unclaimed item (16 bits) | item count (16 bits)
    state: AtomicU64,
    /// items of the current generation finished
    done: AtomicU32,
    /// The current job. Written by the dispatcher before it publishes a new generation
    /// (Release); read by a worker only after it claimed an item of that generation
    /// (Acquire), and the dispatcher does not return (nor replace it) before every claimed
    /// item is done.
    job: UnsafeCell<Option<*const JobFn>>,
    sleeping: [AtomicBool; MAX_THREADS],
    shutdown: AtomicBool,
    panicked: AtomicBool,
    /// requested scheduling: 0 normal, 1 real-time (applied by each worker when it wakes)
    realtime: AtomicU8,
    /// the dispatching thread is rendering a buffer: more jobs follow within microseconds, so
    /// idle workers keep spinning instead of parking
    hot: AtomicBool,
}

// SAFETY: `job` is only accessed under the generation protocol described above.
unsafe impl Sync for Shared {}
unsafe impl Send for Shared {}

const fn pack(gen: u32, next: u32, total: u32) -> u64 {
    (gen as u64) << 32 | (next as u64) << 16 | total as u64
}
const fn gen_of(s: u64) -> u32 {
    (s >> 32) as u32
}
const fn next_of(s: u64) -> u32 {
    ((s >> 16) & 0xFFFF) as u32
}
const fn total_of(s: u64) -> u32 {
    (s & 0xFFFF) as u32
}

/// Most items in one job.
pub const MAX_ITEMS: usize = 0xFFFF;

pub struct Pool {
    shared: Arc<Shared>,
    workers: Vec<Handle>,
}

impl Pool {
    /// A pool rendering with `threads` threads in all: the dispatching thread and
    /// `threads − 1` workers (none for 1).
    pub fn new(threads: usize) -> Pool {
        let threads = threads.clamp(1, MAX_THREADS);
        let shared = Arc::new(Shared {
            state: AtomicU64::new(0),
            done: AtomicU32::new(0),
            job: UnsafeCell::new(None),
            sleeping: std::array::from_fn(|_| AtomicBool::new(false)),
            shutdown: AtomicBool::new(false),
            panicked: AtomicBool::new(false),
            realtime: AtomicU8::new(0),
            hot: AtomicBool::new(false),
        });
        let mut workers = Vec::with_capacity(threads - 1);
        for w in 1..threads {
            let sh = Arc::clone(&shared);
            match crate::thread::spawn(format!("supersynth-render-{w}"), move || worker(sh, w)) {
                Ok(h) => workers.push(h),
                // fewer cores at work, never a failure
                Err(_) => break,
            }
        }
        Pool { shared, workers }
    }

    /// Threads rendering, the dispatching one included.
    pub fn threads(&self) -> usize {
        self.workers.len() + 1
    }

    /// Ask the workers for real-time scheduling (when the engine plays to an audio device) or
    /// normal scheduling. Applied by each worker the next time it wakes; refused requests
    /// (no permission) are ignored.
    pub fn set_realtime(&self, on: bool) {
        self.shared.realtime.store(on as u8, Ordering::Relaxed);
    }

    /// A buffer's rendering starts (`true`) or ends: in between, idle workers wait for the next
    /// job spinning rather than parked, so that the jobs of one buffer (two per block) start
    /// on every core at once.
    pub fn set_hot(&self, hot: bool) {
        self.shared.hot.store(hot, Ordering::Relaxed);
    }

    /// Run `f(item, thread)` for every item in 0..n, on this thread and the workers, and
    /// return when all are done. A panic in a worker is re-raised here.
    pub fn run(&self, n: usize, f: &(dyn Fn(usize, usize) + Sync)) {
        if n == 0 {
            return;
        }
        if self.workers.is_empty() || n == 1 {
            for i in 0..n {
                f(i, 0);
            }
            return;
        }
        assert!(n <= MAX_ITEMS, "too many items in one job");
        let sh = &*self.shared;
        // SAFETY: no item of the previous generation is unfinished (the previous `run`
        // returned only when all were done), so no worker reads `job` now; the lifetime is
        // erased because this function does not return before every claimed item is done.
        unsafe {
            let p: *const JobFn = std::mem::transmute::<&(dyn Fn(usize, usize) + Sync), &'static JobFn>(f);
            *sh.job.get() = Some(p);
        }
        sh.done.store(0, Ordering::Relaxed);
        let gen = gen_of(sh.state.load(Ordering::Relaxed)).wrapping_add(1);
        sh.state.store(pack(gen, 0, n as u32), Ordering::SeqCst);
        for (w, t) in self.workers.iter().enumerate() {
            if sh.sleeping[w + 1].swap(false, Ordering::SeqCst) {
                t.unpark();
            }
        }
        claim_items(sh, gen, 0);
        let mut spins = 0u32;
        while sh.done.load(Ordering::Acquire) < n as u32 {
            spins = spins.wrapping_add(1);
            if spins < 4096 {
                std::hint::spin_loop();
            } else {
                // a worker was preempted in the middle of an item
                std::thread::yield_now();
            }
        }
        if sh.panicked.swap(false, Ordering::Relaxed) {
            panic!("a rendering thread failed");
        }
    }
}

impl Drop for Pool {
    fn drop(&mut self) {
        self.shared.shutdown.store(true, Ordering::SeqCst);
        for h in self.workers.drain(..) {
            h.unpark();
            h.join();
        }
    }
}

/// Claim and run items of generation `gen` until none is left.
fn claim_items(sh: &Shared, gen: u32, thread: usize) {
    let mut s = sh.state.load(Ordering::Acquire);
    loop {
        if gen_of(s) != gen || next_of(s) >= total_of(s) {
            return;
        }
        match sh.state.compare_exchange_weak(s, s + (1 << 16), Ordering::AcqRel, Ordering::Acquire) {
            Ok(_) => {
                let item = next_of(s) as usize;
                // SAFETY: an item of generation `gen` is claimed and not done, so the
                // dispatcher keeps the job alive and unchanged
                let f = unsafe { &*(*sh.job.get()).expect("job set") };
                if catch_unwind(AssertUnwindSafe(|| f(item, thread))).is_err() {
                    sh.panicked.store(true, Ordering::Relaxed);
                }
                sh.done.fetch_add(1, Ordering::Release);
                s = sh.state.load(Ordering::Acquire);
            }
            Err(cur) => s = cur,
        }
    }
}

thread_local! {
    static WORKER: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Whether the calling thread is a rendering worker of some engine (for tests and
/// diagnostics).
pub fn is_worker() -> bool {
    WORKER.try_with(|w| w.get()).unwrap_or(false)
}

fn worker(sh: Arc<Shared>, w: usize) {
    WORKER.with(|f| f.set(true));
    // the same floating-point mode as the dispatching thread renders with
    let _ftz = FlushDenormals::new();
    let mut seen = gen_of(sh.state.load(Ordering::Acquire));
    let mut realtime = 0u8;
    loop {
        // wait for a new generation: spin, then park
        let mut spin = Spin::default();
        loop {
            if sh.shutdown.load(Ordering::Relaxed) {
                return;
            }
            let g = gen_of(sh.state.load(Ordering::Acquire));
            if g != seen {
                seen = g;
                break;
            }
            if sh.hot.load(Ordering::Relaxed) || spin.spinning() {
                for _ in 0..64 {
                    std::hint::spin_loop();
                }
                continue;
            }
            sh.sleeping[w].store(true, Ordering::SeqCst);
            if gen_of(sh.state.load(Ordering::SeqCst)) == seen && !sh.shutdown.load(Ordering::SeqCst) {
                std::thread::park();
            }
            sh.sleeping[w].store(false, Ordering::Relaxed);
            spin = Spin::default();
            let want = sh.realtime.load(Ordering::Relaxed);
            if want != realtime {
                realtime = want;
                set_scheduling(want != 0);
            }
        }
        claim_items(&sh, seen, w);
    }
}

/// How long an idle worker has been spinning: by the clock natively; WebAssembly has no clock,
/// so there by spin rounds (64 hints each, roughly [`SPIN`] in all).
#[derive(Default)]
struct Spin {
    #[cfg(not(target_arch = "wasm32"))]
    since: Option<std::time::Instant>,
    #[cfg(target_arch = "wasm32")]
    rounds: u32,
}

impl Spin {
    #[cfg(not(target_arch = "wasm32"))]
    fn spinning(&mut self) -> bool {
        self.since.get_or_insert_with(std::time::Instant::now).elapsed() < SPIN
    }

    #[cfg(target_arch = "wasm32")]
    fn spinning(&mut self) -> bool {
        self.rounds += 1;
        self.rounds < 400
    }
}

/// Real-time (or normal) scheduling for the calling thread, if the system allows it (not in
/// WebAssembly: a browser schedules its workers itself).
#[cfg_attr(target_arch = "wasm32", allow(unused_variables))]
fn set_scheduling(realtime: bool) {
    #[cfg(all(unix, not(target_arch = "wasm32")))]
    {
        use thread_priority::unix::*;
        use thread_priority::{ThreadPriority, ThreadPriorityValue};
        let id = thread_native_id();
        let _ = if realtime {
            let prio = ThreadPriorityValue::try_from(80u8).map(ThreadPriority::Crossplatform).unwrap_or(ThreadPriority::Max);
            set_thread_priority_and_policy(id, prio, ThreadSchedulePolicy::Realtime(RealtimeThreadSchedulePolicy::Fifo))
        } else {
            set_thread_priority_and_policy(id, ThreadPriority::Min, ThreadSchedulePolicy::Normal(NormalThreadSchedulePolicy::Other))
        };
    }
    #[cfg(not(any(unix, target_arch = "wasm32")))]
    {
        use thread_priority::{set_current_thread_priority, ThreadPriority};
        let _ = set_current_thread_priority(if realtime { ThreadPriority::Max } else { ThreadPriority::Crossplatform(50u8.try_into().unwrap()) });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    #[test]
    fn every_item_runs_exactly_once() {
        for threads in [1, 2, 4, 7] {
            let pool = Pool::new(threads);
            for round in 0..200 {
                let n = 1 + (round * 37) % 300;
                let hits: Vec<AtomicUsize> = (0..n).map(|_| AtomicUsize::new(0)).collect();
                pool.run(n, &|i, t| {
                    assert!(t < threads);
                    hits[i].fetch_add(1, Ordering::Relaxed);
                });
                assert!(hits.iter().all(|h| h.load(Ordering::Relaxed) == 1), "{threads} threads, round {round}");
                if round % 50 == 0 {
                    // let the workers park
                    std::thread::sleep(Duration::from_millis(2));
                }
            }
        }
    }

    #[test]
    fn a_panic_in_a_worker_reaches_the_dispatcher() {
        let pool = Pool::new(3);
        let r = catch_unwind(AssertUnwindSafe(|| {
            pool.run(64, &|i, _| {
                if i == 40 {
                    panic!("item failed");
                }
            })
        }));
        assert!(r.is_err());
        // and the pool keeps working
        let count = AtomicUsize::new(0);
        pool.run(10, &|_, _| {
            count.fetch_add(1, Ordering::Relaxed);
        });
        assert_eq!(count.load(Ordering::Relaxed), 10);
    }
}
