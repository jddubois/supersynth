//! Real-time engine: command queue, scheduling, parts, voices and the master bus.
//!
//! Threading model: a [`Controller`] (owned by the API thread) pushes timestamped
//! [`Command`]s through a lock-free SPSC ring buffer. The [`Engine`] (owned by
//! the audio callback, or driven directly for offline rendering) drains the
//! queue at the start of every buffer, orders events by time, and renders in
//! sub-blocks split exactly at event times (pipes the engine itself schedules, after
//! their speech delay, start at their sample inside a block instead). Objects that need
//! deallocation (replaced instruments) are sent back through a second ring buffer so the
//! audio thread never frees memory.
//!
//! Each block is rendered by a [`pool`] of threads: first the voices (each into its own
//! buffer, set-up of new notes included), then the parts (their voices summed in slot
//! order, pooled noise, insert effects); the rendering thread then mixes the parts in order
//! and runs the reverb and limiter. Nothing depends on which thread did what, so the
//! output is the same for any number of threads.

pub mod params;
pub mod pool;

use std::collections::BinaryHeap;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;

use crate::dsp::denormal::FlushDenormals;
use crate::dsp::noise::Rng;
use crate::dsp::{db_to_amp, BLOCK};
use crate::fx::chorus::{Chorus, ChorusParams};
use crate::fx::drive::Drive;
use crate::fx::eq::{Eq as Equalizer, EqParams};
use crate::fx::leslie::{Leslie, LeslieSpeed};
use crate::fx::limiter::{safety_clip, Limiter};
use crate::fx::reverb::{Reverb, ReverbParams};
use crate::fx::StereoEffect;
use crate::model::Model;
use crate::voice::noisebank::NoiseBank;
use crate::voice::spectral::{BlockMod, NoteOn, SpectralParams, SpectralVoice, VoiceScratch, MAX_BANDS};
use params::{MasterParam, PartParam};
use pool::Pool;

pub const MAX_PARTS: usize = 32;
/// Most events waiting to be applied at once.
pub const QUEUE_CAPACITY: usize = 1 << 15;

// ── instruments ───────────────────────────────────────────────────────────────

/// One sound layer of an instrument: a model plus placement. Organ stops are
/// layers that can be switched on and off while playing.
#[derive(Clone)]
pub struct InstLayer {
    pub model: Arc<Model>,
    /// Pitch offset in semitones (e.g. +12 for a 4' stop).
    pub transpose: f32,
    pub gain_db: f32,
    pub pan: f32,
    pub key_lo: u8,
    pub key_hi: u8,
    pub enabled: bool,
    /// Per-layer detune in cents (organ ranks are never perfectly in tune with each other).
    pub detune_cents: f32,
    /// Played when the key is released instead of when it is pressed (damper and jack
    /// noises of pianos and harpsichords).
    pub on_release: bool,
    /// Longest random delay (ms) before the layer speaks. Organ pipes of different ranks never
    /// start in the same instant (pallet, channel and pipe foot); starting them together
    /// would lock their phases and sum unison ranks louder and brighter than they are.
    pub speech_ms: f32,
    /// Sounds when its own keyboard's key moves, never through a coupler, and plays to its
    /// end (key-action noise).
    pub direct_only: bool,
}

impl InstLayer {
    pub fn new(model: Arc<Model>) -> Self {
        Self {
            model,
            transpose: 0.0,
            gain_db: 0.0,
            pan: 0.0,
            key_lo: 0,
            key_hi: 127,
            enabled: true,
            detune_cents: 0.0,
            on_release: false,
            speech_ms: 0.0,
            direct_only: false,
        }
    }
}

/// Organ coupler: the keys of a keyboard also play `part`, `shift` semitones away (±12 for
/// sub and super octave couplers).
#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
pub struct Route {
    pub part: u8,
    pub shift: i8,
}

pub const MAX_ROUTES: usize = 16;

/// A keyboard's couplers. `unison_off`: its keys do not play its own division (only what
/// it is coupled to).
#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
pub struct Couplers {
    pub routes: [Route; MAX_ROUTES],
    pub n: u8,
    pub unison_off: bool,
}

impl Couplers {
    /// Couplers from a list of routes (duplicates dropped, at most [`MAX_ROUTES`]).
    pub fn new(routes: &[Route], unison_off: bool) -> Self {
        let mut c = Couplers { unison_off, ..Default::default() };
        for r in routes {
            if (c.n as usize) < MAX_ROUTES && !c.routes[..c.n as usize].contains(r) {
                c.routes[c.n as usize] = *r;
                c.n += 1;
            }
        }
        c
    }

    /// Unison couplers to every part in the bit mask `targets` (bit n = part n).
    pub fn to_parts(targets: u32) -> Self {
        let r: Vec<Route> = (0..32u8).filter(|t| targets & (1u32 << t) != 0).map(|part| Route { part, shift: 0 }).collect();
        Self::new(&r, false)
    }
}

impl InstLayer {
    /// Replace non-finite placement values by defaults and clamp them to sane ranges.
    fn sanitize(&mut self) {
        let fin = |x: f32, lo: f32, hi: f32| if x.is_finite() { x.clamp(lo, hi) } else { 0.0 };
        self.transpose = fin(self.transpose, -96.0, 96.0);
        self.gain_db = fin(self.gain_db, -120.0, 48.0);
        self.pan = fin(self.pan, -1.0, 1.0);
        self.detune_cents = fin(self.detune_cents, -1200.0, 1200.0);
        self.speech_ms = fin(self.speech_ms, 0.0, 200.0);
    }
}

/// Most layers one part's instrument can hold (layers added beyond it are ignored).
pub const MAX_LAYERS: usize = 256;

#[derive(Clone)]
pub struct Instrument {
    pub layers: Vec<InstLayer>,
}

impl Default for Instrument {
    fn default() -> Self {
        Self { layers: Vec::with_capacity(64) }
    }
}

impl Instrument {
    pub fn single(model: Arc<Model>) -> Self {
        let mut layers = Vec::with_capacity(64);
        layers.push(InstLayer::new(model));
        Self { layers }
    }
}

// ── commands ─────────────────────────────────────────────────────────────────

pub enum Command {
    NoteOn { part: u16, note: u8, velocity: u8 },
    NoteOff { part: u16, note: u8 },
    ControlChange { part: u16, controller: u8, value: u8 },
    /// Pitch bend, -1..1 (scaled by the part's bend range).
    PitchBend { part: u16, value: f32 },
    SetPartParam { part: u16, param: PartParam, value: f32 },
    SetMasterParam { param: MasterParam, value: f32 },
    /// Replace a part's instrument. `noise` is the part's noise bank for the instrument's band
    /// layout, built by [`Controller::send`] off the audio thread (use [`Command::set_instrument`]).
    SetInstrument { part: u16, instrument: Box<Instrument>, noise: Option<Box<NoiseBank>> },
    /// Append a layer to a part's instrument without interrupting sounding notes. `spare` (an
    /// empty instrument with room for [`MAX_LAYERS`] layers) and `noise` are built by
    /// [`Controller::send`] so that the audio thread never allocates (use [`Command::add_layer`]).
    AddLayer { part: u16, layer: Box<InstLayer>, spare: Option<Box<Instrument>>, noise: Option<Box<NoiseBank>> },
    SetLayerEnabled { part: u16, layer: u16, enabled: bool },
    SetLayerGain { part: u16, layer: u16, gain_db: f32 },
    /// Organ couplers: keys pressed on `part` also play the parts its routes name (octave
    /// shifted for sub/super couplers). Not transitive; a pipe reached from two keyboards (or
    /// two keys) sounds once.
    SetCouplers { part: u16, couplers: Couplers },
    /// (internal) start a layer's voice after its speech delay, if the key that pressed it
    /// (`press`) is still down
    StartVoice { part: u16, layer: u16, note: u8, velocity: u8, press: u32 },
    AllNotesOff { part: Option<u16> },
    AllSoundOff,
}

impl Command {
    pub fn set_instrument(part: u16, instrument: Instrument) -> Command {
        Command::SetInstrument { part, instrument: Box::new(instrument), noise: None }
    }

    pub fn add_layer(part: u16, layer: InstLayer) -> Command {
        Command::AddLayer { part, layer: Box::new(layer), spare: None, noise: None }
    }
}

/// No NaN or infinity in `x` (one multiply-add per sample; vectorises).
#[inline]
fn all_finite(x: &[f32]) -> bool {
    x.iter().fold(0.0f32, |a, &v| a + v * 0.0) == 0.0
}

/// Seed of a part's noise bank.
fn noise_seed(part: u16) -> u64 {
    0xB00 + part as u64
}

pub struct Event {
    /// Absolute engine frame; 0 (or any past time) = as soon as possible.
    pub time: u64,
    pub cmd: Command,
}

struct Pending {
    time: u64,
    seq: u64,
    cmd: Command,
    /// scheduled by the engine itself (speech delays), not sent by the controller
    internal: bool,
}

/// Room in the event heap for the engine's own scheduled events, beyond the controller's.
const INTERNAL_CAPACITY: usize = 4096;

impl PartialEq for Pending {
    fn eq(&self, o: &Self) -> bool {
        self.time == o.time && self.seq == o.seq
    }
}
impl Eq for Pending {}
impl PartialOrd for Pending {
    fn partial_cmp(&self, o: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(o))
    }
}
impl Ord for Pending {
    // reversed: BinaryHeap is a max-heap, we want the earliest event first
    fn cmp(&self, o: &Self) -> std::cmp::Ordering {
        o.time.cmp(&self.time).then(o.seq.cmp(&self.seq))
    }
}

/// Things the audio thread hands back for deallocation on the API thread.
#[allow(dead_code)] // only ever dropped
pub enum Garbage {
    Instrument(Box<Instrument>),
    Layer(Box<InstLayer>),
    /// A voice's model reference: possibly the last one of a replaced or unloaded model.
    Model(Arc<Model>),
    Noise(Box<NoiseBank>),
}

const GARBAGE_CAPACITY: usize = 4096;

/// Hand `g` to the API thread for deallocation. Only if the ring is full (nothing collected
/// it for thousands of items) is it dropped here.
fn trash(q: &mut rtrb::Producer<Garbage>, g: Garbage) {
    let _ = q.push(g);
}

/// Shared, lock-free status published by the engine.
#[derive(Default)]
pub struct Status {
    pub frames: AtomicU64,
    pub active_voices: AtomicU32,
    pub peak_milli: AtomicU32,
    pub load_permille: AtomicU32,
    /// Events sent but not yet applied (queued or waiting for their time).
    pub pending_events: AtomicUsize,
    /// Set by the API: the overload guard watches the render time of every buffer (only while
    /// rendering in real time; see [`Engine::set_overload_guard`]).
    pub guard_armed: AtomicBool,
    /// Published by the engine: the guard is shedding load now, and what it has done so far.
    pub guard_active: AtomicBool,
    pub guard_voices_shed: AtomicU64,
    pub guard_partials_reduced: AtomicU64,
}

// ── controller (API side) ────────────────────────────────────────────────────

pub struct Controller {
    tx: rtrb::Producer<Event>,
    garbage: rtrb::Consumer<Garbage>,
    pub status: Arc<Status>,
    pub sample_rate: f32,
    /// Parts (bit mask) a noise bank has been sent to.
    noise_sent: u32,
}

impl Controller {
    /// Queue `cmd` for engine frame `time` (0 or a past frame: as soon as possible). Fails,
    /// without queueing, when QUEUE_CAPACITY events are already waiting: an event is never
    /// applied before its time.
    pub fn send(&mut self, time: u64, mut cmd: Command) -> Result<(), String> {
        self.collect_garbage();
        if self.queue_free() == 0 {
            return Err(format!("supersynth command queue is full ({QUEUE_CAPACITY} events waiting)"));
        }
        self.prepare(&mut cmd);
        let bank_for = match &cmd {
            Command::SetInstrument { part, noise: Some(_), .. } | Command::AddLayer { part, noise: Some(_), .. } => Some(*part),
            _ => None,
        };
        // counted before it is pushed, so the engine never decrements below zero
        self.status.pending_events.fetch_add(1, Ordering::AcqRel);
        if self.tx.push(Event { time, cmd }).is_err() {
            self.status.pending_events.fetch_sub(1, Ordering::AcqRel);
            return Err("supersynth command queue is full".to_string());
        }
        if let Some(p) = bank_for.filter(|&p| (p as usize) < MAX_PARTS) {
            self.noise_sent |= 1 << p;
        }
        Ok(())
    }

    /// Build what a command needs on the audio thread (noise banks, room for layers) here, on
    /// the calling thread: the audio thread must not allocate.
    fn prepare(&self, cmd: &mut Command) {
        let sr = self.sample_rate;
        let bank = |edges: &[f32], part: u16| (edges.len() >= 2).then(|| Box::new(NoiseBank::new(sr, edges, noise_seed(part))));
        match cmd {
            Command::SetInstrument { part, instrument, noise } if noise.is_none() => {
                *noise = instrument.layers.first().and_then(|l| bank(&l.model.noise_edges, *part));
            }
            Command::AddLayer { part, layer, spare, noise } => {
                if spare.is_none() {
                    *spare = Some(Box::new(Instrument { layers: Vec::with_capacity(MAX_LAYERS) }));
                }
                // a part keeps the noise bank it has, so only its first one is ever used
                // (building one takes about a millisecond)
                let has_bank = (*part as usize) < MAX_PARTS && self.noise_sent & (1 << *part) != 0;
                if noise.is_none() && !has_bank {
                    *noise = bank(&layer.model.noise_edges, *part);
                }
            }
            _ => {}
        }
    }

    pub fn collect_garbage(&mut self) {
        while let Ok(g) = self.garbage.pop() {
            drop(g);
        }
    }

    pub fn now(&self) -> u64 {
        self.status.frames.load(Ordering::Relaxed)
    }

    /// Events that can still be sent (sent events count until they have been applied).
    pub fn queue_free(&self) -> usize {
        QUEUE_CAPACITY.saturating_sub(self.status.pending_events.load(Ordering::Acquire))
    }
}

// ── parts ────────────────────────────────────────────────────────────────────

struct Part {
    inst: Option<Box<Instrument>>,
    sp: SpectralParams,
    volume_db: f32,
    pan: f32,
    reverb_send: f32,
    transpose: f32,
    tune_cents: f32,
    bend_range: f32,
    bend: f32,
    mod_wheel: f32,
    mod_depth_cents: f32,
    expression: f32,
    expression_smoothed: f32,
    /// Enclosed division: CC11 drives swell shutters (broadband + high-shelf damping, never
    /// silent) instead of a plain volume control.
    swell_box: bool,
    swell_shelf: [crate::dsp::biquad::Biquad; 2],
    swell_shelf_db: f32,
    sustain: bool,
    held: [bool; 128],
    /// Organ couplers: what this part's keys play, and the keys held down on this part as a
    /// keyboard (velocity, 0 = up).
    couplers: Couplers,
    keys: [u8; 128],
    /// note-on count per note: a delayed voice start belongs to the press that scheduled it
    press: [u32; 128],
    /// swell box fully closed: broadband level and treble shelf (dB)
    swell_closed_db: f32,
    swell_shelf_max_db: f32,
    pedal_hold: [bool; 128],
    last_velocity: [u8; 128],
    eq: Equalizer,
    eq_params: EqParams,
    chorus: Chorus,
    chorus_params: ChorusParams,
    chorus_on: bool,
    drive: Drive,
    drive_params: (f32, f32, f32, f32),
    drive_on: bool,
    leslie: Leslie,
    leslie_on: bool,
    noise: Option<Box<NoiseBank>>,
    mono: bool,
    legato: bool,
    glide: f32,
    /// part-wide wind/tremulant modulation: amplitude depth (dB), pitch depth (cents), rate
    trem_db: f32,
    trem_cents: f32,
    trem_rate: f32,
    trem_phase: f32,
    /// Shared wind supply (organ division): sensitivity, slow demand average, and the
    /// regulator's pressure deviation (damped oscillator state).
    wind: f32,
    wind_avg: f32,
    wind_p: f32,
    wind_v: f32,
    gain_smoothed: f32,
    /// reverb send level reached at the end of the last block (ramped like the gain)
    send_smoothed: f32,
}

impl Part {
    fn new(sr: f32) -> Self {
        Self {
            inst: None,
            sp: SpectralParams::default(),
            volume_db: 0.0,
            pan: 0.0,
            reverb_send: -1.0,
            transpose: 0.0,
            tune_cents: 0.0,
            bend_range: 2.0,
            bend: 0.0,
            mod_wheel: 0.0,
            mod_depth_cents: 25.0,
            expression: 1.0,
            expression_smoothed: 1.0,
            swell_box: false,
            swell_shelf: [crate::dsp::biquad::Biquad::new(crate::dsp::biquad::Coeffs::high_shelf(700.0, 0.0, 48000.0)); 2],
            swell_shelf_db: 0.0,
            sustain: false,
            held: [false; 128],
            couplers: Couplers::default(),
            keys: [0; 128],
            press: [0; 128],
            swell_closed_db: -9.0,
            swell_shelf_max_db: -14.0,
            pedal_hold: [false; 128],
            last_velocity: [0; 128],
            eq: Equalizer::new(sr),
            eq_params: EqParams::default(),
            chorus: Chorus::new(sr),
            chorus_params: ChorusParams { rate_hz: 0.6, depth_ms: 3.0, delay_ms: 12.0, mix: 0.0, feedback: 0.0, width: 1.0 },
            chorus_on: false,
            drive: Drive::new(sr),
            drive_params: (1.0, 0.1, 6000.0, 0.8),
            drive_on: false,
            leslie: Leslie::new(sr),
            leslie_on: false,
            noise: None,
            mono: false,
            legato: false,
            glide: 0.06,
            trem_db: 0.0,
            trem_cents: 0.0,
            trem_rate: 6.0,
            trem_phase: 0.0,
            wind: 0.0,
            wind_avg: 0.0,
            wind_p: 0.0,
            wind_v: 0.0,
            gain_smoothed: 1.0,
            send_smoothed: 0.0,
        }
    }

    /// Clear every signal state of the part (effects, noise, smoothers) after a non-finite
    /// output; its settings stay.
    fn reset_state(&mut self) {
        self.eq.reset();
        self.chorus.reset();
        self.drive.reset();
        self.leslie.reset();
        for f in self.swell_shelf.iter_mut() {
            f.reset();
        }
        if let Some(nb) = self.noise.as_mut() {
            nb.reset();
        }
        self.expression_smoothed = self.expression;
        self.gain_smoothed = db_to_amp(self.volume_db);
        self.send_smoothed = self.reverb_send();
        self.trem_phase = 0.0;
        self.wind_avg = 0.0;
        self.wind_p = 0.0;
        self.wind_v = 0.0;
    }

    fn reverb_send(&self) -> f32 {
        if self.reverb_send >= 0.0 {
            return self.reverb_send;
        }
        self.inst
            .as_ref()
            .and_then(|i| i.layers.first())
            .map(|l| l.model.params.reverb_send)
            .unwrap_or(0.2)
    }
}

// ── engine ───────────────────────────────────────────────────────────────────

pub struct EngineConfig {
    pub sample_rate: f32,
    pub max_voices: usize,
    pub reverb: ReverbParams,
    /// Threads rendering (the rendering thread included): 1 renders on the calling thread
    /// alone. The output is identical for any number.
    pub threads: usize,
}

/// Default for [`EngineConfig::max_voices`].
pub const DEFAULT_MAX_VOICES: usize = 1024;

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            sample_rate: 48000.0,
            max_voices: DEFAULT_MAX_VOICES,
            reverb: ReverbParams::preset("hall").expect("hall preset"),
            threads: 1,
        }
    }
}

/// Threads to render with by default: one per core but one (left to the system and the
/// application), at least 1 and at most 8.
pub fn default_threads() -> usize {
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);
    cores.saturating_sub(1).clamp(1, 8)
}

pub struct Engine {
    sr: f32,
    rx: rtrb::Consumer<Event>,
    garbage: rtrb::Producer<Garbage>,
    status: Arc<Status>,
    heap: BinaryHeap<Pending>,
    /// engine-scheduled events in `heap`
    internal_pending: usize,
    seq: u64,
    now: u64,
    parts: Vec<Part>,
    voices: Vec<SpectralVoice>,
    max_voices: usize,
    /// voices restarted in place because every slot was busy (and how many of them were still
    /// sounding rather than fading out)
    hard_steals: u64,
    hard_steals_sounding: u64,
    /// times a non-finite signal was silenced and its source reset
    recoveries: u64,
    age: u64,
    rng: Rng,
    reverb: Reverb,
    reverb_return_db: f32,
    limiter: Limiter,
    master_db: f32,
    master_gain_smoothed: f32,
    /// reverb return gain reached at the end of the last block
    return_smoothed: f32,
    peak: f32,
    // scratch
    send_l: Box<[f32; BLOCK]>,
    send_r: Box<[f32; BLOCK]>,
    mix_l: Box<[f32; BLOCK]>,
    mix_r: Box<[f32; BLOCK]>,
    /// the rendering threads, and each one's voice scratch memory
    pool: Pool,
    scratch: Vec<Box<VoiceScratch>>,
    /// per voice slot: its output in the current block, and where in the block it starts
    /// (a pipe whose speech delay ends inside the block)
    vbuf: Vec<[[f32; BLOCK]; 2]>,
    voff: Vec<u8>,
    /// per voice slot: its recorded attack transient in the current block, if it played (kept
    /// apart so that the part adds transient and partials in the same order as one voice
    /// rendering into the part directly)
    vtr: Vec<[[f32; BLOCK]; 2]>,
    vtr_on: Vec<bool>,
    /// offset given to voices started now (see `render_planar`)
    start_offset: usize,
    /// Opt-in release culling (see [`MasterParam::ReleaseFloor`]): absolute floor (dBFS, −200
    /// = off), distance below the part's and the master output level (dB, 0 = off), how those
    /// levels are followed (0 smoothed, 1 peak hold), the levels (dBFS; master last) with
    /// their hold timers (s), and voices retired so far.
    release_floor_db: f32,
    below_mix_db: f32,
    release_hold: bool,
    level_db: [f32; MAX_PARTS + 1],
    level_pow: [f32; MAX_PARTS + 1],
    level_held_s: [f32; MAX_PARTS + 1],
    pub culled: u64,
    /// free voice slots, highest first (rebuilt after every block: voices end while rendering)
    free: Vec<u32>,
    /// split blocks at engine-scheduled starts too, as earlier versions did (for comparisons:
    /// `SUPERSYNTH_SPLIT_STARTS=1`)
    split_starts: bool,
    /// active voices grouped by part, and each part's range of them (see `collect_voices`)
    order: Vec<u32>,
    part_range: [(u32, u32); MAX_PARTS],
    /// parts rendering this block, their block parameters, output (left, right, send left,
    /// send right) and non-finite flag
    active_parts: Vec<u8>,
    part_sp: [SpectralParams; MAX_PARTS],
    part_md: [BlockMod; MAX_PARTS],
    pout: Vec<[[f32; BLOCK]; 4]>,
    recover: Vec<bool>,
    guard: Guard,
}

// ── overload guard ───────────────────────────────────────────────────────────

/// Smoothed load (render time / buffer duration) above which the guard engages…
const GUARD_ENGAGE: f32 = 0.85;
/// …the load it sheds down to while engaged…
const GUARD_TARGET: f32 = 0.7;
/// …and below which it lets go, once it has been calm for `GUARD_CALM_S` and engaged for at
/// least `GUARD_HOLD_S`.
const GUARD_RELEASE: f32 = 0.5;
const GUARD_CALM_S: f32 = 0.5;
const GUARD_HOLD_S: f32 = 1.0;
/// An overrun counts at once, but only on an engine that is busy anyway (an isolated stall of a
/// lightly loaded engine is the system's, and shedding would not help).
const GUARD_OVERRUN_BUSY: f32 = 0.5;
/// Time constants of the load followers: the slow one decides when to engage and release, the
/// fast one how much to shed.
const GUARD_SLOW_S: f32 = 0.1;
const GUARD_FAST_S: f32 = 0.012;
/// Youngest note the guard touches: a released note younger than this is still its attack.
const GUARD_SHED_MIN_S: f32 = 0.1;
/// Last resort, partials: only notes past their attack, at most every `GUARD_THIN_EVERY_S`,
/// each by a quarter of its partials, never below a quarter of them (and 8).
const GUARD_THIN_MIN_S: f32 = 0.3;
const GUARD_THIN_EVERY_S: f32 = 0.03;
/// Share of a voice's cost one thinning step is reckoned to save.
const GUARD_THIN_SAVES: f32 = 0.15;

/// Opt-in overload guard (see [`Engine::set_overload_guard`]).
struct Guard {
    /// was armed for the last buffer
    armed: bool,
    /// the last buffer: load and duration (s)
    last: f32,
    last_dur: f32,
    slow: f32,
    fast: f32,
    /// load of one voice (smoothed)
    per_voice: f32,
    engaged: bool,
    engaged_s: f32,
    calm_s: f32,
    thin_wait_s: f32,
    voices_shed: u64,
    partials_reduced: u64,
    /// candidates (level, slot), room for every slot
    cand: Vec<(f32, u32)>,
    /// tests: the load to act on instead of the measured one
    force: Option<(f32, f32)>,
    /// benchmarks: act as on a machine this many times slower (`SUPERSYNTH_GUARD_SLOWDOWN`)
    slowdown: f32,
}

impl Guard {
    fn new(slots: usize) -> Self {
        Guard {
            armed: false,
            last: 0.0,
            last_dur: 0.0,
            slow: 0.0,
            fast: 0.0,
            per_voice: 0.0,
            engaged: false,
            engaged_s: 0.0,
            calm_s: 0.0,
            thin_wait_s: 0.0,
            voices_shed: 0,
            partials_reduced: 0,
            cand: Vec::with_capacity(slots),
            force: None,
            slowdown: std::env::var("SUPERSYNTH_GUARD_SLOWDOWN").ok().and_then(|s| s.parse::<f32>().ok()).filter(|x| x.is_finite() && *x > 0.0).unwrap_or(1.0),
        }
    }

    /// Follow the load of a buffer just rendered (`voices` sounding after it).
    fn observe(&mut self, load: f32, dur: f32, voices: usize) {
        let load = self.force.map_or(load * self.slowdown, |(fixed, per_voice)| fixed + per_voice * voices as f32);
        if !load.is_finite() || dur <= 0.0 {
            return;
        }
        self.last = load;
        self.last_dur = dur;
        let a_slow = 1.0 - (-dur / GUARD_SLOW_S).exp();
        self.slow += (load - self.slow) * a_slow;
        self.fast += (load - self.fast) * (1.0 - (-dur / GUARD_FAST_S).exp());
        if voices > 0 {
            let pv = load / voices as f32;
            self.per_voice = if self.per_voice > 0.0 { self.per_voice + (pv - self.per_voice) * a_slow } else { pv };
        }
    }

    fn reset_measurements(&mut self) {
        self.last = 0.0;
        self.last_dur = 0.0;
        self.slow = 0.0;
        self.fast = 0.0;
        self.per_voice = 0.0;
        self.engaged_s = 0.0;
        self.calm_s = 0.0;
        self.thin_wait_s = 0.0;
    }
}

impl Engine {
    pub fn new(cfg: EngineConfig) -> (Engine, Controller) {
        let (tx, rx) = rtrb::RingBuffer::new(QUEUE_CAPACITY);
        let (gtx, grx) = rtrb::RingBuffer::new(GARBAGE_CAPACITY);
        let status = Arc::new(Status::default());
        let sr = cfg.sample_rate;
        let mut parts = Vec::with_capacity(MAX_PARTS);
        for _ in 0..MAX_PARTS {
            parts.push(Part::new(sr));
        }
        crate::dsp::simd::init();
        let slots = cfg.max_voices + 32;
        let mut voices = Vec::with_capacity(slots);
        for _ in 0..slots {
            voices.push(SpectralVoice::default());
        }
        let pool = Pool::new(cfg.threads);
        let scratch = (0..pool.threads()).map(|_| VoiceScratch::boxed()).collect();
        let mut limiter = Limiter::new(sr);
        limiter.set_ceiling_db(-0.3);
        let engine = Engine {
            sr,
            rx,
            garbage: gtx,
            status: Arc::clone(&status),
            heap: BinaryHeap::with_capacity(QUEUE_CAPACITY + INTERNAL_CAPACITY),
            internal_pending: 0,
            seq: 0,
            now: 0,
            parts,
            voices,
            max_voices: cfg.max_voices,
            hard_steals: 0,
            hard_steals_sounding: 0,
            recoveries: 0,
            age: 0,
            rng: Rng::new(0x5EED_CAFE),
            reverb: Reverb::new(sr, cfg.reverb),
            reverb_return_db: 0.0,
            limiter,
            master_db: -6.0,
            master_gain_smoothed: db_to_amp(-6.0),
            return_smoothed: 1.0,
            peak: 0.0,
            send_l: Box::new([0.0; BLOCK]),
            send_r: Box::new([0.0; BLOCK]),
            mix_l: Box::new([0.0; BLOCK]),
            mix_r: Box::new([0.0; BLOCK]),
            pool,
            scratch,
            vbuf: vec![[[0.0; BLOCK]; 2]; slots],
            voff: vec![0; slots],
            vtr: vec![[[0.0; BLOCK]; 2]; slots],
            vtr_on: vec![false; slots],
            start_offset: 0,
            release_floor_db: -200.0,
            below_mix_db: 0.0,
            release_hold: false,
            level_db: [-200.0; MAX_PARTS + 1],
            level_pow: [0.0; MAX_PARTS + 1],
            level_held_s: [0.0; MAX_PARTS + 1],
            culled: 0,
            free: (0..slots as u32).rev().collect(),
            split_starts: std::env::var_os("SUPERSYNTH_SPLIT_STARTS").is_some_and(|v| v == "1"),
            order: Vec::with_capacity(slots),
            part_range: [(0, 0); MAX_PARTS],
            active_parts: Vec::with_capacity(MAX_PARTS),
            part_sp: [SpectralParams::default(); MAX_PARTS],
            part_md: [BlockMod::default(); MAX_PARTS],
            pout: vec![[[0.0; BLOCK]; 4]; MAX_PARTS],
            recover: vec![false; MAX_PARTS],
            guard: Guard::new(slots),
        };
        let ctl = Controller { tx, garbage: grx, status, sample_rate: sr, noise_sent: 0 };
        (engine, ctl)
    }

    pub fn sample_rate(&self) -> f32 {
        self.sr
    }

    /// Threads rendering (the rendering thread included).
    pub fn threads(&self) -> usize {
        self.pool.threads()
    }

    /// Real-time scheduling for the worker threads (while playing to an audio device), if the
    /// system allows it.
    pub fn set_realtime(&self, on: bool) {
        self.pool.set_realtime(on);
    }

    pub fn now(&self) -> u64 {
        self.now
    }

    /// Arm or disarm the opt-in overload guard (the same as storing `Status::guard_armed`).
    ///
    /// Armed, the engine measures the wall-clock time each call to `process_*` takes against
    /// the duration of the audio it renders: arm it only while those calls are real-time
    /// buffers (an audio callback). When the smoothed load passes 85 % (or a buffer overran on
    /// an engine above 50 %), it sheds load until the next buffers fit in 70 %: first it ends
    /// the quietest released notes (never a held note, nor one in its first 100 ms) with a
    /// 10 ms fade, as many as the measured cost per voice says are needed; only when no
    /// released note is left does it fade out the upper partials of the quietest notes past
    /// their attack. It lets go (and fades the partials back in) once the load has stayed under
    /// 50 % for 0.5 s, at least 1 s after engaging. While nothing is overloaded it changes
    /// nothing: the output is bit-identical to an engine without it.
    pub fn set_overload_guard(&self, on: bool) {
        self.status.guard_armed.store(on, Ordering::Relaxed);
    }
    /// Tests: act on the load `fixed + per_voice × voices sounding` instead of the measured one.
    /// Tests: act on this load (render time / buffer duration) instead of the measured one.
    #[doc(hidden)]
    pub fn force_guard_load(&mut self, load: Option<(f32, f32)>) {
        self.guard.force = load;
    }

    /// Whether the guard is shedding load now; voices it has ended and partials it has faded
    /// out so far.
    pub fn guard_stats(&self) -> (bool, u64, u64) {
        (self.guard.engaged, self.guard.voices_shed, self.guard.partials_reduced)
    }

    pub fn active_voices(&self) -> usize {
        self.voices.iter().filter(|v| v.is_active()).count()
    }

    // ── public render entry points ──────────────────────────────────────────

    /// Fill an interleaved buffer with `channels` channels (1 = mono downmix).
    pub fn process_interleaved(&mut self, out: &mut [f32], channels: usize) {
        let _ftz = FlushDenormals::new();
        let channels = channels.max(1);
        let frames = out.len() / channels;
        let mut done = 0;
        let mut l = [0.0f32; BLOCK];
        let mut r = [0.0f32; BLOCK];
        while done < frames {
            let n = (frames - done).min(BLOCK);
            self.render_planar(&mut l[..n], &mut r[..n]);
            for i in 0..n {
                let o = &mut out[(done + i) * channels..(done + i + 1) * channels];
                match channels {
                    1 => o[0] = 0.5 * (l[i] + r[i]),
                    _ => {
                        o[0] = l[i];
                        o[1] = r[i];
                        for x in o.iter_mut().skip(2) {
                            *x = 0.0;
                        }
                    }
                }
            }
            done += n;
        }
    }

    /// Render planar stereo (any length), splitting at event boundaries. Denormals are flushed
    /// to zero while rendering; the calling thread's floating-point mode is restored after.
    pub fn process_planar(&mut self, left: &mut [f32], right: &mut [f32]) {
        let _ftz = FlushDenormals::new();
        self.render_planar(left, right);
    }

    /// `process_planar` without switching the denormal mode (the caller has).
    fn render_planar(&mut self, left: &mut [f32], right: &mut [f32]) {
        let start = std::time::Instant::now();
        self.pool.set_hot(true);
        self.drain_queue();
        self.guard_step();
        let frames = left.len();
        let mut i = 0;
        while i < frames {
            // apply all events due now
            while let Some(top) = self.heap.peek() {
                if top.time <= self.now {
                    let ev = self.heap.pop().unwrap();
                    if ev.internal {
                        self.internal_pending -= 1;
                    } else {
                        self.status.pending_events.fetch_sub(1, Ordering::AcqRel);
                    }
                    self.apply(ev.cmd);
                } else {
                    break;
                }
            }
            let mut n = (frames - i).min(BLOCK);
            // The block ends at the next event, except for pipes the engine itself scheduled
            // (speech delays): those start inside the block, at their exact sample, and the
            // block goes on for every other voice. (Ending the block there would split it for
            // every sounding voice: one organ chord starts hundreds of pipes within ~10 ms.)
            while let Some(top) = self.heap.peek() {
                let until = (top.time - self.now) as usize;
                if until >= n {
                    break;
                }
                if !top.internal || self.split_starts {
                    n = until.max(1);
                    break;
                }
                let ev = self.heap.pop().unwrap();
                self.internal_pending -= 1;
                self.start_offset = until;
                self.apply(ev.cmd);
                self.start_offset = 0;
            }
            self.render_block(&mut left[i..i + n], &mut right[i..i + n]);
            self.now += n as u64;
            i += n;
        }
        self.pool.set_hot(false);
        self.reclaim_models();
        self.publish(start.elapsed().as_secs_f32(), frames);
    }

    fn publish(&mut self, secs: f32, frames: usize) {
        let st = &self.status;
        st.frames.store(self.now, Ordering::Relaxed);
        st.active_voices.store(self.voices.iter().filter(|v| v.is_active()).count() as u32, Ordering::Relaxed);
        st.peak_milli.store((self.peak * 1000.0) as u32, Ordering::Relaxed);
        if frames > 0 {
            let load = secs / (frames as f32 / self.sr);
            st.load_permille.store((load * 1000.0) as u32, Ordering::Relaxed);
            if self.guard.armed {
                let voices = st.active_voices.load(Ordering::Relaxed) as usize;
                self.guard.observe(load, frames as f32 / self.sr, voices);
            }
        }
        self.peak *= 0.5;
    }

    // ── overload guard ──────────────────────────────────────────────────────

    /// Before a buffer: shed load if the last buffers were too slow (see
    /// [`set_overload_guard`](Self::set_overload_guard)). Only reads, unless overloaded.
    fn guard_step(&mut self) {
        let armed = self.status.guard_armed.load(Ordering::Relaxed);
        if armed != self.guard.armed {
            self.guard.armed = armed;
            // measurements start afresh (offline renders in between are not real-time buffers)
            self.guard.reset_measurements();
            if !armed && self.guard.engaged {
                self.guard_let_go();
            }
        }
        if !armed || self.guard.last_dur <= 0.0 {
            return;
        }
        let g = &mut self.guard;
        let dur = g.last_dur;
        let overrun = g.last > 1.0 && g.slow > GUARD_OVERRUN_BUSY;
        if !g.engaged {
            if g.slow <= GUARD_ENGAGE && !overrun {
                return;
            }
            g.engaged = true;
            g.engaged_s = 0.0;
            g.calm_s = 0.0;
            self.status.guard_active.store(true, Ordering::Relaxed);
        } else {
            g.engaged_s += dur;
            g.calm_s = if g.slow < GUARD_RELEASE { g.calm_s + dur } else { 0.0 };
            if g.engaged_s >= GUARD_HOLD_S && g.calm_s >= GUARD_CALM_S {
                self.guard_let_go();
                return;
            }
        }
        g.thin_wait_s -= dur;
        // (how much: the fast follower, which an overrun has raised; the overrun itself may be a
        // stall of the system rather than the engine's work)
        let load = g.fast;
        let excess = load - GUARD_TARGET;
        if excess <= 0.0 || g.per_voice <= 0.0 {
            return;
        }
        // voices to end for the load to fit, less those already fading out
        let need = (excess / g.per_voice).ceil().min(self.voices.len() as f32) as usize;
        let fading = self.voices.iter().filter(|v| v.is_killing()).count();
        let todo = need.saturating_sub(fading);
        if todo == 0 {
            return;
        }
        let shed = self.guard_shed(todo);
        if shed < todo && self.guard.thin_wait_s <= 0.0 {
            self.guard_thin((todo - shed) as f32);
        }
        let st = &self.status;
        st.guard_voices_shed.store(self.guard.voices_shed, Ordering::Relaxed);
        st.guard_partials_reduced.store(self.guard.partials_reduced, Ordering::Relaxed);
    }

    /// End up to `count` of the quietest released voices (past their attack) with a short fade.
    /// Returns how many.
    fn guard_shed(&mut self, count: usize) -> usize {
        let cand = &mut self.guard.cand;
        cand.clear();
        for (i, v) in self.voices.iter().enumerate() {
            if v.is_active() && v.is_released() && !v.is_killing() && v.time_s() >= GUARD_SHED_MIN_S {
                cand.push((v.output_level_db() + self.parts[v.part].volume_db, i as u32));
            }
        }
        let n = count.min(cand.len());
        if n == 0 {
            return 0;
        }
        if n < cand.len() {
            cand.select_nth_unstable_by(n - 1, |a, b| a.0.total_cmp(&b.0));
        }
        for &(_, i) in &cand[..n] {
            self.voices[i as usize].shed();
        }
        self.guard.voices_shed += n as u64;
        n
    }

    /// Last resort: fade out a quarter of the partials of the quietest voices past their
    /// attack, enough of them to save about `voices` voices' worth of rendering.
    fn guard_thin(&mut self, voices: f32) {
        let cand = &mut self.guard.cand;
        cand.clear();
        for (i, v) in self.voices.iter().enumerate() {
            let k = v.partials() as f32;
            let floor = (k / 4.0).max(8.0);
            if v.is_active() && !v.is_killing() && v.time_s() >= GUARD_THIN_MIN_S && !v.plays_transient() && v.partial_cap().min(k) > floor {
                cand.push((v.output_level_db() + self.parts[v.part].volume_db, i as u32));
            }
        }
        let n = ((voices / GUARD_THIN_SAVES).ceil() as usize).min(cand.len());
        if n == 0 {
            return;
        }
        if n < cand.len() {
            cand.select_nth_unstable_by(n - 1, |a, b| a.0.total_cmp(&b.0));
        }
        for &(_, i) in &cand[..n] {
            let v = &mut self.voices[i as usize];
            let k = v.partials() as f32;
            let cur = v.partial_cap().min(k);
            let to = (cur * 0.75).floor().max((k / 4.0).max(8.0));
            v.set_partial_cap(to);
            self.guard.partials_reduced += (cur - to).max(0.0) as u64;
        }
        self.guard.thin_wait_s = GUARD_THIN_EVERY_S;
    }

    /// Disengage: every voice gets its partials back (faded in).
    fn guard_let_go(&mut self) {
        self.guard.engaged = false;
        self.guard.engaged_s = 0.0;
        self.guard.calm_s = 0.0;
        for v in self.voices.iter_mut() {
            if v.partial_cap() != f32::INFINITY {
                v.set_partial_cap(f32::INFINITY);
            }
        }
        self.status.guard_active.store(false, Ordering::Relaxed);
    }

    fn drain_queue(&mut self) {
        // The controller admits at most QUEUE_CAPACITY unapplied events and the engine schedules
        // at most INTERNAL_CAPACITY of its own, so the heap (with room for both reserved) never
        // grows here; should it be full, events wait in the ring rather than being applied
        // before their time.
        while self.heap.len() < QUEUE_CAPACITY + INTERNAL_CAPACITY {
            let Ok(ev) = self.rx.pop() else { break };
            self.seq += 1;
            self.heap.push(Pending { time: ev.time, seq: self.seq, cmd: ev.cmd, internal: false });
        }
    }

    // ── command handling ────────────────────────────────────────────────────

    fn apply(&mut self, cmd: Command) {
        match cmd {
            Command::NoteOn { part, note, velocity } => {
                if velocity == 0 {
                    self.key_off(part as usize, note);
                } else {
                    self.key_on(part as usize, note, velocity);
                }
            }
            Command::NoteOff { part, note } => self.key_off(part as usize, note),
            Command::SetCouplers { part, couplers } => self.set_couplers(part as usize, couplers),
            Command::StartVoice { part, layer, note, velocity, press } => {
                let pi = part as usize;
                if let Some(p) = self.parts.get(pi) {
                    let n = note as usize;
                    if p.press[n] == press && (p.held[n] || p.pedal_hold[n]) {
                        self.start_voice_now(pi, layer as usize, note, velocity, false);
                    }
                }
            }
            Command::ControlChange { part, controller, value } => self.cc(part as usize, controller, value),
            Command::PitchBend { part, value } => {
                if let Some(p) = self.parts.get_mut(part as usize) {
                    // (`clamp` passes NaN through, which would silence the part's voices)
                    if value.is_finite() {
                        p.bend = value.clamp(-1.0, 1.0);
                    }
                }
            }
            Command::SetPartParam { part, param, value } => self.set_part_param(part as usize, param, value),
            Command::SetMasterParam { param, value } => self.set_master_param(param, value),
            Command::SetInstrument { part, mut instrument, noise } => {
                let pi = part as usize;
                let q = &mut self.garbage;
                if pi >= self.parts.len() {
                    trash(q, Garbage::Instrument(instrument));
                    if let Some(nb) = noise {
                        trash(q, Garbage::Noise(nb));
                    }
                    return;
                }
                for v in self.voices.iter_mut() {
                    if v.is_active() && v.part == pi {
                        v.kill();
                    }
                }
                for l in instrument.layers.iter_mut() {
                    l.sanitize();
                }
                let p = &mut self.parts[pi];
                // Noise bank: keep the current one if the band layout is unchanged (its noise
                // continues), else switch to the one built with the command.
                if let Some(nb) = noise {
                    let same = match (&p.noise, instrument.layers.first()) {
                        (Some(cur), Some(l)) => cur.edges() == l.model.noise_edges.as_slice(),
                        _ => false,
                    };
                    if same {
                        trash(q, Garbage::Noise(nb));
                    } else if let Some(old) = p.noise.replace(nb) {
                        trash(q, Garbage::Noise(old));
                    }
                }
                if let Some(old) = p.inst.replace(instrument) {
                    trash(q, Garbage::Instrument(old));
                }
            }
            Command::AddLayer { part, layer, spare, noise } => {
                let pi = part as usize;
                let q = &mut self.garbage;
                let Some(p) = self.parts.get_mut(pi) else {
                    trash(q, Garbage::Layer(layer));
                    if let Some(s) = spare {
                        trash(q, Garbage::Instrument(s));
                    }
                    if let Some(nb) = noise {
                        trash(q, Garbage::Noise(nb));
                    }
                    return;
                };
                let enabled = layer.enabled;
                // the layer is copied in (cloning bumps the model's reference count) and its
                // box freed on the API thread
                let mut l = InstLayer::clone(&layer);
                trash(q, Garbage::Layer(layer));
                l.sanitize();
                l.enabled = false;
                let mut spare = spare;
                let added = match p.inst.as_mut() {
                    Some(inst) if inst.layers.len() < inst.layers.capacity() => {
                        inst.layers.push(l);
                        true
                    }
                    // full: move the layers into the spare instrument (preallocated by the
                    // controller), so that pushing never reallocates here
                    Some(inst) => match spare.take() {
                        Some(mut s) if s.layers.is_empty() && s.layers.capacity() > inst.layers.len() => {
                            s.layers.append(&mut inst.layers);
                            s.layers.push(l);
                            trash(q, Garbage::Instrument(std::mem::replace(inst, s)));
                            true
                        }
                        other => {
                            spare = other;
                            false
                        }
                    },
                    None => match spare.take() {
                        Some(mut s) if s.layers.is_empty() && s.layers.capacity() > 0 => {
                            s.layers.push(l);
                            p.inst = Some(s);
                            true
                        }
                        other => {
                            spare = other;
                            false
                        }
                    },
                };
                if let Some(s) = spare {
                    trash(q, Garbage::Instrument(s));
                }
                match noise {
                    Some(nb) if added && p.noise.is_none() => p.noise = Some(nb),
                    Some(nb) => trash(q, Garbage::Noise(nb)),
                    None => {}
                }
                if added && enabled {
                    let li = p.inst.as_ref().map(|i| i.layers.len() - 1).unwrap_or(0);
                    self.set_layer_enabled(pi, li, true);
                }
            }
            Command::SetLayerEnabled { part, layer, enabled } => self.set_layer_enabled(part as usize, layer as usize, enabled),
            Command::SetLayerGain { part, layer, gain_db } => {
                if let Some(inst) = self.parts.get_mut(part as usize).and_then(|p| p.inst.as_mut()) {
                    if let Some(l) = inst.layers.get_mut(layer as usize) {
                        if gain_db.is_finite() {
                            l.gain_db = gain_db.clamp(-120.0, 48.0);
                        }
                    }
                }
            }
            Command::AllNotesOff { part } => {
                for (pi, p) in self.parts.iter_mut().enumerate() {
                    if part.map(|x| x as usize == pi).unwrap_or(true) {
                        p.held = [false; 128];
                        p.keys = [0; 128];
                        p.pedal_hold = [false; 128];
                        p.sustain = false;
                    }
                }
                for v in self.voices.iter_mut() {
                    if v.is_active() && part.map(|x| x as usize == v.part).unwrap_or(true) {
                        v.release();
                    }
                }
            }
            Command::AllSoundOff => {
                for v in self.voices.iter_mut() {
                    v.kill();
                }
                for p in self.parts.iter_mut() {
                    p.held = [false; 128];
                    p.keys = [0; 128];
                    p.pedal_hold = [false; 128];
                }
            }
        }
    }

    // ── keyboards and couplers ──────────────────────────────────────────────
    //
    // A note event names the keyboard (part) whose key moved. The key plays that part and the
    // parts it is coupled to. A part's pipe sounds while any keyboard reaching it holds the key:
    // it starts with the first and stops with the last. Without couplers this is exactly a
    // note event on the part.

    /// Pipes a key on part `src` plays, as (part, shift): `src` itself first (unless its
    /// unison is off), then its couplers.
    fn reach(&self, src: usize) -> ([(usize, i8); MAX_ROUTES + 1], usize) {
        let c = &self.parts[src].couplers;
        let mut out = [(0usize, 0i8); MAX_ROUTES + 1];
        let mut n = 0;
        if !c.unison_off {
            out[0] = (src, 0);
            n = 1;
        }
        for r in &c.routes[..c.n as usize] {
            let t = r.part as usize;
            if t < self.parts.len() && !(t == src && r.shift == 0) {
                out[n] = (t, r.shift);
                n += 1;
            }
        }
        (out, n)
    }

    /// Velocity of the key holding pipe `note` of part `t` down (0: none), ignoring key
    /// `skip` (part, key).
    fn reached(&self, t: usize, note: u8, skip: Option<(usize, u8)>) -> u8 {
        let mut v = 0;
        for u in 0..self.parts.len() {
            let (r, nr) = self.reach(u);
            for &(tt, sh) in &r[..nr] {
                let k = note as i32 - sh as i32;
                if tt != t || !(0..128).contains(&k) || skip == Some((u, k as u8)) {
                    continue;
                }
                v = v.max(self.parts[u].keys[k as usize]);
            }
        }
        v
    }

    /// Every pipe of part `t` held down by some key (velocity, 0 = none).
    fn reached_all(&self, t: usize, held: &[bool; MAX_PARTS]) -> [u8; 128] {
        let mut out = [0u8; 128];
        for (u, &h) in held.iter().enumerate().take(self.parts.len()) {
            if !h {
                continue;
            }
            let (r, nr) = self.reach(u);
            for &(tt, sh) in &r[..nr] {
                if tt != t {
                    continue;
                }
                for (k, &v) in self.parts[u].keys.iter().enumerate() {
                    let n = k as i32 + sh as i32;
                    if v > 0 && (0..128).contains(&n) {
                        out[n as usize] = out[n as usize].max(v);
                    }
                }
            }
        }
        out
    }

    fn key_on(&mut self, src: usize, note: u8, velocity: u8) {
        if src >= self.parts.len() || note > 127 {
            return;
        }
        let (r, nr) = self.reach(src);
        for &(t, sh) in &r[..nr] {
            let n = note as i32 + sh as i32;
            if (0..128).contains(&n) && self.reached(t, n as u8, Some((src, note))) == 0 {
                self.note_on(t, n as u8, velocity);
            }
        }
        self.parts[src].keys[note as usize] = velocity;
        self.key_noise(src, note, velocity, false);
    }

    fn key_off(&mut self, src: usize, note: u8) {
        if src >= self.parts.len() || note > 127 {
            return;
        }
        let vel = self.parts[src].keys[note as usize];
        self.parts[src].keys[note as usize] = 0;
        let (r, nr) = self.reach(src);
        for &(t, sh) in &r[..nr] {
            let n = note as i32 + sh as i32;
            if (0..128).contains(&n) && self.reached(t, n as u8, Some((src, note))) == 0 {
                self.note_off(t, n as u8);
            }
        }
        if vel > 0 {
            self.key_noise(src, note, vel, true);
        }
    }

    /// The keyboard's own action noise for a key going down (or up: `release`).
    fn key_noise(&mut self, src: usize, note: u8, velocity: u8, release: bool) {
        let n = self.parts[src].inst.as_ref().map(|i| i.layers.len()).unwrap_or(0);
        for li in 0..n {
            let ok = self.parts[src].inst.as_ref().map(|i| i.layers[li].direct_only && i.layers[li].on_release == release).unwrap_or(false);
            if ok {
                self.start_voice_now(src, li, note, velocity, true);
            }
        }
    }

    /// Change a part's couplers. Keys held on it start or stop the newly (un)coupled pipes,
    /// as on a real organ.
    fn set_couplers(&mut self, src: usize, c: Couplers) {
        if src >= self.parts.len() {
            return;
        }
        if self.parts[src].keys.iter().all(|&v| v == 0) {
            self.parts[src].couplers = c;
            return;
        }
        let mut held = [false; MAX_PARTS];
        for (u, p) in self.parts.iter().enumerate() {
            held[u] = p.keys.iter().any(|&v| v > 0);
        }
        // parts whose pipes can change: reached from `src` before or after
        let mut tg = [usize::MAX; 2 * (MAX_ROUTES + 1)];
        let mut nt = 0;
        let (r0, n0) = self.reach(src);
        let old = self.parts[src].couplers;
        self.parts[src].couplers = c;
        let (r1, n1) = self.reach(src);
        for &(t, _) in r0[..n0].iter().chain(r1[..n1].iter()) {
            if !tg[..nt].contains(&t) {
                tg[nt] = t;
                nt += 1;
            }
        }
        for &t in &tg[..nt] {
            self.parts[src].couplers = old;
            let before = self.reached_all(t, &held);
            self.parts[src].couplers = c;
            let after = self.reached_all(t, &held);
            for n in 0..128u8 {
                let (b, a) = (before[n as usize], after[n as usize]);
                if b == 0 && a > 0 {
                    self.note_on(t, n, a);
                } else if b > 0 && a == 0 {
                    self.note_off(t, n);
                }
            }
        }
    }

    fn note_on(&mut self, pi: usize, note: u8, velocity: u8) {
        if pi >= self.parts.len() || note > 127 {
            return;
        }
        let mono = self.parts[pi].mono;
        let legato = self.parts[pi].legato;
        // legato: a held note of this part glides to the new one (per layer)
        if legato {
            let held = self.voices.iter().any(|v| v.is_active() && v.part == pi && !v.is_released());
            if held {
                {
                    let p = &mut self.parts[pi];
                    p.held[note as usize] = true;
                    p.pedal_hold[note as usize] = false;
                    p.last_velocity[note as usize] = velocity;
                    p.press[note as usize] = p.press[note as usize].wrapping_add(1);
                }
                let nlayers = self.parts[pi].inst.as_ref().map(|i| i.layers.len()).unwrap_or(0);
                for li in 0..nlayers {
                    let Some(slot) = self
                        .voices
                        .iter()
                        .position(|v| v.is_active() && v.part == pi && v.layer_id as usize == li && !v.is_released())
                    else {
                        self.start_layer_voice(pi, li, note, velocity);
                        continue;
                    };
                    self.retarget_layer_voice(slot, pi, li, note, velocity);
                }
                return;
            }
        }
        // re-striking a key: release the previous sounding instance of this note
        for v in self.voices.iter_mut() {
            if v.is_active() && v.part == pi && (v.note == note || mono) && !v.is_released() {
                v.release();
            }
        }
        {
            let p = &mut self.parts[pi];
            p.held[note as usize] = true;
            p.pedal_hold[note as usize] = false;
            p.last_velocity[note as usize] = velocity;
            p.press[note as usize] = p.press[note as usize].wrapping_add(1);
        }
        let nlayers = self.parts[pi].inst.as_ref().map(|i| i.layers.len()).unwrap_or(0);
        for li in 0..nlayers {
            self.start_layer_voice(pi, li, note, velocity);
        }
    }

    fn start_layer_voice(&mut self, pi: usize, li: usize, note: u8, velocity: u8) {
        self.start_layer_voice_t(pi, li, note, velocity, false);
    }

    /// Start the release-triggered layers of a part for a note that was just damped.
    fn trigger_release_layers(&mut self, pi: usize, note: u8) {
        let n = self.parts[pi].inst.as_ref().map(|i| i.layers.iter().filter(|l| l.on_release && !l.direct_only).count()).unwrap_or(0);
        if n == 0 {
            return;
        }
        let vel = self.parts[pi].last_velocity[note as usize].max(1);
        let nlayers = self.parts[pi].inst.as_ref().map(|i| i.layers.len()).unwrap_or(0);
        for li in 0..nlayers {
            self.start_layer_voice_t(pi, li, note, vel, true);
        }
    }

    fn start_layer_voice_t(&mut self, pi: usize, li: usize, note: u8, velocity: u8, release_trigger: bool) {
        let speech = {
            let Some(layer) = self.parts[pi].inst.as_ref().and_then(|i| i.layers.get(li)) else { return };
            if layer.direct_only || layer.on_release != release_trigger {
                return;
            }
            layer.speech_ms
        };
        // (with no room left for delayed starts, the pipe speaks at once)
        if speech > 0.0 && !release_trigger && self.internal_pending < INTERNAL_CAPACITY {
            let d = (self.rng.uniform() * speech * 1e-3 * self.sr) as u64;
            if d > 0 {
                self.seq += 1;
                self.internal_pending += 1;
                let press = self.parts[pi].press[note as usize];
                let cmd = Command::StartVoice { part: pi as u16, layer: li as u16, note, velocity, press };
                self.heap.push(Pending { time: self.now + d, seq: self.seq, cmd, internal: true });
                return;
            }
        }
        self.start_voice_now(pi, li, note, velocity, release_trigger);
    }

    /// Start a voice for layer `li` now. `one_shot` voices are not released by their key.
    fn start_voice_now(&mut self, pi: usize, li: usize, note: u8, velocity: u8, one_shot: bool) {
        let (model, pitch, pan, sp) = {
            let p = &self.parts[pi];
            let Some(inst) = p.inst.as_ref() else { return };
            let Some(layer) = inst.layers.get(li) else { return };
            if !layer.enabled || note < layer.key_lo || note > layer.key_hi {
                return;
            }
            let pitch = note as f32 + p.transpose + layer.transpose + (p.tune_cents + layer.detune_cents) / 100.0;
            let mut sp = p.sp;
            sp.gain_db += layer.gain_db;
            (Arc::clone(&layer.model), pitch, (p.pan + layer.pan).clamp(-1.0, 1.0), sp)
        };
        let slot = self.alloc_voice();
        self.age += 1;
        let age = self.age;
        let sr = self.sr;
        self.retire_model(slot, &model);
        let v = &mut self.voices[slot];
        // (set up by the thread that renders the voice first)
        v.start_deferred(NoteOn { model: &model, note, velocity, pitch, pan, params: &sp, sample_rate: sr, rng: &mut self.rng });
        if !v.is_active() {
            // (nothing to play: the slot stays free)
            self.free.push(slot as u32);
        }
        v.part = pi;
        v.layer_id = li as u32;
        v.age = age;
        v.one_shot = one_shot;
        self.voff[slot] = self.start_offset.min(BLOCK - 1) as u8;
    }

    fn retarget_layer_voice(&mut self, slot: usize, pi: usize, li: usize, note: u8, velocity: u8) {
        let (model, pitch, pan, sp, glide) = {
            let p = &self.parts[pi];
            let Some(inst) = p.inst.as_ref() else { return };
            let Some(layer) = inst.layers.get(li) else { return };
            let pitch = note as f32 + p.transpose + layer.transpose + (p.tune_cents + layer.detune_cents) / 100.0;
            let mut sp = p.sp;
            sp.gain_db += layer.gain_db;
            (Arc::clone(&layer.model), pitch, (p.pan + layer.pan).clamp(-1.0, 1.0), sp, p.glide)
        };
        let sr = self.sr;
        self.retire_model(slot, &model);
        let v = &mut self.voices[slot];
        v.legato(NoteOn { model: &model, note, velocity, pitch, pan, params: &sp, sample_rate: sr, rng: &mut self.rng }, glide);
        v.part = pi;
        v.layer_id = li as u32;
    }

    /// Before voice `slot` starts playing `next`: hand its previous model reference (if it is
    /// another model, possibly its last reference) to the API thread for dropping.
    fn retire_model(&mut self, slot: usize, next: &Arc<Model>) {
        if let Some(old) = self.voices[slot].take_model() {
            if Arc::ptr_eq(&old, next) {
                // `next` still holds the model: this only decrements the count
                drop(old);
            } else {
                trash(&mut self.garbage, Garbage::Model(old));
            }
        }
    }

    /// Finished voices give up their model references (through the garbage ring, as long as
    /// it has room; otherwise they keep them until a later block).
    fn reclaim_models(&mut self) {
        for v in self.voices.iter_mut() {
            if !v.is_active() && v.has_model() && self.garbage.slots() > 0 {
                if let Some(m) = v.take_model() {
                    trash(&mut self.garbage, Garbage::Model(m));
                }
            }
        }
    }

    /// A free voice slot. Beyond `max_voices` sounding voices, the least important one is
    /// stolen: it fades out (~25 ms) in one of the spare slots while the new note starts.
    fn alloc_voice(&mut self) -> usize {
        // voices already fading out after a steal no longer count, and are not stolen again:
        // every voice needed beyond the limit takes its own victim (counted only near the
        // limit: the slots not in the free list bound the sounding voices)
        let live = if self.voices.len() - self.free.len() < self.max_voices {
            0
        } else {
            self.voices.iter().filter(|v| v.is_active() && !v.is_killing()).count()
        };
        if live >= self.max_voices {
            // prefer released voices, then the quietest, then the oldest
            let mut best = None;
            let mut best_score = f32::INFINITY;
            for (i, v) in self.voices.iter().enumerate() {
                if !v.is_active() || v.is_killing() {
                    continue;
                }
                let score = v.level_db() - if v.is_released() { 60.0 } else { 0.0 } - (self.age - v.age) as f32 * 1e-3;
                if score < best_score {
                    best_score = score;
                    best = Some(i);
                }
            }
            if let Some(i) = best {
                self.voices[i].kill();
            }
        }
        // the lowest free slot
        while let Some(i) = self.free.pop() {
            if !self.voices[i as usize].is_active() {
                return i as usize;
            }
        }
        if let Some(i) = self.voices.iter().position(|v| !v.is_active()) {
            return i;
        }
        // Every slot busy, the spares with voices still fading out (more notes started within
        // one fade than there are spares): cut short the least audible of those. Sounding
        // voices never number more than `max_voices`, so there always is one.
        let audible = |v: &SpectralVoice| {
            let db = v.level_db() + 20.0 * v.kill_gain().max(1e-9).log10();
            if v.is_killing() {
                db
            } else {
                db + 1000.0
            }
        };
        let i = (0..self.voices.len()).min_by(|&a, &b| audible(&self.voices[a]).total_cmp(&audible(&self.voices[b]))).unwrap_or(0);
        self.hard_steals += 1;
        if !self.voices[i].is_killing() {
            self.hard_steals_sounding += 1;
        }
        i
    }

    fn note_off(&mut self, pi: usize, note: u8) {
        if pi >= self.parts.len() || note > 127 {
            return;
        }
        let p = &mut self.parts[pi];
        p.held[note as usize] = false;
        if p.sustain {
            p.pedal_hold[note as usize] = true;
            return;
        }
        let mut damped = false;
        for v in self.voices.iter_mut() {
            if v.is_active() && v.part == pi && v.note == note && !v.is_released() && v.layer_released_by_key() {
                v.release();
                damped = true;
            }
        }
        if damped {
            self.trigger_release_layers(pi, note);
        }
    }

    fn cc(&mut self, pi: usize, controller: u8, value: u8) {
        if pi >= self.parts.len() {
            return;
        }
        let x = value as f32 / 127.0;
        match controller {
            1 => self.parts[pi].mod_wheel = x,
            7 => self.parts[pi].volume_db = if value == 0 { -120.0 } else { 40.0 * x.log10() },
            10 => self.parts[pi].pan = x * 2.0 - 1.0,
            11 => self.parts[pi].expression = x,
            64 => {
                let on = value >= 64;
                let p = &mut self.parts[pi];
                p.sustain = on;
                if !on {
                    let hold = p.pedal_hold;
                    p.pedal_hold = [false; 128];
                    let mut damped = [false; 128];
                    for v in self.voices.iter_mut() {
                        if v.is_active() && v.part == pi && hold[v.note as usize] && !v.is_released() && v.layer_released_by_key() {
                            v.release();
                            damped[v.note as usize] = true;
                        }
                    }
                    for n in 0..128u8 {
                        if damped[n as usize] {
                            self.trigger_release_layers(pi, n);
                        }
                    }
                }
            }
            91 => self.parts[pi].reverb_send = x,
            120 => self.apply(Command::AllSoundOff),
            123 => self.apply(Command::AllNotesOff { part: Some(pi as u16) }),
            _ => {}
        }
    }

    fn set_layer_enabled(&mut self, pi: usize, li: usize, enabled: bool) {
        let Some(p) = self.parts.get_mut(pi) else { return };
        let Some(inst) = p.inst.as_mut() else { return };
        let Some(layer) = inst.layers.get_mut(li) else { return };
        if layer.enabled == enabled {
            return;
        }
        layer.enabled = enabled;
        if enabled {
            // start this layer for notes currently sounding (held or held by pedal)
            for n in 0..128u8 {
                let p = &self.parts[pi];
                if p.held[n as usize] || p.pedal_hold[n as usize] {
                    let vel = p.last_velocity[n as usize].max(1);
                    self.start_layer_voice(pi, li, n, vel);
                }
            }
        } else {
            for v in self.voices.iter_mut() {
                if v.is_active() && v.part == pi && v.layer_id as usize == li {
                    v.release();
                }
            }
        }
    }

    fn set_part_param(&mut self, pi: usize, param: PartParam, v: f32) {
        let Some(p) = self.parts.get_mut(pi) else { return };
        // NaN or infinite values are ignored (one would silence the part, or the whole engine)
        let Some(v) = param.sanitize(v) else { return };
        use PartParam::*;
        match param {
            Volume => p.volume_db = v,
            Pan => p.pan = v,
            ReverbSend => p.reverb_send = v,
            Brightness => p.sp.brightness = v,
            EvenDb => p.sp.even_db = v,
            NoiseDb => p.sp.noise_db = v,
            AttackScale => p.sp.attack_scale = v,
            DecayScale => p.sp.decay_scale = v,
            ReleaseScale => p.sp.release_scale = v,
            VibratoCents => p.sp.vibrato_cents = v,
            VibratoRate => p.sp.vibrato_rate = v,
            VibratoDelay => p.sp.vibrato_delay = v,
            Expression => p.sp.expression = v,
            Formant => p.sp.formant = v,
            Inharmonicity => p.sp.inharmonicity = v,
            Spread => p.sp.spread = v,
            Humanize => p.sp.humanize_cents = v,
            VelocitySens => p.sp.velocity_sens = v,
            MaxPartials => p.sp.max_partials = v as usize,
            GainDb => p.sp.gain_db = v,
            Jitter => p.sp.jitter = v,
            Shimmer => p.sp.shimmer = v,
            Transpose => p.transpose = v,
            Tune => p.tune_cents = v,
            BendRange => p.bend_range = v,
            ModDepth => p.mod_depth_cents = v,
            Mono => p.mono = v >= 0.5,
            Legato => {
                p.legato = v >= 0.5;
                if p.legato {
                    p.mono = true;
                }
            }
            Glide => p.glide = v,
            TremDepth => p.trem_db = v,
            TremPitch => p.trem_cents = v,
            TremRate => p.trem_rate = v,
            EqLowDb => p.eq_params.low_gain_db = v,
            EqLowHz => p.eq_params.low_freq = v,
            EqMidDb => p.eq_params.mid_gain_db = v,
            EqMidHz => p.eq_params.mid_freq = v,
            EqMidQ => p.eq_params.mid_q = v,
            EqHighDb => p.eq_params.high_gain_db = v,
            EqHighHz => p.eq_params.high_freq = v,
            LowCut => p.eq_params.low_cut_hz = v,
            HighCut => p.eq_params.high_cut_hz = v,
            ChorusMix => {
                p.chorus_params.mix = v;
                p.chorus_on = v > 0.0;
            }
            ChorusRate => p.chorus_params.rate_hz = v,
            ChorusDepth => p.chorus_params.depth_ms = v,
            DriveAmount => {
                p.drive_params.0 = v;
                p.drive_on = v > 1.0;
            }
            DriveTone => p.drive_params.2 = v,
            DriveLevel => p.drive_params.3 = v,
            SwellBox => p.swell_box = v >= 0.5,
            SwellClosed => p.swell_closed_db = v,
            SwellShelf => p.swell_shelf_max_db = v,
            Wind => p.wind = v,
            Leslie => {
                p.leslie_on = v >= 1.0;
                p.leslie.set_speed(match v as i32 {
                    2 => LeslieSpeed::Slow,
                    3 => LeslieSpeed::Fast,
                    _ => LeslieSpeed::Stop,
                });
            }
        }
        match param {
            EqLowDb | EqLowHz | EqMidDb | EqMidHz | EqMidQ | EqHighDb | EqHighHz | LowCut | HighCut => {
                p.eq.set_params(p.eq_params)
            }
            ChorusMix | ChorusRate | ChorusDepth => p.chorus.set_params(p.chorus_params),
            DriveAmount | DriveTone | DriveLevel => {
                let (d, b, t, l) = p.drive_params;
                p.drive.set_params(d, b, t, l)
            }
            _ => {}
        }
    }

    fn set_master_param(&mut self, param: MasterParam, v: f32) {
        use MasterParam::*;
        let Some(v) = param.sanitize(v) else { return };
        let mut rp = self.reverb.params();
        match param {
            Volume => self.master_db = v,
            Ceiling => self.limiter.set_ceiling_db(v),
            ReverbReturn => self.reverb_return_db = v,
            ReverbDecay => rp.decay = v,
            ReverbLowMult => rp.low_mult = v,
            ReverbHighMult => rp.high_mult = v,
            ReverbSize => rp.size = v,
            ReverbPredelay => rp.predelay_ms = v,
            ReverbDiffusion => rp.diffusion = v,
            ReverbEarly => rp.early = v,
            ReverbWidth => rp.width = v,
            ReverbLowCut => rp.low_cut_hz = v,
            ReverbHighCut => rp.high_cut_hz = v,
            ReverbModulation => rp.modulation = v,
            ReleaseFloor => self.release_floor_db = v,
            ReleaseBelowMix => self.below_mix_db = v,
            ReleaseHold => self.release_hold = v >= 0.5,
        }
        if !matches!(param, Volume | Ceiling | ReverbReturn | ReleaseFloor | ReleaseBelowMix | ReleaseHold) {
            self.reverb.set_params(rp);
        }
    }

    /// Replace all reverb parameters at once (e.g. switching presets).
    pub fn set_reverb(&mut self, p: ReverbParams) {
        self.reverb.set_params(p);
    }

    // ── rendering ───────────────────────────────────────────────────────────

    /// Active voices grouped by part (`order`, slot order within a part; part `p` owns
    /// `order[range[p].0..range[p].1]`).
    fn collect_voices(&mut self) {
        let mut count = [0u32; MAX_PARTS];
        for v in self.voices.iter() {
            if v.is_active() {
                count[v.part] += 1;
            }
        }
        let mut at = [0u32; MAX_PARTS];
        let mut sum = 0u32;
        for p in 0..MAX_PARTS {
            self.part_range[p] = (sum, sum + count[p]);
            at[p] = sum;
            sum += count[p];
        }
        self.order.clear();
        self.order.resize(sum as usize, 0);
        for (i, v) in self.voices.iter().enumerate() {
            if v.is_active() {
                self.order[at[v.part] as usize] = i as u32;
                at[v.part] += 1;
            }
        }
    }

    fn render_block(&mut self, out_l: &mut [f32], out_r: &mut [f32]) {
        let n = out_l.len();
        self.collect_voices();

        // ── parts at control rate: expression, tremulant, wind ──────────────
        self.active_parts.clear();
        for pi in 0..self.parts.len() {
            let (a, b) = self.part_range[pi];
            let p = &mut self.parts[pi];
            if a == b && !p.leslie_on && !p.chorus_on {
                if let Some(nb) = p.noise.as_mut() {
                    nb.clear_powers();
                }
                continue;
            }
            self.active_parts.push(pi as u8);

            // smoothed expression (CC11)
            let a_exp = 1.0 - (-(n as f32) / (0.02 * self.sr)).exp();
            p.expression_smoothed += (p.expression - p.expression_smoothed) * a_exp;
            if (p.expression - p.expression_smoothed).abs() < 1e-6 {
                // settle exactly (CC11 = 0 would otherwise decay into denormals)
                p.expression_smoothed = p.expression;
            }
            // tremulant: one wind-pressure wobble shared by every pipe of the division
            let (mut trem_c, mut trem_g) = (0.0f32, 1.0f32);
            if p.trem_db > 0.0 || p.trem_cents > 0.0 {
                p.trem_phase = (p.trem_phase + p.trem_rate * n as f32 / self.sr).fract();
                let w = (std::f32::consts::TAU * p.trem_phase).sin();
                trem_c = p.trem_cents * w;
                trem_g = db_to_amp(p.trem_db * w);
            }
            // shared wind: a sudden rise in demand (many pipes starting) makes the pressure
            // dip and the regulator recover (damped ~4 Hz); all pipes of the division sag a
            // little in pitch and loudness together
            let (mut wind_c, mut wind_g) = (0.0f32, 1.0f32);
            if p.wind > 0.0 {
                let demand: f32 = self.order[a as usize..b as usize].iter().map(|&vi| self.voices[vi as usize].level()).sum::<f32>() / 0.1;
                let dt = n as f32 / self.sr;
                p.wind_avg += (demand - p.wind_avg) * (1.0 - (-dt / 0.25).exp());
                let drive = -(demand - p.wind_avg) * 0.004 * p.wind;
                let w0 = std::f32::consts::TAU * 4.0;
                let acc = w0 * w0 * (drive - p.wind_p) - 2.0 * 0.45 * w0 * p.wind_v;
                p.wind_v += acc * dt;
                p.wind_p += p.wind_v * dt;
                p.wind_p = p.wind_p.clamp(-0.15, 0.15);
                wind_c = 30.0 * p.wind_p;
                wind_g = db_to_amp(8.0 * p.wind_p);
            }
            self.part_md[pi] = BlockMod {
                cents: p.bend * p.bend_range * 100.0 + trem_c + wind_c,
                mod_vibrato: p.mod_wheel * p.mod_depth_cents,
                expression_gain: if p.swell_box {
                    // closed shutters: about −9 dB overall (plus the shelf below), not silence
                    db_to_amp(p.swell_closed_db * (1.0 - p.expression_smoothed)) * trem_g * wind_g
                } else {
                    p.expression_smoothed * trem_g * wind_g
                },
            };
            self.part_sp[pi] = p.sp;
        }

        // ── voices: each into its own buffer, on every rendering thread ─────
        {
            let order = &self.order[..];
            let voices = Raw(self.voices.as_mut_ptr());
            let vbuf = Raw(self.vbuf.as_mut_ptr());
            let voff = Raw(self.voff.as_mut_ptr());
            let vtr = Raw(self.vtr.as_mut_ptr());
            let vtr_on = Raw(self.vtr_on.as_mut_ptr());
            let scratch = Raw(self.scratch.as_mut_ptr());
            let (sp, md) = (&self.part_sp, &self.part_md);
            let nv = order.len();
            let threads = if nv >= PARALLEL_VOICES { self.pool.threads() } else { 1 };
            // a few items per thread: whoever is free takes the next (voice starts and voices
            // with many partials cost far more than others)
            let items = if threads > 1 { (threads * 8).min(nv) } else { 1 };
            let job = |item: usize, t: usize| {
                let (a, b) = (item * nv / items, (item + 1) * nv / items);
                // SAFETY: each voice index appears once in `order` and each item covers its own
                // range of it, so no two threads touch the same voice, buffer or offset; each
                // thread has its own scratch
                let s = unsafe { &mut **scratch.at(t) };
                for &vi in &order[a..b] {
                    let vi = vi as usize;
                    let (v, buf, off, tb, ton) = unsafe { (&mut *voices.at(vi), &mut *vbuf.at(vi), &mut *voff.at(vi), &mut *vtr.at(vi), &mut *vtr_on.at(vi)) };
                    let o = (*off as usize).min(n);
                    *off = 0;
                    let [bl, br] = buf;
                    bl[..n].fill(0.0);
                    br[..n].fill(0.0);
                    let tr = if v.plays_transient() {
                        let [tl, tr] = tb;
                        tl[..n].fill(0.0);
                        tr[..n].fill(0.0);
                        Some((&mut tl[o..n], &mut tr[o..n]))
                    } else {
                        None
                    };
                    *ton = v.render_split(s, &mut bl[o..n], &mut br[o..n], tr, &sp[v.part], &md[v.part]);
                }
            };
            if threads > 1 {
                self.pool.run(items, &job);
            } else {
                job(0, 0);
            }
        }

        // ── parts: their voices summed, pooled noise, insert effects, level ──
        {
            let list = &self.active_parts[..];
            let parts = Raw(self.parts.as_mut_ptr());
            let pout = Raw(self.pout.as_mut_ptr());
            let recover = Raw(self.recover.as_mut_ptr());
            let (order, range, voices) = (&self.order[..], &self.part_range, &self.voices[..]);
            let vb = VoiceOut { buf: &self.vbuf, tr: &self.vtr, tr_on: &self.vtr_on };
            let sr = self.sr;
            let job = |item: usize, _t: usize| {
                let pi = list[item] as usize;
                let (a, b) = range[pi];
                // SAFETY: each item is one part: its state, output and flag are its own
                let (p, out, rec) = unsafe { (&mut *parts.at(pi), &mut *pout.at(pi), &mut *recover.at(pi)) };
                *rec = part_block(p, &order[a as usize..b as usize], voices, &vb, out, n, sr);
            };
            let threads = if list.len() > 1 && order.len() >= PARALLEL_VOICES { self.pool.threads() } else { 1 };
            if threads > 1 {
                self.pool.run(list.len(), &job);
            } else {
                for i in 0..list.len() {
                    job(i, 0);
                }
            }
        }

        if self.release_floor_db > -199.0 || self.below_mix_db > 0.0 {
            self.cull_releases();
        }

        // ── mix, in part order ───────────────────────────────────────────────
        self.mix_l[..n].fill(0.0);
        self.mix_r[..n].fill(0.0);
        self.send_l[..n].fill(0.0);
        self.send_r[..n].fill(0.0);
        let culling = self.below_mix_db > 0.0;
        if culling {
            // parts without output this block fall silent
            let mut sounding = [false; MAX_PARTS];
            for &pi in &self.active_parts {
                sounding[pi as usize] = true;
            }
            for (pi, &on) in sounding.iter().enumerate() {
                if !on {
                    self.follow_level(pi, 0.0, n);
                }
            }
        }
        for k in 0..self.active_parts.len() {
            let pi = self.active_parts[k] as usize;
            if culling {
                let [pl, pr, _, _] = &self.pout[pi];
                let p = pl[..n].iter().chain(&pr[..n]).map(|x| x * x).sum::<f32>() / (2 * n) as f32;
                self.follow_level(pi, p, n);
            }
            let [pl, pr, sl, sr] = &self.pout[pi];
            for i in 0..n {
                self.mix_l[i] += pl[i];
                self.mix_r[i] += pr[i];
                self.send_l[i] += sl[i];
                self.send_r[i] += sr[i];
            }
            if self.recover[pi] {
                // A non-finite sample (an extreme model or state) would have poisoned the mix,
                // the reverb and the limiter for good: the part was silenced, and its voices
                // restart from a clean state.
                self.recover[pi] = false;
                for v in self.voices.iter_mut().filter(|v| v.part == pi) {
                    v.reset();
                }
                self.recoveries += 1;
            }
        }

        // reverb send/return
        self.reverb.process(&mut self.send_l[..n], &mut self.send_r[..n]);
        if !all_finite(&self.send_l[..n]) || !all_finite(&self.send_r[..n]) {
            self.send_l[..n].fill(0.0);
            self.send_r[..n].fill(0.0);
            self.reverb.reset();
            self.recoveries += 1;
        }
        let ret_target = db_to_amp(self.reverb_return_db);
        let dr = (ret_target - self.return_smoothed) / n as f32;
        let target = db_to_amp(self.master_db);
        let g0 = self.master_gain_smoothed;
        let dg = (target - g0) / n as f32;
        let (mut g, mut ret) = (g0, self.return_smoothed);
        for i in 0..n {
            g += dg;
            ret += dr;
            out_l[i] = (self.mix_l[i] + self.send_l[i] * ret) * g;
            out_r[i] = (self.mix_r[i] + self.send_r[i] * ret) * g;
        }
        self.master_gain_smoothed = target;
        self.return_smoothed = ret_target;
        if !all_finite(out_l) || !all_finite(out_r) {
            out_l.fill(0.0);
            out_r.fill(0.0);
            self.reverb.reset();
            self.limiter.reset();
            self.recoveries += 1;
        }
        self.limiter.process(out_l, out_r);
        let mut pk = self.peak;
        // Last-resort safety only: identity up to the limiter's ceiling.
        let knee = self.limiter.output_ceiling();
        for i in 0..n {
            out_l[i] = safety_clip(out_l[i], knee);
            out_r[i] = safety_clip(out_r[i], knee);
            pk = pk.max(out_l[i].abs()).max(out_r[i].abs());
        }
        self.peak = pk;
        if self.below_mix_db > 0.0 {
            let p = out_l.iter().chain(out_r.iter()).map(|x| x * x).sum::<f32>() / (2 * n).max(1) as f32;
            self.follow_level(MAX_PARTS, p, n);
        }
        self.collect_free();
    }

    /// Follow output level `i` (a part, or the master at `MAX_PARTS`) given this block's mean
    /// power `p`: smoothed over ~300 ms, or held for 1 s and then falling 40 dB/s.
    fn follow_level(&mut self, i: usize, p: f32, n: usize) {
        let dt = n as f32 / self.sr;
        if self.release_hold {
            let db = 10.0 * p.max(1e-20).log10();
            if db >= self.level_db[i] {
                self.level_db[i] = db;
                self.level_held_s[i] = 0.0;
            } else {
                self.level_held_s[i] += dt;
                if self.level_held_s[i] > 1.0 {
                    self.level_db[i] = (self.level_db[i] - 40.0 * dt).max(db);
                }
            }
        } else {
            let a = 1.0 - (-dt / 0.3).exp();
            self.level_pow[i] += (p - self.level_pow[i]) * a;
            self.level_db[i] = 10.0 * self.level_pow[i].max(1e-20).log10();
        }
    }

    /// Opt-in: retire (with the 4 ms steal fade) released voices whose output is below the
    /// release floor, or far below both their part's output and the master output.
    fn cull_releases(&mut self) {
        let master = self.master_db;
        for &vi in &self.order {
            let v = &mut self.voices[vi as usize];
            if !v.is_active() || !v.is_released() || v.is_killing() {
                continue;
            }
            // (an upper bound: the voice's partials' amplitudes summed)
            let part = v.output_level_db() + self.parts[v.part].volume_db;
            let level = part + master;
            let below_floor = level < self.release_floor_db;
            let x = self.below_mix_db;
            let masked = x > 0.0 && part < self.level_db[v.part] - x && level < self.level_db[MAX_PARTS] - x;
            if below_floor || masked {
                v.kill();
                self.culled += 1;
            }
        }
    }

    fn collect_free(&mut self) {
        self.free.clear();
        for (i, v) in self.voices.iter().enumerate().rev() {
            if !v.is_active() {
                self.free.push(i as u32);
            }
        }
    }
}

/// Fewest sounding voices worth rendering on several threads (below, waking the workers costs
/// more than it saves).
const PARALLEL_VOICES: usize = 12;

/// A pointer into engine-owned memory handed to the rendering threads: every job item works
/// on elements no other item touches.
struct Raw<T>(*mut T);
impl<T> Clone for Raw<T> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> Copy for Raw<T> {}
// SAFETY: see the jobs in `render_block`: items never share an element
unsafe impl<T> Send for Raw<T> {}
unsafe impl<T> Sync for Raw<T> {}

impl<T> Raw<T> {
    /// Element `i` (callers guarantee exclusive use).
    #[inline]
    fn at(self, i: usize) -> *mut T {
        // SAFETY: callers index within the array the pointer was taken from
        unsafe { self.0.add(i) }
    }
}

/// The voices' outputs of the current block (see `Engine::vbuf`, `Engine::vtr`).
struct VoiceOut<'a> {
    buf: &'a [[[f32; BLOCK]; 2]],
    tr: &'a [[[f32; BLOCK]; 2]],
    tr_on: &'a [bool],
}

/// One part's block after its voices rendered: their sum (in slot order), the part's pooled
/// noise, its insert effects and level. Writes the part's output and reverb send, already
/// scaled (`out` = [left, right, send left, send right]). Returns true when the part produced a
/// non-finite signal: it is then silenced and its state cleared (its voices are reset by the
/// caller).
#[allow(clippy::needless_range_loop)]
fn part_block(p: &mut Part, ids: &[u32], voices: &[SpectralVoice], vo: &VoiceOut, out: &mut [[f32; BLOCK]; 4], n: usize, sr: f32) -> bool {
    let [part_l, part_r, send_l, send_r] = out;
    part_l[..n].fill(0.0);
    part_r[..n].fill(0.0);
    for &vi in ids {
        let vi = vi as usize;
        if vo.tr_on[vi] {
            let [tl, tr] = &vo.tr[vi];
            for s in 0..n {
                part_l[s] += tl[s];
                part_r[s] += tr[s];
            }
        }
        let [bl, br] = &vo.buf[vi];
        for s in 0..n {
            part_l[s] += bl[s];
            part_r[s] += br[s];
        }
    }
    if let Some(nb) = p.noise.as_mut() {
        nb.clear_powers();
        // pitch-synchronous noise: Σ p_v·g_v(t) over voices with an envelope (p_v = the
        // voice's noise power), applied to the part's pooled noise as G = (Σ p_v g_v + rest) / Σ p
        let mut pulse_acc = [0.0f32; BLOCK];
        let (mut p_pulse, mut p_all) = (0.0f32, 0.0f32);
        for &vi in ids {
            let v = &voices[vi as usize];
            let (gl, gr) = v.noise_pan();
            let (gl2, gr2) = (gl * gl, gr * gr);
            let bands = v.noise_bands().min(MAX_BANDS);
            let mut pv = 0.0;
            for b in 0..bands {
                let pw = v.noise_pow[b];
                if pw > 0.0 {
                    nb.pow_l[b] += pw * gl2;
                    nb.pow_r[b] += pw * gr2;
                    pv += pw;
                }
            }
            p_all += pv;
            if v.pulse_on && pv > 0.0 {
                p_pulse += pv;
                // (a voice that started inside this block filled the end of its buffer)
                let len = v.pulse_len().min(n);
                let o = n - len;
                for s in 0..n {
                    let g = v.pulse_buf[s.saturating_sub(o)];
                    pulse_acc[s] += pv * g;
                }
            }
        }
        if p_pulse > 0.0 && p_all > 0.0 {
            let mut nl = [0.0f32; BLOCK];
            let mut nr = [0.0f32; BLOCK];
            nb.render(&mut nl[..n], &mut nr[..n]);
            let rest = p_all - p_pulse;
            let inv = 1.0 / p_all;
            for s in 0..n {
                let g = (pulse_acc[s] + rest) * inv;
                part_l[s] += nl[s] * g;
                part_r[s] += nr[s] * g;
            }
        } else {
            nb.render(&mut part_l[..n], &mut part_r[..n]);
        }
    }

    // insert effects
    if p.drive_on {
        p.drive.process(&mut part_l[..n], &mut part_r[..n]);
    }
    if !p.eq.is_flat() {
        p.eq.process(&mut part_l[..n], &mut part_r[..n]);
    }
    if p.chorus_on {
        p.chorus.process(&mut part_l[..n], &mut part_r[..n]);
    }
    if p.leslie_on {
        p.leslie.process(&mut part_l[..n], &mut part_r[..n]);
    }
    if p.swell_box {
        // shutters absorb treble far more than bass: up to −14 dB above ~700 Hz
        let target = p.swell_shelf_max_db * (1.0 - p.expression_smoothed);
        if (target - p.swell_shelf_db).abs() > 0.05 {
            p.swell_shelf_db = target;
            let c = crate::dsp::biquad::Coeffs::high_shelf(700.0, target, sr);
            for f in p.swell_shelf.iter_mut() {
                f.c = c;
            }
        }
        if p.swell_shelf_db < -0.05 {
            p.swell_shelf[0].process_block(&mut part_l[..n]);
            p.swell_shelf[1].process_block(&mut part_r[..n]);
        }
    }

    // A non-finite sample (an extreme model or state) would poison the mix, the reverb and
    // the limiter for good: silence this part and restart it from a clean state.
    let mut recover = false;
    if !all_finite(&part_l[..n]) || !all_finite(&part_r[..n]) {
        part_l[..n].fill(0.0);
        part_r[..n].fill(0.0);
        p.reset_state();
        recover = true;
    }

    // volume (smoothed) and sends
    let target = db_to_amp(p.volume_db);
    let g0 = p.gain_smoothed;
    let dg = (target - g0) / n as f32;
    let send_target = p.reverb_send();
    let ds = (send_target - p.send_smoothed) / n as f32;
    let (mut g, mut send) = (g0, p.send_smoothed);
    for i in 0..n {
        g += dg;
        send += ds;
        let l = part_l[i] * g;
        let r = part_r[i] * g;
        part_l[i] = l;
        part_r[i] = r;
        send_l[i] = l * send;
        send_r[i] = r * send;
    }
    p.gain_smoothed = target;
    p.send_smoothed = send_target;
    recover
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::testing;

    /// A model of the repository (the organ ones live in the Burea organ's package).
    fn model(name: &str) -> Option<Arc<Model>> {
        let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");
        ["models", "packages/organ-burea/models"]
            .iter()
            .find_map(|dir| std::fs::read(format!("{root}/{dir}/{name}.ssm")).ok())
            .map(|b| Arc::new(Model::from_bytes(&b).expect("model parses")))
    }

    fn engine_with(name: &str) -> Option<(Engine, Controller)> {
        let m = model(name)?;
        let (eng, mut ctl) = Engine::new(EngineConfig::default());
        ctl.send(0, Command::set_instrument(0, Instrument::single(m))).unwrap();
        Some((eng, ctl))
    }

    fn render(eng: &mut Engine, frames: usize) -> (Vec<f32>, Vec<f32>) {
        let mut l = vec![0.0; frames];
        let mut r = vec![0.0; frames];
        eng.process_planar(&mut l, &mut r);
        (l, r)
    }

    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|v| v * v).sum::<f32>() / x.len().max(1) as f32).sqrt()
    }

    #[test]
    fn silence_without_notes() {
        let Some((mut eng, _ctl)) = engine_with("grand-piano") else { return };
        let (l, _) = render(&mut eng, 4800);
        assert!(l.iter().all(|v| v.abs() < 1e-6));
    }

    #[test]
    fn piano_note_sounds_and_decays_away() {
        let Some((mut eng, mut ctl)) = engine_with("grand-piano") else { return };
        ctl.send(0, Command::NoteOn { part: 0, note: 60, velocity: 100 }).unwrap();
        let (l, r) = render(&mut eng, 24000);
        assert!(rms(&l) > 1e-3 && rms(&r) > 1e-3);
        assert!(l.iter().chain(r.iter()).all(|v| v.is_finite() && v.abs() <= 1.0));
        ctl.send(0, Command::NoteOff { part: 0, note: 60 }).unwrap();
        render(&mut eng, 48000 * 4);
        assert_eq!(eng.active_voices(), 0, "damper should end the note");
    }

    #[test]
    fn events_are_sample_accurate() {
        let Some((mut eng, mut ctl)) = engine_with("marimba") else { return };
        ctl.send(10_000, Command::NoteOn { part: 0, note: 72, velocity: 110 }).unwrap();
        let (l, _) = render(&mut eng, 20_000);
        let first = l.iter().position(|v| v.abs() > 1e-5).unwrap();
        assert!((10_000..10_100).contains(&first), "onset at {first}");
    }

    #[test]
    fn legato_moves_the_voice_without_clicks() {
        let Some((mut eng, mut ctl)) = engine_with("violin") else { return };
        ctl.send(0, Command::SetPartParam { part: 0, param: PartParam::Legato, value: 1.0 }).unwrap();
        ctl.send(0, Command::NoteOn { part: 0, note: 69, velocity: 100 }).unwrap();
        render(&mut eng, 24000);
        ctl.send(0, Command::NoteOn { part: 0, note: 72, velocity: 100 }).unwrap();
        let (l, _) = render(&mut eng, 24000);
        assert_eq!(eng.active_voices(), 1, "legato keeps one voice");
        let max_step = l.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0, f32::max);
        assert!(max_step < 0.2, "discontinuity {max_step}");
    }

    #[test]
    fn layers_can_be_added_while_notes_sound() {
        let (Some(a), Some(b)) = (model("organ/great-principal-8"), model("organ/great-octave-4")) else { return };
        let (mut eng, mut ctl) = Engine::new(EngineConfig::default());
        ctl.send(0, Command::set_instrument(0, Instrument::single(a))).unwrap();
        ctl.send(0, Command::NoteOn { part: 0, note: 60, velocity: 100 }).unwrap();
        render(&mut eng, 24000);
        let layer = InstLayer { transpose: 12.0, ..InstLayer::new(b) };
        ctl.send(0, Command::add_layer(0, layer)).unwrap();
        render(&mut eng, 4800);
        assert_eq!(eng.active_voices(), 2);
    }

    #[test]
    fn organ_pipe_stops_speaking_at_note_off() {
        // the recorded release starts where the pipe's tone starts to die away: within 50 ms
        // of note-off the level is well below the sustain (the church's reverberation remains)
        let Some((mut eng, mut ctl)) = engine_with("organ/great-principal-8") else { return };
        ctl.send(0, Command::NoteOn { part: 0, note: 67, velocity: 100 }).unwrap();
        let (l, r) = render(&mut eng, 48000 * 3);
        let sustain = rms(&l[48000 * 2..]) + rms(&r[48000 * 2..]);
        ctl.send(0, Command::NoteOff { part: 0, note: 67 }).unwrap();
        let (l, r) = render(&mut eng, 48000);
        let after = rms(&l[2400..3360]) + rms(&r[2400..3360]);
        let db = 20.0 * (after / sustain).log10();
        assert!(db < -6.0, "50–70 ms after note-off: {db:.1} dB re sustain");
        assert!(l.iter().chain(r.iter()).all(|v| v.is_finite()));
    }

    /// Voices of a part still held (not released).
    fn speaking(eng: &Engine, part: usize) -> usize {
        eng.voices.iter().filter(|v| v.is_active() && v.part == part && !v.is_released()).count()
    }

    fn two_divisions() -> Option<(Engine, Controller)> {
        let (a, b) = (model("organ/great-principal-8")?, model("organ/swell-rohrflute-8")?);
        let (eng, mut ctl) = Engine::new(EngineConfig::default());
        ctl.send(0, Command::set_instrument(0, Instrument::single(a))).unwrap();
        ctl.send(0, Command::set_instrument(1, Instrument::single(b))).unwrap();
        Some((eng, ctl))
    }

    #[test]
    fn coupled_division_sounds_from_any_note_source() {
        let Some((mut eng, mut ctl)) = two_divisions() else { return };
        ctl.send(0, Command::SetCouplers { part: 0, couplers: Couplers::to_parts(1 << 1) }).unwrap();
        ctl.send(0, Command::NoteOn { part: 0, note: 60, velocity: 100 }).unwrap();
        render(&mut eng, 4800);
        assert_eq!((speaking(&eng, 0), speaking(&eng, 1)), (1, 1), "the great key plays the swell too");
        ctl.send(0, Command::NoteOff { part: 0, note: 60 }).unwrap();
        render(&mut eng, 4800);
        assert_eq!((speaking(&eng, 0), speaking(&eng, 1)), (0, 0));
        // not the other way round
        ctl.send(0, Command::NoteOn { part: 1, note: 62, velocity: 100 }).unwrap();
        render(&mut eng, 4800);
        assert_eq!((speaking(&eng, 0), speaking(&eng, 1)), (0, 1));
    }

    #[test]
    fn a_pipe_reached_from_two_keyboards_sounds_until_both_keys_are_up() {
        let Some((mut eng, mut ctl)) = two_divisions() else { return };
        ctl.send(0, Command::SetCouplers { part: 0, couplers: Couplers::to_parts(1 << 1) }).unwrap();
        ctl.send(0, Command::NoteOn { part: 1, note: 60, velocity: 100 }).unwrap();
        ctl.send(0, Command::NoteOn { part: 0, note: 60, velocity: 100 }).unwrap();
        render(&mut eng, 4800);
        assert_eq!(speaking(&eng, 1), 1, "one swell pipe, not restruck");
        ctl.send(0, Command::NoteOff { part: 1, note: 60 }).unwrap();
        render(&mut eng, 4800);
        assert_eq!(speaking(&eng, 1), 1, "still held through the coupler");
        ctl.send(0, Command::NoteOff { part: 0, note: 60 }).unwrap();
        render(&mut eng, 4800);
        assert_eq!((speaking(&eng, 0), speaking(&eng, 1)), (0, 0));
    }

    #[test]
    fn couplers_change_held_notes() {
        let Some((mut eng, mut ctl)) = two_divisions() else { return };
        ctl.send(0, Command::NoteOn { part: 0, note: 60, velocity: 100 }).unwrap();
        ctl.send(0, Command::NoteOn { part: 0, note: 64, velocity: 100 }).unwrap();
        render(&mut eng, 4800);
        ctl.send(0, Command::SetCouplers { part: 0, couplers: Couplers::to_parts(1 << 1) }).unwrap();
        render(&mut eng, 4800);
        assert_eq!(speaking(&eng, 1), 2, "coupling in starts the held keys on the swell");
        ctl.send(0, Command::SetCouplers { part: 0, couplers: Couplers::default() }).unwrap();
        render(&mut eng, 4800);
        assert_eq!((speaking(&eng, 0), speaking(&eng, 1)), (2, 0));
    }

    fn test_layer(model: Arc<Model>) -> InstLayer {
        InstLayer::new(model)
    }

    #[test]
    fn replaced_models_are_freed_by_the_api_thread() {
        let m = testing::model();
        let weak = Arc::downgrade(&m);
        let (mut eng, mut ctl) = Engine::new(EngineConfig::default());
        ctl.send(0, Command::set_instrument(0, Instrument::single(m))).unwrap();
        ctl.send(0, Command::NoteOn { part: 0, note: 60, velocity: 100 }).unwrap();
        render(&mut eng, 4800);
        assert_eq!(eng.active_voices(), 1);
        ctl.send(0, Command::set_instrument(0, Instrument::default())).unwrap();
        // the old instrument and, once its fade ends, the voice's reference wait in the ring
        render(&mut eng, 4800);
        assert_eq!(eng.active_voices(), 0);
        assert!(weak.upgrade().is_some(), "the audio thread must not drop the last reference");
        ctl.collect_garbage();
        assert!(weak.upgrade().is_none(), "the model is freed once the API thread collects");
    }

    #[test]
    fn a_big_organ_chord_at_the_voice_limit_never_cuts_a_sounding_voice() {
        let m = testing::model();
        let (mut eng, mut ctl) = Engine::new(EngineConfig { max_voices: 16, ..EngineConfig::default() });
        let mut inst = Instrument::default();
        for t in 0..8 {
            inst.layers.push(InstLayer { transpose: (t % 3) as f32 * 12.0, ..test_layer(m.clone()) });
        }
        ctl.send(0, Command::set_instrument(0, inst)).unwrap();
        render(&mut eng, 480);
        // 12 keys × 8 stops = 96 voices wanted at once, 16 allowed (+32 spare slots for fades)
        for n in 48..60 {
            ctl.send(0, Command::NoteOn { part: 0, note: n, velocity: 100 }).unwrap();
        }
        let (l, r) = render(&mut eng, 4800);
        assert!(l.iter().chain(&r).all(|v| v.is_finite()));
        assert!(eng.hard_steals > 0, "the chord must overrun the spare slots");
        assert_eq!(eng.hard_steals_sounding, 0, "only voices already fading out may be cut");
        let sounding = eng.voices.iter().filter(|v| v.is_active() && !v.is_killing()).count();
        assert_eq!(sounding, 16);
        // the newest notes are the ones left sounding
        assert!(eng.voices.iter().filter(|v| v.is_active() && !v.is_killing()).all(|v| v.note >= 58));
        render(&mut eng, 4800);
        assert_eq!(eng.active_voices(), 16, "stolen voices finish their fade");
    }

    fn finite_and_audible(l: &[f32], r: &[f32]) -> bool {
        l.iter().chain(r).all(|v| v.is_finite()) && rms(l) > 1e-4 && rms(r) > 1e-4
    }

    #[test]
    fn non_finite_parameters_are_ignored() {
        let (mut eng, mut ctl) = Engine::new(EngineConfig::default());
        ctl.send(0, Command::set_instrument(0, Instrument::single(testing::model()))).unwrap();
        ctl.send(0, Command::NoteOn { part: 0, note: 60, velocity: 100 }).unwrap();
        render(&mut eng, 4800);
        // (a NaN pitch bend used to silence the whole engine for good)
        ctl.send(0, Command::PitchBend { part: 0, value: f32::NAN }).unwrap();
        let (l, r) = render(&mut eng, 4800);
        assert!(finite_and_audible(&l, &r));
        for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            for &(_, param) in PartParam::ALL {
                ctl.send(0, Command::SetPartParam { part: 0, param, value: bad }).unwrap();
            }
            for &(_, param) in MasterParam::ALL {
                ctl.send(0, Command::SetMasterParam { param, value: bad }).unwrap();
            }
            ctl.send(0, Command::SetLayerGain { part: 0, layer: 0, gain_db: bad }).unwrap();
            let (l, r) = render(&mut eng, 4800);
            assert!(finite_and_audible(&l, &r), "after {bad} parameters");
        }
        // huge finite values are clamped to something playable
        for &(_, param) in PartParam::ALL {
            ctl.send(0, Command::SetPartParam { part: 0, param, value: 1e30 }).unwrap();
            ctl.send(0, Command::SetPartParam { part: 0, param, value: -1e30 }).unwrap();
        }
        ctl.send(0, Command::NoteOn { part: 0, note: 64, velocity: 100 }).unwrap();
        let (l, r) = render(&mut eng, 9600);
        assert!(l.iter().chain(&r).all(|v| v.is_finite()));
    }

    #[test]
    fn the_engine_recovers_from_a_non_finite_voice_or_reverb() {
        let good = testing::model();
        let mut bad = Model::clone(&good);
        bad.zones[0].ratios[0] = f32::NAN; // something a voice turns into NaN samples
        let (mut eng, mut ctl) = Engine::new(EngineConfig::default());
        ctl.send(0, Command::set_instrument(0, Instrument::single(good.clone()))).unwrap();
        ctl.send(0, Command::set_instrument(1, Instrument::single(Arc::new(bad)))).unwrap();
        ctl.send(0, Command::SetPartParam { part: 0, param: PartParam::ReverbSend, value: 0.5 }).unwrap();
        ctl.send(0, Command::SetPartParam { part: 1, param: PartParam::ReverbSend, value: 0.5 }).unwrap();
        ctl.send(0, Command::NoteOn { part: 0, note: 60, velocity: 100 }).unwrap();
        ctl.send(0, Command::NoteOn { part: 1, note: 67, velocity: 100 }).unwrap();
        let (l, r) = render(&mut eng, 4800);
        assert!(finite_and_audible(&l, &r), "the poisoned part is silenced, the others play on");
        assert!(eng.recoveries > 0);
        assert!(!eng.voices.iter().any(|v| v.is_active() && v.part == 1));
        // the part plays again with a sound instrument
        ctl.send(0, Command::set_instrument(1, Instrument::single(good))).unwrap();
        ctl.send(0, Command::NoteOff { part: 0, note: 60 }).unwrap();
        ctl.send(0, Command::NoteOn { part: 1, note: 67, velocity: 100 }).unwrap();
        render(&mut eng, 4800);
        assert!(eng.voices.iter().any(|v| v.is_active() && v.part == 1 && !v.is_released()));
        // a reverb whose state went non-finite is cleared, and its tail comes back
        let (mut nl, mut nr) = ([f32::NAN; 64], [f32::INFINITY; 64]);
        eng.reverb.process(&mut nl, &mut nr);
        let (l, r) = render(&mut eng, 9600);
        assert!(l.iter().chain(&r).all(|v| v.is_finite()));
        assert!(rms(&l[4800..]) > 1e-4 && rms(&r[4800..]) > 1e-4);
    }

    #[test]
    fn reverb_return_changes_are_ramped() {
        // three identical engines: return at 0 dB, switched off at frame T, and off throughout;
        // the reverb's share of the output follows the return level sample by sample
        const T: u64 = 9600;
        let run = |ret0: f32, ret1: Option<f32>| {
            let (mut eng, mut ctl) = Engine::new(EngineConfig::default());
            ctl.send(0, Command::set_instrument(0, Instrument::single(testing::model()))).unwrap();
            ctl.send(0, Command::SetPartParam { part: 0, param: PartParam::ReverbSend, value: 1.0 }).unwrap();
            ctl.send(0, Command::SetMasterParam { param: MasterParam::ReverbReturn, value: ret0 }).unwrap();
            ctl.send(0, Command::NoteOn { part: 0, note: 60, velocity: 100 }).unwrap();
            if let Some(r) = ret1 {
                ctl.send(T, Command::SetMasterParam { param: MasterParam::ReverbReturn, value: r }).unwrap();
            }
            let la = eng.limiter.latency();
            (render(&mut eng, T as usize + 1024).0, la)
        };
        let ((a, la), (b, _), (c, _)) = (run(0.0, None), run(0.0, Some(-120.0)), run(-120.0, None));
        let t0 = T as usize + la;
        for k in [0usize, 16, 32, 48] {
            let t = t0 + k;
            let ratio = (b[t] - c[t]) / (a[t] - c[t]);
            let want = 1.0 - (k + 1) as f32 / 64.0;
            assert!((ratio - want).abs() < 0.02, "return at {k} samples into the change: {ratio:.3}, want {want:.3}");
        }
        assert!(b[t0 + 100..].iter().zip(&c[t0 + 100..]).all(|(x, y)| (x - y).abs() < 1e-5));
    }

    #[test]
    fn a_full_queue_refuses_events_instead_of_playing_them_early() {
        let (mut eng, mut ctl) = Engine::new(EngineConfig::default());
        ctl.send(0, Command::set_instrument(0, Instrument::single(testing::model()))).unwrap();
        render(&mut eng, 64);
        assert_eq!(ctl.queue_free(), QUEUE_CAPACITY);
        for i in 0..QUEUE_CAPACITY as u64 {
            let cmd = if i % 2 == 0 { Command::NoteOn { part: 0, note: 60, velocity: 90 } } else { Command::NoteOff { part: 0, note: 60 } };
            ctl.send(48_000 + i, cmd).unwrap();
        }
        assert_eq!(ctl.queue_free(), 0);
        assert!(ctl.send(0, Command::NoteOn { part: 0, note: 72, velocity: 90 }).is_err());
        // the engine takes them all in, but nothing sounds before its time
        render(&mut eng, 24_000);
        assert_eq!(eng.active_voices(), 0);
        assert!(ctl.send(0, Command::NoteOn { part: 0, note: 72, velocity: 90 }).is_err(), "still waiting");
        render(&mut eng, 24_000 + 100);
        assert_eq!(ctl.queue_free(), 64 + 24_000 + 24_100 - 48_000, "applied events free their places");
        ctl.send(0, Command::NoteOn { part: 0, note: 72, velocity: 90 }).unwrap();
    }

    #[test]
    fn rendering_restores_the_callers_denormal_mode() {
        let denormal = || std::hint::black_box(1e-30f32) * std::hint::black_box(1e-10f32);
        let (mut eng, mut ctl) = Engine::new(EngineConfig::default());
        ctl.send(0, Command::set_instrument(0, Instrument::single(testing::model()))).unwrap();
        ctl.send(0, Command::NoteOn { part: 0, note: 60, velocity: 100 }).unwrap();
        // CC11 = 0: the expression smoother settles at exactly zero rather than in denormals
        ctl.send(0, Command::ControlChange { part: 0, controller: 11, value: 0 }).unwrap();
        render(&mut eng, 48_000);
        let mut buf = vec![0.0f32; 960];
        eng.process_interleaved(&mut buf, 2);
        assert!(denormal() > 0.0, "offline rendering runs on the caller's thread");
        assert_eq!(eng.parts[0].expression_smoothed, 0.0);
    }

    #[test]
    fn layers_beyond_the_reserved_room_are_added() {
        let m = testing::model();
        let (mut eng, mut ctl) = Engine::new(EngineConfig::default());
        for _ in 0..100 {
            ctl.send(0, Command::add_layer(3, InstLayer { enabled: false, ..test_layer(m.clone()) })).unwrap();
        }
        ctl.send(0, Command::SetLayerEnabled { part: 3, layer: 99, enabled: true }).unwrap();
        ctl.send(0, Command::NoteOn { part: 3, note: 60, velocity: 100 }).unwrap();
        render(&mut eng, 480);
        assert_eq!(eng.parts[3].inst.as_ref().map(|i| i.layers.len()), Some(100));
        assert_eq!(eng.active_voices(), 1);
        assert!(eng.parts[3].noise.is_some());
    }

    fn notes(eng: &Engine, part: usize) -> Vec<u8> {
        let mut v: Vec<u8> = eng.voices.iter().filter(|v| v.is_active() && v.part == part && !v.is_released()).map(|v| v.note).collect();
        v.sort();
        v
    }

    #[test]
    fn octave_couplers_play_the_octave_and_share_pipes() {
        let Some((mut eng, mut ctl)) = two_divisions() else { return };
        let r = |part, shift| Route { part, shift };
        // swell to great 4' (super octave) and the great's own super octave
        ctl.send(0, Command::SetCouplers { part: 0, couplers: Couplers::new(&[r(1, 12), r(0, 12)], false) }).unwrap();
        ctl.send(0, Command::NoteOn { part: 0, note: 60, velocity: 100 }).unwrap();
        render(&mut eng, 4800);
        assert_eq!((notes(&eng, 0), notes(&eng, 1)), (vec![60, 72], vec![72]));
        // c'' reaches pipe 72 directly: it sounds once and stays while either key is down
        ctl.send(0, Command::NoteOn { part: 0, note: 72, velocity: 100 }).unwrap();
        render(&mut eng, 4800);
        assert_eq!((notes(&eng, 0), notes(&eng, 1)), (vec![60, 72, 84], vec![72, 84]));
        ctl.send(0, Command::NoteOff { part: 0, note: 60 }).unwrap();
        render(&mut eng, 4800);
        assert_eq!((notes(&eng, 0), notes(&eng, 1)), (vec![72, 84], vec![84]));
        // coupling off stops what only the coupler held
        ctl.send(0, Command::SetCouplers { part: 0, couplers: Couplers::default() }).unwrap();
        render(&mut eng, 4800);
        assert_eq!((notes(&eng, 0), notes(&eng, 1)), (vec![72], vec![]));
    }

    #[test]
    fn unison_off_plays_only_the_coupled_division() {
        let Some((mut eng, mut ctl)) = two_divisions() else { return };
        ctl.send(0, Command::SetCouplers { part: 0, couplers: Couplers::new(&[Route { part: 1, shift: -12 }], true) }).unwrap();
        ctl.send(0, Command::NoteOn { part: 0, note: 60, velocity: 100 }).unwrap();
        render(&mut eng, 4800);
        assert_eq!((notes(&eng, 0), notes(&eng, 1)), (vec![], vec![48]));
        // unison back on while the key is held: the great's own pipe starts
        ctl.send(0, Command::SetCouplers { part: 0, couplers: Couplers::new(&[Route { part: 1, shift: -12 }], false) }).unwrap();
        render(&mut eng, 4800);
        assert_eq!((notes(&eng, 0), notes(&eng, 1)), (vec![60], vec![48]));
        ctl.send(0, Command::NoteOff { part: 0, note: 60 }).unwrap();
        render(&mut eng, 4800);
        assert_eq!((notes(&eng, 0), notes(&eng, 1)), (vec![], vec![]));
    }

    #[test]
    fn speech_delay_starts_pipes_later_and_not_after_a_short_press() {
        let Some(a) = model("organ/great-principal-8") else { return };
        let (mut eng, mut ctl) = Engine::new(EngineConfig::default());
        let layer = InstLayer { speech_ms: 20.0, ..InstLayer::new(a) };
        let mut inst = Instrument::default();
        inst.layers.push(layer);
        ctl.send(0, Command::set_instrument(0, inst)).unwrap();
        let mut started = Vec::new();
        for _ in 0..40 {
            let t0 = eng.now();
            ctl.send(t0, Command::NoteOn { part: 0, note: 60, velocity: 100 }).unwrap();
            let mut at = None;
            for f in 0..1100 {
                render(&mut eng, 1);
                if at.is_none() && speaking(&eng, 0) == 1 {
                    at = Some(f);
                }
            }
            let at = at.expect("the pipe speaks within the delay");
            assert!(at <= 960, "within 20 ms: {at}");
            started.push(at);
            ctl.send(eng.now(), Command::NoteOff { part: 0, note: 60 }).unwrap();
            render(&mut eng, 48000);
        }
        let spread = started.iter().max().unwrap() - started.iter().min().unwrap();
        assert!(spread > 400, "delays vary from note to note: {started:?}");
        // a key let go before the pipe speaks never starts it
        for _ in 0..10 {
            let t0 = eng.now();
            ctl.send(t0, Command::NoteOn { part: 0, note: 62, velocity: 100 }).unwrap();
            ctl.send(t0 + 1, Command::NoteOff { part: 0, note: 62 }).unwrap();
            render(&mut eng, 2000);
            assert_eq!(speaking(&eng, 0), 0, "no pipe starts after its key is up");
        }
    }

    #[test]
    fn key_noise_plays_from_its_own_keyboard_only() {
        let Some((mut eng, mut ctl)) = two_divisions() else { return };
        let Some(noise) = model("organ/great-principal-8") else { return };
        let layer = InstLayer { direct_only: true, ..InstLayer::new(noise) };
        ctl.send(0, Command::add_layer(1, layer)).unwrap();
        ctl.send(0, Command::SetCouplers { part: 0, couplers: Couplers::to_parts(1 << 1) }).unwrap();
        ctl.send(0, Command::NoteOn { part: 0, note: 60, velocity: 100 }).unwrap();
        render(&mut eng, 480);
        let on1 = |eng: &Engine| eng.voices.iter().filter(|v| v.is_active() && v.part == 1).count();
        assert_eq!(on1(&eng), 1, "coupled: the swell pipe, no swell key noise");
        ctl.send(0, Command::NoteOn { part: 1, note: 64, velocity: 100 }).unwrap();
        render(&mut eng, 480);
        assert_eq!(on1(&eng), 3, "played on the swell: pipe and key noise");
        ctl.send(0, Command::NoteOff { part: 1, note: 64 }).unwrap();
        render(&mut eng, 480);
        let noise_on = eng.voices.iter().filter(|v| v.is_active() && v.part == 1 && v.layer_id == 1 && !v.is_released()).count();
        assert_eq!(noise_on, 1, "the key noise plays on after the key is up");
    }

    /// A two-division organ (great with 8 stops, swell with 4, coupled), a piano and
    /// strings-like violin, played for `seconds` with `threads` rendering threads.
    fn ensemble(threads: usize, seconds: f32) -> Option<(Vec<f32>, Vec<f32>, usize)> {
        let great = ["great-principal-8", "great-octave-4", "great-octave-2", "great-mixture", "great-gedackt-8", "great-trumpet-8", "great-sesquialtera", "great-rohrflute-4"];
        let swell = ["swell-rohrflute-8", "swell-principal-4", "swell-scharf", "swell-schalmei-8"];
        let mut g = Instrument::default();
        for (i, name) in great.iter().enumerate() {
            let m = model(&format!("organ/{name}"))?;
            g.layers.push(InstLayer { speech_ms: 10.0, detune_cents: i as f32 * 0.3 - 1.0, ..InstLayer::new(m) });
        }
        let mut sw = Instrument::default();
        for name in swell {
            sw.layers.push(InstLayer { speech_ms: 10.0, ..InstLayer::new(model(&format!("organ/{name}"))?) });
        }
        let (piano, violin) = (model("grand-piano")?, model("violin")?);
        let (mut eng, mut ctl) = Engine::new(EngineConfig { threads, max_voices: 160, ..EngineConfig::default() });
        ctl.send(0, Command::set_instrument(0, g)).unwrap();
        ctl.send(0, Command::set_instrument(1, sw)).unwrap();
        ctl.send(0, Command::set_instrument(2, Instrument::single(piano))).unwrap();
        ctl.send(0, Command::set_instrument(3, Instrument::single(violin))).unwrap();
        ctl.send(0, Command::SetCouplers { part: 0, couplers: Couplers::to_parts(1 << 1) }).unwrap();
        ctl.send(0, Command::SetPartParam { part: 0, param: PartParam::Wind, value: 0.5 }).unwrap();
        ctl.send(0, Command::SetPartParam { part: 1, param: PartParam::TremDepth, value: 1.0 }).unwrap();
        ctl.send(0, Command::SetPartParam { part: 3, param: PartParam::ChorusMix, value: 0.3 }).unwrap();
        let sr = 48000.0;
        let mut t = 0.05f32;
        let mut k = 0u8;
        while t < seconds - 0.5 {
            let at = (t * sr) as u64;
            for n in [48u8, 55, 60, 64, 67].iter().map(|n| n + k % 5) {
                ctl.send(at, Command::NoteOn { part: 0, note: n, velocity: 100 }).unwrap();
                ctl.send(at + 9000, Command::NoteOff { part: 0, note: n }).unwrap();
            }
            ctl.send(at + 1000, Command::NoteOn { part: 2, note: 40 + k, velocity: 90 }).unwrap();
            ctl.send(at + 1000, Command::NoteOn { part: 3, note: 62 + k % 7, velocity: 90 }).unwrap();
            ctl.send(at + 15000, Command::NoteOff { part: 3, note: 62 + k % 7 }).unwrap();
            t += 0.23;
            k = k.wrapping_add(1);
        }
        let n = (seconds * sr) as usize;
        let (mut l, mut r) = (vec![0.0; n], vec![0.0; n]);
        let mut most = 0;
        // buffers of varying size, as audio callbacks deliver them
        let mut i = 0;
        let mut b = 0;
        while i < n {
            let len = [128usize, 64, 441, 37, 256][b % 5].min(n - i);
            eng.process_planar(&mut l[i..i + len], &mut r[i..i + len]);
            most = most.max(eng.active_voices());
            i += len;
            b += 1;
        }
        Some((l, r, most))
    }

    #[test]
    fn the_output_is_the_same_for_any_number_of_threads() {
        let Some((l1, r1, voices)) = ensemble(1, 4.0) else { return };
        assert!(voices > PARALLEL_VOICES * 3, "a load worth sharing out: {voices} voices");
        assert!(rms(&l1) > 1e-3);
        for threads in [2, 3, 4] {
            let (l, r, _) = ensemble(threads, 4.0).unwrap();
            let same = l.iter().zip(&l1).chain(r.iter().zip(&r1)).all(|(a, b)| a.to_bits() == b.to_bits());
            assert!(same, "{threads} threads render differently from one");
        }
    }

    #[test]
    fn a_stop_drawn_on_a_held_note_speaks_after_its_delay() {
        let Some((mut eng, mut ctl)) = two_divisions() else { return };
        let Some(b) = model("organ/swell-rohrflute-8") else { return };
        ctl.send(0, Command::NoteOn { part: 0, note: 60, velocity: 100 }).unwrap();
        render(&mut eng, 4800);
        let layer = InstLayer { speech_ms: 12.0, enabled: false, ..InstLayer::new(b) };
        ctl.send(eng.now(), Command::add_layer(0, layer)).unwrap();
        ctl.send(eng.now(), Command::SetLayerEnabled { part: 0, layer: 1, enabled: true }).unwrap();
        render(&mut eng, 4800);
        assert_eq!(speaking(&eng, 0), 2);
    }

    // ── overload guard ──────────────────────────────────────────────────────

    #[derive(Clone, Copy)]
    enum Load {
        /// guard not armed
        Off,
        /// armed, acting on the measured render time
        Measured,
        /// armed, acting on this load
        Forced(f32, f32),
        /// this load, the guard not armed
        Disarmed(f32, f32),
    }

    /// Piano with pedal, a string section, or an organ plenum with pedal (great + pedal), playing
    /// for `seconds` in 128-frame buffers (as an audio callback). Returns the output
    /// (interleaved by buffer), whether the guard ever engaged, and the engine.
    fn guarded(kind: &str, load: Load, seconds: f32) -> Option<(Vec<f32>, bool, Engine, usize)> {
        let (mut eng, mut ctl) = Engine::new(EngineConfig { threads: 3, ..EngineConfig::default() });
        let sr = 48000.0;
        let at = |t: f32| (t * sr) as u64;
        match kind {
            "piano" => {
                ctl.send(0, Command::set_instrument(0, Instrument::single(model("grand-piano")?))).unwrap();
                let mut t = 0.05;
                let mut i = 0u8;
                while t < seconds - 0.3 {
                    let n = 40 + (i * 7) % 36;
                    ctl.send(at(t), Command::NoteOn { part: 0, note: n, velocity: 70 + i % 40 }).unwrap();
                    ctl.send(at(t + 0.25), Command::NoteOff { part: 0, note: n }).unwrap();
                    if i.is_multiple_of(8) {
                        let value = if i.is_multiple_of(16) { 127 } else { 0 };
                        ctl.send(at(t), Command::ControlChange { part: 0, controller: 64, value }).unwrap();
                    }
                    t += 0.12;
                    i = i.wrapping_add(1);
                }
            }
            "strings" => {
                let mut s = Instrument::default();
                for name in ["violins", "violas", "cellos"] {
                    s.layers.push(InstLayer::new(model(name)?));
                }
                ctl.send(0, Command::set_instrument(0, s)).unwrap();
                let mut t = 0.05;
                let mut i = 0u8;
                while t < seconds - 0.3 {
                    let n = 50 + (i * 5) % 24;
                    ctl.send(at(t), Command::NoteOn { part: 0, note: n, velocity: 90 }).unwrap();
                    ctl.send(at(t + 0.6), Command::NoteOff { part: 0, note: n }).unwrap();
                    t += 0.3;
                    i = i.wrapping_add(1);
                }
            }
            _ => {
                let mut g = Instrument::default();
                for name in ["great-principal-8", "great-octave-4", "great-octave-2", "great-mixture"] {
                    g.layers.push(InstLayer { speech_ms: 10.0, ..InstLayer::new(model(&format!("organ/{name}"))?) });
                }
                let mut p = Instrument::default();
                for name in ["pedal-subbass-16", "pedal-principal-8"] {
                    p.layers.push(InstLayer { speech_ms: 10.0, ..InstLayer::new(model(&format!("organ/{name}"))?) });
                }
                ctl.send(0, Command::set_instrument(0, g)).unwrap();
                ctl.send(0, Command::set_instrument(1, p)).unwrap();
                let mut t = 0.05;
                let mut i = 0u8;
                while t < seconds - 0.3 {
                    for n in [60 + (i * 3) % 12, 67 + (i * 5) % 10] {
                        ctl.send(at(t), Command::NoteOn { part: 0, note: n, velocity: 100 }).unwrap();
                        ctl.send(at(t + 0.11), Command::NoteOff { part: 0, note: n }).unwrap();
                    }
                    if i.is_multiple_of(4) {
                        let n = 36 + i % 7;
                        ctl.send(at(t), Command::NoteOn { part: 1, note: n, velocity: 100 }).unwrap();
                        ctl.send(at(t + 0.45), Command::NoteOff { part: 1, note: n }).unwrap();
                    }
                    t += 0.25;
                    i = i.wrapping_add(1);
                }
            }
        }
        match load {
            Load::Off => {}
            Load::Measured => eng.set_overload_guard(true),
            Load::Forced(fixed, per_voice) => {
                eng.set_overload_guard(true);
                eng.force_guard_load(Some((fixed, per_voice)));
            }
            Load::Disarmed(fixed, per_voice) => eng.force_guard_load(Some((fixed, per_voice))),
        }
        let n = (seconds * sr) as usize;
        let mut out = vec![0.0f32; 2 * n];
        let (mut l, mut r) = ([0.0f32; 128], [0.0f32; 128]);
        let (mut engaged, mut most) = (false, 0);
        for b in 0..n / 128 {
            eng.process_planar(&mut l, &mut r);
            out[b * 256..b * 256 + 128].copy_from_slice(&l);
            out[b * 256 + 128..b * 256 + 256].copy_from_slice(&r);
            engaged |= eng.guard_stats().0;
            most = most.max(eng.active_voices());
        }
        Some((out, engaged, eng, most))
    }

    fn same_bits(a: &[f32], b: &[f32]) -> bool {
        a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x.to_bits() == y.to_bits())
    }

    #[test]
    fn the_overload_guard_changes_nothing_without_an_overload() {
        for kind in ["piano", "strings", "plenum"] {
            let Some((reference, _, _, _)) = guarded(kind, Load::Off, 3.0) else { return };
            assert!(rms(&reference) > 1e-3, "{kind} sounds");
            // a busy engine, below the guard's threshold: it watches and does nothing
            let (out, engaged, eng, _) = guarded(kind, Load::Forced(0.8, 0.0), 3.0).unwrap();
            assert!(!engaged, "{kind}: 80 % load does not engage the guard");
            assert_eq!(eng.guard_stats(), (false, 0, 0));
            assert!(same_bits(&out, &reference), "{kind}: the armed guard changed the output");
            // the real clock (release builds: a debug build may well be overloaded; and other
            // tests running at the same time may overload this machine for a while: retried)
            if !cfg!(debug_assertions) {
                let mut tries = 0;
                loop {
                    let (out, engaged, _, _) = guarded(kind, Load::Measured, 3.0).unwrap();
                    if !engaged {
                        assert!(same_bits(&out, &reference), "{kind}: the armed guard changed the output");
                        break;
                    }
                    tries += 1;
                    if tries == 4 {
                        eprintln!("{kind}: this machine kept the engine overloaded; null test on the measured load skipped");
                        break;
                    }
                }
            }
        }
    }

    #[test]
    fn the_overload_guard_sheds_the_quietest_released_notes_never_held_ones() {
        let Some(p8) = model("organ/great-principal-8") else { return };
        let o4 = model("organ/great-octave-4").unwrap();
        let (mut eng, mut ctl) = Engine::new(EngineConfig::default());
        let mut g = Instrument::single(p8);
        g.layers.push(InstLayer::new(o4));
        ctl.send(0, Command::set_instrument(0, g)).unwrap();
        // held: a chord; released: a run of short notes, whose recorded releases ring on
        for n in [48u8, 52, 55] {
            ctl.send(0, Command::NoteOn { part: 0, note: n, velocity: 100 }).unwrap();
        }
        for (i, n) in (60u8..84).enumerate() {
            let t = 4800 + i as u64 * 2400;
            ctl.send(t, Command::NoteOn { part: 0, note: n, velocity: 100 }).unwrap();
            ctl.send(t + 7200, Command::NoteOff { part: 0, note: n }).unwrap();
        }
        let (mut l, mut r) = ([0.0f32; 128], [0.0f32; 128]);
        let mut last = 0.0f32;
        let mut step = |l: &[f32], most: &mut f32| {
            for &x in l {
                *most = most.max((x - last).abs());
                last = x;
            }
        };
        // 1.5 s: every short note released, their tails ringing
        let mut step_before = 0.0f32;
        for _ in 0..560 {
            eng.process_planar(&mut l, &mut r);
            step(&l, &mut step_before);
        }
        let held = |e: &Engine| e.voices.iter().filter(|v| v.is_active() && !v.is_released()).count();
        let tails = |e: &Engine| e.voices.iter().filter(|v| v.is_active() && v.is_released() && !v.is_killing()).count();
        assert_eq!(held(&eng), 6, "the chord's pipes");
        let ringing = tails(&eng);
        assert!(ringing > 10, "released pipes ringing: {ringing}");

        // just overloaded: some tails go, the quietest
        eng.set_overload_guard(true);
        eng.force_guard_load(Some((0.0, 1.0 / (6 + ringing) as f32)));
        let mut step_shed = 0.0f32;
        let mut checked = false;
        for _ in 0..200 {
            let levels: Vec<(usize, f32)> =
                eng.voices.iter().enumerate().filter(|(_, v)| v.is_active() && v.is_released() && !v.is_killing()).map(|(i, v)| (i, v.output_level_db())).collect();
            let shed_before = eng.guard_stats().1;
            eng.process_planar(&mut l, &mut r);
            step(&l, &mut step_shed);
            if !checked && eng.guard_stats().1 > shed_before {
                let (gone, kept): (Vec<_>, Vec<_>) = levels.iter().copied().partition(|&(i, _): &(usize, f32)| eng.voices[i].is_killing() || !eng.voices[i].is_active());
                let loudest_gone = gone.iter().map(|g| g.1).fold(-200.0f32, f32::max);
                let quietest_kept = kept.iter().map(|k| k.1).fold(200.0f32, f32::min);
                assert!(!gone.is_empty() && !kept.is_empty(), "a mild overload sheds some tails ({} of {})", gone.len(), levels.len());
                assert!(loudest_gone <= quietest_kept, "quietest first: shed up to {loudest_gone} dB, kept from {quietest_kept} dB");
                checked = true;
            }
        }
        assert!(checked, "the guard engaged");
        assert_eq!(held(&eng), 6, "held notes are never shed");
        assert_eq!(eng.guard_stats().2, 0, "tails are left: no partial is touched");

        // heavily overloaded: every tail goes, then (last resort) partials of the held notes
        eng.force_guard_load(Some((0.0, 0.5)));
        for _ in 0..100 {
            eng.process_planar(&mut l, &mut r);
            step(&l, &mut step_shed);
        }
        let (active, shed, partials) = eng.guard_stats();
        assert!(active && eng.status.guard_active.load(Ordering::Relaxed));
        assert_eq!(eng.status.guard_voices_shed.load(Ordering::Relaxed), shed);
        assert!(shed > 0 && tails(&eng) == 0, "every tail shed under a heavy overload ({shed} shed, {} left)", tails(&eng));
        assert_eq!(held(&eng), 6, "held notes are never shed");
        assert!(partials > 0, "with no tail left, partials of the held notes go (last resort)");
        assert!(step_shed < 1.5 * step_before + 1e-3, "no click: largest sample step {step_shed} (before the guard: {step_before})");

        // load back to normal: the guard lets go after its hold time, the partials return
        eng.force_guard_load(Some((0.3, 0.0)));
        for _ in 0..600 {
            eng.process_planar(&mut l, &mut r);
        }
        assert!(!eng.guard_stats().0, "released after the overload");
        assert!(!eng.status.guard_active.load(Ordering::Relaxed));
        assert!(eng.voices.iter().filter(|v| v.is_active()).all(|v| v.partial_cap() == f32::INFINITY));
        assert_eq!(held(&eng), 6);
    }

    #[test]
    fn a_mild_overload_shortens_only_some_tails() {
        let Some((reference, _, _, most)) = guarded("plenum", Load::Off, 2.5) else { return };
        let (out, engaged, eng, _) = guarded("plenum", Load::Forced(0.0, 0.95 / most as f32), 2.5).unwrap();
        let (_, shed, partials) = eng.guard_stats();
        assert!(engaged && shed > 0, "90 % load engages the guard");
        assert_eq!(partials, 0, "enough tails: no partial is touched");
        assert!(!same_bits(&out, &reference));
        let (a, b) = (rms(&out), rms(&reference));
        assert!((a - b).abs() < 0.05 * b, "the music is the same, its quietest tails shorter: rms {a} vs {b}");
    }

    #[test]
    fn a_disarmed_guard_does_nothing_even_overloaded() {
        // (offline rendering: the guard is never armed, whatever the load)
        let Some((reference, _, _, _)) = guarded("plenum", Load::Off, 1.5) else { return };
        let (out, engaged, eng, _) = guarded("plenum", Load::Disarmed(5.0, 0.0), 1.5).unwrap();
        assert!(!engaged);
        assert_eq!(eng.guard_stats(), (false, 0, 0));
        assert!(same_bits(&out, &reference));
    }
}
