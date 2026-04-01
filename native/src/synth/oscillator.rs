use super::{chiff::{Chiff, KeyClick}, waveform::Waveform};

// ── Ensemble / LFO auto-variation ────────────────────────────────────────────
const AUTO_DETUNE_RANGE_CENTS: f32 = 6.0; // ±3 cents per oscillator
const PITCH_LFO_RATE_MIN: f32 = 0.15;     // Hz; randomised up to +0.20 per oscillator
// Pitch LFO reduced from 2.0→0.5 cents min: the ±3 cent auto-detune already gives natural
// ensemble warmth. A 2-5 cent pitch wobble on top (at different rates per oscillator) creates
// excessive "warbly" beating between the multiple principal stops. 0.5–2 cents is barely
// perceptible but still represents the slow natural wind variation in a pipe organ.
const PITCH_LFO_DEPTH_MIN: f32 = 0.5;     // cents; randomised up to +1.5 per oscillator
const AMP_LFO_RATE_MIN: f32 = 0.20;       // Hz; randomised up to +0.20 per oscillator
const AMP_LFO_DEPTH_MIN: f32 = 0.03;      // fraction; randomised up to +0.02 per oscillator

// ── Equal loudness (Fletcher-Munson) compensation ────────────────────────────
const EQ_LOUD_SCALE: f32 = 0.3;           // overall output scale after A-weighting
const EQ_LOUD_MAX: f32 = 10.0;            // clamp ceiling (prevent extreme boosts)
const EQ_LOUD_BOOST_DB: f32 = 4.0;        // high-freq presence boost (dB)
const EQ_LOUD_BOOST_LO_HZ: f32 = 1000.0;  // frequency below which boost = 0
const EQ_LOUD_BOOST_HI_HZ: f32 = 4186.0;  // C8 — frequency at which full boost applies

/// Returns the default equal-loudness strength (0.0–1.0) for a waveform.
/// Strength maps to the A-weighting divisor as `20.0 / strength`:
///   1.0 → divisor 20  (full correction, correct for pure sine/triangle organ pipes)
///   0.1 → divisor 200 (gentle, avoids over-compensating harmonically rich waveforms)
fn default_eq_loudness_strength(waveform: &Waveform) -> f32 {
    match waveform {
        Waveform::Sine | Waveform::Triangle => 1.0,
        // Principal: no A-weighting correction. At strength=1.0, bass notes like C2 (65 Hz)
        // receive a ~22× amplitude boost (to compensate for human ear insensitivity at low
        // frequencies), but real organ recordings capture flat acoustic amplitude with no
        // such boost. Using strength=0.0 gives a natural flat-response output that matches
        // the spectral characteristics of real organ recordings.
        Waveform::Principal => 0.0,
        Waveform::KarplusStrong(_) => 0.1,
        _ => 0.5,
    }
}

pub struct OscillatorParams {
    pub frequency: f32,
    pub waveform: Waveform,
    pub amplitude: f32,
    pub detune_cents: f32,
    pub attack_time: f32,
    pub decay_time: f32,
    pub sustain_level: f32,
    pub release_time: f32,
    pub chiff_intensity: f32,
    pub chiff_duration: f32,
    /// Organ key-contact click intensity (0.0 = off). Applied at note-on.
    pub key_click_intensity: f32,
    /// Duration of the key click transient in seconds. @default 0.003
    pub key_click_duration: f32,
    pub pitch_lfo_rate: Option<f32>,
    pub pitch_lfo_depth: Option<f32>,
    pub amp_lfo_rate: Option<f32>,
    pub amp_lfo_depth: Option<f32>,
    /// Identifies which registered oscillator this belongs to (for `remove_oscillator`).
    /// 0 = created from voice config (not removable by id).
    pub oscillator_id: u32,
    /// A-weighting correction strength (0.0–1.0). `None` uses the waveform-dependent default.
    /// 1.0 = full correction (divisor 20, best for organ/sine); 0.1 = gentle (divisor 200, for guitar).
    pub eq_loudness_strength: Option<f32>,
}

impl OscillatorParams {
    pub fn new(frequency: f32, waveform: Waveform) -> Self {
        Self {
            frequency,
            waveform,
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
            oscillator_id: 0,
            eq_loudness_strength: None,
        }
    }
}

pub struct Oscillator {
    phase: f32,
    pub frequency: f32,
    base_frequency: f32,
    sample_rate: f32,
    envelope: Envelope,
    waveform: Waveform,
    amp: f32,
    /// Stored so `update_amplitude` can recompute `amp` with the correct EQ correction.
    eq_strength: f32,
    pub is_released: bool,
    chiff: Chiff,
    key_click: KeyClick,
    pitch_lfo_phase: f32,
    pitch_lfo_rate: f32,
    pitch_lfo_depth: f32,
    amp_lfo_phase: f32,
    amp_lfo_rate: f32,
    amp_lfo_depth: f32,
    oscillator_id: u32,
}

impl Oscillator {
    pub fn new(params: OscillatorParams, sample_rate: f32) -> Self {
        let seed = (params.frequency * 1000.0) as u32 ^ 0xCAFEBABE;
        let detuned = params.frequency * 2.0_f32.powf(params.detune_cents / 1200.0);

        // Per-oscillator random detune ±3 cents for ensemble richness.
        // Skipped for KarplusStrong — the delay-line length determines pitch and
        // any extra detune corrupts tuning rather than adding warmth.
        let is_ks = matches!(params.waveform, Waveform::KarplusStrong(_));
        let frequency = if is_ks {
            detuned
        } else {
            let rand_val = ((seed.wrapping_mul(2654435761)) % 10000) as f32 / 10000.0;
            let auto_cents = (rand_val - 0.5) * AUTO_DETUNE_RANGE_CENTS;
            detuned * 2.0_f32.powf(auto_cents / 1200.0)
        };

        let lfo_phase1 = (seed % 1000) as f32 / 1000.0;
        let lfo_phase2 = ((seed.wrapping_mul(31337)) % 1000) as f32 / 1000.0;

        let pitch_lfo_rate = params.pitch_lfo_rate
            .unwrap_or(PITCH_LFO_RATE_MIN + (seed % 200) as f32 / 1000.0);
        let pitch_lfo_depth = params.pitch_lfo_depth
            .unwrap_or(PITCH_LFO_DEPTH_MIN + (seed % 150) as f32 / 100.0);
        let amp_lfo_rate = params.amp_lfo_rate
            .unwrap_or(AMP_LFO_RATE_MIN + ((seed.wrapping_mul(7)) % 200) as f32 / 1000.0);
        let amp_lfo_depth = params.amp_lfo_depth
            .unwrap_or(AMP_LFO_DEPTH_MIN + ((seed.wrapping_mul(13)) % 200) as f32 / 10000.0);

        let chiff = Chiff::new(
            params.frequency, sample_rate,
            params.chiff_intensity, params.chiff_duration, &params.waveform,
        );

        let key_click = KeyClick::new(
            sample_rate,
            params.key_click_intensity,
            params.key_click_duration,
        );

        let eq_strength = params.eq_loudness_strength
            .unwrap_or_else(|| default_eq_loudness_strength(&params.waveform));

        Self {
            phase: 0.0,
            frequency,
            base_frequency: frequency,
            sample_rate,
            envelope: Envelope::new(sample_rate, params.attack_time, params.decay_time, params.sustain_level, params.release_time),
            waveform: params.waveform,
            amp: params.amplitude * equal_loudness_multiplier(params.frequency, eq_strength),
            eq_strength,
            is_released: false,
            chiff,
            key_click,
            pitch_lfo_phase: lfo_phase1,
            pitch_lfo_rate,
            pitch_lfo_depth,
            amp_lfo_phase: lfo_phase2,
            amp_lfo_rate,
            amp_lfo_depth,
            oscillator_id: params.oscillator_id,
        }
    }

    pub fn oscillator_id(&self) -> u32 {
        self.oscillator_id
    }

    pub fn next_sample(&mut self) -> f32 {
        self.advance_phase();
        let dt = self.frequency / self.sample_rate;
        let wave = self.waveform.generate_sample(self.phase, self.frequency, dt);
        let amp_mod = 1.0 + self.amp_lfo_depth * (2.0 * std::f32::consts::PI * self.amp_lfo_phase).sin();
        let chiff = self.chiff.next_sample();
        let click = self.key_click.next_sample();
        (wave + chiff + click) * self.amp * amp_mod * self.envelope.next()
    }

    /// Update the oscillator's amplitude in real time.
    ///
    /// Recomputes `amp` using the stored equal-loudness correction so the
    /// Fletcher-Munson compensation remains accurate after a drawbar change.
    pub fn update_amplitude(&mut self, new_amplitude: f32) {
        self.amp = new_amplitude * equal_loudness_multiplier(self.base_frequency, self.eq_strength);
    }

    pub fn release(&mut self) {
        self.envelope.trigger_release();
        self.is_released = true;
    }

    pub fn is_finished(&self) -> bool {
        self.envelope.is_finished()
    }

    fn advance_phase(&mut self) {
        let pitch_cents = self.pitch_lfo_depth
            * (2.0 * std::f32::consts::PI * self.pitch_lfo_phase).sin();
        self.frequency = self.base_frequency * 2.0_f32.powf(pitch_cents / 1200.0);
        self.phase = (self.phase + self.frequency / self.sample_rate) % 1.0;
        self.pitch_lfo_phase = (self.pitch_lfo_phase + self.pitch_lfo_rate / self.sample_rate) % 1.0;
        self.amp_lfo_phase = (self.amp_lfo_phase + self.amp_lfo_rate / self.sample_rate) % 1.0;
    }
}

/// Equal loudness compensation (A-weighting / Fletcher-Munson curve).
///
/// `strength` (0.0–1.0) controls how aggressively the A-weighting is applied.
/// It maps to the exponent divisor as `20.0 / strength`:
///   1.0 → divisor 20 (full correction — correct for organ/sine tones)
///   0.1 → divisor 200 (gentle — avoids over-boosting harmonically rich waveforms)
pub(crate) fn equal_loudness_multiplier(frequency: f32, strength: f32) -> f32 {
    if frequency <= 0.0 {
        return 0.0;
    }
    let divisor = 20.0 / strength.clamp(0.001, 1.0);
    let f_sq = frequency * frequency;
    let pole_20_6_hz: f32 = 20.6;
    let pole_107_7_hz: f32 = 107.7;
    let pole_737_9_hz: f32 = 737.9;
    let pole_12200_hz: f32 = 12200.0;
    let pole_ref_hz: f32 = 12194.0;

    let numerator = pole_ref_hz.powi(2) * frequency.powi(4);
    let denominator = (f_sq + pole_20_6_hz.powi(2))
        * (f_sq + pole_12200_hz.powi(2))
        * ((f_sq + pole_107_7_hz.powi(2)) * (f_sq + pole_737_9_hz.powi(2))).sqrt();

    let a_db = 20.0 * (numerator / denominator).log10();
    let base = 10_f32.powf(-a_db / divisor);

    let boost_db = if frequency <= EQ_LOUD_BOOST_LO_HZ {
        0.0
    } else if frequency >= EQ_LOUD_BOOST_HI_HZ {
        EQ_LOUD_BOOST_DB
    } else {
        EQ_LOUD_BOOST_DB * (frequency - EQ_LOUD_BOOST_LO_HZ) / (EQ_LOUD_BOOST_HI_HZ - EQ_LOUD_BOOST_LO_HZ)
    };

    (base * 10_f32.powf(boost_db / 20.0) * EQ_LOUD_SCALE).min(EQ_LOUD_MAX)
}

// ── Envelope ──────────────────────────────────────────────────────────────────

const EPSILON: f32 = 1e-4;

enum EnvelopeState { Attack, Decay, Sustain, Release, Idle }

pub struct Envelope {
    value: f32,
    attack_coeff: f32,
    decay_coeff: f32,
    sustain_level: f32,
    release_coeff: f32,
    state: EnvelopeState,
}

impl Envelope {
    pub fn new(sample_rate: f32, attack_time: f32, decay_time: f32, sustain_level: f32, release_time: f32) -> Self {
        let attack_coeff = if attack_time > 0.0 {
            (-1.0 / (attack_time * sample_rate)).exp()
        } else {
            0.0
        };
        let decay_coeff = if decay_time > 0.0 {
            (-1.0 / (decay_time * sample_rate)).exp()
        } else {
            0.0
        };
        let release_coeff = if release_time > 0.0 {
            (-1.0 / (release_time * sample_rate)).exp()
        } else {
            0.0
        };
        Self { value: EPSILON, attack_coeff, decay_coeff, sustain_level, release_coeff, state: EnvelopeState::Attack }
    }

    pub fn next(&mut self) -> f32 {
        match self.state {
            EnvelopeState::Attack => {
                self.value = 1.0 - (1.0 - self.value) * self.attack_coeff;
                if self.value >= 1.0 - EPSILON {
                    self.value = 1.0;
                    self.state = if self.decay_coeff > 0.0 {
                        EnvelopeState::Decay
                    } else {
                        EnvelopeState::Sustain
                    };
                }
            }
            EnvelopeState::Decay => {
                self.value = self.sustain_level + (self.value - self.sustain_level) * self.decay_coeff;
                if (self.value - self.sustain_level).abs() < EPSILON {
                    self.value = self.sustain_level;
                    self.state = EnvelopeState::Sustain;
                }
            }
            EnvelopeState::Release => {
                self.value *= self.release_coeff;
                if self.value <= EPSILON {
                    self.value = 0.0;
                    self.state = EnvelopeState::Idle;
                }
            }
            _ => {}
        }
        self.value
    }

    pub fn trigger_release(&mut self) {
        self.state = EnvelopeState::Release;
    }

    pub fn is_finished(&self) -> bool {
        matches!(self.state, EnvelopeState::Idle)
            || (matches!(self.state, EnvelopeState::Release) && self.value <= EPSILON)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_attack_reaches_sustain() {
        let mut env = Envelope::new(48000.0, 0.01, 0.0, 1.0, 0.1);
        let samples = (0.1 * 48000.0) as usize;
        let mut max = 0.0_f32;
        for _ in 0..samples {
            max = max.max(env.next());
        }
        assert!(max >= 0.99, "envelope did not reach sustain: {max}");
    }

    #[test]
    fn envelope_release_reaches_idle() {
        let mut env = Envelope::new(48000.0, 0.001, 0.0, 1.0, 0.01);
        for _ in 0..1000 { env.next(); }
        env.trigger_release();
        for _ in 0..48000 { env.next(); }
        assert!(env.is_finished(), "envelope did not finish after release");
    }

    #[test]
    fn oscillator_output_is_finite() {
        let params = OscillatorParams::new(440.0, Waveform::Sine);
        let mut osc = Oscillator::new(params, 48000.0);
        for _ in 0..4800 {
            assert!(osc.next_sample().is_finite());
        }
    }

    #[test]
    fn karplus_strong_oscillator_output_is_finite() {
        use super::super::karplus_strong::KarplusData;
        let mut params = OscillatorParams::new(440.0, Waveform::KarplusStrong(KarplusData::plucked()));
        params.attack_time = 0.001;
        params.decay_time = 0.0;
        params.sustain_level = 1.0;
        params.release_time = 0.3;
        let mut osc = Oscillator::new(params, 48000.0);
        for _ in 0..4800 {
            assert!(osc.next_sample().is_finite());
        }
    }
}
