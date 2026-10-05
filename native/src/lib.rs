#![deny(clippy::all)]

//! Node.js bindings for supersynth-core.

mod audio;
mod midi;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex};

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;

use audio::backend::{list_available_backends, BackendKind};
use audio::output::{default_output_rate, AudioOutput};
use midi::input::{connect_midi_device, list_midi_devices, MidiInputHandle};
use midi::message::{MidiMessage, MidiMessageKind};

/// A MIDI channel routed to no part: its messages only reach the JavaScript callback.
const NO_ROUTE: u8 = 255;
use supersynth_core::engine::params::{MasterParam, PartParam};
use supersynth_core::engine::{Command, Controller, Couplers, Engine, EngineConfig, InstLayer, Instrument, Route, Status as EngineStatus, MAX_PARTS, MAX_ROUTES};
use supersynth_core::fx::reverb::ReverbParams;
use supersynth_core::model::{Kind, Model, ReleaseMode};

// ── JS objects ────────────────────────────────────────────────────────────────

#[napi(object)]
pub struct JsEngineOptions {
    /// Sample rate in Hz. Default: the output device's rate (or 48000 without a device).
    pub sample_rate: Option<u32>,
    pub backend: Option<String>,
    /// Maximum simultaneously sounding voices (default 192).
    pub max_voices: Option<u32>,
    /// Reverb preset name (default "hall").
    pub reverb: Option<String>,
    /// Audio buffer size in frames (default: device default).
    pub buffer_size: Option<u32>,
}

#[napi(object)]
pub struct JsLayer {
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
#[napi(object)]
pub struct JsCoupler {
    pub part: u32,
    pub shift: Option<i32>,
}

fn inst_layer(model: &Arc<Model>, l: &JsLayer) -> InstLayer {
    InstLayer {
        model: Arc::clone(model),
        transpose: l.transpose.unwrap_or(0.0) as f32,
        gain_db: l.gain_db.unwrap_or(0.0) as f32,
        pan: l.pan.unwrap_or(0.0) as f32,
        key_lo: l.key_lo.unwrap_or(0).min(127) as u8,
        key_hi: l.key_hi.unwrap_or(127).min(127) as u8,
        enabled: l.enabled.unwrap_or(true),
        detune_cents: l.detune_cents.unwrap_or(0.0) as f32,
        on_release: l.on_release.unwrap_or(false),
        speech_ms: l.speech_ms.unwrap_or(0.0).clamp(0.0, 200.0) as f32,
        direct_only: l.direct_only.unwrap_or(false),
    }
}

// ── engine handle ────────────────────────────────────────────────────────────

struct Shared {
    ctl: Mutex<Controller>,
    status: Arc<EngineStatus>,
    sample_rate: f32,
    /// Part each MIDI channel (1–16) plays when MIDI input is routed (`NO_ROUTE`: none)
    /// until changed.
    midi_routes: [AtomicU8; 16],
}

impl Shared {
    fn send(&self, time: Option<f64>, cmd: Command) -> Result<()> {
        let frame = time.map(|t| (t.max(0.0) * self.sample_rate as f64).round() as u64).unwrap_or(0);
        let mut c = self.ctl.lock().map_err(|_| Error::new(Status::GenericFailure, "controller lock poisoned"))?;
        c.send(frame, cmd).map_err(|e| Error::new(Status::GenericFailure, e))
    }
}

#[napi]
pub struct SynthEngine {
    engine: Arc<Mutex<Engine>>,
    shared: Arc<Shared>,
    output: Option<AudioOutput>,
    midi: Option<MidiInputHandle>,
    models: HashMap<u32, Arc<Model>>,
    next_model: u32,
    sample_rate: u32,
    backend: BackendKind,
    buffer_size: Option<u32>,
}

fn err(msg: impl Into<String>) -> Error {
    Error::new(Status::GenericFailure, msg.into())
}

#[napi]
impl SynthEngine {
    #[napi(constructor)]
    pub fn new(options: Option<JsEngineOptions>) -> Result<Self> {
        let o = options.unwrap_or(JsEngineOptions {
            sample_rate: None,
            backend: None,
            max_voices: None,
            reverb: None,
            buffer_size: None,
        });
        let backend = BackendKind::parse(o.backend.as_deref().unwrap_or(""));
        let sample_rate = o.sample_rate.unwrap_or_else(|| default_output_rate(&backend).unwrap_or(48000));
        if !(8000..=384_000).contains(&sample_rate) {
            return Err(err(format!("unsupported sample rate {sample_rate}")));
        }
        let reverb_name = o.reverb.unwrap_or_else(|| "hall".into());
        let reverb = ReverbParams::preset(&reverb_name).ok_or_else(|| err(format!("unknown reverb preset '{reverb_name}'")))?;
        let (engine, ctl) = Engine::new(EngineConfig {
            sample_rate: sample_rate as f32,
            max_voices: o.max_voices.unwrap_or(192).clamp(8, 2048) as usize,
            reverb,
        });
        let status = Arc::clone(&ctl.status);
        Ok(Self {
            engine: Arc::new(Mutex::new(engine)),
            shared: Arc::new(Shared {
                ctl: Mutex::new(ctl),
                status,
                sample_rate: sample_rate as f32,
                midi_routes: std::array::from_fn(|_| AtomicU8::new(NO_ROUTE)),
            }),
            output: None,
            midi: None,
            models: HashMap::new(),
            next_model: 1,
            sample_rate,
            backend,
            buffer_size: o.buffer_size,
        })
    }

    #[napi(getter)]
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    /// Engine clock in seconds (frames rendered so far).
    #[napi(getter)]
    pub fn current_time(&self) -> f64 {
        self.shared.status.frames.load(Ordering::Relaxed) as f64 / self.sample_rate as f64
    }

    #[napi(getter)]
    pub fn active_voices(&self) -> u32 {
        self.shared.status.active_voices.load(Ordering::Relaxed)
    }

    /// Fraction of real time spent rendering the last buffer (0.25 = 25 % of one core).
    #[napi(getter)]
    pub fn cpu_load(&self) -> f64 {
        self.shared.status.load_permille.load(Ordering::Relaxed) as f64 / 1000.0
    }

    #[napi(getter)]
    pub fn is_running(&self) -> bool {
        self.output.is_some()
    }

    // ── models ──────────────────────────────────────────────────────────────

    /// Parse a spectral model (.ssm bytes). Returns a model id.
    #[napi]
    pub fn load_model(&mut self, bytes: Buffer) -> Result<u32> {
        let m = Model::from_bytes(bytes.as_ref()).map_err(err)?;
        let id = self.next_model;
        self.next_model += 1;
        self.models.insert(id, Arc::new(m));
        Ok(id)
    }

    /// Release a model (instruments already using it keep their reference).
    #[napi]
    pub fn unload_model(&mut self, id: u32) {
        self.models.remove(&id);
    }

    /// Model metadata as JSON.
    #[napi]
    pub fn model_info(&self, id: u32) -> Result<String> {
        let m = self.models.get(&id).ok_or_else(|| err(format!("unknown model {id}")))?;
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
    #[napi]
    pub fn set_instrument(&self, part: u32, layers: Vec<JsLayer>, time: Option<f64>) -> Result<()> {
        let mut inst = Instrument::default();
        for l in layers {
            let model = self.models.get(&l.model).ok_or_else(|| err(format!("unknown model {}", l.model)))?;
            inst.layers.push(inst_layer(model, &l));
        }
        self.shared.send(time, Command::SetInstrument { part: part as u16, instrument: Box::new(inst) })
    }

    #[napi]
    pub fn note_on(&self, part: u32, note: u32, velocity: u32, time: Option<f64>) -> Result<()> {
        if note > 127 {
            return Err(err(format!("note {note} out of range 0-127")));
        }
        self.shared.send(time, Command::NoteOn { part: part as u16, note: note as u8, velocity: velocity.min(127) as u8 })
    }

    #[napi]
    pub fn note_off(&self, part: u32, note: u32, time: Option<f64>) -> Result<()> {
        if note > 127 {
            return Err(err(format!("note {note} out of range 0-127")));
        }
        self.shared.send(time, Command::NoteOff { part: part as u16, note: note as u8 })
    }

    #[napi]
    pub fn control_change(&self, part: u32, controller: u32, value: u32, time: Option<f64>) -> Result<()> {
        self.shared.send(
            time,
            Command::ControlChange { part: part as u16, controller: controller.min(127) as u8, value: value.min(127) as u8 },
        )
    }

    /// Pitch bend in -1..1.
    #[napi]
    pub fn pitch_bend(&self, part: u32, value: f64, time: Option<f64>) -> Result<()> {
        self.shared.send(time, Command::PitchBend { part: part as u16, value: value as f32 })
    }

    #[napi]
    pub fn set_param(&self, part: u32, name: String, value: f64, time: Option<f64>) -> Result<()> {
        let p = PartParam::parse(&name).ok_or_else(|| err(format!("unknown parameter '{name}'")))?;
        self.shared.send(time, Command::SetPartParam { part: part as u16, param: p, value: value as f32 })
    }

    #[napi]
    pub fn set_master_param(&self, name: String, value: f64, time: Option<f64>) -> Result<()> {
        let p = MasterParam::parse(&name).ok_or_else(|| err(format!("unknown master parameter '{name}'")))?;
        self.shared.send(time, Command::SetMasterParam { param: p, value: value as f32 })
    }

    /// Switch all reverb parameters to a named preset.
    #[napi]
    pub fn set_reverb_preset(&self, name: String, time: Option<f64>) -> Result<()> {
        let rp = ReverbParams::preset(&name).ok_or_else(|| err(format!("unknown reverb preset '{name}'")))?;
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

    /// Add one layer to a part without interrupting sounding notes (organ stops).
    /// Returns nothing; the layer index is the number of layers added before it.
    #[napi]
    pub fn add_layer(&self, part: u32, layer: JsLayer, time: Option<f64>) -> Result<()> {
        let model = self.models.get(&layer.model).ok_or_else(|| err(format!("unknown model {}", layer.model)))?;
        let l = inst_layer(model, &layer);
        self.shared.send(time, Command::AddLayer { part: part as u16, layer: Box::new(l) })
    }

    #[napi]
    pub fn set_layer_enabled(&self, part: u32, layer: u32, enabled: bool, time: Option<f64>) -> Result<()> {
        self.shared.send(time, Command::SetLayerEnabled { part: part as u16, layer: layer as u16, enabled })
    }

    #[napi]
    pub fn set_layer_gain(&self, part: u32, layer: u32, gain_db: f64, time: Option<f64>) -> Result<()> {
        self.shared.send(time, Command::SetLayerGain { part: part as u16, layer: layer as u16, gain_db: gain_db as f32 })
    }

    /// Organ couplers: keys pressed on `part` (from any source: API, MIDI input, MIDI files)
    /// also play the `targets` parts, octave-shifted by their `shift`. An empty list releases
    /// all of its couplers. `unison_off`: the keys do not play `part` itself.
    #[napi]
    pub fn set_couplers(&self, part: u32, targets: Vec<JsCoupler>, unison_off: Option<bool>, time: Option<f64>) -> Result<()> {
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
    #[napi]
    pub fn set_midi_route(&self, channel: u32, part: u32) -> Result<()> {
        if !(1..=16).contains(&channel) {
            return Err(err(format!("MIDI channel {channel} is not 1–16")));
        }
        self.shared.midi_routes[channel as usize - 1].store(part.min(NO_ROUTE as u32) as u8, Ordering::Relaxed);
        Ok(())
    }

    #[napi]
    pub fn all_notes_off(&self, part: Option<u32>, time: Option<f64>) -> Result<()> {
        self.shared.send(time, Command::AllNotesOff { part: part.map(|p| p as u16) })
    }

    #[napi]
    pub fn all_sound_off(&self) -> Result<()> {
        self.shared.send(None, Command::AllSoundOff)
    }

    /// Free space in the command queue (events not yet consumed by the engine).
    #[napi(getter)]
    pub fn queue_free(&self) -> u32 {
        self.shared.ctl.lock().map(|c| c.queue_free() as u32).unwrap_or(0)
    }

    // ── audio output ────────────────────────────────────────────────────────

    #[napi]
    pub fn start(&mut self) -> Result<()> {
        if self.output.is_some() {
            return Ok(());
        }
        let out = AudioOutput::start(Arc::clone(&self.engine), &self.backend, self.sample_rate, self.buffer_size).map_err(err)?;
        self.output = Some(out);
        Ok(())
    }

    #[napi]
    pub fn stop(&mut self) {
        self.output = None;
    }

    /// Render `frames` of audio offline. Returns interleaved stereo (L, R, L, R…).
    /// Not available while real-time output is running.
    #[napi]
    pub fn render(&self, frames: u32) -> Result<Float32Array> {
        if self.output.is_some() {
            return Err(err("render() is unavailable while real-time output is running; call stop() first"));
        }
        let mut eng = self.engine.lock().map_err(|_| err("engine lock poisoned"))?;
        let mut buf = vec![0.0f32; frames as usize * 2];
        eng.process_interleaved(&mut buf, 2);
        if let Ok(mut c) = self.shared.ctl.lock() {
            c.collect_garbage();
        }
        Ok(Float32Array::new(buf))
    }

    // ── MIDI ────────────────────────────────────────────────────────────────

    #[napi]
    pub fn list_midi_devices(&self) -> Vec<String> {
        list_midi_devices()
    }

    #[napi]
    pub fn list_audio_backends(&self) -> Vec<String> {
        list_available_backends()
    }

    /// Connect a MIDI input. Messages are applied to the engine immediately (to the part each
    /// channel is given with `set_midi_route`, when `route` is true) and forwarded to
    /// `callback` as raw bytes.
    #[napi]
    pub fn enable_midi(&mut self, device_name: Option<String>, route: bool, callback: JsFunction) -> Result<()> {
        let tsfn: ThreadsafeFunction<Vec<u8>, ErrorStrategy::Fatal> =
            callback.create_threadsafe_function(0, |ctx| Ok(vec![Buffer::from(ctx.value)]))?;
        let shared = Arc::clone(&self.shared);
        let handle = connect_midi_device(
            device_name.as_deref(),
            Box::new(move |bytes| {
                if route {
                    if let Some(msg) = MidiMessage::parse(&bytes) {
                        let ch = (msg.channel.clamp(1, 16) - 1) as usize;
                        let part = shared.midi_routes[ch].load(Ordering::Relaxed);
                        if part == NO_ROUTE {
                            tsfn.call(bytes, ThreadsafeFunctionCallMode::NonBlocking);
                            return;
                        }
                        let part = part as u16;
                        let cmd = match msg.kind {
                            MidiMessageKind::NoteOn => Some(Command::NoteOn { part, note: msg.data1, velocity: msg.data2 }),
                            MidiMessageKind::NoteOff => Some(Command::NoteOff { part, note: msg.data1 }),
                            MidiMessageKind::ControlChange => {
                                Some(Command::ControlChange { part, controller: msg.data1, value: msg.data2 })
                            }
                            MidiMessageKind::PitchBend => {
                                let v = ((msg.data2 as i32) << 7 | msg.data1 as i32) - 8192;
                                Some(Command::PitchBend { part, value: v as f32 / 8192.0 })
                            }
                            _ => None,
                        };
                        if let Some(c) = cmd {
                            let _ = shared.send(None, c);
                        }
                    }
                }
                tsfn.call(bytes, ThreadsafeFunctionCallMode::NonBlocking);
            }),
        )
        .map_err(err)?;
        self.midi = Some(handle);
        Ok(())
    }

    #[napi]
    pub fn disable_midi(&mut self) {
        self.midi = None;
    }
}

/// Names of the built-in reverb presets.
#[napi]
pub fn reverb_presets() -> Vec<String> {
    ["room", "studio", "chamber", "hall", "concert-hall", "church", "cathedral", "plate"].iter().map(|s| s.to_string()).collect()
}

/// Names of all part parameters accepted by `setParam`.
#[napi]
pub fn part_param_names() -> Vec<String> {
    PartParam::ALL.iter().map(|(n, _)| n.to_string()).collect()
}
