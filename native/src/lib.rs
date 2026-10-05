#![deny(clippy::all)]

//! Node.js bindings for supersynth: napi types over `supersynth-host` (shared with the browser's
//! WebAssembly bindings), plus what only Node.js has here — an audio device (cpal), MIDI devices
//! (midir), and model files loaded on worker threads.

mod audio;
mod midi;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;

use audio::backend::{list_available_backends, BackendKind};
use audio::output::{default_output_rate, AudioOutput};
use midi::input::{connect_midi_device, list_midi_devices, MidiInputHandle};
use supersynth_host::{CouplerSpec, EngineOptions, ErrorKind, GuardStats, Host, LayerSpec};

// ── JS objects ────────────────────────────────────────────────────────────────

#[napi(object)]
pub struct JsEngineOptions {
    /// Sample rate in Hz. Default: the output device's rate (or 48000 without a device).
    pub sample_rate: Option<u32>,
    pub backend: Option<String>,
    /// Maximum simultaneously sounding voices (default 1024).
    pub max_voices: Option<u32>,
    /// Reverb preset name (default "hall").
    pub reverb: Option<String>,
    /// Audio buffer size in frames (default: device default).
    pub buffer_size: Option<u32>,
    /// Threads rendering audio, the audio thread included (default 0 = one per core but one,
    /// at most 8). The output is the same for any number.
    pub threads: Option<u32>,
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

impl From<JsLayer> for LayerSpec {
    fn from(l: JsLayer) -> Self {
        LayerSpec {
            model: l.model,
            transpose: l.transpose,
            gain_db: l.gain_db,
            pan: l.pan,
            key_lo: l.key_lo,
            key_hi: l.key_hi,
            enabled: l.enabled,
            detune_cents: l.detune_cents,
            on_release: l.on_release,
            speech_ms: l.speech_ms,
            direct_only: l.direct_only,
        }
    }
}

/// What the overload guard has done (see `SynthEngine::set_overload_guard`).
#[napi(object)]
pub struct JsGuardStats {
    /// Shedding load now.
    pub active: bool,
    /// Released notes ended early so far.
    pub voices_shed: f64,
    /// Partials faded out so far (last resort, when no released note was left).
    pub partials_reduced: f64,
}

impl From<GuardStats> for JsGuardStats {
    fn from(s: GuardStats) -> Self {
        JsGuardStats { active: s.active, voices_shed: s.voices_shed as f64, partials_reduced: s.partials_reduced as f64 }
    }
}

/// One organ coupler: also play `part`, `shift` semitones away (±12: octave couplers).
#[napi(object)]
pub struct JsCoupler {
    pub part: u32,
    pub shift: Option<i32>,
}

// ── engine handle ────────────────────────────────────────────────────────────

fn err(msg: impl Into<String>) -> Error {
    Error::new(Status::GenericFailure, msg.into())
}

/// A host error as a JavaScript error.
fn js(e: supersynth_host::Error) -> Error {
    let status = match e.kind {
        ErrorKind::InvalidArg => Status::InvalidArg,
        ErrorKind::Failure => Status::GenericFailure,
    };
    Error::new(status, e.message)
}

#[napi]
pub struct SynthEngine {
    host: Host,
    output: Option<AudioOutput>,
    midi: Option<MidiInputHandle>,
    backend: BackendKind,
    buffer_size: Option<u32>,
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
            threads: None,
        });
        let backend = BackendKind::parse(o.backend.as_deref().unwrap_or(""));
        let sample_rate = o.sample_rate.unwrap_or_else(|| default_output_rate(&backend).unwrap_or(48000));
        let host = Host::new(EngineOptions { sample_rate, max_voices: o.max_voices, reverb: o.reverb, threads: o.threads }).map_err(js)?;
        Ok(Self { host, output: None, midi: None, backend, buffer_size: o.buffer_size })
    }

    /// True once rendering has failed (an internal error in the engine). The engine is then
    /// stopped for good: real-time output plays silence and `render()` throws. Create a new
    /// engine to continue.
    #[napi(getter)]
    pub fn faulted(&self) -> bool {
        self.host.faulted()
    }

    /// What made the engine fail (see `faulted`), or null.
    #[napi(getter)]
    pub fn error(&self) -> Option<String> {
        self.host.error()
    }

    #[napi(getter)]
    pub fn sample_rate(&self) -> u32 {
        self.host.sample_rate()
    }

    /// Engine clock in seconds (frames rendered so far).
    #[napi(getter)]
    pub fn current_time(&self) -> f64 {
        self.host.current_time()
    }

    #[napi(getter)]
    pub fn active_voices(&self) -> u32 {
        self.host.active_voices()
    }

    /// Fraction of real time spent rendering the last buffer (0.25 = 25 % of one core).
    #[napi(getter)]
    pub fn cpu_load(&self) -> f64 {
        self.host.cpu_load()
    }

    /// Peak output level of the last buffers (0–1, falling by half every buffer), in steps of
    /// 0.001 (-60 dBFS).
    #[napi(getter)]
    pub fn peak(&self) -> f64 {
        self.host.peak()
    }

    /// Threads rendering audio (the audio thread included).
    #[napi(getter)]
    pub fn threads(&self) -> u32 {
        self.host.threads()
    }

    #[napi(getter)]
    pub fn is_running(&self) -> bool {
        self.output.is_some()
    }

    /// Opt-in overload guard: while rendering in real time, when buffers come close to their
    /// deadline, end the quietest released notes early (then, as a last resort, fade out upper
    /// partials). Offline `render()` is never guarded.
    #[napi]
    pub fn set_overload_guard(&mut self, on: bool) {
        self.host.set_overload_guard(on);
    }

    /// Treat `render()` calls as real-time buffers (benchmarks and tests that drive the engine
    /// buffer by buffer as an audio callback would).
    #[napi]
    pub fn set_realtime_emulation(&mut self, on: bool) {
        self.host.set_realtime_emulation(on);
    }

    /// The overload guard is shedding load now.
    #[napi(getter)]
    pub fn guard_active(&self) -> bool {
        self.host.guard_active()
    }

    /// What the overload guard has done so far.
    #[napi(getter)]
    pub fn guard_stats(&self) -> JsGuardStats {
        self.host.guard_stats().into()
    }

    // ── models ──────────────────────────────────────────────────────────────

    /// Parse a spectral model (.ssm bytes). Returns a model id.
    #[napi]
    pub fn load_model(&mut self, bytes: Buffer) -> Result<u32> {
        self.host.load_model(bytes.as_ref()).map_err(js)
    }

    /// Load a model file (.ssm) in the background, on a pool of worker threads. Returns its id
    /// at once: the model can be used right away, and whatever uses it before it has loaded
    /// waits for just that model (loading it itself if no worker has started it yet). A file
    /// that fails to load fails each use with its error.
    #[napi]
    pub fn queue_model_file(&mut self, path: String) -> u32 {
        self.host.queue_model_file(path.into())
    }

    /// Call `callback` once all these models have loaded (or been unloaded): with null, or with
    /// the first loading error. The wait does not keep Node.js running.
    #[napi(ts_args_type = "ids: number[], callback: (error: string | null) => void")]
    pub fn watch_models(&self, env: Env, ids: Vec<u32>, callback: JsFunction) -> Result<()> {
        let mut tsfn: ThreadsafeFunction<Option<String>, ErrorStrategy::Fatal> =
            callback.create_threadsafe_function(0, |ctx| Ok(vec![ctx.value]))?;
        tsfn.unref(&env)?;
        self.host.watch_models(
            &ids,
            Box::new(move |error| {
                tsfn.call(error, ThreadsafeFunctionCallMode::NonBlocking);
            }),
        );
        Ok(())
    }

    /// Load these models next, before the other models queued (those not started yet).
    #[napi]
    pub fn hurry_models(&self, ids: Vec<u32>) {
        self.host.hurry_models(&ids);
    }

    /// Whether a model is still loading in the background (a use would wait for it).
    #[napi]
    pub fn model_loading(&self, id: u32) -> bool {
        self.host.model_loading(id)
    }

    /// Decoded size of a model in bytes, or null while it is still loading.
    #[napi]
    pub fn model_bytes(&self, id: u32) -> Option<f64> {
        self.host.model_bytes(id).map(|b| b as f64)
    }

    /// Release a model (instruments already using it keep their reference).
    #[napi]
    pub fn unload_model(&mut self, id: u32) {
        self.host.unload_model(id);
    }

    /// Model metadata as JSON.
    #[napi]
    pub fn model_info(&self, id: u32) -> Result<String> {
        self.host.model_info(id).map_err(js)
    }

    // ── parts ───────────────────────────────────────────────────────────────

    /// Assign an instrument (one or more layers) to a part.
    #[napi]
    pub fn set_instrument(&self, part: u32, layers: Vec<JsLayer>, time: Option<f64>) -> Result<()> {
        self.host.set_instrument(part, layers.into_iter().map(LayerSpec::from).collect(), time).map_err(js)
    }

    #[napi]
    pub fn note_on(&self, part: u32, note: u32, velocity: u32, time: Option<f64>) -> Result<()> {
        self.host.note_on(part, note, velocity, time).map_err(js)
    }

    #[napi]
    pub fn note_off(&self, part: u32, note: u32, time: Option<f64>) -> Result<()> {
        self.host.note_off(part, note, time).map_err(js)
    }

    #[napi]
    pub fn control_change(&self, part: u32, controller: u32, value: u32, time: Option<f64>) -> Result<()> {
        self.host.control_change(part, controller, value, time).map_err(js)
    }

    /// Pitch bend in -1..1.
    #[napi]
    pub fn pitch_bend(&self, part: u32, value: f64, time: Option<f64>) -> Result<()> {
        self.host.pitch_bend(part, value, time).map_err(js)
    }

    #[napi]
    pub fn set_param(&self, part: u32, name: String, value: f64, time: Option<f64>) -> Result<()> {
        self.host.set_param(part, &name, value, time).map_err(js)
    }

    #[napi]
    pub fn set_master_param(&self, name: String, value: f64, time: Option<f64>) -> Result<()> {
        self.host.set_master_param(&name, value, time).map_err(js)
    }

    /// Switch all reverb parameters to a named preset.
    #[napi]
    pub fn set_reverb_preset(&self, name: String, time: Option<f64>) -> Result<()> {
        self.host.set_reverb_preset(&name, time).map_err(js)
    }

    /// Add one layer to a part without interrupting sounding notes (organ stops).
    /// Returns nothing; the layer index is the number of layers added before it.
    #[napi]
    pub fn add_layer(&self, part: u32, layer: JsLayer, time: Option<f64>) -> Result<()> {
        self.host.add_layer(part, layer.into(), time).map_err(js)
    }

    #[napi]
    pub fn set_layer_enabled(&self, part: u32, layer: u32, enabled: bool, time: Option<f64>) -> Result<()> {
        self.host.set_layer_enabled(part, layer, enabled, time).map_err(js)
    }

    #[napi]
    pub fn set_layer_gain(&self, part: u32, layer: u32, gain_db: f64, time: Option<f64>) -> Result<()> {
        self.host.set_layer_gain(part, layer, gain_db, time).map_err(js)
    }

    /// Organ couplers: keys pressed on `part` (from any source: API, MIDI input, MIDI files)
    /// also play the `targets` parts, octave-shifted by their `shift`. An empty list releases
    /// all of its couplers. `unison_off`: the keys do not play `part` itself.
    #[napi]
    pub fn set_couplers(&self, part: u32, targets: Vec<JsCoupler>, unison_off: Option<bool>, time: Option<f64>) -> Result<()> {
        let targets: Vec<CouplerSpec> = targets.into_iter().map(|t| CouplerSpec { part: t.part, shift: t.shift }).collect();
        self.host.set_couplers(part, &targets, unison_off, time).map_err(js)
    }

    /// Part that MIDI input on `channel` (1–16) plays; 255 (or more) routes it to no part.
    #[napi]
    pub fn set_midi_route(&self, channel: u32, part: u32) -> Result<()> {
        self.host.set_midi_route(channel, part).map_err(js)
    }

    #[napi]
    pub fn all_notes_off(&self, part: Option<u32>, time: Option<f64>) -> Result<()> {
        self.host.all_notes_off(part, time).map_err(js)
    }

    #[napi]
    pub fn all_sound_off(&self) -> Result<()> {
        self.host.all_sound_off().map_err(js)
    }

    /// Free space in the command queue (events not yet consumed by the engine).
    #[napi(getter)]
    pub fn queue_free(&self) -> u32 {
        self.host.queue_free()
    }

    // ── audio output ────────────────────────────────────────────────────────

    #[napi]
    pub fn start(&mut self) -> Result<()> {
        if self.output.is_some() {
            return Ok(());
        }
        self.host.check_open().map_err(js)?;
        // asked for before the stream starts, so the audio thread never waits for this lock:
        // the render workers take the audio thread's priority when it renders its first buffer
        self.host.set_realtime(true);
        match AudioOutput::start(self.host.engine().clone(), self.host.fault().clone(), &self.backend, self.host.sample_rate(), self.buffer_size) {
            Ok(out) => self.output = Some(out),
            Err(e) => {
                self.host.set_realtime(false);
                return Err(err(e));
            }
        }
        // (arms the overload guard, if wanted)
        self.host.set_running(true);
        Ok(())
    }

    #[napi]
    pub fn stop(&mut self) {
        self.host.set_running(false);
        self.output = None;
        self.host.set_realtime(false);
    }

    /// Render `frames` of audio offline. Returns interleaved stereo (L, R, L, R…).
    /// Not available while real-time output is running.
    #[napi]
    pub fn render(&self, frames: u32) -> Result<Float32Array> {
        self.host.render(frames).map(Float32Array::new).map_err(js)
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
    /// channel is given with `set_midi_route`, when `route` is true, and only while real-time
    /// output is running) and forwarded to `callback` as raw bytes.
    #[napi]
    pub fn enable_midi(&mut self, device_name: Option<String>, route: bool, callback: JsFunction) -> Result<()> {
        let tsfn: ThreadsafeFunction<Vec<u8>, ErrorStrategy::Fatal> =
            callback.create_threadsafe_function(0, |ctx| Ok(vec![Buffer::from(ctx.value)]))?;
        let router = self.host.midi_router();
        let handle = connect_midi_device(
            device_name.as_deref(),
            Box::new(move |bytes| {
                if route {
                    router.route(&bytes);
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

    /// Stop output and MIDI and let go of everything the engine holds: its instruments and their
    /// models (freed on the loader's reclaim thread), voices and buffers, now rather than when
    /// the JavaScript object is garbage-collected. The engine cannot be used afterwards: its
    /// commands and `start()` fail, `render()` renders silence, and its clock and status keep
    /// their last values.
    #[napi]
    pub fn release_resources(&mut self) {
        self.host.set_running(false);
        self.output = None;
        self.midi = None;
        self.host.release_resources();
    }
}

/// Names of the built-in reverb presets.
#[napi]
pub fn reverb_presets() -> Vec<String> {
    supersynth_host::reverb_presets()
}

/// Names of all part parameters accepted by `setParam`.
#[napi]
pub fn part_param_names() -> Vec<String> {
    supersynth_host::part_param_names()
}
