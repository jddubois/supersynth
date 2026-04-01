use crate::synth::note::{Note, midi_note_to_frequency};
use crate::synth::oscillator::OscillatorParams;
use crate::synth::waveform::Waveform;

// ── OscillatorTemplate ────────────────────────────────────────────────────────

/// A template describing one oscillator within a voice. Frequencies are expressed
/// as a ratio relative to the MIDI note's fundamental — e.g. 2.0 = one octave up.
pub struct OscillatorTemplate {
    pub waveform: Waveform,
    pub harmonic_ratio: f32,
    pub amplitude: f32,
    pub detune_cents: f32,
    pub attack_time: f32,
    pub decay_time: f32,
    pub sustain_level: f32,
    pub release_time: f32,
    pub chiff_intensity: f32,
    pub chiff_duration: f32,
    pub key_click_intensity: f32,
    pub key_click_duration: f32,
    pub pitch_lfo_rate: Option<f32>,
    pub pitch_lfo_depth: Option<f32>,
    pub amp_lfo_rate: Option<f32>,
    pub amp_lfo_depth: Option<f32>,
    /// Break points for mixture-rank stops: `(midi_note_threshold, harmonic_ratio)` sorted ascending.
    /// When non-empty, the harmonic_ratio is chosen as the last entry where `midi_note >= threshold`.
    /// `harmonic_ratio` is the fallback when no break point applies.
    pub breaks: Vec<(u8, f32)>,
    /// A-weighting correction strength (0.0–1.0). `None` uses the waveform-dependent default.
    pub eq_loudness_strength: Option<f32>,
}

impl OscillatorTemplate {
    /// Resolve the harmonic ratio for a given MIDI note, using break points if present.
    pub fn harmonic_ratio_for(&self, midi_note: u8) -> f32 {
        if self.breaks.is_empty() {
            return self.harmonic_ratio;
        }
        self.breaks.iter()
            .filter(|(note, _)| midi_note >= *note)
            .last()
            .map(|(_, ratio)| *ratio)
            .unwrap_or(self.harmonic_ratio)
    }

    pub fn to_oscillator_params(&self, base_freq: f32, amplitude_scale: f32, midi_note: u8) -> OscillatorParams {
        let ratio = self.harmonic_ratio_for(midi_note);
        let mut p = OscillatorParams::new(base_freq * ratio, self.waveform.clone());
        p.amplitude = self.amplitude * amplitude_scale;
        p.detune_cents = self.detune_cents;
        p.attack_time = self.attack_time;
        p.decay_time = self.decay_time;
        p.sustain_level = self.sustain_level;
        p.release_time = self.release_time;
        p.chiff_intensity = self.chiff_intensity;
        p.chiff_duration = self.chiff_duration;
        p.key_click_intensity = self.key_click_intensity;
        p.key_click_duration = self.key_click_duration;
        p.pitch_lfo_rate = self.pitch_lfo_rate;
        p.pitch_lfo_depth = self.pitch_lfo_depth;
        p.amp_lfo_rate = self.amp_lfo_rate;
        p.amp_lfo_depth = self.amp_lfo_depth;
        p.eq_loudness_strength = self.eq_loudness_strength;
        p
    }
}

// ── VelocityCurve ─────────────────────────────────────────────────────────────

pub enum VelocityCurve {
    /// Linear mapping: amplitude = velocity / 127.0
    Linear,
    /// Power curve: amplitude = (velocity / 127.0).powf(exponent)
    /// Exponent > 1.0 compresses soft dynamics (piano-like).
    Exponential(f32),
    /// Fixed amplitude regardless of velocity (organ-style).
    Fixed(f32),
}

impl VelocityCurve {
    pub fn apply(&self, velocity: u8) -> f32 {
        let v = velocity as f32 / 127.0;
        match self {
            VelocityCurve::Linear => v,
            VelocityCurve::Exponential(exp) => v.powf(*exp),
            VelocityCurve::Fixed(amp) => *amp,
        }
    }
}

// ── VoiceConfig ───────────────────────────────────────────────────────────────

/// Defines how a MIDI note is synthesised — the instrument voice.
///
/// A `VoiceConfig` is a factory: when a note-on arrives, `build_note` converts
/// its oscillator templates into a live `Note` with real frequencies and amplitudes.
pub struct VoiceConfig {
    pub oscillators: Vec<OscillatorTemplate>,
    pub velocity_curve: VelocityCurve,
    /// Static gain divisor applied before `master_volume`. Use this to normalise
    /// a voice whose oscillators sum to more than 1.0 at peak (e.g. 8 organ
    /// drawbars sum to ~3.5 — set `headroom: 4.0` to keep per-note level consistent).
    pub headroom: f32,
}

impl Default for VoiceConfig {
    fn default() -> Self {
        Self {
            oscillators: vec![OscillatorTemplate {
                waveform: Waveform::Sine,
                harmonic_ratio: 1.0,
                amplitude: 1.0,
                detune_cents: 0.0,
                attack_time: 0.03,
                decay_time: 0.0,
                sustain_level: 1.0,
                release_time: 0.1,
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
            velocity_curve: VelocityCurve::Linear,
            headroom: 1.0,
        }
    }
}

impl VoiceConfig {
    /// Build a live `Note` from this voice definition.
    pub fn build_note(&self, midi_note: u8, velocity: u8, sample_rate: f32) -> Note {
        let amp = self.velocity_curve.apply(velocity);
        let base_freq = midi_note_to_frequency(midi_note);
        let params: Vec<OscillatorParams> = self.oscillators
            .iter()
            .map(|t| t.to_oscillator_params(base_freq, amp, midi_note))
            .collect();
        Note::new(midi_note, params, sample_rate)
    }

}
