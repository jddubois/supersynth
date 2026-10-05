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
use supersynth_core::engine::pool::MAX_THREADS;
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
}

/// One organ coupler: also play `part`, `shift` semitones away (±12: octave couplers).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct CouplerSpec {
    pub part: u32,
    pub shift: Option<i32>,
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

/// What the API side and MIDI input share.
struct Shared {
    ctl: Mutex<Controller>,
    status: Arc<EngineStatus>,
    sample_rate: f32,
    /// Part each MIDI channel (1–16) plays when MIDI input is routed (`NO_ROUTE`: none)
    /// until changed.
    midi_routes: [AtomicU8; 16],
    /// Real-time output is running. MIDI input is routed into the engine only then: nothing
    /// would consume it otherwise, and the backlog would all sound at once on `start()`.
    running: AtomicBool,
}

impl Shared {
    fn send(&self, time: Option<f64>, cmd: Command) -> Result<()> {
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
                midi_routes: std::array::from_fn(|_| AtomicU8::new(NO_ROUTE)),
                running: AtomicBool::new(false),
            }),
            models: ModelStore::default(),
            fault: Arc::new(Fault::default()),
            sample_rate,
            threads,
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

    /// Threads rendering audio (the audio thread included).
    pub fn threads(&self) -> u32 {
        self.threads
    }

    /// Free space in the command queue (events not yet consumed by the engine).
    pub fn queue_free(&self) -> u32 {
        lock(&self.shared.ctl).queue_free() as u32
    }

    /// Real-time output started (`true`) or stopped: MIDI input is routed into the engine only
    /// while it runs, and offline rendering is refused.
    pub fn set_running(&self, running: bool) {
        self.shared.running.store(running, Ordering::Release);
    }

    pub fn is_running(&self) -> bool {
        self.shared.running.load(Ordering::Acquire)
    }

    /// Real-time scheduling for the render workers (while playing to an audio device), where
    /// the system allows it.
    pub fn set_realtime(&self, on: bool) {
        lock(&self.engine).set_realtime(on);
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

    /// Part that MIDI input on `channel` (1–16) plays; 255 (or more) routes it to no part.
    pub fn set_midi_route(&self, channel: u32, part: u32) -> Result<()> {
        if !(1..=16).contains(&channel) {
            return Err(err(format!("MIDI channel {channel} is not 1–16")));
        }
        self.shared.midi_routes[channel as usize - 1].store(part.min(NO_ROUTE as u32) as u8, Ordering::Relaxed);
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
    /// the host stops its output first. The engine stays usable but empty.
    pub fn release_resources(&mut self) {
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
    /// Apply one MIDI message to the part its channel plays (see [`Host::set_midi_route`]), if
    /// real-time output is running. Notes, controllers and pitch bend are applied; other
    /// messages, and channels routed nowhere, are left to the host's callback.
    pub fn route(&self, bytes: &[u8]) {
        let shared = &self.0;
        if !shared.running.load(Ordering::Acquire) {
            return;
        }
        let Some(msg) = MidiMessage::parse(bytes) else { return };
        let ch = (msg.channel.clamp(1, 16) - 1) as usize;
        let part = shared.midi_routes[ch].load(Ordering::Relaxed);
        if part == NO_ROUTE {
            return;
        }
        let part = part as u16;
        let cmd = match msg.kind {
            MidiMessageKind::NoteOn => Some(Command::NoteOn { part, note: msg.data1, velocity: msg.data2 }),
            MidiMessageKind::NoteOff => Some(Command::NoteOff { part, note: msg.data1 }),
            MidiMessageKind::ControlChange => Some(Command::ControlChange { part, controller: msg.data1, value: msg.data2 }),
            MidiMessageKind::PitchBend => {
                let v = ((msg.data2 as i32) << 7 | msg.data1 as i32) - 8192;
                Some(Command::PitchBend { part, value: v as f32 / 8192.0 })
            }
            _ => None,
        };
        if let Some(c) = cmd {
            // (a full queue drops the message: there is no caller to tell)
            let _ = shared.send(None, c);
        }
    }
}
