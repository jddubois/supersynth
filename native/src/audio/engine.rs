use std::sync::{Arc, Mutex};

use crate::effects::filter::Filter;
use crate::effects::leslie::Leslie;
use crate::effects::limiter::{LimiterParams, SoftKneeLimiter};
use crate::effects::loudness::LoudnessFilter;
use crate::effects::low_pass::LowPass;
use crate::effects::overdrive::Overdrive;
use crate::effects::reverb::{Freeverb, FreeverbParams};
use crate::effects::scanner::ScannerVibrato;
use crate::synth::note::Note;
use crate::synth::oscillator::OscillatorParams;
use crate::synth::voice::{OscillatorTemplate, VoiceConfig};

// ── Overdrive params ──────────────────────────────────────────────────────────

pub struct OverdriveParams {
    pub drive: f32,
    pub bias: f32,
    pub level: f32,
}

// ── Engine config ─────────────────────────────────────────────────────────────

pub struct EngineConfig {
    pub sample_rate: f32,
    pub voice: VoiceConfig,
    pub master_volume: f32,
    pub reverb: Option<FreeverbParams>,
    pub low_pass_cutoff: Option<f32>,
    /// Number of cascaded low-pass filter stages. Only used when `low_pass_cutoff` is set.
    /// Two stages (the default) gives a steeper roll-off like organsynth; one stage is gentler.
    pub low_pass_stages: u32,
    pub limiter: LimiterParams,
    /// Enable Leslie rotary speaker simulation. Default: false.
    pub leslie_enabled: bool,
    /// Initial Leslie speed: `"stop"` | `"slow"` | `"fast"`. Default: `"stop"`.
    pub leslie_initial_speed: Option<String>,
    /// Enable tube overdrive/saturation. `None` = bypass.
    pub overdrive: Option<OverdriveParams>,
    /// Initial vibrato/chorus scanner mode: `"off"` | `"v1"–"v3"` | `"c1"–"c3"`. Default: `"off"`.
    pub scanner_mode: Option<String>,
    /// Global organ-mode key-click intensity (0.0 = off). Applied to all organ-mode oscillators. Default: 0.0.
    pub key_click_intensity: f32,
    /// Key-click transient duration in seconds. Default: 0.003 (3 ms).
    pub key_click_duration: f32,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            sample_rate: 48000.0,
            voice: VoiceConfig::default(),
            master_volume: 0.5,
            reverb: None,
            low_pass_cutoff: None,
            low_pass_stages: 2,
            limiter: LimiterParams::default(),
            leslie_enabled: false,
            leslie_initial_speed: None,
            overdrive: None,
            scanner_mode: None,
            key_click_intensity: 0.0,
            key_click_duration: 0.003,
        }
    }
}

/// Core synthesis engine — manages active notes, effects chain, buffer fill.
/// Designed to be used from both the napi-rs binding and tests.
pub struct Engine {
    sample_rate: f32,
    voice: VoiceConfig,
    master_volume: f32,
    notes: Vec<Note>,
    filters: Vec<Box<dyn Filter>>,
    limiter: SoftKneeLimiter,
    loudness_filter: LoudnessFilter,
    /// Leslie rotary speaker (stereo, processed after limiter).
    leslie: Option<Leslie>,
    /// Tube overdrive/saturation (processed after loudness filter, before scanner).
    overdrive: Option<Overdrive>,
    /// Vibrato/chorus scanner (processed after overdrive, before reverb).
    scanner: Option<ScannerVibrato>,
    /// Global key-click intensity applied to organ-mode oscillators.
    key_click_intensity: f32,
    key_click_duration: f32,
    /// Registered oscillator templates (organ mode). When non-empty, `note_on` builds
    /// notes from this list instead of the voice config.
    active_oscillators: Vec<(u32, OscillatorTemplate)>,
    next_oscillator_id: u32,
}

impl Engine {
    pub fn new(config: EngineConfig) -> Self {
        let mut filters: Vec<Box<dyn Filter>> = Vec::new();

        if let Some(cutoff) = config.low_pass_cutoff {
            for _ in 0..config.low_pass_stages {
                filters.push(Box::new(LowPass::new(cutoff)));
            }
        }
        if let Some(ref reverb_params) = config.reverb {
            filters.push(Box::new(Freeverb::new(config.sample_rate, reverb_params)));
        }

        let limiter = SoftKneeLimiter::new(&config.limiter, config.sample_rate);
        let loudness_filter = LoudnessFilter::new(config.sample_rate, config.master_volume);

        let leslie = if config.leslie_enabled {
            let mut l = Leslie::new(config.sample_rate);
            if let Some(ref speed) = config.leslie_initial_speed {
                l.set_speed(speed);
            }
            Some(l)
        } else {
            None
        };

        let overdrive = config.overdrive.map(|od| {
            Overdrive::new(od.drive, od.bias, od.level)
        });

        let scanner = {
            let mut sc = ScannerVibrato::new(config.sample_rate);
            if let Some(ref mode) = config.scanner_mode {
                sc.set_mode(mode);
            }
            Some(sc)
        };

        Self {
            sample_rate: config.sample_rate,
            voice: config.voice,
            master_volume: config.master_volume,
            notes: Vec::new(),
            filters,
            limiter,
            loudness_filter,
            leslie,
            overdrive,
            scanner,
            key_click_intensity: config.key_click_intensity,
            key_click_duration: config.key_click_duration,
            active_oscillators: Vec::new(),
            next_oscillator_id: 1,
        }
    }

    pub fn note_on(&mut self, midi_note: u8, velocity: u8, voice_override: Option<VoiceConfig>) {
        // If note already active, release old one first
        if let Some(existing) = self.notes.iter_mut().find(|n| n.midi_note == midi_note && !n.is_released) {
            existing.release();
        }

        let note = if !self.active_oscillators.is_empty() {
            // Organ mode: build note from registered oscillator templates.
            let base_freq = crate::synth::note::midi_note_to_frequency(midi_note);
            let params: Vec<OscillatorParams> = self.active_oscillators
                .iter()
                .map(|(osc_id, template)| {
                    let mut p = template.to_oscillator_params(base_freq, 1.0, midi_note);
                    p.oscillator_id = *osc_id;
                    // Apply global key-click override when enabled
                    if self.key_click_intensity > 0.0 {
                        p.key_click_intensity = self.key_click_intensity;
                        p.key_click_duration = self.key_click_duration;
                    }
                    p
                })
                .collect();
            Note::new(midi_note, params, self.sample_rate)
        } else {
            let voice = voice_override.as_ref().unwrap_or(&self.voice);
            voice.build_note(midi_note, velocity, self.sample_rate)
        };

        self.notes.push(note);
    }

    pub fn note_off(&mut self, midi_note: u8) {
        for note in &mut self.notes {
            if note.midi_note == midi_note && !note.is_released {
                note.release();
                break;
            }
        }
    }

    pub fn set_voice(&mut self, voice: VoiceConfig) {
        self.voice = voice;
    }

    pub fn set_master_volume(&mut self, volume: f32) {
        self.master_volume = volume.clamp(0.0, 1.0);
        self.loudness_filter.update_volume(self.master_volume);
    }

    pub fn active_note_count(&self) -> usize {
        self.notes.iter().filter(|n| !n.is_finished()).count()
    }

    /// Register an oscillator template and add it to all currently playing notes.
    /// Returns an oscillator_id that can be passed to `remove_oscillator`.
    pub fn add_oscillator(&mut self, template: OscillatorTemplate) -> u32 {
        let id = self.next_oscillator_id;
        self.next_oscillator_id += 1;
        for note in &mut self.notes {
            let base_freq = note.frequency;
            let midi_note = note.midi_note;
            let mut p = template.to_oscillator_params(base_freq, 1.0, midi_note);
            p.oscillator_id = id;
            if self.key_click_intensity > 0.0 {
                p.key_click_intensity = self.key_click_intensity;
                p.key_click_duration = self.key_click_duration;
            }
            note.add_oscillator(p);
        }
        self.active_oscillators.push((id, template));
        id
    }

    /// Trigger release on oscillators with the given id across all playing notes.
    pub fn remove_oscillator(&mut self, oscillator_id: u32) {
        self.active_oscillators.retain(|(id, _)| *id != oscillator_id);
        for note in &mut self.notes {
            note.remove_oscillator(oscillator_id);
        }
    }

    pub fn active_oscillator_count(&self) -> usize {
        self.active_oscillators.len()
    }

    /// Update the amplitude of all active oscillators with the given id — both the
    /// stored template (for future notes) and all currently playing notes.
    /// Used for real-time drawbar control.
    pub fn update_oscillator_amplitude(&mut self, oscillator_id: u32, amplitude: f32) {
        for (id, template) in &mut self.active_oscillators {
            if *id == oscillator_id {
                template.amplitude = amplitude;
                break;
            }
        }
        for note in &mut self.notes {
            note.update_oscillator_amplitude(oscillator_id, amplitude);
        }
    }

    /// Set overdrive parameters. Pass `drive=1.0, bias=0.0, level=1.0` for clean.
    pub fn set_overdrive(&mut self, drive: f32, bias: f32, level: f32) {
        if let Some(ref mut od) = self.overdrive {
            od.set_params(drive, bias, level);
        } else {
            self.overdrive = Some(Overdrive::new(drive, bias, level));
        }
    }

    /// Set the vibrato/chorus scanner mode.
    /// `mode`: `"off"` | `"v1"` | `"v2"` | `"v3"` | `"c1"` | `"c2"` | `"c3"`
    pub fn set_vibrato_chorus_mode(&mut self, mode: &str) {
        if let Some(ref mut sc) = self.scanner {
            sc.set_mode(mode);
        }
    }

    /// Set the global key-click intensity for organ mode.
    pub fn set_key_click(&mut self, intensity: f32, duration: f32) {
        self.key_click_intensity = intensity.max(0.0);
        self.key_click_duration = duration.max(0.001);
    }

    /// Fill an interleaved output buffer (L, R, L, R, … for stereo; mono if channels=1).
    ///
    /// Signal chain:
    ///   oscillators → headroom → master_volume → loudness EQ →
    ///   overdrive (opt) → scanner vibrato (opt) →
    ///   [low-pass, reverb] → limiter →
    ///   Leslie stereo (opt) → output buffer
    pub fn fill_buffer(&mut self, buffer: &mut [f32], channels: usize) {
        let frames = buffer.len() / channels;
        for frame in 0..frames {
            let mut sample = 0.0_f32;
            for note in &mut self.notes {
                sample += note.next_sample();
            }
            self.notes.retain(|n| !n.is_finished());

            let headroom = if self.active_oscillators.is_empty() { self.voice.headroom } else { 1.0 };
            sample /= headroom;
            sample *= self.master_volume;
            sample = self.loudness_filter.process(sample);

            if let Some(ref mut od) = self.overdrive {
                sample = od.process(sample);
            }

            if let Some(ref mut sc) = self.scanner {
                sample = sc.process(sample);
            }

            for f in &mut self.filters {
                sample = f.process(sample);
            }

            sample = self.limiter.process(sample);

            let (left, right) = if let Some(ref mut leslie) = self.leslie {
                leslie.process_stereo(sample)
            } else {
                (sample, sample)
            };

            for ch in 0..channels {
                buffer[frame * channels + ch] = if ch == 0 { left } else { right };
            }
        }
    }

    /// Render N samples to a mono Vec — useful for testing without audio hardware.
    pub fn render(&mut self, num_samples: usize) -> Vec<f32> {
        let mut buf = vec![0.0_f32; num_samples];
        self.fill_buffer(&mut buf, 1);
        buf
    }
}

#[allow(dead_code)]
pub type SharedEngine = Arc<Mutex<Engine>>;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::effects::reverb::FreeverbParams;

    fn make_engine() -> Engine {
        Engine::new(EngineConfig::default())
    }

    #[test]
    fn silence_when_no_notes() {
        let mut engine = make_engine();
        let buf = engine.render(1024);
        assert!(buf.iter().all(|&s| s == 0.0), "expected silence with no notes");
    }

    #[test]
    fn note_on_produces_audio() {
        let mut engine = make_engine();
        engine.note_on(69, 100, None);
        let buf = engine.render(1024);
        let has_signal = buf.iter().any(|&s| s.abs() > 1e-6);
        assert!(has_signal, "expected audio after note_on");
    }

    #[test]
    fn note_off_eventually_silences() {
        let mut engine = make_engine();
        engine.note_on(69, 100, None);
        engine.render(480); // let attack finish
        engine.note_off(69);
        // Exponential decay needs ~10× release_time*sr to reach EPSILON.
        // Default release=0.1s → needs ~48000 samples; render 96000 to be safe.
        engine.render(96000);
        assert_eq!(engine.active_note_count(), 0);
    }

    #[test]
    fn buffer_output_is_finite() {
        let mut engine = Engine::new(EngineConfig {
            reverb: Some(FreeverbParams::default()),
            low_pass_cutoff: Some(0.7),
            ..Default::default()
        });
        engine.note_on(60, 80, None);
        let buf = engine.render(4096);
        for s in &buf {
            assert!(s.is_finite(), "non-finite sample in output");
        }
    }

    #[test]
    fn multiple_simultaneous_notes() {
        let mut engine = make_engine();
        for note in [60u8, 64, 67, 72] {
            engine.note_on(note, 80, None);
        }
        let buf = engine.render(1024);
        assert!(buf.iter().any(|&s| s.abs() > 1e-6));
    }

    #[test]
    fn limiter_keeps_output_bounded() {
        let mut engine = make_engine();
        // Play many loud notes to stress the limiter
        for note in 48u8..64 {
            engine.note_on(note, 127, None);
        }
        // Warm up — let the attack envelope settle (render 2400 samples ≈ 50ms)
        engine.render(2400);
        // After settling, output should be well below the unprocessed sum
        let buf = engine.render(2048);
        let peak = buf.iter().map(|s| s.abs()).fold(0.0_f32, f32::max);
        // 16 notes at velocity 127, headroom 1.0, masterVolume 0.5 → theoretical peak ~8.0.
        // The limiter (threshold 0.85, ratio 10) should reduce this significantly.
        // We allow up to 2.0 to accommodate the 1ms attack's transient overshoot.
        assert!(peak < 2.0, "limiter did not significantly reduce output: peak={peak}");
    }

    #[test]
    fn organ_voice_produces_audio() {
        let mut engine = Engine::new(EngineConfig {
            voice: VoiceConfig {
                oscillators: vec![crate::synth::voice::OscillatorTemplate {
                    waveform: crate::synth::waveform::Waveform::Sine,
                    harmonic_ratio: 1.0,
                    amplitude: 1.0,
                    detune_cents: 0.0,
                    attack_time: 0.005,
                    decay_time: 0.0,
                    sustain_level: 1.0,
                    release_time: 0.005,
                    chiff_intensity: 0.0,
                    chiff_duration: 0.04,
                    key_click_intensity: 0.0,
                    key_click_duration: 0.003,
                    pitch_lfo_rate: None,
                    pitch_lfo_depth: None,
                    amp_lfo_rate: None,
                    amp_lfo_depth: None,
                    breaks: vec![],
                    eq_loudness_strength: None,
                }],
                velocity_curve: crate::synth::voice::VelocityCurve::Fixed(0.8),
                headroom: 1.0,
            },
            ..Default::default()
        });
        engine.note_on(60, 100, None);
        let buf = engine.render(1024);
        assert!(buf.iter().any(|&s| s.abs() > 1e-6));
    }

    #[test]
    fn loudness_contour_boosts_bass_at_low_volume() {
        use crate::synth::voice::{OscillatorTemplate, VelocityCurve};
        use crate::synth::waveform::Waveform;

        fn make_bass_voice() -> VoiceConfig {
            VoiceConfig {
                oscillators: vec![OscillatorTemplate {
                    waveform: Waveform::Sine,
                    harmonic_ratio: 1.0,
                    amplitude: 1.0,
                    detune_cents: 0.0,
                    attack_time: 0.001,
                    decay_time: 0.0,
                    sustain_level: 1.0,
                    release_time: 0.1,
                    chiff_intensity: 0.0,
                    chiff_duration: 0.04,
                    key_click_intensity: 0.0,
                    key_click_duration: 0.003,
                    pitch_lfo_rate: Some(0.0),
                    pitch_lfo_depth: Some(0.0),
                    amp_lfo_rate: Some(0.0),
                    amp_lfo_depth: Some(0.0),
                    breaks: vec![],
                    eq_loudness_strength: None,
                }],
                velocity_curve: VelocityCurve::Fixed(1.0),
                headroom: 1.0,
            }
        }

        // MIDI note 40 ≈ 82.4 Hz — sits in the low-shelf boost region
        let mut loud_engine = Engine::new(EngineConfig {
            master_volume: 1.0,
            voice: make_bass_voice(),
            ..Default::default()
        });
        let mut quiet_engine = Engine::new(EngineConfig {
            master_volume: 0.05,
            voice: make_bass_voice(),
            ..Default::default()
        });

        loud_engine.note_on(40, 100, None);
        quiet_engine.note_on(40, 100, None);

        // Warm up past attack transient (~50 ms)
        loud_engine.render(2400);
        quiet_engine.render(2400);

        let loud_buf  = loud_engine.render(4800);
        let quiet_buf = quiet_engine.render(4800);

        let loud_peak  = loud_buf.iter().map(|s| s.abs()).fold(0.0_f32, f32::max);
        let quiet_peak = quiet_buf.iter().map(|s| s.abs()).fold(0.0_f32, f32::max);

        // Normalize each by master_volume to isolate the shelf filter's contribution.
        // Without loudness contouring, normalized peaks would be equal.
        // At volume=0.05, bass boost ≈ 9.5 dB ≈ 2.99× linear — expect at least 1.5×.
        let loud_normalized  = loud_peak  / 1.0;
        let quiet_normalized = quiet_peak / 0.05;

        assert!(
            quiet_normalized > loud_normalized * 1.5,
            "loudness contour did not boost bass at low volume: \
             quiet_normalized={quiet_normalized:.4} loud_normalized={loud_normalized:.4}"
        );
    }

    #[test]
    fn voice_with_decay_reduces_level() {
        let mut engine = Engine::new(EngineConfig {
            voice: VoiceConfig {
                oscillators: vec![crate::synth::voice::OscillatorTemplate {
                    waveform: crate::synth::waveform::Waveform::Sine,
                    harmonic_ratio: 1.0,
                    amplitude: 1.0,
                    detune_cents: 0.0,
                    attack_time: 0.003,
                    decay_time: 1.5,
                    sustain_level: 0.1,
                    release_time: 0.3,
                    chiff_intensity: 0.0,
                    chiff_duration: 0.04,
                    key_click_intensity: 0.0,
                    key_click_duration: 0.003,
                    pitch_lfo_rate: None,
                    pitch_lfo_depth: None,
                    amp_lfo_rate: None,
                    amp_lfo_depth: None,
                    breaks: vec![],
                    eq_loudness_strength: None,
                }],
                velocity_curve: crate::synth::voice::VelocityCurve::Exponential(1.5),
                headroom: 1.0,
            },
            ..Default::default()
        });
        engine.note_on(60, 100, None);
        let buf = engine.render(48000);
        let early_peak = buf[..480].iter().map(|s| s.abs()).fold(0.0_f32, f32::max);
        let late_peak = buf[40000..].iter().map(|s| s.abs()).fold(0.0_f32, f32::max);
        assert!(late_peak < early_peak, "decay did not reduce level: early={early_peak} late={late_peak}");
    }

    #[test]
    fn leslie_produces_stereo_when_enabled() {
        let mut engine = Engine::new(EngineConfig {
            leslie_enabled: true,
            leslie_initial_speed: Some("fast".to_string()),
            ..Default::default()
        });
        engine.note_on(60, 100, None);
        // fill stereo buffer
        let mut buf = vec![0.0_f32; 2 * 4800]; // stereo: 4800 frames
        engine.fill_buffer(&mut buf, 2);
        // After warm-up there should be L/R difference
        let l_samples: Vec<f32> = buf.iter().step_by(2).cloned().collect();
        let r_samples: Vec<f32> = buf.iter().skip(1).step_by(2).cloned().collect();
        let diff: f32 = l_samples.iter().zip(r_samples.iter()).map(|(l, r)| (l - r).abs()).sum();
        assert!(diff > 0.01, "Leslie stereo should produce L/R difference, got {diff}");
    }

    #[test]
    fn update_oscillator_amplitude_silences_stop() {
        let mut engine = make_engine();
        let id = engine.add_oscillator(OscillatorTemplate {
            waveform: crate::synth::waveform::Waveform::Sine,
            harmonic_ratio: 1.0,
            amplitude: 1.0,
            detune_cents: 0.0,
            attack_time: 0.001,
            decay_time: 0.0,
            sustain_level: 1.0,
            release_time: 0.1,
            chiff_intensity: 0.0,
            chiff_duration: 0.04,
            key_click_intensity: 0.0,
            key_click_duration: 0.003,
            pitch_lfo_rate: Some(0.0),
            pitch_lfo_depth: Some(0.0),
            amp_lfo_rate: Some(0.0),
            amp_lfo_depth: Some(0.0),
            breaks: vec![],
            eq_loudness_strength: Some(0.0),
        });
        engine.note_on(60, 100, None);
        engine.render(480); // past attack
        engine.update_oscillator_amplitude(id, 0.0);
        let buf = engine.render(480);
        let peak = buf.iter().map(|s| s.abs()).fold(0.0_f32, f32::max);
        assert!(peak < 0.01, "amplitude=0 should silence the oscillator, peak={peak}");
    }
}
