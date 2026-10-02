//! Real-time engine: command queue, scheduling, parts, voices and the master bus.
//!
//! Threading model: a [`Controller`] (owned by the API thread) pushes timestamped
//! [`Command`]s through a lock-free SPSC ring buffer. The [`Engine`] (owned by
//! the audio callback, or driven directly for offline rendering) drains the
//! queue at the start of every buffer, orders events by time, and renders in
//! sub-blocks split exactly at event times. Objects that need deallocation
//! (replaced instruments) are sent back through a second ring buffer so the
//! audio thread never frees memory.

pub mod params;

use std::collections::BinaryHeap;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;

use crate::dsp::noise::Rng;
use crate::dsp::{db_to_amp, BLOCK};
use crate::fx::chorus::{Chorus, ChorusParams};
use crate::fx::drive::Drive;
use crate::fx::eq::{Eq as Equalizer, EqParams};
use crate::fx::leslie::{Leslie, LeslieSpeed};
use crate::fx::limiter::{soft_clip, Limiter};
use crate::fx::reverb::{Reverb, ReverbParams};
use crate::fx::StereoEffect;
use crate::model::Model;
use crate::voice::noisebank::NoiseBank;
use crate::voice::spectral::{BlockMod, NoteOn, SpectralParams, SpectralVoice, MAX_BANDS};
use params::{MasterParam, PartParam};

pub const MAX_PARTS: usize = 32;
const QUEUE_CAPACITY: usize = 1 << 15;

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
}

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
        layers.push(InstLayer {
                model,
                transpose: 0.0,
                gain_db: 0.0,
                pan: 0.0,
                key_lo: 0,
                key_hi: 127,
                enabled: true,
                detune_cents: 0.0,
                on_release: false,
            });
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
    SetInstrument { part: u16, instrument: Box<Instrument> },
    /// Append a layer to a part's instrument without interrupting sounding notes.
    AddLayer { part: u16, layer: Box<InstLayer> },
    SetLayerEnabled { part: u16, layer: u16, enabled: bool },
    SetLayerGain { part: u16, layer: u16, gain_db: f32 },
    AllNotesOff { part: Option<u16> },
    AllSoundOff,
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
}

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
pub enum Garbage {
    Instrument(#[allow(dead_code)] Box<Instrument>),
    Layer(#[allow(dead_code)] Box<InstLayer>),
}

/// Shared, lock-free status published by the engine.
#[derive(Default)]
pub struct Status {
    pub frames: AtomicU64,
    pub active_voices: AtomicU32,
    pub peak_milli: AtomicU32,
    pub load_permille: AtomicU32,
}

// ── controller (API side) ────────────────────────────────────────────────────

pub struct Controller {
    tx: rtrb::Producer<Event>,
    garbage: rtrb::Consumer<Garbage>,
    pub status: Arc<Status>,
    pub sample_rate: f32,
}

impl Controller {
    pub fn send(&mut self, time: u64, cmd: Command) -> Result<(), String> {
        self.collect_garbage();
        self.tx.push(Event { time, cmd }).map_err(|_| "supersynth command queue is full".to_string())
    }

    pub fn collect_garbage(&mut self) {
        while let Ok(g) = self.garbage.pop() {
            drop(g);
        }
    }

    pub fn now(&self) -> u64 {
        self.status.frames.load(Ordering::Relaxed)
    }

    pub fn queue_free(&self) -> usize {
        self.tx.slots()
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
    noise: Option<NoiseBank>,
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
        }
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
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            sample_rate: 48000.0,
            max_voices: 192,
            reverb: ReverbParams::preset("hall").expect("hall preset"),
        }
    }
}

pub struct Engine {
    sr: f32,
    rx: rtrb::Consumer<Event>,
    garbage: rtrb::Producer<Garbage>,
    status: Arc<Status>,
    heap: BinaryHeap<Pending>,
    seq: u64,
    now: u64,
    parts: Vec<Part>,
    voices: Vec<SpectralVoice>,
    max_voices: usize,
    age: u64,
    rng: Rng,
    reverb: Reverb,
    reverb_return_db: f32,
    limiter: Limiter,
    master_db: f32,
    master_gain_smoothed: f32,
    peak: f32,
    // scratch
    part_l: Box<[f32; BLOCK]>,
    part_r: Box<[f32; BLOCK]>,
    send_l: Box<[f32; BLOCK]>,
    send_r: Box<[f32; BLOCK]>,
    mix_l: Box<[f32; BLOCK]>,
    mix_r: Box<[f32; BLOCK]>,
}

impl Engine {
    pub fn new(cfg: EngineConfig) -> (Engine, Controller) {
        let (tx, rx) = rtrb::RingBuffer::new(QUEUE_CAPACITY);
        let (gtx, grx) = rtrb::RingBuffer::new(1024);
        let status = Arc::new(Status::default());
        let sr = cfg.sample_rate;
        let mut parts = Vec::with_capacity(MAX_PARTS);
        for _ in 0..MAX_PARTS {
            parts.push(Part::new(sr));
        }
        let mut voices = Vec::with_capacity(cfg.max_voices + 32);
        for _ in 0..cfg.max_voices + 32 {
            voices.push(SpectralVoice::default());
        }
        let mut limiter = Limiter::new(sr);
        limiter.set_ceiling_db(-0.3);
        let engine = Engine {
            sr,
            rx,
            garbage: gtx,
            status: Arc::clone(&status),
            heap: BinaryHeap::with_capacity(QUEUE_CAPACITY),
            seq: 0,
            now: 0,
            parts,
            voices,
            max_voices: cfg.max_voices,
            age: 0,
            rng: Rng::new(0x5EED_CAFE),
            reverb: Reverb::new(sr, cfg.reverb),
            reverb_return_db: 0.0,
            limiter,
            master_db: -6.0,
            master_gain_smoothed: db_to_amp(-6.0),
            peak: 0.0,
            part_l: Box::new([0.0; BLOCK]),
            part_r: Box::new([0.0; BLOCK]),
            send_l: Box::new([0.0; BLOCK]),
            send_r: Box::new([0.0; BLOCK]),
            mix_l: Box::new([0.0; BLOCK]),
            mix_r: Box::new([0.0; BLOCK]),
        };
        let ctl = Controller { tx, garbage: grx, status, sample_rate: sr };
        (engine, ctl)
    }

    pub fn sample_rate(&self) -> f32 {
        self.sr
    }

    pub fn now(&self) -> u64 {
        self.now
    }

    pub fn active_voices(&self) -> usize {
        self.voices.iter().filter(|v| v.is_active()).count()
    }

    // ── public render entry points ──────────────────────────────────────────

    /// Fill an interleaved buffer with `channels` channels (1 = mono downmix).
    pub fn process_interleaved(&mut self, out: &mut [f32], channels: usize) {
        let channels = channels.max(1);
        let frames = out.len() / channels;
        let mut done = 0;
        let mut l = [0.0f32; BLOCK];
        let mut r = [0.0f32; BLOCK];
        while done < frames {
            let n = (frames - done).min(BLOCK);
            self.process_planar(&mut l[..n], &mut r[..n]);
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

    /// Render planar stereo (any length), splitting at event boundaries.
    pub fn process_planar(&mut self, left: &mut [f32], right: &mut [f32]) {
        let start = std::time::Instant::now();
        self.drain_queue();
        let frames = left.len();
        let mut i = 0;
        while i < frames {
            // apply all events due now
            while let Some(top) = self.heap.peek() {
                if top.time <= self.now {
                    let ev = self.heap.pop().unwrap();
                    self.apply(ev.cmd);
                } else {
                    break;
                }
            }
            let mut n = (frames - i).min(BLOCK);
            if let Some(top) = self.heap.peek() {
                let until = (top.time - self.now) as usize;
                n = n.min(until.max(1));
            }
            self.render_block(&mut left[i..i + n], &mut right[i..i + n]);
            self.now += n as u64;
            i += n;
        }
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
        }
        self.peak *= 0.5;
    }

    fn drain_queue(&mut self) {
        while let Ok(ev) = self.rx.pop() {
            self.seq += 1;
            if self.heap.len() >= QUEUE_CAPACITY {
                // never reallocate on the audio thread: apply immediately
                self.apply(ev.cmd);
                continue;
            }
            self.heap.push(Pending { time: ev.time, seq: self.seq, cmd: ev.cmd });
        }
    }

    // ── command handling ────────────────────────────────────────────────────

    fn apply(&mut self, cmd: Command) {
        match cmd {
            Command::NoteOn { part, note, velocity } => {
                if velocity == 0 {
                    self.note_off(part as usize, note);
                } else {
                    self.note_on(part as usize, note, velocity);
                }
            }
            Command::NoteOff { part, note } => self.note_off(part as usize, note),
            Command::ControlChange { part, controller, value } => self.cc(part as usize, controller, value),
            Command::PitchBend { part, value } => {
                if let Some(p) = self.parts.get_mut(part as usize) {
                    p.bend = value.clamp(-1.0, 1.0);
                }
            }
            Command::SetPartParam { part, param, value } => self.set_part_param(part as usize, param, value),
            Command::SetMasterParam { param, value } => self.set_master_param(param, value),
            Command::SetInstrument { part, instrument } => {
                let pi = part as usize;
                if pi >= self.parts.len() {
                    let _ = self.garbage.push(Garbage::Instrument(instrument));
                    return;
                }
                for v in self.voices.iter_mut() {
                    if v.is_active() && v.part == pi {
                        v.kill();
                    }
                }
                let edges: Option<Vec<f32>> = instrument.layers.first().map(|l| l.model.noise_edges.clone());
                let p = &mut self.parts[pi];
                if let Some(old) = p.inst.replace(instrument) {
                    let _ = self.garbage.push(Garbage::Instrument(old));
                }
                // Noise bank: rebuild only if band layout changed. Building it allocates,
                // which is acceptable on instrument change (rare, not per note).
                if let Some(e) = edges {
                    let rebuild = p.noise.as_ref().map(|nb| nb.edges() != e.as_slice()).unwrap_or(true);
                    if rebuild && e.len() >= 2 {
                        p.noise = Some(NoiseBank::new(self.sr, &e, 0xB00 + pi as u64));
                    }
                }
            }
            Command::AddLayer { part, layer } => {
                let pi = part as usize;
                if pi >= self.parts.len() {
                    let _ = self.garbage.push(Garbage::Layer(layer));
                    return;
                }
                let enabled = layer.enabled;
                let edges = layer.model.noise_edges.clone();
                let p = &mut self.parts[pi];
                let inst = p.inst.get_or_insert_with(|| Box::new(Instrument::default()));
                // Vec growth may allocate; layers are added rarely (stop changes), and
                // `Instrument` reserves capacity up front so this normally does not.
                let mut l = *layer;
                l.enabled = false;
                inst.layers.push(l);
                let li = inst.layers.len() - 1;
                if p.noise.is_none() && edges.len() >= 2 {
                    p.noise = Some(NoiseBank::new(self.sr, &edges, 0xB00 + pi as u64));
                }
                if enabled {
                    self.set_layer_enabled(pi, li, true);
                }
            }
            Command::SetLayerEnabled { part, layer, enabled } => self.set_layer_enabled(part as usize, layer as usize, enabled),
            Command::SetLayerGain { part, layer, gain_db } => {
                if let Some(inst) = self.parts.get_mut(part as usize).and_then(|p| p.inst.as_mut()) {
                    if let Some(l) = inst.layers.get_mut(layer as usize) {
                        l.gain_db = gain_db;
                    }
                }
            }
            Command::AllNotesOff { part } => {
                for (pi, p) in self.parts.iter_mut().enumerate() {
                    if part.map(|x| x as usize == pi).unwrap_or(true) {
                        p.held = [false; 128];
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
                    p.pedal_hold = [false; 128];
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
        let n = self.parts[pi].inst.as_ref().map(|i| i.layers.iter().filter(|l| l.on_release).count()).unwrap_or(0);
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
        let (model, pitch, pan, sp) = {
            let p = &self.parts[pi];
            let Some(inst) = p.inst.as_ref() else { return };
            let Some(layer) = inst.layers.get(li) else { return };
            if !layer.enabled || note < layer.key_lo || note > layer.key_hi || layer.on_release != release_trigger {
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
        let v = &mut self.voices[slot];
        v.start(NoteOn { model: &model, note, velocity, pitch, pan, params: &sp, sample_rate: sr, rng: &mut self.rng });
        v.part = pi;
        v.layer_id = li as u32;
        v.age = age;
        v.one_shot = release_trigger;
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
        let v = &mut self.voices[slot];
        v.legato(NoteOn { model: &model, note, velocity, pitch, pan, params: &sp, sample_rate: sr, rng: &mut self.rng }, glide);
        v.part = pi;
        v.layer_id = li as u32;
    }

    fn alloc_voice(&mut self) -> usize {
        let active = self.voices.iter().filter(|v| v.is_active()).count();
        if active >= self.max_voices {
            // steal: prefer released voices, then the quietest, then the oldest
            let mut best = None;
            let mut best_score = f32::INFINITY;
            for (i, v) in self.voices.iter().enumerate() {
                if !v.is_active() {
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
        if let Some(i) = self.voices.iter().position(|v| !v.is_active()) {
            return i;
        }
        // all slots busy (including spares): hard-steal the oldest
        let i = (0..self.voices.len()).min_by_key(|&i| self.voices[i].age).unwrap_or(0);
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
            let sounding: Vec<(u8, u8)> = (0..128u8)
                .filter(|&n| p.held[n as usize] || p.pedal_hold[n as usize])
                .map(|n| (n, p.last_velocity[n as usize].max(1)))
                .collect();
            for (n, vel) in sounding {
                self.start_layer_voice(pi, li, n, vel);
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
        use PartParam::*;
        match param {
            Volume => p.volume_db = v,
            Pan => p.pan = v.clamp(-1.0, 1.0),
            ReverbSend => p.reverb_send = v,
            Brightness => p.sp.brightness = v,
            EvenDb => p.sp.even_db = v,
            NoiseDb => p.sp.noise_db = v,
            AttackScale => p.sp.attack_scale = v.max(0.05),
            DecayScale => p.sp.decay_scale = v.max(0.05),
            ReleaseScale => p.sp.release_scale = v.max(0.01),
            VibratoCents => p.sp.vibrato_cents = v.max(0.0),
            VibratoRate => p.sp.vibrato_rate = v.max(0.0),
            VibratoDelay => p.sp.vibrato_delay = v.max(0.0),
            Expression => p.sp.expression = v.clamp(0.0, 2.0),
            Formant => p.sp.formant = v,
            Inharmonicity => p.sp.inharmonicity = v.max(0.0),
            Spread => p.sp.spread = v,
            Humanize => p.sp.humanize_cents = v.max(0.0),
            VelocitySens => p.sp.velocity_sens = v.clamp(0.0, 1.0),
            MaxPartials => p.sp.max_partials = (v.max(1.0) as usize).min(crate::model::MAX_PARTIALS),
            GainDb => p.sp.gain_db = v,
            Jitter => p.sp.jitter = v.max(0.0),
            Shimmer => p.sp.shimmer = v.max(0.0),
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
            Glide => p.glide = v.max(0.0),
            TremDepth => p.trem_db = v.max(0.0),
            TremPitch => p.trem_cents = v.max(0.0),
            TremRate => p.trem_rate = v.max(0.0),
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
                p.chorus_params.mix = v.clamp(0.0, 1.0);
                p.chorus_on = v > 0.0;
            }
            ChorusRate => p.chorus_params.rate_hz = v,
            ChorusDepth => p.chorus_params.depth_ms = v,
            DriveAmount => {
                p.drive_params.0 = v.max(1.0);
                p.drive_on = v > 1.0;
            }
            DriveTone => p.drive_params.2 = v,
            DriveLevel => p.drive_params.3 = v,
            SwellBox => p.swell_box = v >= 0.5,
            Wind => p.wind = v.clamp(0.0, 4.0),
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
        }
        if !matches!(param, Volume | Ceiling | ReverbReturn) {
            self.reverb.set_params(rp);
        }
    }

    /// Replace all reverb parameters at once (e.g. switching presets).
    pub fn set_reverb(&mut self, p: ReverbParams) {
        self.reverb.set_params(p);
    }

    // ── rendering ───────────────────────────────────────────────────────────

    fn render_block(&mut self, out_l: &mut [f32], out_r: &mut [f32]) {
        let n = out_l.len();
        self.mix_l[..n].fill(0.0);
        self.mix_r[..n].fill(0.0);
        self.send_l[..n].fill(0.0);
        self.send_r[..n].fill(0.0);

        for pi in 0..self.parts.len() {
            let any = self.voices.iter().any(|v| v.is_active() && v.part == pi);
            let p = &mut self.parts[pi];
            if !any && !p.leslie_on && !p.chorus_on {
                if let Some(nb) = p.noise.as_mut() {
                    nb.clear_powers();
                }
                continue;
            }
            self.part_l[..n].fill(0.0);
            self.part_r[..n].fill(0.0);

            // smoothed expression (CC11)
            let a = 1.0 - (-(n as f32) / (0.02 * self.sr)).exp();
            p.expression_smoothed += (p.expression - p.expression_smoothed) * a;
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
                let demand: f32 = self
                    .voices
                    .iter()
                    .filter(|v| v.is_active() && v.part == pi)
                    .map(|v| v.level())
                    .sum::<f32>()
                    / 0.1;
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
            let md = BlockMod {
                cents: p.bend * p.bend_range * 100.0 + trem_c + wind_c,
                mod_vibrato: p.mod_wheel * p.mod_depth_cents,
                expression_gain: if p.swell_box {
                    // closed shutters: about −9 dB overall (plus the shelf below), not silence
                    db_to_amp(-9.0 * (1.0 - p.expression_smoothed)) * trem_g * wind_g
                } else {
                    p.expression_smoothed * trem_g * wind_g
                },
            };
            let sp = p.sp;
            if let Some(nb) = p.noise.as_mut() {
                nb.clear_powers();
            }
            // pitch-synchronous noise: Σ p_v·g_v(t) over voices with an envelope (p_v = the
            // voice's noise power), applied to the part's pooled noise as G = (Σ p_v g_v + rest) / Σ p
            let mut pulse_acc = [0.0f32; BLOCK];
            let (mut p_pulse, mut p_all) = (0.0f32, 0.0f32);
            for v in self.voices.iter_mut() {
                if !v.is_active() || v.part != pi {
                    continue;
                }
                v.render(&mut self.part_l[..n], &mut self.part_r[..n], &sp, &md);
                if let Some(nb) = p.noise.as_mut() {
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
                        for (a, &g) in pulse_acc[..n].iter_mut().zip(v.pulse_buf[..n].iter()) {
                            *a += pv * g;
                        }
                    }
                }
            }
            if let Some(nb) = p.noise.as_mut() {
                if p_pulse > 0.0 && p_all > 0.0 {
                    let mut nl = [0.0f32; BLOCK];
                    let mut nr = [0.0f32; BLOCK];
                    nb.render(&mut nl[..n], &mut nr[..n]);
                    let rest = p_all - p_pulse;
                    let inv = 1.0 / p_all;
                    for s in 0..n {
                        let g = (pulse_acc[s] + rest) * inv;
                        self.part_l[s] += nl[s] * g;
                        self.part_r[s] += nr[s] * g;
                    }
                } else {
                    nb.render(&mut self.part_l[..n], &mut self.part_r[..n]);
                }
            }

            // insert effects
            if p.drive_on {
                p.drive.process(&mut self.part_l[..n], &mut self.part_r[..n]);
            }
            if !p.eq.is_flat() {
                p.eq.process(&mut self.part_l[..n], &mut self.part_r[..n]);
            }
            if p.chorus_on {
                p.chorus.process(&mut self.part_l[..n], &mut self.part_r[..n]);
            }
            if p.leslie_on {
                p.leslie.process(&mut self.part_l[..n], &mut self.part_r[..n]);
            }
            if p.swell_box {
                // shutters absorb treble far more than bass: up to −14 dB above ~700 Hz
                let target = -14.0 * (1.0 - p.expression_smoothed);
                if (target - p.swell_shelf_db).abs() > 0.05 {
                    p.swell_shelf_db = target;
                    let c = crate::dsp::biquad::Coeffs::high_shelf(700.0, target, self.sr);
                    for f in p.swell_shelf.iter_mut() {
                        f.c = c;
                    }
                }
                if p.swell_shelf_db < -0.05 {
                    p.swell_shelf[0].process_block(&mut self.part_l[..n]);
                    p.swell_shelf[1].process_block(&mut self.part_r[..n]);
                }
            }

            // volume (smoothed) and sends
            let target = db_to_amp(p.volume_db);
            let g0 = p.gain_smoothed;
            let dg = (target - g0) / n as f32;
            let send = p.reverb_send();
            let mut g = g0;
            for i in 0..n {
                g += dg;
                let l = self.part_l[i] * g;
                let r = self.part_r[i] * g;
                self.mix_l[i] += l;
                self.mix_r[i] += r;
                self.send_l[i] += l * send;
                self.send_r[i] += r * send;
            }
            p.gain_smoothed = target;
        }

        // reverb send/return
        self.reverb.process(&mut self.send_l[..n], &mut self.send_r[..n]);
        let ret = db_to_amp(self.reverb_return_db);
        let target = db_to_amp(self.master_db);
        let g0 = self.master_gain_smoothed;
        let dg = (target - g0) / n as f32;
        let mut g = g0;
        for i in 0..n {
            g += dg;
            out_l[i] = (self.mix_l[i] + self.send_l[i] * ret) * g;
            out_r[i] = (self.mix_r[i] + self.send_r[i] * ret) * g;
        }
        self.master_gain_smoothed = target;
        self.limiter.process(out_l, out_r);
        let mut pk = self.peak;
        for i in 0..n {
            out_l[i] = soft_clip(out_l[i]);
            out_r[i] = soft_clip(out_r[i]);
            pk = pk.max(out_l[i].abs()).max(out_r[i].abs());
        }
        self.peak = pk;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(name: &str) -> Option<Arc<Model>> {
        let path = format!("{}/../../models/{name}.ssm", env!("CARGO_MANIFEST_DIR"));
        std::fs::read(path).ok().map(|b| Arc::new(Model::from_bytes(&b).expect("model parses")))
    }

    fn engine_with(name: &str) -> Option<(Engine, Controller)> {
        let m = model(name)?;
        let (eng, mut ctl) = Engine::new(EngineConfig::default());
        ctl.send(0, Command::SetInstrument { part: 0, instrument: Box::new(Instrument::single(m)) }).unwrap();
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
        ctl.send(0, Command::SetInstrument { part: 0, instrument: Box::new(Instrument::single(a)) }).unwrap();
        ctl.send(0, Command::NoteOn { part: 0, note: 60, velocity: 100 }).unwrap();
        render(&mut eng, 24000);
        let layer = InstLayer { model: b, transpose: 12.0, gain_db: 0.0, pan: 0.0, key_lo: 0, key_hi: 127, enabled: true, detune_cents: 0.0, on_release: false };
        ctl.send(0, Command::AddLayer { part: 0, layer: Box::new(layer) }).unwrap();
        render(&mut eng, 4800);
        assert_eq!(eng.active_voices(), 2);
    }
}
