#![deny(clippy::all)]

//! The engine as its hosts drive it: Node.js (the napi addon in `native/`) and browsers (the
//! WebAssembly module in `native/wasm/`). Everything that does not depend on the host lives
//! here — checking arguments, turning calls into engine commands at their frame, the models
//! and their loading, MIDI routing, rendering that survives an engine failure — so each binding
//! is a thin layer of its host's types over [`Host`], plus what only that host has (an audio
//! device or an AudioWorklet, MIDI devices or Web MIDI, files or fetched bytes).

pub mod fault;
pub mod midi;
pub mod models;
pub mod sync;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use supersynth_core::engine::params::{MasterParam, PartParam};
use supersynth_core::engine::pool::{MAX_THREADS, RT_GRANTED, RT_REFUSED};
use supersynth_core::engine::{
    default_threads, Command, Controller, Couplers, Engine, EngineConfig, InstLayer, Instrument, Route, Status as EngineStatus, DEFAULT_MAX_VOICES, MAX_PARTS,
    MAX_ROUTES,
};
use supersynth_core::fx::reverb::ReverbParams;
use supersynth_core::model::{Kind, Model, ReleaseMode};

use fault::{render_guarded, Fault};
use midi::{MidiMessage, MidiMessageKind};
use models::{ModelStore, Settle};
use sync::lock;

// ── errors ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    /// An argument is not acceptable (a NaN, a value out of range).
    InvalidArg,
    Failure,
}

#[derive(Debug, Clone)]
pub struct Error {
    pub kind: ErrorKind,
    pub message: String,
}

impl Error {
    pub fn failure(msg: impl Into<String>) -> Self {
        Self { kind: ErrorKind::Failure, message: msg.into() }
    }

    pub fn invalid_arg(msg: impl Into<String>) -> Self {
        Self { kind: ErrorKind::InvalidArg, message: msg.into() }
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;

fn err(msg: impl Into<String>) -> Error {
    Error::failure(msg)
}

/// `v` if it is a finite number: NaN or an infinity reaching the engine would corrupt its
/// state, so they are rejected here with an error naming the argument.
fn finite(v: f64, what: &str) -> Result<f64> {
    if v.is_finite() {
        Ok(v)
    } else {
        Err(Error::invalid_arg(format!("{what} must be a finite number, got {v}")))
    }
}

fn finite_or(v: Option<f64>, default: f64, what: &str) -> Result<f32> {
    v.map(|x| finite(x, what)).transpose().map(|x| x.unwrap_or(default) as f32)
}

// ── arguments ─────────────────────────────────────────────────────────────────

/// An engine's settings when it is created.
#[derive(Debug, Clone, Default)]
pub struct EngineOptions {
    /// Sample rate in Hz (the host picks its default: the output device's rate).
    pub sample_rate: u32,
    /// Maximum simultaneously sounding voices (default 1024).
    pub max_voices: Option<u32>,
    /// Reverb preset name (default "hall").
    pub reverb: Option<String>,
    /// Threads rendering audio, the audio thread included (None or 0: one per core but one,
    /// at most 8). The output is the same for any number.
    pub threads: Option<u32>,
}

/// One layer of a part's instrument: a model played with these settings.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LayerSpec {
    pub model: u32,
    pub transpose: Option<f64>,
    pub gain_db: Option<f64>,
    pub pan: Option<f64>,
    pub key_lo: Option<u32>,
    pub key_hi: Option<u32>,
    pub enabled: Option<bool>,
    pub detune_cents: Option<f64>,
    /// Play this layer when the key is released (damper / jack noises).
    pub on_release: Option<bool>,
    /// Longest random delay before the layer speaks, ms (organ pipes).
    pub speech_ms: Option<f64>,
    /// Sound only when this part's own key moves, never through a coupler (key-action noise).
    pub direct_only: Option<bool>,
    /// Sound when the sustain pedal moves, never for a key (pedal noise).
    pub on_pedal: Option<bool>,
}

/// One organ coupler: also play `part`, `shift` semitones away (±12: octave couplers).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct CouplerSpec {
    pub part: u32,
    pub shift: Option<i32>,
}

/// What the overload guard has done (see [`Host::set_overload_guard`]).
#[derive(Debug, Clone, Copy, Default)]
pub struct GuardStats {
    /// Shedding load now.
    pub active: bool,
    /// Released notes ended early so far.
    pub voices_shed: u64,
    /// Partials faded out so far (last resort, when no released note was left).
    pub partials_reduced: u64,
}

/// Names of the built-in reverb presets.
pub fn reverb_presets() -> Vec<String> {
    ["room", "studio", "chamber", "hall", "concert-hall", "church", "cathedral", "plate"].iter().map(|s| s.to_string()).collect()
}

/// Names of all part parameters accepted by `set_param`.
pub fn part_param_names() -> Vec<String> {
    PartParam::ALL.iter().map(|(n, _)| n.to_string()).collect()
}

// ── the host ─────────────────────────────────────────────────────────────────

/// A MIDI channel routed to no part: its messages only reach the host's callback.
const NO_ROUTE: u8 = 255;

/// MIDI sources a route can name: source 0 is any input; sources 1… are inputs of their own
/// (a device each), whose routes come before source 0's.
pub const MIDI_SOURCES: usize = 16;

/// What one MIDI source's input is holding down, so that a key comes up on the part it went
/// down on (even when the channel was routed elsewhere in between), and so that everything it
/// holds can be let go when the device goes away.
struct Held {
    /// Part each (channel, key) is sounding on, or `NO_ROUTE`.
    notes: [[u8; 128]; 16],
    /// Part each channel's sustain pedal (CC 64) is down on, or `NO_ROUTE`.
    pedal: [u8; 16],
}

impl Default for Held {
    fn default() -> Self {
        Held { notes: [[NO_ROUTE; 128]; 16], pedal: [NO_ROUTE; 16] }
    }
}

/// A route's flag: only notes go to its part, not controllers or pitch bend.
const NOTES_ONLY: u8 = 0x80;

/// The commands that play one MIDI message from an input holding `held`, by `route` (the part
/// its channel is routed to now, with `NOTES_ONLY` if so, or `NO_ROUTE`).
fn held_route(held: &mut Held, route: u8, msg: &MidiMessage) -> [Option<Command>; 2] {
    let ch = (msg.channel.clamp(1, 16) - 1) as usize;
    let part = if route == NO_ROUTE { NO_ROUTE } else { route & !NOTES_ONLY };
    // controllers and pitch bend follow the route unless it takes notes only
    let ctl_part = if route != NO_ROUTE && route & NOTES_ONLY != 0 { NO_ROUTE } else { part };
    let mut cmds: [Option<Command>; 2] = [None, None];
    match msg.kind {
        MidiMessageKind::NoteOn if part != NO_ROUTE => {
            let note = msg.data1 & 0x7F;
            let was = std::mem::replace(&mut held.notes[ch][note as usize], part);
            if was != NO_ROUTE && was != part {
                // re-struck after a re-route: the old part lets go of it
                cmds[0] = Some(Command::NoteOff { part: was as u16, note });
            }
            cmds[1] = Some(Command::NoteOn { part: part as u16, note, velocity: msg.data2 });
        }
        MidiMessageKind::NoteOff => {
            let note = msg.data1 & 0x7F;
            let was = std::mem::replace(&mut held.notes[ch][note as usize], NO_ROUTE);
            let to = if was != NO_ROUTE { was } else { part };
            if to != NO_ROUTE {
                cmds[0] = Some(Command::NoteOff { part: to as u16, note });
            }
        }
        MidiMessageKind::ControlChange if msg.data1 == 64 => {
            let was = held.pedal[ch];
            if was != NO_ROUTE && was != ctl_part {
                cmds[0] = Some(Command::ControlChange { part: was as u16, controller: 64, value: 0 });
            }
            if ctl_part != NO_ROUTE {
                cmds[1] = Some(Command::ControlChange { part: ctl_part as u16, controller: 64, value: msg.data2 });
            }
            held.pedal[ch] = if msg.data2 > 0 { ctl_part } else { NO_ROUTE };
        }
        _ if ctl_part == NO_ROUTE => {}
        MidiMessageKind::ControlChange => {
            cmds[0] = Some(Command::ControlChange { part: ctl_part as u16, controller: msg.data1, value: msg.data2 });
        }
        MidiMessageKind::PitchBend => {
            let v = ((msg.data2 as i32) << 7 | msg.data1 as i32) - 8192;
            cmds[0] = Some(Command::PitchBend { part: ctl_part as u16, value: v as f32 / 8192.0 });
        }
        _ => {}
    }
    cmds
}

/// What the API side and MIDI input share.
struct Shared {
    ctl: Mutex<Controller>,
    status: Arc<EngineStatus>,
    sample_rate: f32,
    /// Part each MIDI channel (1–16) of each source plays when MIDI input is routed
    /// (`NO_ROUTE`: none) until changed.
    midi_routes: [[AtomicU8; 16]; MIDI_SOURCES],
    /// Keys and pedals each source holds down.
    held: [Mutex<Held>; MIDI_SOURCES],
    /// Real-time output is running. MIDI input is routed into the engine only then: nothing
    /// would consume it otherwise, and the backlog would all sound at once on `start()`.
    running: AtomicBool,
    /// `release_resources` was called: the engine is empty and takes no more commands.
    released: AtomicBool,
}

fn released() -> Error {
    err("the engine's resources were released (the synth is closed)")
}

impl Shared {
    fn send(&self, time: Option<f64>, cmd: Command) -> Result<()> {
        if self.released.load(Ordering::Acquire) {
            return Err(released());
        }
        let frame = match time {
            Some(t) => (finite(t, "time")?.max(0.0) * self.sample_rate as f64).round() as u64,
            None => 0,
        };
        lock(&self.ctl).send(frame, cmd).map_err(err)
    }
}

/// An engine, its models and its command queue, driven through plain calls.
pub struct Host {
    engine: Arc<Mutex<Engine>>,
    shared: Arc<Shared>,
    models: ModelStore,
    /// Set when rendering panicked (see `faulted`).
    fault: Arc<Fault>,
    sample_rate: u32,
    threads: u32,
    /// The overload guard is wanted (`set_overload_guard`); it is armed only while rendering
    /// in real time (output running, or emulated).
    guard: bool,
    emulated: bool,
}

impl Host {
    pub fn new(o: EngineOptions) -> Result<Self> {
        let sample_rate = o.sample_rate;
        if !(8000..=384_000).contains(&sample_rate) {
            return Err(err(format!("unsupported sample rate {sample_rate}")));
        }
        let reverb_name = o.reverb.unwrap_or_else(|| "hall".into());
        let reverb = ReverbParams::preset(&reverb_name).ok_or_else(|| err(format!("unknown reverb preset '{reverb_name}'")))?;
        let (engine, ctl) = Engine::new(EngineConfig {
            sample_rate: sample_rate as f32,
            max_voices: o.max_voices.map(|v| v as usize).unwrap_or(DEFAULT_MAX_VOICES).clamp(8, 4096),
            reverb,
            threads: match o.threads {
                None | Some(0) => default_threads(),
                Some(t) => (t as usize).clamp(1, MAX_THREADS),
            },
        });
        let status = Arc::clone(&ctl.status);
        let threads = engine.threads() as u32;
        Ok(Self {
            engine: Arc::new(Mutex::new(engine)),
            shared: Arc::new(Shared {
                ctl: Mutex::new(ctl),
                status,
                sample_rate: sample_rate as f32,
                midi_routes: std::array::from_fn(|_| std::array::from_fn(|_| AtomicU8::new(NO_ROUTE))),
                held: std::array::from_fn(|_| Mutex::new(Held::default())),
                running: AtomicBool::new(false),
                released: AtomicBool::new(false),
            }),
            models: ModelStore::default(),
            fault: Arc::new(Fault::default()),
            sample_rate,
            threads,
            guard: false,
            emulated: false,
        })
    }

    /// The engine, for the host's audio output (which renders it with [`render_guarded`]).
    pub fn engine(&self) -> &Arc<Mutex<Engine>> {
        &self.engine
    }

    /// Where a rendering failure is recorded, for the host's audio output.
    pub fn fault(&self) -> &Arc<Fault> {
        &self.fault
    }

    // ── state ───────────────────────────────────────────────────────────────

    /// True once rendering has failed (an internal error in the engine). The engine is then
    /// stopped for good: real-time output plays silence and `render()` fails.
    pub fn faulted(&self) -> bool {
        self.fault.is_set()
    }

    /// What made the engine fail (see `faulted`).
    pub fn error(&self) -> Option<String> {
        self.fault.message()
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    /// Engine clock in seconds (frames rendered so far).
    pub fn current_time(&self) -> f64 {
        self.shared.status.frames.load(Ordering::Relaxed) as f64 / self.sample_rate as f64
    }

    pub fn active_voices(&self) -> u32 {
        self.shared.status.active_voices.load(Ordering::Relaxed)
    }

    /// Fraction of real time spent rendering the last buffer (0.25 = 25 % of one core).
    pub fn cpu_load(&self) -> f64 {
        self.shared.status.load_permille.load(Ordering::Relaxed) as f64 / 1000.0
    }

    /// Peak output level of the last buffers (0–1, falling by half every buffer), in steps of
    /// 0.001 (-60 dBFS).
    pub fn peak(&self) -> f64 {
        self.shared.status.peak_milli.load(Ordering::Relaxed) as f64 / 1000.0
    }

    /// Threads rendering audio (the audio thread included).
    pub fn threads(&self) -> u32 {
        self.threads
    }

    /// Free space in the command queue (events not yet consumed by the engine).
    pub fn queue_free(&self) -> u32 {
        lock(&self.shared.ctl).queue_free() as u32
    }

    /// Real-time output started (`true`) or stopped: MIDI input is routed into the engine only
    /// while it runs, offline rendering is refused, and the overload guard (if wanted) is armed.
    pub fn set_running(&self, running: bool) {
        self.shared.running.store(running, Ordering::Release);
        self.arm_guard();
    }

    /// Fails once `release_resources` was called (the engine takes no more commands).
    pub fn check_open(&self) -> Result<()> {
        if self.shared.released.load(Ordering::Acquire) {
            return Err(released());
        }
        Ok(())
    }

    // ── overload guard ──────────────────────────────────────────────────────

    /// Opt-in overload guard: while rendering in real time, when buffers come close to their
    /// deadline, end the quietest released notes early (then, as a last resort, fade out upper
    /// partials). Offline `render()` is never guarded.
    pub fn set_overload_guard(&mut self, on: bool) {
        self.guard = on;
        self.arm_guard();
    }

    /// Treat `render()` calls as real-time buffers (benchmarks and tests that drive the engine
    /// buffer by buffer as an audio callback would).
    pub fn set_realtime_emulation(&mut self, on: bool) {
        self.emulated = on;
        self.arm_guard();
    }

    fn arm_guard(&self) {
        let st = &self.shared.status;
        let armed = self.guard && (self.is_running() || self.emulated);
        st.guard_armed.store(armed, Ordering::Relaxed);
        if !armed {
            // (the engine lets go at its next buffer; there may be none)
            st.guard_active.store(false, Ordering::Relaxed);
        }
    }

    /// The overload guard is shedding load now.
    pub fn guard_active(&self) -> bool {
        self.shared.status.guard_active.load(Ordering::Relaxed)
    }

    /// What the overload guard has done so far.
    pub fn guard_stats(&self) -> GuardStats {
        let st = &self.shared.status;
        GuardStats {
            active: st.guard_active.load(Ordering::Relaxed),
            voices_shed: st.guard_voices_shed.load(Ordering::Relaxed),
            partials_reduced: st.guard_partials_reduced.load(Ordering::Relaxed),
        }
    }

    pub fn is_running(&self) -> bool {
        self.shared.running.load(Ordering::Acquire)
    }

    /// Real-time scheduling for the render workers (while playing to an audio device), where
    /// the system allows it.
    pub fn set_realtime(&self, on: bool) {
        lock(&self.engine).set_realtime(on);
    }

    /// Whether real-time output renders at real-time priority: `None` until it has rendered its
    /// first buffer (or when it is not running), `Some(false)` when the system refused it (on
    /// Linux: the user's real-time priority limit, `RLIMIT_RTPRIO`, is 0).
    pub fn realtime(&self) -> Option<bool> {
        match self.shared.status.realtime.load(Ordering::Relaxed) {
            RT_GRANTED => Some(true),
            RT_REFUSED => Some(false),
            _ => None,
        }
    }

    // ── models ──────────────────────────────────────────────────────────────

    pub fn models(&self) -> &ModelStore {
        &self.models
    }

    /// Parse a spectral model (.ssm bytes). Returns a model id.
    pub fn load_model(&mut self, data: &[u8]) -> Result<u32> {
        // untrusted input: a parser panic becomes an error, not an abort
        let m = std::panic::catch_unwind(|| Model::from_bytes(data))
            .map_err(|_| err("invalid supersynth model (the parser failed)"))?
            .map_err(err)?;
        Ok(self.models.insert(m))
    }

    /// Load a model file (.ssm) in the background. Returns its id at once: the model can be
    /// used right away, and whatever uses it before it has loaded waits for just that model
    /// (loading it itself if no worker has started it yet). A file that fails to load fails
    /// each use with its error.
    pub fn queue_model_file(&mut self, path: PathBuf) -> u32 {
        self.models.queue_file(path)
    }

    /// Like [`Host::queue_model_file`], with the file's bytes (`name` names it in errors).
    pub fn queue_model_bytes(&mut self, name: String, bytes: Vec<u8>) -> u32 {
        self.models.queue_bytes(name, bytes)
    }

    /// Call `settle` once all these models have loaded (or been unloaded): with the first
    /// loading error, if any.
    pub fn watch_models(&self, ids: &[u32], settle: Settle) {
        self.models.when_loaded(ids, settle);
    }

    /// Load these models next, before the other models queued (those not started yet).
    pub fn hurry_models(&self, ids: &[u32]) {
        for &id in ids {
            self.models.hurry(id);
        }
    }

    /// Whether a model is still loading in the background (a use would wait for it).
    pub fn model_loading(&self, id: u32) -> bool {
        self.models.loading(id)
    }

    /// Decoded size of a model in bytes, or None while it is still loading.
    pub fn model_bytes(&self, id: u32) -> Option<usize> {
        self.models.bytes(id)
    }

    /// Release a model (instruments already using it keep their reference).
    pub fn unload_model(&mut self, id: u32) {
        self.models.remove(id);
    }

    /// Model metadata as JSON.
    pub fn model_info(&self, id: u32) -> Result<String> {
        let m = self.models.get(id).map_err(err)?;
        let p = &m.params;
        let info = serde_json::json!({
            "name": m.name,
            "displayName": m.display_name,
            "family": m.family,
            "kind": if m.kind == Kind::Sustained { "sustained" } else { "decaying" },
            "source": m.source,
            "noteRange": [m.note_range.0, m.note_range.1],
            "zones": m.zones.len(),
            "layers": m.layers.iter().map(|l| serde_json::json!({"name": l.name, "velocity": l.velocity})).collect::<Vec<_>>(),
            "releaseMode": match p.release_mode { ReleaseMode::Natural => "natural", ReleaseMode::Damper => "damper", ReleaseMode::RingOut => "ringout" },
            "reverb": p.reverb,
            "reverbSend": p.reverb_send,
            "formant": p.formant,
        });
        Ok(info.to_string())
    }

    // ── parts ───────────────────────────────────────────────────────────────

    /// Assign an instrument (one or more layers) to a part.
    pub fn set_instrument(&self, part: u32, layers: Vec<LayerSpec>, time: Option<f64>) -> Result<()> {
        let mut inst = Instrument::default();
        for l in layers {
            inst.layers.push(self.inst_layer(l)?);
        }
        self.shared.send(time, Command::set_instrument(part as u16, inst))
    }

    fn inst_layer(&self, l: LayerSpec) -> Result<InstLayer> {
        // (waits for a model still loading in the background)
        let model = self.models.get(l.model).map_err(err)?;
        Ok(InstLayer {
            model,
            transpose: finite_or(l.transpose, 0.0, "transpose")?,
            gain_db: finite_or(l.gain_db, 0.0, "gainDb")?,
            pan: finite_or(l.pan, 0.0, "pan")?,
            key_lo: l.key_lo.unwrap_or(0).min(127) as u8,
            key_hi: l.key_hi.unwrap_or(127).min(127) as u8,
            enabled: l.enabled.unwrap_or(true),
            detune_cents: finite_or(l.detune_cents, 0.0, "detuneCents")?,
            on_release: l.on_release.unwrap_or(false),
            speech_ms: finite_or(l.speech_ms, 0.0, "speechMs")?.clamp(0.0, 200.0),
            direct_only: l.direct_only.unwrap_or(false),
            on_pedal: l.on_pedal.unwrap_or(false),
        })
    }

    pub fn note_on(&self, part: u32, note: u32, velocity: u32, time: Option<f64>) -> Result<()> {
        if note > 127 {
            return Err(err(format!("note {note} out of range 0-127")));
        }
        self.shared.send(time, Command::NoteOn { part: part as u16, note: note as u8, velocity: velocity.min(127) as u8 })
    }

    pub fn note_off(&self, part: u32, note: u32, time: Option<f64>) -> Result<()> {
        if note > 127 {
            return Err(err(format!("note {note} out of range 0-127")));
        }
        self.shared.send(time, Command::NoteOff { part: part as u16, note: note as u8 })
    }

    pub fn control_change(&self, part: u32, controller: u32, value: u32, time: Option<f64>) -> Result<()> {
        self.shared.send(
            time,
            Command::ControlChange { part: part as u16, controller: controller.min(127) as u8, value: value.min(127) as u8 },
        )
    }

    /// Pitch bend in -1..1.
    pub fn pitch_bend(&self, part: u32, value: f64, time: Option<f64>) -> Result<()> {
        self.shared.send(time, Command::PitchBend { part: part as u16, value: finite(value, "pitch bend")? as f32 })
    }

    pub fn set_param(&self, part: u32, name: &str, value: f64, time: Option<f64>) -> Result<()> {
        let p = PartParam::parse(name).ok_or_else(|| err(format!("unknown parameter '{name}'")))?;
        self.shared.send(time, Command::SetPartParam { part: part as u16, param: p, value: finite(value, name)? as f32 })
    }

    pub fn set_master_param(&self, name: &str, value: f64, time: Option<f64>) -> Result<()> {
        let p = MasterParam::parse(name).ok_or_else(|| err(format!("unknown master parameter '{name}'")))?;
        self.shared.send(time, Command::SetMasterParam { param: p, value: finite(value, name)? as f32 })
    }

    /// Switch all reverb parameters to a named preset.
    pub fn set_reverb_preset(&self, name: &str, time: Option<f64>) -> Result<()> {
        let rp = ReverbParams::preset(name).ok_or_else(|| err(format!("unknown reverb preset '{name}'")))?;
        let sets = [
            (MasterParam::ReverbDecay, rp.decay),
            (MasterParam::ReverbLowMult, rp.low_mult),
            (MasterParam::ReverbHighMult, rp.high_mult),
            (MasterParam::ReverbSize, rp.size),
            (MasterParam::ReverbPredelay, rp.predelay_ms),
            (MasterParam::ReverbDiffusion, rp.diffusion),
            (MasterParam::ReverbEarly, rp.early),
            (MasterParam::ReverbWidth, rp.width),
            (MasterParam::ReverbLowCut, rp.low_cut_hz),
            (MasterParam::ReverbHighCut, rp.high_cut_hz),
            (MasterParam::ReverbModulation, rp.modulation),
        ];
        for (p, v) in sets {
            self.shared.send(time, Command::SetMasterParam { param: p, value: v })?;
        }
        Ok(())
    }

    /// Add one layer to a part without interrupting sounding notes (organ stops). The layer
    /// index is the number of layers added before it.
    pub fn add_layer(&self, part: u32, layer: LayerSpec, time: Option<f64>) -> Result<()> {
        let l = self.inst_layer(layer)?;
        self.shared.send(time, Command::add_layer(part as u16, l))
    }

    pub fn set_layer_enabled(&self, part: u32, layer: u32, enabled: bool, time: Option<f64>) -> Result<()> {
        self.shared.send(time, Command::SetLayerEnabled { part: part as u16, layer: layer as u16, enabled })
    }

    pub fn set_layer_gain(&self, part: u32, layer: u32, gain_db: f64, time: Option<f64>) -> Result<()> {
        self.shared.send(time, Command::SetLayerGain { part: part as u16, layer: layer as u16, gain_db: finite(gain_db, "gainDb")? as f32 })
    }

    /// Organ couplers: keys pressed on `part` (from any source: API, MIDI input, MIDI files)
    /// also play the `targets` parts, octave-shifted by their `shift`. An empty list releases
    /// all of its couplers. `unison_off`: the keys do not play `part` itself.
    pub fn set_couplers(&self, part: u32, targets: &[CouplerSpec], unison_off: Option<bool>, time: Option<f64>) -> Result<()> {
        if targets.len() > MAX_ROUTES {
            return Err(err(format!("at most {MAX_ROUTES} couplers per keyboard")));
        }
        let routes: Vec<Route> = targets
            .iter()
            .filter(|t| t.part < MAX_PARTS as u32)
            .map(|t| Route { part: t.part as u8, shift: t.shift.unwrap_or(0).clamp(-48, 48) as i8 })
            .collect();
        let couplers = Couplers::new(&routes, unison_off.unwrap_or(false));
        self.shared.send(time, Command::SetCouplers { part: part as u16, couplers })
    }

    /// Part that MIDI input on `channel` (1–16) from `source` plays; 255 (or more) routes it
    /// to no part. Source 0 is any input; the routes of sources 1… (an input each, see
    /// [`MidiRouter::route_from`]) come first for messages from that input. Keys already down
    /// still come up on the part they went down on. With `controllers` false the part gets
    /// only the notes, not controllers (pedals, wheels) or pitch bend.
    pub fn set_midi_route(&self, channel: u32, part: u32, source: u32, controllers: bool) -> Result<()> {
        if !(1..=16).contains(&channel) {
            return Err(err(format!("MIDI channel {channel} is not 1–16")));
        }
        if source as usize >= MIDI_SOURCES {
            return Err(err(format!("MIDI source {source} is not 0–{}", MIDI_SOURCES - 1)));
        }
        let route = if part >= MAX_PARTS as u32 { NO_ROUTE } else { part as u8 | if controllers { 0 } else { NOTES_ONLY } };
        self.shared.midi_routes[source as usize][channel as usize - 1].store(route, Ordering::Relaxed);
        Ok(())
    }

    pub fn all_notes_off(&self, part: Option<u32>, time: Option<f64>) -> Result<()> {
        self.shared.send(time, Command::AllNotesOff { part: part.map(|p| p as u16) })
    }

    pub fn all_sound_off(&self) -> Result<()> {
        self.shared.send(None, Command::AllSoundOff)
    }

    // ── rendering ───────────────────────────────────────────────────────────

    /// Render `frames` of audio offline: interleaved stereo (L, R, L, R…). Not available while
    /// real-time output is running.
    pub fn render(&self, frames: u32) -> Result<Vec<f32>> {
        if self.is_running() {
            return Err(err("render() is unavailable while real-time output is running; call stop() first"));
        }
        let mut buf = vec![0.0f32; frames as usize * 2];
        if !render_guarded(&self.engine, &self.fault, &mut buf, 2) {
            return Err(err(self.fault.message().unwrap_or_else(|| "the audio engine failed".into())));
        }
        lock(&self.shared.ctl).collect_garbage();
        Ok(buf)
    }

    /// What MIDI input calls with each message (from any thread).
    pub fn midi_router(&self) -> MidiRouter {
        MidiRouter(Arc::clone(&self.shared))
    }

    /// Let go of everything the engine holds: its instruments and their models, voices and
    /// buffers, now rather than when the host's object is collected. Stops routing MIDI input;
    /// the host stops its output first. The engine cannot be used afterwards: its commands
    /// fail (and the host's `start()`), `render()` renders silence, and its clock and status
    /// keep their last values.
    pub fn release_resources(&mut self) {
        self.shared.released.store(true, Ordering::Release);
        self.set_running(false);
        let (engine, ctl) = Engine::new(EngineConfig { sample_rate: self.sample_rate as f32, max_voices: 8, ..EngineConfig::default() });
        let old = std::mem::replace(&mut *lock(&self.engine), engine);
        *lock(&self.shared.ctl) = ctl;
        drop(old);
    }
}

/// Plays MIDI input on the parts its channels are routed to.
#[derive(Clone)]
pub struct MidiRouter(Arc<Shared>);

impl MidiRouter {
    /// Apply one MIDI message from any input (source 0; see [`MidiRouter::route_from`]).
    pub fn route(&self, bytes: &[u8]) {
        self.route_from(0, bytes);
    }

    /// Apply one MIDI message from the input of `source` (1…, or 0 for any) to the part its
    /// channel plays: the source's own route for that channel, else source 0's (see
    /// [`Host::set_midi_route`]), if real-time output is running. Notes, controllers and pitch
    /// bend are applied; other messages, and channels routed nowhere, are left to the host's
    /// callback. A key comes up on the part it went down on, and a sustain pedal held down on
    /// a part the channel no longer plays is let go there.
    pub fn route_from(&self, source: usize, bytes: &[u8]) {
        let shared = &self.0;
        if source >= MIDI_SOURCES || !shared.running.load(Ordering::Acquire) {
            return;
        }
        let Some(msg) = MidiMessage::parse(bytes) else { return };
        let ch = (msg.channel.clamp(1, 16) - 1) as usize;
        let mut part = shared.midi_routes[source][ch].load(Ordering::Relaxed);
        if part == NO_ROUTE && source != 0 {
            part = shared.midi_routes[0][ch].load(Ordering::Relaxed);
        }
        let cmds = held_route(&mut lock(&shared.held[source]), part, &msg);
        // live input has room of its own in the queue, so events a program scheduled ahead
        // never crowd it out; it is applied at the start of the next audio buffer (a full
        // queue drops the message: there is no caller to tell)
        if cmds.iter().any(|c| c.is_some()) && !shared.released.load(Ordering::Acquire) {
            let mut ctl = lock(&shared.ctl);
            for c in cmds.into_iter().flatten() {
                let _ = ctl.send_live(c);
            }
        }
    }

    /// Let go of everything the input of `source` holds down (its device went away, or the
    /// input was closed): its keys come up and its sustain pedals are released, on the parts
    /// they went down on.
    pub fn release(&self, source: usize) {
        let shared = &self.0;
        if source >= MIDI_SOURCES {
            return;
        }
        let mut held = lock(&shared.held[source]);
        let mut cmds = Vec::new();
        for ch in 0..16 {
            for note in 0..128 {
                let part = std::mem::replace(&mut held.notes[ch][note], NO_ROUTE);
                if part != NO_ROUTE {
                    cmds.push(Command::NoteOff { part: part as u16, note: note as u8 });
                }
            }
            let part = std::mem::replace(&mut held.pedal[ch], NO_ROUTE);
            if part != NO_ROUTE {
                cmds.push(Command::ControlChange { part: part as u16, controller: 64, value: 0 });
            }
        }
        drop(held);
        // (with output stopped nothing plays: the engine would only get these at the next start)
        if cmds.is_empty() || shared.released.load(Ordering::Acquire) || !shared.running.load(Ordering::Acquire) {
            return;
        }
        let mut ctl = lock(&shared.ctl);
        for c in cmds {
            let _ = ctl.send_live(c);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(bytes: &[u8]) -> MidiMessage {
        MidiMessage::parse(bytes).unwrap()
    }

    /// The commands as (kind, part, data) for comparison.
    fn plan(held: &mut Held, part: u8, bytes: &[u8]) -> Vec<(&'static str, u16, u8, u8)> {
        held_route(held, part, &msg(bytes))
            .into_iter()
            .flatten()
            .map(|c| match c {
                Command::NoteOn { part, note, velocity } => ("on", part, note, velocity),
                Command::NoteOff { part, note } => ("off", part, note, 0),
                Command::ControlChange { part, controller, value } => ("cc", part, controller, value),
                Command::PitchBend { part, .. } => ("bend", part, 0, 0),
                _ => ("other", 0, 0, 0),
            })
            .collect()
    }

    #[test]
    fn a_key_comes_up_on_the_part_it_went_down_on() {
        let mut h = Held::default();
        assert_eq!(plan(&mut h, 3, &[0x90, 60, 100]), [("on", 3, 60, 100)]);
        // the channel is routed elsewhere while the key is down
        assert_eq!(plan(&mut h, 7, &[0x80, 60, 0]), [("off", 3, 60, 0)]);
        // once up, it follows the route again (a note-on with velocity 0 is a note-off)
        assert_eq!(plan(&mut h, 7, &[0x90, 60, 0]), [("off", 7, 60, 0)]);
        // routed nowhere: nothing plays, and a key that went down nowhere comes up nowhere
        assert_eq!(plan(&mut h, NO_ROUTE, &[0x90, 61, 90]), []);
        assert_eq!(plan(&mut h, NO_ROUTE, &[0x80, 61, 0]), []);
        // channels are kept apart
        assert_eq!(plan(&mut h, 1, &[0x91, 60, 80]), [("on", 1, 60, 80)]);
        assert_eq!(plan(&mut h, 2, &[0x90, 60, 80]), [("on", 2, 60, 80)]);
        assert_eq!(plan(&mut h, 5, &[0x81, 60, 0]), [("off", 1, 60, 0)]);
    }

    #[test]
    fn a_key_struck_again_after_a_reroute_lets_go_of_the_old_part() {
        let mut h = Held::default();
        plan(&mut h, 3, &[0x90, 60, 100]);
        assert_eq!(plan(&mut h, 4, &[0x90, 60, 100]), [("off", 3, 60, 0), ("on", 4, 60, 100)]);
        assert_eq!(plan(&mut h, 3, &[0x80, 60, 0]), [("off", 4, 60, 0)]);
    }

    #[test]
    fn a_pedal_held_on_a_part_the_channel_left_is_let_go_there() {
        let mut h = Held::default();
        assert_eq!(plan(&mut h, 3, &[0xB0, 64, 127]), [("cc", 3, 64, 127)]);
        assert_eq!(plan(&mut h, 3, &[0xB0, 64, 90]), [("cc", 3, 64, 90)]);
        // re-routed while down: the old part's pedal comes up, the new part gets this one
        assert_eq!(plan(&mut h, 5, &[0xB0, 64, 0]), [("cc", 3, 64, 0), ("cc", 5, 64, 0)]);
        assert_eq!(plan(&mut h, 5, &[0xB0, 64, 0]), [("cc", 5, 64, 0)]);
        // other controllers and pitch bend follow the route
        assert_eq!(plan(&mut h, 5, &[0xB0, 11, 40]), [("cc", 5, 11, 40)]);
        assert_eq!(plan(&mut h, 6, &[0xE0, 0, 64]), [("bend", 6, 0, 0)]);
        assert_eq!(plan(&mut h, NO_ROUTE, &[0xB0, 11, 40]), []);
    }

    #[test]
    fn a_notes_only_route_leaves_controllers_out() {
        let mut h = Held::default();
        let r = 3 | NOTES_ONLY;
        assert_eq!(plan(&mut h, r, &[0x90, 60, 100]), [("on", 3, 60, 100)]);
        assert_eq!(plan(&mut h, r, &[0xB0, 64, 127]), []);
        assert_eq!(plan(&mut h, r, &[0xE0, 0, 64]), []);
        assert_eq!(plan(&mut h, r, &[0x80, 60, 0]), [("off", 3, 60, 0)]);
        // a pedal held down before the route took notes only is let go
        assert_eq!(plan(&mut h, 3, &[0xB0, 64, 127]), [("cc", 3, 64, 127)]);
        assert_eq!(plan(&mut h, r, &[0xB0, 64, 0]), [("cc", 3, 64, 0)]);
    }

    #[test]
    fn device_routes_come_before_any_device_routes() {
        let host = Host::new(EngineOptions { sample_rate: 48000, threads: Some(1), ..EngineOptions::default() }).unwrap();
        host.set_midi_route(1, 4, 0, true).unwrap();
        host.set_midi_route(1, 9, 2, true).unwrap();
        assert!(host.set_midi_route(1, 9, MIDI_SOURCES as u32, true).is_err());
        assert!(host.set_midi_route(17, 9, 0, true).is_err());
        let r = &host.shared.midi_routes;
        assert_eq!(r[0][0].load(Ordering::Relaxed), 4);
        assert_eq!(r[2][0].load(Ordering::Relaxed), 9);
        assert_eq!(r[1][0].load(Ordering::Relaxed), NO_ROUTE);
        // played through the engine: source 2 plays part 9, source 1 falls back to part 4
        host.set_running(true);
        let router = host.midi_router();
        router.route_from(2, &[0x90, 60, 100]);
        router.route_from(1, &[0x90, 62, 100]);
        let held = |s: usize, n: usize| lock(&host.shared.held[s]).notes[0][n];
        assert_eq!(held(2, 60), 9);
        assert_eq!(held(1, 62), 4);
        // a device going away lets go of what it held
        router.release(2);
        assert_eq!(held(2, 60), NO_ROUTE);
        assert_eq!(held(1, 62), 4);
        host.set_running(false);
    }
}
