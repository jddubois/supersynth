#![deny(clippy::all)]

//! Node.js bindings for supersynth: napi types over `supersynth-host` (shared with the browser's
//! WebAssembly bindings), plus what only Node.js has here — an audio device (cpal), MIDI devices
//! (the ALSA sequencer on Linux, midir elsewhere), and model files loaded on worker threads.

mod audio;
mod midi;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;

use std::sync::Arc;

use audio::backend::{list_available_backends, BackendKind};
use audio::output::{default_output_rate, AudioOutput, OutputEvents};
use midi::devices::MidiDevices;
use supersynth_host::{CouplerSpec, EngineOptions, ErrorKind, GuardStats, Host, LayerSpec, MIDI_SOURCES};

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
    /// The engine's name where the system shows it: the JACK client (`<name>_out`) and the
    /// ALSA sequencer client of its MIDI devices (default "supersynth").
    pub client_name: Option<String>,
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
    /// Sound when the sustain pedal moves, never for a key (pedal noise).
    pub on_pedal: Option<bool>,
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
            on_pedal: l.on_pedal,
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

/// How to open a MIDI input (see `SynthEngine::open_midi_input`).
#[napi(object)]
pub struct JsMidiInput {
    /// Substring of the device name (ignoring case); the first device when left out.
    pub device: Option<String>,
    /// Play its notes on the parts their channels are routed to.
    pub route: bool,
    /// No such device now is not an error: it is connected when it appears.
    pub optional: bool,
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
    events: Arc<OutputEvents>,
    /// MIDI devices, opened with the first input (or output) used.
    midi: Option<MidiDevices>,
    backend: BackendKind,
    buffer_size: Option<u32>,
    client_name: String,
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
            client_name: None,
        });
        let backend = BackendKind::parse(o.backend.as_deref().unwrap_or(""));
        let sample_rate = o.sample_rate.unwrap_or_else(|| default_output_rate(&backend).unwrap_or(48000));
        let host = Host::new(EngineOptions { sample_rate, max_voices: o.max_voices, reverb: o.reverb, threads: o.threads }).map_err(js)?;
        let client_name = o.client_name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| "supersynth".into());
        Ok(Self { host, output: None, events: Arc::default(), midi: None, backend, buffer_size: o.buffer_size, client_name })
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

    /// Real-time output is running (it stops by itself when its device goes away).
    #[napi(getter)]
    pub fn is_running(&self) -> bool {
        self.output.is_some() && !self.events.stopped()
    }

    /// Whether real-time output renders at real-time priority: null until its first buffer (or
    /// with output stopped), false when the system refused it.
    #[napi(getter)]
    pub fn realtime(&self) -> Option<bool> {
        if self.output.is_some() {
            self.host.realtime()
        } else {
            None
        }
    }

    /// Xruns (buffers the audio system missed) its backend has reported so far: JACK reports
    /// them; ALSA, CoreAudio and WASAPI through cpal do not.
    #[napi(getter)]
    pub fn xruns(&self) -> f64 {
        self.events.xruns() as f64
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

    /// Part that MIDI input on `channel` (1–16) of `source` plays; 255 (or more) routes it to
    /// no part. Source 0 (the default) is any input; 1… are the inputs of `openMidiInput`.
    /// `controllers` false: only notes go to the part.
    #[napi]
    pub fn set_midi_route(&self, channel: u32, part: u32, source: Option<u32>, controllers: Option<bool>) -> Result<()> {
        self.host.set_midi_route(channel, part, source.unwrap_or(0), controllers.unwrap_or(true)).map_err(js)
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

    /// Start real-time output. `on_event` is called with null for an xrun the backend reports,
    /// and with the reason when the output stops by itself (its device went away, the JACK
    /// server shut down, the engine failed); `stop()` it then.
    #[napi(ts_args_type = "onEvent?: (stopped: string | null) => void")]
    pub fn start(&mut self, env: Env, on_event: Option<JsFunction>) -> Result<()> {
        if self.output.is_some() {
            if !self.events.stopped() {
                return Ok(());
            }
            self.stop();
        }
        self.host.check_open().map_err(js)?;
        let notify: Option<audio::output::Notify> = match on_event {
            Some(f) => {
                let mut tsfn: ThreadsafeFunction<Option<String>, ErrorStrategy::Fatal> = f.create_threadsafe_function(0, |ctx| Ok(vec![ctx.value]))?;
                tsfn.unref(&env)?;
                Some(Box::new(move |what: Option<&str>| {
                    tsfn.call(what.map(String::from), ThreadsafeFunctionCallMode::NonBlocking);
                }))
            }
            None => None,
        };
        self.events.reset(notify);
        // asked for before the stream starts, so the audio thread never waits for this lock:
        // the render workers take the audio thread's priority when it renders its first buffer
        self.host.set_realtime(true);
        match AudioOutput::start(
            self.host.engine().clone(),
            self.host.fault().clone(),
            Arc::clone(&self.events),
            &self.backend,
            self.host.sample_rate(),
            self.buffer_size,
            &self.client_name,
        ) {
            Ok(out) => self.output = Some(out),
            Err(e) => {
                self.host.set_realtime(false);
                self.events.reset(None);
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
        self.events.reset(None);
        self.host.set_realtime(false);
    }

    /// Render `frames` of audio offline. Returns interleaved stereo (L, R, L, R…).
    /// Not available while real-time output is running.
    #[napi]
    pub fn render(&self, frames: u32) -> Result<Float32Array> {
        self.host.render(frames).map(Float32Array::new).map_err(js)
    }

    // ── MIDI ────────────────────────────────────────────────────────────────

    fn midi_devices(&mut self) -> Result<&MidiDevices> {
        if self.midi.is_none() {
            self.midi = Some(MidiDevices::new(&self.client_name, MIDI_SOURCES).map_err(err)?);
        }
        Ok(self.midi.as_ref().expect("opened"))
    }

    /// Names of the MIDI input devices.
    #[napi]
    pub fn list_midi_devices(&mut self) -> Vec<String> {
        self.midi_devices().map(|m| m.inputs()).unwrap_or_default()
    }

    /// Names of the MIDI output devices.
    #[napi]
    pub fn list_midi_outputs(&mut self) -> Vec<String> {
        self.midi_devices().map(|m| m.outputs()).unwrap_or_default()
    }

    #[napi]
    pub fn list_audio_backends(&self) -> Vec<String> {
        list_available_backends()
    }

    /// Open MIDI input `source` (1–15): the first device whose name contains `device` (ignoring
    /// case; the first device when null), now and whenever one appears again after going away.
    /// Its messages are played on the parts their channels are routed to for this source, else
    /// for source 0 (when `route` is true, and only while real-time output is running), and
    /// passed to `on_message` as raw bytes. `on_state` is told when the device connects (true,
    /// its name) and goes away (false: the keys and pedals it held down are let go first).
    /// Returns the device's name, or null when there is none now and `optional` is true (else
    /// that is an error). Replaces what the source had.
    #[napi(ts_args_type = "source: number, options: { device?: string | null; route: boolean; optional: boolean }, onMessage: (bytes: Buffer) => void, onState: (connected: boolean, name: string) => void")]
    pub fn open_midi_input(&mut self, env: Env, source: u32, options: JsMidiInput, on_message: JsFunction, on_state: JsFunction) -> Result<Option<String>> {
        let JsMidiInput { device, route, optional } = options;
        if source == 0 || source as usize >= MIDI_SOURCES {
            return Err(err(format!("MIDI input {source} is not 1–{}", MIDI_SOURCES - 1)));
        }
        // (keeps Node.js running while the input is open)
        let msg_fn: ThreadsafeFunction<Vec<u8>, ErrorStrategy::Fatal> = on_message.create_threadsafe_function(0, |ctx| Ok(vec![Buffer::from(ctx.value)]))?;
        let mut state_fn: ThreadsafeFunction<(bool, String), ErrorStrategy::Fatal> =
            on_state.create_threadsafe_function(0, |ctx: napi::threadsafe_function::ThreadSafeCallContext<(bool, String)>| {
                let (c, n) = ctx.value;
                Ok(vec![ctx.env.get_boolean(c)?.into_unknown(), ctx.env.create_string(&n)?.into_unknown()])
            })?;
        state_fn.unref(&env)?;
        let router = self.host.midi_router();
        let release = self.host.midi_router();
        let slot = source as usize;
        // a source opened again lets go of what its previous device held
        release.release(slot);
        let devices = self.midi_devices()?;
        devices
            .open(
                slot,
                device.as_deref(),
                optional,
                Arc::new(move |bytes: &[u8]| {
                    if route {
                        router.route_from(slot, bytes);
                    }
                    msg_fn.call(bytes.to_vec(), ThreadsafeFunctionCallMode::NonBlocking);
                }),
                Arc::new(move |connected: bool, name: &str| {
                    if !connected {
                        release.release(slot);
                    }
                    state_fn.call((connected, name.to_string()), ThreadsafeFunctionCallMode::NonBlocking);
                }),
            )
            .map_err(err)
    }

    /// Close MIDI input `source`, or every input when left out; the keys and pedals they held
    /// down are let go.
    #[napi]
    pub fn close_midi_input(&mut self, source: Option<u32>) {
        let Some(m) = &self.midi else { return };
        let router = self.host.midi_router();
        for s in 1..MIDI_SOURCES {
            if source.is_none_or(|x| x as usize == s) {
                m.close(s);
                router.release(s);
            }
        }
    }

    /// Send whole MIDI messages (`bytes`) to the first output device whose name contains
    /// `device` (ignoring case). False when there is no such device.
    #[napi]
    pub fn send_midi(&mut self, device: String, bytes: Buffer) -> Result<bool> {
        let bytes = bytes.to_vec();
        self.midi_devices()?.send(&device, &bytes).map_err(err)
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
        self.events.reset(None);
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
