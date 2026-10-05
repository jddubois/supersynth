//! The engine's models, and loading them off the JavaScript thread.
//!
//! A model queued with [`ModelStore::queue_file`] (or [`ModelStore::queue_bytes`]) is read,
//! inflated and parsed by a small pool of
//! worker threads (shared by every engine of the process, at a lower OS priority than the audio
//! and JavaScript threads). Its id is usable at once: whatever needs the model
//! ([`ModelStore::get`]) waits for it then, for just that model and only for what is left of
//! its loading, and loads it itself on the calling thread when no worker has started it yet.
//! [`ModelStore::when_loaded`] calls back (to settle a JavaScript promise) once a set of models
//! has loaded.
//!
//! Models are freed on a reclaim thread, never where the engine lets go of them: a model that
//! is unloaded goes to the reclaimer, which holds it until every other reference (the engine's
//! instruments and voices, the garbage that `render()` collects, an engine waiting for garbage
//! collection) is gone, and only then frees it. Freeing a large organ's models takes a
//! noticeable time, which must not land in a render call or between key events.
//!
//! Where threads cannot be started (WebAssembly in a browser, whose main thread must also never
//! block), nothing loads in the background: a model loads when it is first used, or when the
//! host calls [`ModelStore::load_next`] (between other work), and unloaded models are freed
//! on the calling thread once nothing else holds them ([`sweep`]).

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};

use supersynth_core::model::Model;

use crate::sync::lock;

type Loaded = std::result::Result<Arc<Model>, String>;

/// Called once a set of models has loaded: with the first loading error, if any.
pub type Settle = Box<dyn FnOnce(Option<String>) + Send>;

/// Where a model's bytes come from.
pub enum Source {
    File(PathBuf),
    /// Bytes the host fetched; `name` names the model in errors.
    Bytes { name: String, bytes: Vec<u8> },
}

/// Read (if need be) and parse one model. Untrusted input: a parser panic becomes an error.
pub fn load(source: Source) -> Loaded {
    let (bytes, name) = match source {
        Source::File(path) => (std::fs::read(&path).map_err(|e| format!("cannot read model {}: {e}", path.display()))?, path.display().to_string()),
        Source::Bytes { name, bytes } => (bytes, name),
    };
    match std::panic::catch_unwind(|| Model::from_bytes(&bytes)) {
        Ok(Ok(m)) => Ok(Arc::new(m)),
        Ok(Err(e)) => Err(format!("{e} (model {name})")),
        Err(_) => Err(format!("invalid supersynth model (the parser failed): {name}")),
    }
}

// ── jobs ──────────────────────────────────────────────────────────────────────

enum State {
    Queued(Source),
    Running,
    Done(Loaded),
    /// Unloaded before it was started: never loaded.
    Cancelled,
}

struct JobInner {
    state: State,
    waiters: Vec<Arc<Waiter>>,
}

/// One model to load.
pub struct Job {
    inner: Mutex<JobInner>,
    done: Condvar,
}

impl Job {
    fn new(source: Source) -> Self {
        Self { inner: Mutex::new(JobInner { state: State::Queued(source), waiters: Vec::new() }), done: Condvar::new() }
    }

    /// Take the job if nobody has started it (the caller then runs it with the source).
    fn claim(&self) -> Option<Source> {
        let mut g = lock(&self.inner);
        if !matches!(g.state, State::Queued(_)) {
            return None;
        }
        match std::mem::replace(&mut g.state, State::Running) {
            State::Queued(source) => Some(source),
            _ => unreachable!(),
        }
    }

    fn run(&self, source: Source) {
        let r = load(source);
        let error = r.as_ref().err().cloned();
        let waiters = {
            let mut g = lock(&self.inner);
            g.state = State::Done(r);
            std::mem::take(&mut g.waiters)
        };
        self.done.notify_all();
        for w in waiters {
            w.settle(error.as_deref());
        }
    }

    /// Never load it, unless it is already loading or loaded.
    fn cancel(&self) {
        let waiters = {
            let mut g = lock(&self.inner);
            if !matches!(g.state, State::Queued(_)) {
                return;
            }
            g.state = State::Cancelled;
            std::mem::take(&mut g.waiters)
        };
        self.done.notify_all();
        for w in waiters {
            w.settle(None);
        }
    }

    /// The model, once loaded (loading it on this thread if no worker has started it);
    /// `None` when it was cancelled.
    fn wait(&self) -> Option<Loaded> {
        if let Some(source) = self.claim() {
            self.run(source);
        }
        let mut g = lock(&self.inner);
        loop {
            match &g.state {
                State::Done(r) => return Some(r.clone()),
                State::Cancelled => return None,
                State::Queued(_) | State::Running => g = self.done.wait(g).unwrap_or_else(|e| e.into_inner()),
            }
        }
    }

    /// Settle `w` (once) when the job is done; at once if it already is.
    fn notify(&self, w: &Arc<Waiter>) {
        let mut g = lock(&self.inner);
        let error = match &g.state {
            State::Queued(_) | State::Running => {
                g.waiters.push(Arc::clone(w));
                return;
            }
            State::Done(Err(e)) => Some(e.clone()),
            State::Done(Ok(_)) | State::Cancelled => None,
        };
        drop(g);
        w.settle(error.as_deref());
    }

    fn model(&self) -> Option<Arc<Model>> {
        match &lock(&self.inner).state {
            State::Done(Ok(m)) => Some(Arc::clone(m)),
            _ => None,
        }
    }

    fn loading(&self) -> bool {
        matches!(lock(&self.inner).state, State::Queued(_) | State::Running)
    }

    /// Unloaded: never load it, and give up the model if it is loaded (to the reclaimer). A job
    /// still loading is left to finish; its worker then frees it.
    fn unload(&self) {
        self.cancel();
        let mut g = lock(&self.inner);
        if matches!(g.state, State::Done(Ok(_))) {
            if let State::Done(Ok(m)) = std::mem::replace(&mut g.state, State::Cancelled) {
                drop(g);
                reclaim(m);
            }
        }
    }
}

// ── reclaimer ─────────────────────────────────────────────────────────────────

struct Reclaimer {
    held: Mutex<Vec<Arc<Model>>>,
    more: Condvar,
    /// The reclaim thread runs (else [`sweep`] frees on the caller's thread).
    threaded: AtomicBool,
}

fn reclaimer() -> &'static Reclaimer {
    static R: OnceLock<Reclaimer> = OnceLock::new();
    static STARTED: OnceLock<()> = OnceLock::new();
    let r = R.get_or_init(|| Reclaimer { held: Mutex::new(Vec::new()), more: Condvar::new(), threaded: AtomicBool::new(false) });
    STARTED.get_or_init(|| {
        // (without the thread, unloaded models are freed by `sweep`, on the thread calling it)
        let spawned = std::thread::Builder::new().name("supersynth-reclaim".into()).spawn(move || {
            lower_priority();
            let mut free = Vec::new();
            loop {
                {
                    let mut held = lock(&r.held);
                    while held.is_empty() {
                        held = r.more.wait(held).unwrap_or_else(|e| e.into_inner());
                    }
                    // only the reclaimer holds these: nobody can take another reference
                    let mut i = 0;
                    while i < held.len() {
                        if Arc::strong_count(&held[i]) == 1 {
                            free.push(held.swap_remove(i));
                        } else {
                            i += 1;
                        }
                    }
                    if free.is_empty() {
                        // still used (an engine's instruments, voices or garbage): look again soon
                        held = r.more.wait_timeout(held, std::time::Duration::from_millis(100)).map_or_else(|e| e.into_inner().0, |w| w.0);
                        drop(held);
                    }
                }
                free.clear();
            }
        });
        r.threaded.store(spawned.is_ok(), Ordering::Release);
    });
    r
}

/// Free `m` on the reclaim thread once nothing else uses it (without one: when [`sweep`] finds
/// nothing else uses it).
fn reclaim(m: Arc<Model>) {
    let r = reclaimer();
    lock(&r.held).push(m);
    if r.threaded.load(Ordering::Acquire) {
        r.more.notify_one();
    } else {
        sweep();
    }
}

/// Where there is no reclaim thread: free, on this thread, the unloaded models nothing else
/// holds any more. Hosts without threads call it now and then (natively it does nothing).
pub fn sweep() {
    let r = reclaimer();
    if r.threaded.load(Ordering::Acquire) {
        return;
    }
    let free: Vec<Arc<Model>> = {
        let mut held = lock(&r.held);
        let mut free = Vec::new();
        let mut i = 0;
        while i < held.len() {
            if Arc::strong_count(&held[i]) == 1 {
                free.push(held.swap_remove(i));
            } else {
                i += 1;
            }
        }
        free
    };
    drop(free);
}

/// Waits for several models: settled when all are loaded (or unloaded), with the first error.
struct Waiter {
    inner: Mutex<(usize, Option<String>, Option<Settle>)>,
}

impl Waiter {
    fn settle(&self, error: Option<&str>) {
        let (settle, error) = {
            let mut g = lock(&self.inner);
            if let (Some(e), None) = (error, &g.1) {
                g.1 = Some(e.to_string());
            }
            g.0 = g.0.saturating_sub(1);
            if g.0 > 0 {
                return;
            }
            (g.2.take(), g.1.take())
        };
        if let Some(f) = settle {
            f(error);
        }
    }
}

// ── worker pool ───────────────────────────────────────────────────────────────

struct Pool {
    queue: Mutex<VecDeque<Arc<Job>>>,
    work: Condvar,
}

/// Worker threads: `$SUPERSYNTH_LOAD_THREADS`, else the cores less two (one for audio, one for
/// JavaScript), 1–6.
fn worker_count() -> usize {
    if let Some(n) = std::env::var("SUPERSYNTH_LOAD_THREADS").ok().and_then(|v| v.trim().parse::<usize>().ok()) {
        return n.clamp(1, 64);
    }
    std::thread::available_parallelism().map_or(1, |n| n.get().saturating_sub(2)).clamp(1, 6)
}

fn pool() -> &'static Pool {
    static POOL: OnceLock<Pool> = OnceLock::new();
    static STARTED: OnceLock<()> = OnceLock::new();
    let p = POOL.get_or_init(|| Pool { queue: Mutex::new(VecDeque::new()), work: Condvar::new() });
    STARTED.get_or_init(|| {
        for i in 0..worker_count() {
            // (a thread that cannot be started leaves its jobs to the others, or to `wait`)
            let _ = std::thread::Builder::new().name(format!("supersynth-load-{i}")).spawn(move || worker(p));
        }
    });
    p
}

fn worker(p: &'static Pool) {
    lower_priority();
    loop {
        let job = {
            let mut q = lock(&p.queue);
            loop {
                match q.pop_front() {
                    Some(j) => break j,
                    None => q = p.work.wait(q).unwrap_or_else(|e| e.into_inner()),
                }
            }
        };
        if let Some(source) = job.claim() {
            job.run(source);
        }
    }
}

/// Loading yields to the audio and JavaScript threads when the cores are busy (Linux: a
/// thread's nice value is its own).
fn lower_priority() {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    // SAFETY: plain system call on the calling thread
    unsafe {
        libc::setpriority(libc::PRIO_PROCESS, 0, 10);
    }
}

// ── the store ─────────────────────────────────────────────────────────────────

enum Slot {
    Ready(Arc<Model>),
    Pending(Arc<Job>),
}

/// The models an engine holds, by id.
pub struct ModelStore {
    slots: HashMap<u32, Slot>,
    next: u32,
}

impl Default for ModelStore {
    fn default() -> Self {
        Self { slots: HashMap::new(), next: 1 }
    }
}

impl ModelStore {
    fn id(&mut self) -> u32 {
        let id = self.next;
        self.next = self.next.wrapping_add(1).max(1);
        id
    }

    /// Hold a parsed model; returns its id.
    pub fn insert(&mut self, m: Model) -> u32 {
        let id = self.id();
        self.slots.insert(id, Slot::Ready(Arc::new(m)));
        id
    }

    /// Load a model file in the background; returns its id, usable at once.
    pub fn queue_file(&mut self, path: PathBuf) -> u32 {
        self.queue(Source::File(path))
    }

    /// Load a model from its file's bytes in the background; returns its id, usable at once.
    pub fn queue_bytes(&mut self, name: String, bytes: Vec<u8>) -> u32 {
        self.queue(Source::Bytes { name, bytes })
    }

    fn queue(&mut self, source: Source) -> u32 {
        let id = self.id();
        let job = Arc::new(Job::new(source));
        self.slots.insert(id, Slot::Pending(Arc::clone(&job)));
        let p = pool();
        lock(&p.queue).push_back(job);
        p.work.notify_one();
        id
    }

    /// The model `id`, waiting for it if it is still loading; its loading error if it failed.
    pub fn get(&self, id: u32) -> std::result::Result<Arc<Model>, String> {
        match self.slots.get(&id) {
            Some(Slot::Ready(m)) => Ok(Arc::clone(m)),
            Some(Slot::Pending(j)) => j.wait().unwrap_or_else(|| Err(format!("unknown model {id}"))),
            None => Err(format!("unknown model {id}")),
        }
    }

    /// Release a model (a background load not started yet is dropped).
    pub fn remove(&mut self, id: u32) {
        match self.slots.remove(&id) {
            Some(Slot::Ready(m)) => reclaim(m),
            Some(Slot::Pending(j)) => j.unload(),
            None => {}
        }
    }

    /// Load model `id` next, before the other queued models (when no thread has started it).
    pub fn hurry(&self, id: u32) {
        if let Some(Slot::Pending(j)) = self.slots.get(&id) {
            if matches!(lock(&j.inner).state, State::Queued(_)) {
                // (its other queue entry is skipped once it has been claimed)
                let p = pool();
                lock(&p.queue).push_front(Arc::clone(j));
                p.work.notify_one();
            }
        }
    }

    /// Whether model `id` is still loading in the background.
    pub fn loading(&self, id: u32) -> bool {
        matches!(self.slots.get(&id), Some(Slot::Pending(j)) if j.loading())
    }

    /// Call `settle` once all of `ids` are loaded (or unloaded), with the first loading error.
    /// It runs on the thread that finishes the last of them.
    pub fn when_loaded(&self, ids: &[u32], settle: Settle) {
        // one more than the models, settled last, so that it cannot settle before all are counted
        let w = Arc::new(Waiter { inner: Mutex::new((ids.len() + 1, None, Some(settle))) });
        for id in ids {
            match self.slots.get(id) {
                Some(Slot::Pending(j)) => j.notify(&w),
                _ => w.settle(None),
            }
        }
        w.settle(None);
    }

    /// Load the next queued model (of any store) on this thread, if one is waiting: for hosts
    /// without loading threads, between other work. Returns whether there was one.
    pub fn load_next(&self) -> bool {
        let p = pool();
        loop {
            let Some(job) = lock(&p.queue).pop_front() else { return false };
            // (a job queued twice, hurried, or already used is skipped)
            if let Some(source) = job.claim() {
                job.run(source);
                return true;
            }
        }
    }

    /// Decoded size of a model in bytes, `None` while it is still loading (or failed).
    pub fn bytes(&self, id: u32) -> Option<usize> {
        match self.slots.get(&id)? {
            Slot::Ready(m) => Some(m.heap_bytes()),
            Slot::Pending(j) => j.model().map(|m| m.heap_bytes()),
        }
    }
}

impl Drop for ModelStore {
    fn drop(&mut self) {
        // an engine that is gone does not need its queued models; the others are freed on the
        // reclaim thread (the engine's own references go with it, possibly right after this)
        for (_, slot) in self.slots.drain() {
            match slot {
                Slot::Ready(m) => reclaim(m),
                Slot::Pending(j) => j.unload(),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str, bytes: &[u8]) -> PathBuf {
        let p = std::env::temp_dir().join(format!("supersynth-loader-{}-{name}", std::process::id()));
        std::fs::write(&p, bytes).unwrap();
        p
    }

    fn model_file() -> PathBuf {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../models/piccolo.ssm");
        assert!(root.exists());
        root
    }

    #[test]
    fn queued_models_load_in_the_background_or_on_demand() {
        let mut s = ModelStore::default();
        let ids: Vec<u32> = (0..12).map(|_| s.queue_file(model_file())).collect();
        for &id in ids.iter().rev() {
            let m = s.get(id).unwrap();
            assert!(!m.zones.is_empty());
            assert!(s.bytes(id).unwrap() > 0);
        }
        // the same model again comes from the store
        assert!(Arc::ptr_eq(&s.get(ids[0]).unwrap(), &s.get(ids[0]).unwrap()));
    }

    #[test]
    fn models_from_bytes_and_loading_them_on_this_thread() {
        let bytes = std::fs::read(model_file()).unwrap();
        let mut s = ModelStore::default();
        let good = s.queue_bytes("piccolo".into(), bytes);
        let bad = s.queue_bytes("broken".into(), b"\x1f\x8b\x08\x00garbage".to_vec());
        // whatever the loading threads have not taken loads here
        while s.load_next() {}
        assert!(!s.get(good).unwrap().zones.is_empty());
        assert!(s.get(bad).unwrap_err().contains("broken"));
        assert!(!s.loading(good) && !s.loading(bad));
    }

    #[test]
    fn loading_errors_are_reported_every_time() {
        let mut s = ModelStore::default();
        let bad = temp("bad.ssm", b"\x1f\x8b\x08\x00garbage");
        let a = s.queue_file(bad.clone());
        let b = s.queue_file(PathBuf::from("/no/such/model.ssm"));
        for _ in 0..2 {
            assert!(s.get(a).unwrap_err().contains("bad.ssm"));
            assert!(s.get(b).unwrap_err().contains("cannot read"));
        }
        assert_eq!(s.bytes(a), None);
        std::fs::remove_file(bad).ok();
    }

    #[test]
    fn waiting_for_a_set_of_models() {
        use std::sync::mpsc::channel;
        let mut s = ModelStore::default();
        let bad = temp("bad2.ssm", b"SSM1 not a model");
        let good: Vec<u32> = (0..6).map(|_| s.queue_file(model_file())).collect();
        let (tx, rx) = channel();
        let t = tx.clone();
        s.when_loaded(&good, Box::new(move |e| t.send(e).unwrap()));
        assert_eq!(rx.recv_timeout(std::time::Duration::from_secs(30)).unwrap(), None);
        for &id in &good {
            assert!(s.bytes(id).is_some());
        }
        // with a failing one: its error; nothing to wait for: at once
        let mut ids = good.clone();
        ids.push(s.queue_file(bad.clone()));
        let t = tx.clone();
        s.when_loaded(&ids, Box::new(move |e| t.send(e).unwrap()));
        assert!(rx.recv_timeout(std::time::Duration::from_secs(30)).unwrap().unwrap().contains("bad2.ssm"));
        let t = tx.clone();
        s.when_loaded(&[], Box::new(move |e| t.send(e).unwrap()));
        assert_eq!(rx.try_recv().unwrap(), None);
        // unloaded before loading: settled without error
        let pending: Vec<u32> = (0..30).map(|_| s.queue_file(model_file())).collect();
        s.when_loaded(&pending, Box::new(move |e| tx.send(e).unwrap()));
        for id in pending {
            s.remove(id);
        }
        assert_eq!(rx.recv_timeout(std::time::Duration::from_secs(30)).unwrap(), None);
        std::fs::remove_file(bad).ok();
    }

    /// Whoever lets go of a model after it was unloaded (the engine, in `render()` or the audio
    /// callback) never frees it: the reclaim thread does, once nothing else holds it.
    #[test]
    fn unloaded_models_are_freed_on_the_reclaim_thread() {
        let mut s = ModelStore::default();
        let bytes = std::fs::read(model_file()).unwrap();
        let ready = s.insert(Model::from_bytes(&bytes).unwrap());
        let queued = s.queue_file(model_file());
        let mut engine = Vec::new();
        for id in [ready, queued] {
            engine.push(s.get(id).unwrap()); // the engine's reference
        }
        let weak: Vec<_> = engine.iter().map(Arc::downgrade).collect();
        s.remove(ready);
        s.remove(queued);
        for m in &engine {
            assert!(Arc::strong_count(m) >= 2, "the engine's reference is not the last");
        }
        drop(engine); // only decrements
        let t = std::time::Instant::now();
        while weak.iter().any(|w| w.upgrade().is_some()) {
            assert!(t.elapsed().as_secs() < 10, "the reclaimer frees them");
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        // a dropped store hands its models over too
        let mut s = ModelStore::default();
        let id = s.insert(Model::from_bytes(&bytes).unwrap());
        let m = s.get(id).unwrap();
        drop(s);
        assert!(Arc::strong_count(&m) >= 2);
    }

    #[test]
    fn removed_models_are_gone_and_cancelled_jobs_never_run() {
        let mut s = ModelStore::default();
        let ids: Vec<u32> = (0..40).map(|_| s.queue_file(model_file())).collect();
        for &id in &ids {
            s.remove(id);
            assert!(s.get(id).is_err());
        }
        let job = Arc::new(Job::new(Source::File(model_file())));
        job.cancel();
        assert!(job.claim().is_none());
        assert!(job.wait().is_none());
        assert!(s.slots.is_empty());
    }
}
