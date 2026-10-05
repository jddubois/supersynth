//! Browser bindings for supersynth: wasm-bindgen types over `supersynth-host` (shared with the
//! Node.js addon), plus what only a browser has here.
//!
//! The module is built with shared memory (see `scripts/build-wasm.mjs`), and runs on three
//! kinds of threads, each instantiating it on the same memory:
//!
//! - the page's main thread: a [`SynthEngine`] (the API calls, models, MIDI input);
//! - an AudioWorklet: renders the engine for the audio device ([`render_audio`]), as the audio
//!   callback does natively;
//! - Web Workers: the engine's render workers, which the host starts for the threads the
//!   engine asked for ([`queued_threads`], [`run_queued_thread`]).
//!
//! The main thread never blocks (a browser forbids it): models load on it when first used or
//! between other work ([`SynthEngine::load_next`]), and the locks it shares with the audio
//! thread spin instead of waiting (`supersynth_host::sync`).

#![cfg(target_arch = "wasm32")]

use std::sync::{Arc, Mutex};

use serde::Deserialize;
use supersynth_core::engine::Engine;
use supersynth_host::fault::{render_guarded, Fault};
use supersynth_host::{models, CouplerSpec, EngineOptions, Host, LayerSpec, MidiRouter};
use wasm_bindgen::prelude::*;

use serde_wasm_bindgen::from_value;

fn js(e: supersynth_host::Error) -> JsError {
    JsError::new(&e.message)
}

fn arg<T: for<'de> Deserialize<'de>>(v: JsValue, what: &str) -> Result<T, JsError> {
    from_value(v).map_err(|e| JsError::new(&format!("invalid {what}: {e}")))
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Options {
    sample_rate: Option<u32>,
    max_voices: Option<u32>,
    reverb: Option<String>,
    threads: Option<u32>,
}

#[wasm_bindgen]
pub struct SynthEngine {
    host: Host,
    midi: MidiRouter,
}

#[wasm_bindgen]
impl SynthEngine {
    /// `options`: `{ sampleRate?, maxVoices?, reverb?, threads? }` (48000 Hz by default; the
    /// engine asks for `threads − 1` render workers, which the host starts).
    #[wasm_bindgen(constructor)]
    pub fn new(options: JsValue) -> Result<SynthEngine, JsError> {
        let o: Options = if options.is_undefined() || options.is_null() { Options::default() } else { arg(options, "engine options")? };
        let host = Host::new(EngineOptions { sample_rate: o.sample_rate.unwrap_or(48000), max_voices: o.max_voices, reverb: o.reverb, threads: o.threads }).map_err(js)?;
        let midi = host.midi_router();
        Ok(SynthEngine { host, midi })
    }

    #[wasm_bindgen(getter)]
    pub fn faulted(&self) -> bool {
        self.host.faulted()
    }

    #[wasm_bindgen(getter)]
    pub fn error(&self) -> Option<String> {
        self.host.error()
    }

    #[wasm_bindgen(getter, js_name = sampleRate)]
    pub fn sample_rate(&self) -> u32 {
        self.host.sample_rate()
    }

    #[wasm_bindgen(getter, js_name = currentTime)]
    pub fn current_time(&self) -> f64 {
        self.host.current_time()
    }

    #[wasm_bindgen(getter, js_name = activeVoices)]
    pub fn active_voices(&self) -> u32 {
        self.host.active_voices()
    }

    #[wasm_bindgen(getter, js_name = cpuLoad)]
    pub fn cpu_load(&self) -> f64 {
        self.host.cpu_load()
    }

    #[wasm_bindgen(getter)]
    pub fn peak(&self) -> f64 {
        self.host.peak()
    }

    #[wasm_bindgen(getter)]
    pub fn threads(&self) -> u32 {
        self.host.threads()
    }

    /// Opt-in overload guard (armed only while rendering in real time). In a browser it follows
    /// the load the AudioWorklet reports (every 64 buffers).
    #[wasm_bindgen(js_name = setOverloadGuard)]
    pub fn set_overload_guard(&mut self, on: bool) {
        self.host.set_overload_guard(on);
    }

    #[wasm_bindgen(js_name = setRealtimeEmulation)]
    pub fn set_realtime_emulation(&mut self, on: bool) {
        self.host.set_realtime_emulation(on);
    }

    #[wasm_bindgen(getter, js_name = guardActive)]
    pub fn guard_active(&self) -> bool {
        self.host.guard_active()
    }

    /// What the overload guard has done so far: `[active (0/1), voices shed, partials reduced]`.
    #[wasm_bindgen(js_name = guardStats)]
    pub fn guard_stats(&self) -> Vec<f64> {
        let s = self.host.guard_stats();
        vec![s.active as u8 as f64, s.voices_shed as f64, s.partials_reduced as f64]
    }

    #[wasm_bindgen(getter, js_name = queueFree)]
    pub fn queue_free(&self) -> u32 {
        self.host.queue_free()
    }

    /// Real-time output started or stopped (MIDI input is routed only while it runs; offline
    /// rendering is refused).
    #[wasm_bindgen(js_name = setRunning)]
    pub fn set_running(&self, running: bool) {
        self.host.set_running(running);
    }

    /// Fails once `releaseResources` was called (no more output either).
    #[wasm_bindgen(js_name = checkOpen)]
    pub fn check_open(&self) -> Result<(), JsError> {
        self.host.check_open().map_err(js)
    }

    // ── models ──────────────────────────────────────────────────────────────

    #[wasm_bindgen(js_name = loadModel)]
    pub fn load_model(&mut self, bytes: &[u8]) -> Result<u32, JsError> {
        self.host.load_model(bytes).map_err(js)
    }

    /// Queue a model's file bytes (fetched by the host); the id is usable at once (a use loads
    /// it on the spot if it has not loaded yet).
    #[wasm_bindgen(js_name = queueModelBytes)]
    pub fn queue_model_bytes(&mut self, name: String, bytes: Vec<u8>) -> u32 {
        self.host.queue_model_bytes(name, bytes)
    }

    /// Load the next queued model now, if one is waiting; returns whether there was one.
    #[wasm_bindgen(js_name = loadNext)]
    pub fn load_next(&self) -> bool {
        self.host.models().load_next()
    }

    #[wasm_bindgen(js_name = hurryModels)]
    pub fn hurry_models(&self, ids: Vec<u32>) {
        self.host.hurry_models(&ids);
    }

    #[wasm_bindgen(js_name = modelLoading)]
    pub fn model_loading(&self, id: u32) -> bool {
        self.host.model_loading(id)
    }

    /// A loaded model's loading error, if it failed (null while it is still loading).
    #[wasm_bindgen(js_name = modelError)]
    pub fn model_error(&self, id: u32) -> Option<String> {
        if self.host.model_loading(id) {
            return None;
        }
        self.host.models().get(id).err()
    }

    #[wasm_bindgen(js_name = modelBytes)]
    pub fn model_bytes(&self, id: u32) -> Option<f64> {
        self.host.model_bytes(id).map(|b| b as f64)
    }

    #[wasm_bindgen(js_name = unloadModel)]
    pub fn unload_model(&mut self, id: u32) {
        self.host.unload_model(id);
    }

    #[wasm_bindgen(js_name = modelInfo)]
    pub fn model_info(&self, id: u32) -> Result<String, JsError> {
        self.host.model_info(id).map_err(js)
    }

    // ── parts ───────────────────────────────────────────────────────────────

    #[wasm_bindgen(js_name = setInstrument)]
    pub fn set_instrument(&self, part: u32, layers: JsValue, time: Option<f64>) -> Result<(), JsError> {
        let layers: Vec<LayerSpec> = arg(layers, "layers")?;
        self.host.set_instrument(part, layers, time).map_err(js)
    }

    #[wasm_bindgen(js_name = addLayer)]
    pub fn add_layer(&self, part: u32, layer: JsValue, time: Option<f64>) -> Result<(), JsError> {
        let layer: LayerSpec = arg(layer, "layer")?;
        self.host.add_layer(part, layer, time).map_err(js)
    }

    #[wasm_bindgen(js_name = noteOn)]
    pub fn note_on(&self, part: u32, note: u32, velocity: u32, time: Option<f64>) -> Result<(), JsError> {
        self.host.note_on(part, note, velocity, time).map_err(js)
    }

    #[wasm_bindgen(js_name = noteOff)]
    pub fn note_off(&self, part: u32, note: u32, time: Option<f64>) -> Result<(), JsError> {
        self.host.note_off(part, note, time).map_err(js)
    }

    #[wasm_bindgen(js_name = controlChange)]
    pub fn control_change(&self, part: u32, controller: u32, value: u32, time: Option<f64>) -> Result<(), JsError> {
        self.host.control_change(part, controller, value, time).map_err(js)
    }

    #[wasm_bindgen(js_name = pitchBend)]
    pub fn pitch_bend(&self, part: u32, value: f64, time: Option<f64>) -> Result<(), JsError> {
        self.host.pitch_bend(part, value, time).map_err(js)
    }

    #[wasm_bindgen(js_name = setParam)]
    pub fn set_param(&self, part: u32, name: &str, value: f64, time: Option<f64>) -> Result<(), JsError> {
        self.host.set_param(part, name, value, time).map_err(js)
    }

    #[wasm_bindgen(js_name = setMasterParam)]
    pub fn set_master_param(&self, name: &str, value: f64, time: Option<f64>) -> Result<(), JsError> {
        self.host.set_master_param(name, value, time).map_err(js)
    }

    #[wasm_bindgen(js_name = setReverbPreset)]
    pub fn set_reverb_preset(&self, name: &str, time: Option<f64>) -> Result<(), JsError> {
        self.host.set_reverb_preset(name, time).map_err(js)
    }

    #[wasm_bindgen(js_name = setLayerEnabled)]
    pub fn set_layer_enabled(&self, part: u32, layer: u32, enabled: bool, time: Option<f64>) -> Result<(), JsError> {
        self.host.set_layer_enabled(part, layer, enabled, time).map_err(js)
    }

    #[wasm_bindgen(js_name = setLayerGain)]
    pub fn set_layer_gain(&self, part: u32, layer: u32, gain_db: f64, time: Option<f64>) -> Result<(), JsError> {
        self.host.set_layer_gain(part, layer, gain_db, time).map_err(js)
    }

    #[wasm_bindgen(js_name = setCouplers)]
    pub fn set_couplers(&self, part: u32, targets: JsValue, unison_off: Option<bool>, time: Option<f64>) -> Result<(), JsError> {
        let targets: Vec<CouplerSpec> = arg(targets, "couplers")?;
        self.host.set_couplers(part, &targets, unison_off, time).map_err(js)
    }

    #[wasm_bindgen(js_name = setMidiRoute)]
    pub fn set_midi_route(&self, channel: u32, part: u32) -> Result<(), JsError> {
        self.host.set_midi_route(channel, part).map_err(js)
    }

    #[wasm_bindgen(js_name = allNotesOff)]
    pub fn all_notes_off(&self, part: Option<u32>, time: Option<f64>) -> Result<(), JsError> {
        self.host.all_notes_off(part, time).map_err(js)
    }

    #[wasm_bindgen(js_name = allSoundOff)]
    pub fn all_sound_off(&self) -> Result<(), JsError> {
        self.host.all_sound_off().map_err(js)
    }

    // ── rendering, MIDI ─────────────────────────────────────────────────────

    /// Render `frames` offline: interleaved stereo.
    pub fn render(&self, frames: u32) -> Result<Vec<f32>, JsError> {
        self.host.render(frames).map_err(js)
    }

    /// A MIDI message from the host's MIDI input: played on the part its channel is routed
    /// to, while real-time output runs.
    #[wasm_bindgen(js_name = midiInput)]
    pub fn midi_input(&self, bytes: &[u8]) {
        self.midi.route(bytes);
    }

    #[wasm_bindgen(js_name = releaseResources)]
    pub fn release_resources(&mut self) {
        self.host.release_resources();
        models::sweep();
    }

    /// What the AudioWorklet renders with ([`render_audio`]): an address in the shared memory,
    /// valid until [`free_audio_handle`]. `frames`: the most it renders at once.
    #[wasm_bindgen(js_name = audioHandle)]
    pub fn audio_handle(&self, frames: u32) -> u32 {
        let target = AudioTarget { engine: Arc::clone(self.host.engine()), fault: Arc::clone(self.host.fault()), out: vec![0.0; frames as usize * 2] };
        Box::into_raw(Box::new(target)) as u32
    }
}

/// The engine as the audio thread sees it.
struct AudioTarget {
    engine: Arc<Mutex<Engine>>,
    fault: Arc<Fault>,
    /// interleaved stereo, written by each render
    out: Vec<f32>,
}

/// AudioWorklet: render `frames` (at most the handle's) into the handle's buffer; returns the
/// buffer's address (interleaved stereo, silence if the engine failed).
#[wasm_bindgen(js_name = renderAudio)]
pub fn render_audio(handle: u32, frames: u32) -> u32 {
    // SAFETY: `handle` comes from `audio_handle` and is not freed while the worklet renders
    // (the host frees it only once the worklet has stopped); only the worklet uses it.
    let t = unsafe { &mut *(handle as *mut AudioTarget) };
    let n = (frames as usize * 2).min(t.out.len());
    render_guarded(&t.engine, &t.fault, &mut t.out[..n], 2);
    t.out.as_ptr() as u32
}

/// AudioWorklet: rendering the last `frames` took `secs` (the engine's CPU load; WebAssembly has
/// no clock of its own).
#[wasm_bindgen(js_name = reportLoad)]
pub fn report_load(handle: u32, secs: f64, frames: u32) {
    // SAFETY: as in `render_audio`
    let t = unsafe { &*(handle as *const AudioTarget) };
    supersynth_host::sync::lock(&t.engine).report_load(secs as f32, frames as usize);
}

/// Free a handle from `audio_handle`, once the worklet no longer renders with it.
#[wasm_bindgen(js_name = freeAudioHandle)]
pub fn free_audio_handle(handle: u32) {
    if handle != 0 {
        // SAFETY: from `audio_handle`, freed once
        drop(unsafe { Box::from_raw(handle as *mut AudioTarget) });
    }
}

/// Threads the engines have asked for that the host has not started yet.
#[wasm_bindgen(js_name = queuedThreads)]
pub fn queued_threads() -> usize {
    supersynth_core::thread::queued()
}

/// In a Web Worker: run the next queued thread; returns when it ends (its engine is gone).
#[wasm_bindgen(js_name = runQueuedThread)]
pub fn run_queued_thread() -> bool {
    supersynth_core::thread::run_queued()
}

/// Free the unloaded models nothing holds any more (there is no reclaim thread in a browser).
#[wasm_bindgen]
pub fn sweep() {
    models::sweep();
}

#[wasm_bindgen(js_name = reverbPresets)]
pub fn reverb_presets() -> Vec<String> {
    supersynth_host::reverb_presets()
}

#[wasm_bindgen(js_name = partParamNames)]
pub fn part_param_names() -> Vec<String> {
    supersynth_host::part_param_names()
}
