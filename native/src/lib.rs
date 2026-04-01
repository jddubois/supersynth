#![deny(clippy::all)]

mod audio;
mod effects;
mod midi;
mod synth;

use std::sync::{Arc, Mutex};

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;

use audio::backend::{list_available_backends, BackendKind};
use audio::engine::{Engine, EngineConfig, OverdriveParams};
use audio::output::AudioOutput;
use effects::limiter::LimiterParams;
use effects::reverb::FreeverbParams;
use midi::input::{connect_midi_device, list_midi_devices, MidiInputHandle};
use midi::message::{MidiMessage, MidiMessageKind};
use synth::voice::{OscillatorTemplate, VelocityCurve, VoiceConfig};
use synth::waveform::Waveform;

// ── Voice config objects ──────────────────────────────────────────────────────

/// A break point for a mixture-rank stop: at MIDI notes >= `note`, use `frequency_ratio`.
#[napi(object)]
pub struct JsBreakPoint {
    pub note: u32,
    pub frequency_ratio: f64,
}

#[napi(object)]
pub struct JsOscillatorTemplate {
    pub waveform: Option<String>,
    pub harmonic_ratio: Option<f64>,
    pub amplitude: Option<f64>,
    pub detune_cents: Option<f64>,
    pub attack_time: Option<f64>,
    pub decay_time: Option<f64>,
    pub sustain_level: Option<f64>,
    pub release_time: Option<f64>,
    pub chiff_intensity: Option<f64>,
    pub chiff_duration: Option<f64>,
    /// Organ key-contact click intensity (0.0 = off, 0.5 = typical).
    pub key_click_intensity: Option<f64>,
    /// Key-click transient duration in seconds. @default 0.003
    pub key_click_duration: Option<f64>,
    /// Duty cycle for the `pulse` waveform (0.0–1.0). 0.5 = square wave. Ignored for other waveforms.
    pub pulse_width: Option<f64>,
    /// Break points for mixture-rank (breaking) stops. When provided, `harmonic_ratio` is
    /// resolved per MIDI note rather than using a single fixed value.
    pub breaks: Option<Vec<JsBreakPoint>>,
    /// A-weighting correction strength (0.0–1.0). Defaults waveform-dependent:
    /// sine/triangle = 1.0 (full, organ-quality), KarplusStrong = 0.1 (gentle), others = 0.5.
    pub eq_loudness_strength: Option<f64>,
}

#[napi(object)]
pub struct JsVoiceConfig {
    pub oscillators: Option<Vec<JsOscillatorTemplate>>,
    /// "linear" | "exponential" | "fixed"
    pub velocity_curve: Option<String>,
    /// Exponent for "exponential", amplitude for "fixed".
    pub velocity_curve_value: Option<f64>,
    pub headroom: Option<f64>,
}

// ── Engine config ─────────────────────────────────────────────────────────────

#[napi(object)]
pub struct JsEngineConfig {
    pub sample_rate: Option<u32>,
    pub backend: Option<String>,
    pub voice: Option<JsVoiceConfig>,
    pub master_volume: Option<f64>,
    pub reverb_room_size: Option<f64>,
    pub reverb_damping: Option<f64>,
    pub reverb_wet: Option<f64>,
    pub reverb_dry: Option<f64>,
    pub reverb_pre_delay_ms: Option<f64>,
    pub low_pass_cutoff: Option<f64>,
    /// Number of cascaded low-pass filter stages (default 2). Only used when `low_pass_cutoff` is set.
    pub low_pass_stages: Option<u32>,
    pub limiter_threshold: Option<f64>,
    pub limiter_knee_width: Option<f64>,
    pub limiter_ratio: Option<f64>,
    pub limiter_attack_ms: Option<f64>,
    pub limiter_release_ms: Option<f64>,
    // ── Leslie cabinet ────────────────────────────────────────────────────────
    /// Enable Leslie rotary speaker simulation. Default: false.
    pub leslie_enabled: Option<bool>,
    /// Initial Leslie speed: "stop" | "slow" | "fast". Default: "stop".
    pub leslie_initial_speed: Option<String>,
    // ── Overdrive ─────────────────────────────────────────────────────────────
    /// Tube overdrive drive amount (1.0 = clean, 10.0 = heavy saturation).
    pub overdrive_drive: Option<f64>,
    /// Overdrive asymmetry bias (0.0 = symmetric, 0.3 = warm organ character).
    pub overdrive_bias: Option<f64>,
    /// Overdrive output level compensation (0.0–1.0).
    pub overdrive_level: Option<f64>,
    // ── Scanner vibrato/chorus ────────────────────────────────────────────────
    /// Initial scanner mode: "off" | "v1" | "v2" | "v3" | "c1" | "c2" | "c3". Default: "off".
    pub scanner_mode: Option<String>,
    // ── Key click ─────────────────────────────────────────────────────────────
    /// Global organ-mode key-click intensity (0.0 = off). Default: 0.0.
    pub key_click_intensity: Option<f64>,
    /// Key-click transient duration in seconds. Default: 0.003.
    pub key_click_duration: Option<f64>,
}

#[napi(object)]
pub struct JsNoteOnOptions {
    pub voice: Option<JsVoiceConfig>,
}

// ── Helpers: JS types → Rust synth types ─────────────────────────────────────

fn js_oscillator_template_to_template(t: JsOscillatorTemplate) -> OscillatorTemplate {
    let breaks: Vec<(u8, f32)> = t.breaks
        .unwrap_or_default()
        .into_iter()
        .map(|b| (b.note.min(127) as u8, b.frequency_ratio as f32))
        .collect();
    let waveform_str = t.waveform.as_deref().unwrap_or("sine");
    let waveform = if waveform_str == "pulse" {
        Waveform::Pulse(t.pulse_width.unwrap_or(0.5) as f32)
    } else {
        Waveform::parse(waveform_str)
    };
    OscillatorTemplate {
        waveform,
        harmonic_ratio: t.harmonic_ratio.unwrap_or(1.0) as f32,
        amplitude: t.amplitude.unwrap_or(1.0) as f32,
        detune_cents: t.detune_cents.unwrap_or(0.0) as f32,
        attack_time: t.attack_time.unwrap_or(0.03) as f32,
        decay_time: t.decay_time.unwrap_or(0.0) as f32,
        sustain_level: t.sustain_level.unwrap_or(1.0) as f32,
        release_time: t.release_time.unwrap_or(0.1) as f32,
        chiff_intensity: t.chiff_intensity.unwrap_or(0.0) as f32,
        chiff_duration: t.chiff_duration.unwrap_or(0.04) as f32,
        key_click_intensity: t.key_click_intensity.unwrap_or(0.0) as f32,
        key_click_duration: t.key_click_duration.unwrap_or(0.003) as f32,
        pitch_lfo_rate: None,
        pitch_lfo_depth: None,
        amp_lfo_rate: None,
        amp_lfo_depth: None,
        breaks,
        eq_loudness_strength: t.eq_loudness_strength.map(|v| v as f32),
    }
}

fn js_voice_to_voice(js: JsVoiceConfig) -> VoiceConfig {
    let velocity_curve = match js.velocity_curve.as_deref() {
        Some("exponential") => VelocityCurve::Exponential(js.velocity_curve_value.unwrap_or(2.0) as f32),
        Some("fixed") => VelocityCurve::Fixed(js.velocity_curve_value.unwrap_or(0.8) as f32),
        _ => VelocityCurve::Linear,
    };

    let headroom = js.headroom.unwrap_or(1.0) as f32;

    let oscillators: Vec<OscillatorTemplate> = js.oscillators.unwrap_or_default()
        .into_iter()
        .map(|t| js_oscillator_template_to_template(t))
        .collect();

    if oscillators.is_empty() {
        return VoiceConfig::default();
    }

    VoiceConfig { oscillators, velocity_curve, headroom }
}

// ── Main SynthEngine class ────────────────────────────────────────────────────

#[napi]
pub struct SynthEngine {
    engine: Arc<Mutex<Engine>>,
    _output: Option<AudioOutput>,
    _midi: Option<MidiInputHandle>,
    sample_rate: u32,
    backend: BackendKind,
}

#[napi]
impl SynthEngine {
    #[napi(constructor)]
    pub fn new(config: Option<JsEngineConfig>) -> Result<Self> {
        let cfg = config.unwrap_or(JsEngineConfig {
            sample_rate: None,
            backend: None,
            voice: None,
            master_volume: None,
            reverb_room_size: None,
            reverb_damping: None,
            reverb_wet: None,
            reverb_dry: None,
            reverb_pre_delay_ms: None,
            low_pass_cutoff: None,
            low_pass_stages: None,
            limiter_threshold: None,
            limiter_knee_width: None,
            limiter_ratio: None,
            limiter_attack_ms: None,
            limiter_release_ms: None,
            leslie_enabled: None,
            leslie_initial_speed: None,
            overdrive_drive: None,
            overdrive_bias: None,
            overdrive_level: None,
            scanner_mode: None,
            key_click_intensity: None,
            key_click_duration: None,
        });

        let sample_rate = cfg.sample_rate.unwrap_or(48000);
        let backend = BackendKind::parse(&cfg.backend.unwrap_or_default());
        let master_volume = cfg.master_volume.unwrap_or(0.5) as f32;
        let low_pass_cutoff = cfg.low_pass_cutoff.map(|v| v as f32);
        let low_pass_stages = cfg.low_pass_stages.unwrap_or(2);

        let voice = cfg.voice.map(js_voice_to_voice).unwrap_or_default();

        let reverb = if cfg.reverb_room_size.is_some()
            || cfg.reverb_wet.is_some()
            || cfg.reverb_dry.is_some()
        {
            Some(FreeverbParams {
                room_size: cfg.reverb_room_size.unwrap_or(0.85) as f32,
                damping: cfg.reverb_damping.unwrap_or(0.5) as f32,
                wet: cfg.reverb_wet.unwrap_or(0.35) as f32,
                dry: cfg.reverb_dry.unwrap_or(0.65) as f32,
                pre_delay_ms: cfg.reverb_pre_delay_ms.unwrap_or(20.0) as f32,
            })
        } else {
            None
        };

        let limiter = LimiterParams {
            threshold: cfg.limiter_threshold.unwrap_or(0.85) as f32,
            knee_width: cfg.limiter_knee_width.unwrap_or(0.15) as f32,
            ratio: cfg.limiter_ratio.unwrap_or(10.0) as f32,
            attack_ms: cfg.limiter_attack_ms.unwrap_or(1.0) as f32,
            release_ms: cfg.limiter_release_ms.unwrap_or(100.0) as f32,
        };

        let leslie_enabled = cfg.leslie_enabled.unwrap_or(false);
        let leslie_initial_speed = cfg.leslie_initial_speed;

        let overdrive = if cfg.overdrive_drive.is_some() {
            Some(OverdriveParams {
                drive: cfg.overdrive_drive.unwrap_or(1.0) as f32,
                bias: cfg.overdrive_bias.unwrap_or(0.0) as f32,
                level: cfg.overdrive_level.unwrap_or(1.0) as f32,
            })
        } else {
            None
        };

        let scanner_mode = cfg.scanner_mode;

        let engine_config = EngineConfig {
            sample_rate: sample_rate as f32,
            voice,
            master_volume,
            reverb,
            low_pass_cutoff,
            low_pass_stages,
            limiter,
            leslie_enabled,
            leslie_initial_speed,
            overdrive,
            scanner_mode,
            key_click_intensity: cfg.key_click_intensity.unwrap_or(0.0) as f32,
            key_click_duration: cfg.key_click_duration.unwrap_or(0.003) as f32,
        };

        let engine = Arc::new(Mutex::new(Engine::new(engine_config)));

        Ok(Self { engine, _output: None, _midi: None, sample_rate, backend })
    }

    /// Start audio output. Must be called before sound is produced.
    #[napi]
    pub fn start(&mut self) -> Result<()> {
        let output = AudioOutput::start(Arc::clone(&self.engine), &self.backend, self.sample_rate)
            .map_err(|e| Error::new(Status::GenericFailure, e))?;
        self._output = Some(output);
        Ok(())
    }

    /// Stop audio output.
    #[napi]
    pub fn stop(&mut self) {
        self._output = None;
        self._midi = None;
    }

    /// Send a note-on event. `note` is a MIDI note number (0–127), `velocity` is 0–127.
    #[napi]
    pub fn note_on(&self, note: u32, velocity: u32, options: Option<JsNoteOnOptions>) -> Result<()> {
        let voice_override = options.and_then(|o| o.voice).map(js_voice_to_voice);
        let mut eng = self.engine.lock()
            .map_err(|_| Error::new(Status::GenericFailure, "Engine lock poisoned"))?;
        eng.note_on(note as u8, velocity as u8, voice_override);
        Ok(())
    }

    /// Send a note-off event.
    #[napi]
    pub fn note_off(&self, note: u32) -> Result<()> {
        let mut eng = self.engine.lock()
            .map_err(|_| Error::new(Status::GenericFailure, "Engine lock poisoned"))?;
        eng.note_off(note as u8);
        Ok(())
    }

    /// Set the instrument voice for all subsequent note-on events.
    #[napi]
    pub fn set_voice(&self, config: JsVoiceConfig) -> Result<()> {
        let mut eng = self.engine.lock()
            .map_err(|_| Error::new(Status::GenericFailure, "Engine lock poisoned"))?;
        eng.set_voice(js_voice_to_voice(config));
        Ok(())
    }

    /// Set master volume (0.0–1.0).
    #[napi]
    pub fn set_master_volume(&self, volume: f64) -> Result<()> {
        let mut eng = self.engine.lock()
            .map_err(|_| Error::new(Status::GenericFailure, "Engine lock poisoned"))?;
        eng.set_master_volume(volume as f32);
        Ok(())
    }

    /// Returns the number of currently active (not yet finished) notes.
    #[napi(getter)]
    pub fn active_note_count(&self) -> Result<u32> {
        let eng = self.engine.lock()
            .map_err(|_| Error::new(Status::GenericFailure, "Engine lock poisoned"))?;
        Ok(eng.active_note_count() as u32)
    }

    /// Connect to a MIDI input device. `deviceName` is a substring match; omit for first device.
    /// The returned JS function is called with each raw MIDI message as a Buffer.
    #[napi]
    pub fn enable_midi(
        &mut self,
        device_name: Option<String>,
        callback: JsFunction,
    ) -> Result<()> {
        let tsfn: ThreadsafeFunction<Vec<u8>, ErrorStrategy::Fatal> = callback
            .create_threadsafe_function(0, |ctx| {
                let bytes: Vec<u8> = ctx.value;
                Ok(vec![Buffer::from(bytes)])
            })?;

        let handle = connect_midi_device(
            device_name.as_deref(),
            Box::new(move |bytes| {
                tsfn.call(bytes, ThreadsafeFunctionCallMode::NonBlocking);
            }),
        )
        .map_err(|e| Error::new(Status::GenericFailure, e))?;

        self._midi = Some(handle);
        Ok(())
    }

    /// List available MIDI input device names.
    #[napi]
    pub fn list_midi_devices(&self) -> Vec<String> {
        list_midi_devices()
    }

    /// List available audio backends on this platform.
    #[napi]
    pub fn list_audio_backends(&self) -> Vec<String> {
        list_available_backends()
    }

    /// Render `numSamples` of audio to a Float32Array without requiring audio hardware.
    /// Useful for testing and offline rendering.
    #[napi]
    pub fn render(&self, num_samples: u32) -> Result<Float32Array> {
        let mut eng = self.engine.lock()
            .map_err(|_| Error::new(Status::GenericFailure, "Engine lock poisoned"))?;
        let samples = eng.render(num_samples as usize);
        Ok(Float32Array::new(samples))
    }

    /// Parse a raw MIDI byte buffer and apply it to the engine.
    #[napi]
    pub fn send_midi_bytes(&self, bytes: Buffer) -> Result<()> {
        let msg = MidiMessage::parse(bytes.as_ref());
        if let Some(msg) = msg {
            let mut eng = self.engine.lock()
                .map_err(|_| Error::new(Status::GenericFailure, "Engine lock poisoned"))?;
            match msg.kind {
                MidiMessageKind::NoteOn => eng.note_on(msg.data1, msg.data2, None),
                MidiMessageKind::NoteOff => eng.note_off(msg.data1),
                _ => {}
            }
        }
        Ok(())
    }

    // ── Organ oscillator management ───────────────────────────────────────────

    /// Register an oscillator template and add it to all currently playing notes.
    /// Returns an oscillator_id that must be passed to `removeOscillator` to remove it.
    ///
    /// When any oscillators are registered, `noteOn` will build notes from the registered
    /// set instead of the voice config (organ mode). Use `breaks` for mixture-rank stops
    /// whose harmonic ratio depends on the MIDI note number.
    #[napi]
    pub fn add_oscillator(&self, template: JsOscillatorTemplate) -> Result<u32> {
        let rust_template = js_oscillator_template_to_template(template);
        let mut eng = self.engine.lock()
            .map_err(|_| Error::new(Status::GenericFailure, "Engine lock poisoned"))?;
        Ok(eng.add_oscillator(rust_template))
    }

    /// Trigger the release phase on all oscillators with the given id across all playing notes.
    /// Also removes the template from the registry so future notes won't include it.
    #[napi]
    pub fn remove_oscillator(&self, oscillator_id: u32) -> Result<()> {
        let mut eng = self.engine.lock()
            .map_err(|_| Error::new(Status::GenericFailure, "Engine lock poisoned"))?;
        eng.remove_oscillator(oscillator_id);
        Ok(())
    }

    /// The number of currently registered oscillator templates (organ mode).
    #[napi(getter)]
    pub fn active_oscillator_count(&self) -> Result<u32> {
        let eng = self.engine.lock()
            .map_err(|_| Error::new(Status::GenericFailure, "Engine lock poisoned"))?;
        Ok(eng.active_oscillator_count() as u32)
    }

    /// Update the amplitude of a registered oscillator in real time.
    /// Affects both the stored template (for future notes) and all currently playing notes.
    /// Used for drawbar-style real-time level control.
    #[napi]
    pub fn update_oscillator_amplitude(&self, oscillator_id: u32, amplitude: f64) -> Result<()> {
        let mut eng = self.engine.lock()
            .map_err(|_| Error::new(Status::GenericFailure, "Engine lock poisoned"))?;
        eng.update_oscillator_amplitude(oscillator_id, amplitude as f32);
        Ok(())
    }

    // ── Overdrive ─────────────────────────────────────────────────────────────

    /// Set tube overdrive parameters (creates the overdrive effect if not already active).
    /// - `drive` — 1.0 (clean) to 10.0 (heavy saturation)
    /// - `bias`  — 0.0 (symmetric) to 0.3 (warm organ character)
    /// - `level` — output level compensation (0.0–1.0)
    #[napi]
    pub fn set_overdrive(&self, drive: f64, bias: f64, level: f64) -> Result<()> {
        let mut eng = self.engine.lock()
            .map_err(|_| Error::new(Status::GenericFailure, "Engine lock poisoned"))?;
        eng.set_overdrive(drive as f32, bias as f32, level as f32);
        Ok(())
    }

    // ── Vibrato/chorus scanner ────────────────────────────────────────────────

    /// Set the vibrato/chorus scanner mode.
    /// `mode`: `"off"` | `"v1"` | `"v2"` | `"v3"` | `"c1"` | `"c2"` | `"c3"`
    ///
    /// V modes: pure pitch modulation at increasing depths.
    /// C modes: pitch + amplitude modulation (chorus) at increasing rates.
    #[napi]
    pub fn set_vibrato_chorus_mode(&self, mode: String) -> Result<()> {
        let mut eng = self.engine.lock()
            .map_err(|_| Error::new(Status::GenericFailure, "Engine lock poisoned"))?;
        eng.set_vibrato_chorus_mode(&mode);
        Ok(())
    }

    // ── Key click ─────────────────────────────────────────────────────────────

    /// Set the global organ-mode key-click intensity and duration.
    /// - `intensity` — 0.0 = off, 0.5 = typical organ key-click
    /// - `duration`  — transient duration in seconds (default: 0.003 = 3 ms)
    #[napi]
    pub fn set_key_click(&self, intensity: f64, duration: Option<f64>) -> Result<()> {
        let mut eng = self.engine.lock()
            .map_err(|_| Error::new(Status::GenericFailure, "Engine lock poisoned"))?;
        eng.set_key_click(intensity as f32, duration.unwrap_or(0.003) as f32);
        Ok(())
    }
}
