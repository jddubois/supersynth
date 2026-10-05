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
use std::thread::{JoinHandle, Thread};
use std::time::{Duration, Instant};

use crate::dsp::denormal::FlushDenormals;

/// Most threads (the rendering thread included) the engine renders with.
pub const MAX_THREADS: usize = 16;

/// How long an idle worker spins before it parks.
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
    /// requested scheduling: 0 normal, 1 real-time (set by the API; the dispatching thread
    /// turns it into `sched` at the start of its next buffer)
    realtime: AtomicU8,
    /// the request the dispatching thread last turned into `sched`
    applied: AtomicU8,
    /// the scheduling the workers take (applied by each worker when it next gets a job):
    /// `SCHED_NORMAL`, or the dispatching thread's own (see `encode_sched`)
    sched: AtomicU32,
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
    workers: Vec<(JoinHandle<()>, Thread)>,
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
            applied: AtomicU8::new(0),
            sched: AtomicU32::new(SCHED_NORMAL),
            hot: AtomicBool::new(false),
        });
        let mut workers = Vec::with_capacity(threads - 1);
        for w in 1..threads {
            let sh = Arc::clone(&shared);
            let spawned = std::thread::Builder::new().name(format!("supersynth-render-{w}")).spawn(move || worker(sh, w));
            match spawned {
                Ok(h) => {
                    let t = h.thread().clone();
                    workers.push((h, t));
                }
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

    /// Ask for real-time scheduling (when the engine plays to an audio device) or normal
    /// scheduling. The workers take the scheduling of the thread that renders the next buffer
    /// (the audio callback), never a higher one: they spin while it renders, and a worker
    /// above it would take the core it needs. Where that thread has no real-time priority,
    /// it is given one (Linux; the workers then share it) if the system allows it. Refused
    /// requests (no permission) leave everything at normal priority.
    pub fn set_realtime(&self, on: bool) {
        self.shared.realtime.store(on as u8, Ordering::Relaxed);
    }

    /// A buffer's rendering starts (`true`) or ends: in between, idle workers wait for the next
    /// job spinning rather than parked, so that the jobs of one buffer (two per block) start
    /// on every core at once. Called by the dispatching thread.
    pub fn set_hot(&self, hot: bool) {
        let sh = &*self.shared;
        if hot {
            let want = sh.realtime.load(Ordering::Relaxed);
            if want != sh.applied.load(Ordering::Relaxed) {
                // once per start or stop of real-time output: a few system calls
                sh.applied.store(want, Ordering::Relaxed);
                let sched = if want != 0 { dispatcher_realtime() } else { SCHED_NORMAL };
                sh.sched.store(sched, Ordering::Relaxed);
            }
        }
        sh.hot.store(hot, Ordering::Relaxed);
    }

    /// The scheduling the workers take (for tests): `None` for normal, else the policy
    /// (`"fifo"`, `"rr"`, `"max"`) and priority.
    pub fn worker_scheduling(&self) -> Option<(&'static str, u8)> {
        match self.shared.sched.load(Ordering::Relaxed) {
            SCHED_NORMAL => None,
            SCHED_MAX => Some(("max", 0)),
            s => Some((if s >> 8 == 2 { "rr" } else { "fifo" }, s as u8)),
        }
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
        for (w, (_, t)) in self.workers.iter().enumerate() {
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
        for (h, t) in self.workers.drain(..) {
            t.unpark();
            let _ = h.join();
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
    let mut sched = SCHED_NORMAL;
    loop {
        // wait for a new generation: spin, then park
        let mut since: Option<Instant> = None;
        loop {
            if sh.shutdown.load(Ordering::Relaxed) {
                return;
            }
            let g = gen_of(sh.state.load(Ordering::Acquire));
            if g != seen {
                seen = g;
                break;
            }
            let t0 = *since.get_or_insert_with(Instant::now);
            if sh.hot.load(Ordering::Relaxed) || t0.elapsed() < SPIN {
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
            since = None;
        }
        let want = sh.sched.load(Ordering::Relaxed);
        if want != sched {
            sched = want;
            set_scheduling(want);
        }
        claim_items(&sh, seen, w);
    }
}

/// Workers at normal priority.
const SCHED_NORMAL: u32 = 0;
/// Workers at the platform's highest priority (Windows).
const SCHED_MAX: u32 = 0xFFFF;
/// Real-time priority given to a dispatching thread that has none (Linux, `SCHED_FIFO`).
#[cfg(target_os = "linux")]
const DISPATCH_PRIORITY: u8 = 80;

/// A real-time scheduling for the workers: policy 1 (FIFO) or 2 (round robin), priority.
const fn encode_sched(policy: u32, priority: u8) -> u32 {
    policy << 8 | priority as u32
}

/// Called on the dispatching thread when real-time output starts: the scheduling the workers
/// should take, which is that thread's own when it is real-time (JACK, PipeWire). Elsewhere
/// on Linux (ALSA), the dispatching thread is given `SCHED_FIFO` first, if allowed.
fn dispatcher_realtime() -> u32 {
    #[cfg(unix)]
    {
        use thread_priority::unix::*;
        let id = thread_native_id();
        let own = |(policy, params): (ThreadSchedulePolicy, ScheduleParams)| match policy {
            ThreadSchedulePolicy::Realtime(RealtimeThreadSchedulePolicy::Fifo) => Some(encode_sched(1, params.sched_priority.clamp(1, 99) as u8)),
            ThreadSchedulePolicy::Realtime(RealtimeThreadSchedulePolicy::RoundRobin) => Some(encode_sched(2, params.sched_priority.clamp(1, 99) as u8)),
            _ => None,
        };
        if let Some(s) = thread_schedule_policy_param(id).ok().and_then(own) {
            return s;
        }
        // macOS: the audio thread has a time-constraint policy of its own, which changing its
        // POSIX scheduling would take away; the workers stay at normal priority
        #[cfg(target_os = "linux")]
        {
            use thread_priority::{ThreadPriority, ThreadPriorityValue};
            let prio = ThreadPriorityValue::try_from(DISPATCH_PRIORITY).map(ThreadPriority::Crossplatform).unwrap_or(ThreadPriority::Max);
            let fifo = ThreadSchedulePolicy::Realtime(RealtimeThreadSchedulePolicy::Fifo);
            if set_thread_priority_and_policy(id, prio, fifo).is_ok() {
                return thread_schedule_policy_param(id).ok().and_then(own).unwrap_or(SCHED_NORMAL);
            }
        }
        SCHED_NORMAL
    }
    #[cfg(not(unix))]
    {
        SCHED_MAX
    }
}

/// Apply a scheduling from `dispatcher_realtime` (or `SCHED_NORMAL`) to the calling worker,
/// if the system allows it.
fn set_scheduling(sched: u32) {
    #[cfg(unix)]
    {
        use thread_priority::unix::*;
        use thread_priority::ThreadPriority;
        let id = thread_native_id();
        let _ = match sched {
            SCHED_NORMAL | SCHED_MAX => set_thread_priority_and_policy(id, ThreadPriority::Min, ThreadSchedulePolicy::Normal(NormalThreadSchedulePolicy::Other)),
            s => {
                let policy = if s >> 8 == 2 { RealtimeThreadSchedulePolicy::RoundRobin } else { RealtimeThreadSchedulePolicy::Fifo };
                let prio = ThreadPriority::from_posix(ScheduleParams { sched_priority: (s & 0xFF) as _ });
                set_thread_priority_and_policy(id, prio, ThreadSchedulePolicy::Realtime(policy))
            }
        };
    }
    #[cfg(not(unix))]
    {
        use thread_priority::{set_current_thread_priority, ThreadPriority};
        let _ = set_current_thread_priority(if sched == SCHED_NORMAL { ThreadPriority::Crossplatform(50u8.try_into().unwrap()) } else { ThreadPriority::Max });
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

    #[test]
    #[cfg(unix)]
    fn workers_take_the_dispatching_threads_scheduling() {
        // on a thread of its own: it may be given real-time priority
        std::thread::spawn(|| {
            use thread_priority::unix::*;
            let pool = Pool::new(2);
            pool.set_hot(true);
            assert_eq!(pool.worker_scheduling(), None, "normal until real-time output starts");
            pool.set_realtime(true);
            pool.set_hot(true);
            let (policy, params) = thread_schedule_policy_param(thread_native_id()).unwrap();
            let expected = match policy {
                ThreadSchedulePolicy::Realtime(RealtimeThreadSchedulePolicy::Fifo) => Some(("fifo", params.sched_priority as u8)),
                ThreadSchedulePolicy::Realtime(RealtimeThreadSchedulePolicy::RoundRobin) => Some(("rr", params.sched_priority as u8)),
                // no permission: the dispatching thread stayed normal, so do the workers
                _ => None,
            };
            assert_eq!(pool.worker_scheduling(), expected, "never above the dispatching thread");
            pool.run(8, &|_, _| {});
            pool.set_realtime(false);
            pool.set_hot(true);
            assert_eq!(pool.worker_scheduling(), None);
            pool.set_hot(false);
        })
        .join()
        .unwrap();
    }
}
