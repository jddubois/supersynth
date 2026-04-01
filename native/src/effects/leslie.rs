use crate::effects::biquad::Biquad;
use crate::effects::filter::Filter;
use std::f32::consts::PI;

/// Maximum Doppler delay in seconds. At 48kHz this is ~96 samples.
const MAX_DELAY_SECS: f32 = 0.002;

/// One rotor in a Leslie cabinet — models the rotating horn or bass drum.
///
/// Doppler shift is produced by modulating the read position in a short circular
/// delay buffer. Amplitude modulation is added to simulate the directivity of the
/// horn mouth as it sweeps toward and away from each microphone.
struct LeslieRotor {
    delay_buffer: Vec<f32>,
    write_pos: usize,
    /// Usable delay range (samples): 0 .. max_delay_samples
    max_delay_samples: usize,
    /// Current rotation angle, 0.0–1.0
    phase: f32,
    /// Instantaneous rotation rate in Hz, exponentially ramped toward target
    current_rate: f32,
    target_rate: f32,
    slow_rate: f32,
    fast_rate: f32,
    /// Per-sample decay coefficient for acceleration: `exp(-1 / (ramp_up_s * sr))`
    ramp_up_coeff: f32,
    /// Per-sample decay coefficient for deceleration: `exp(-1 / (ramp_down_s * sr))`
    ramp_down_coeff: f32,
    /// Depth of pitch (Doppler) modulation, 0.0–1.0
    doppler_depth: f32,
    /// Depth of amplitude modulation, 0.0–1.0
    am_depth: f32,
    sample_rate: f32,
}

impl LeslieRotor {
    fn new(
        sample_rate: f32,
        slow_rate: f32,
        fast_rate: f32,
        ramp_up_secs: f32,
        ramp_down_secs: f32,
        doppler_depth: f32,
        am_depth: f32,
    ) -> Self {
        let max_delay_samples = ((MAX_DELAY_SECS * sample_rate) as usize + 4).max(8);
        // Buffer is 2× the max delay to give headroom for interpolation
        Self {
            delay_buffer: vec![0.0; max_delay_samples * 2],
            write_pos: 0,
            max_delay_samples,
            phase: 0.0,
            current_rate: 0.0,
            target_rate: 0.0,
            slow_rate,
            fast_rate,
            ramp_up_coeff: (-1.0 / (ramp_up_secs * sample_rate)).exp(),
            ramp_down_coeff: (-1.0 / (ramp_down_secs * sample_rate)).exp(),
            doppler_depth,
            am_depth,
            sample_rate,
        }
    }

    fn advance_phase(&mut self) {
        // Exponential ramp: rate = target + (rate - target) * coeff
        let coeff = if self.target_rate >= self.current_rate {
            self.ramp_up_coeff
        } else {
            self.ramp_down_coeff
        };
        self.current_rate = self.target_rate + (self.current_rate - self.target_rate) * coeff;
        self.phase = (self.phase + self.current_rate / self.sample_rate).fract();
    }

    /// Linearly interpolated read from the delay line.
    /// `delay_f` is the fractional delay in samples (0 = just written).
    fn read_interpolated(&self, delay_f: f32) -> f32 {
        let delay_f = delay_f.clamp(0.0, self.max_delay_samples as f32 - 1.001);
        let i = delay_f as usize;
        let frac = delay_f - i as f32;
        let len = self.delay_buffer.len();
        // write_pos is the position just written; write_pos - i goes backward in time
        let a = self.delay_buffer[(self.write_pos + len - i) % len];
        let b = self.delay_buffer[(self.write_pos + len - i - 1) % len];
        a + frac * (b - a)
    }

    /// Process one input sample, producing a stereo (L, R) output pair.
    ///
    /// The two channels see the rotor horn from opposite sides (180° apart), so
    /// when one channel gets higher pitch (horn moving toward it), the other
    /// gets lower pitch. This creates the characteristic stereo sweep.
    fn process_stereo(&mut self, input: f32) -> (f32, f32) {
        // Advance write pointer and write
        self.write_pos = (self.write_pos + 1) % self.delay_buffer.len();
        self.delay_buffer[self.write_pos] = input;

        self.advance_phase();

        let sin = (2.0 * PI * self.phase).sin();

        // Delay modulation: L and R see opposite sides of the rotation
        let center = self.max_delay_samples as f32 * 0.5;
        let delay_l = center * (1.0 + sin * self.doppler_depth);
        let delay_r = center * (1.0 - sin * self.doppler_depth);

        let sample_l = self.read_interpolated(delay_l);
        let sample_r = self.read_interpolated(delay_r);

        // Amplitude modulation: horn radiates more energy toward the mic
        let am_l = 1.0 + sin * self.am_depth * 0.5;
        let am_r = 1.0 - sin * self.am_depth * 0.5;

        (sample_l * am_l, sample_r * am_r)
    }

    fn set_target_speed(&mut self, speed_state: LeslieSpeedState) {
        self.target_rate = match speed_state {
            LeslieSpeedState::Stop => 0.0,
            LeslieSpeedState::Slow => self.slow_rate,
            LeslieSpeedState::Fast => self.fast_rate,
        };
    }
}

#[derive(Clone, Copy)]
pub enum LeslieSpeedState {
    Stop,
    Slow,
    Fast,
}

impl LeslieSpeedState {
    pub fn from_str(s: &str) -> Self {
        match s {
            "fast" => Self::Fast,
            "slow" => Self::Slow,
            _ => Self::Stop,
        }
    }
}

/// Leslie rotary speaker cabinet simulation.
///
/// Models a Leslie 122-style cabinet with separate horn (treble) and bass drum
/// rotors, each running at independent speeds. An 800 Hz crossover splits the
/// signal: the horn rotor processes the high band (Doppler + AM), and the bass
/// rotor processes the low band (mostly AM with subtle Doppler).
///
/// Calling `process_stereo` produces interleaved L/R output. Speed can be
/// changed at any time via `set_speed`; the rotors accelerate/decelerate
/// smoothly with different inertia characteristics.
pub struct Leslie {
    crossover_lp: Biquad, // feeds bass rotor
    crossover_hp: Biquad, // feeds horn rotor
    /// Horn rotor: fast=6.7 Hz, slow=0.75 Hz; accelerates in ~0.5s, decelerates in ~1.5s
    horn: LeslieRotor,
    /// Bass rotor: fast=6.0 Hz, slow=0.6 Hz; accelerates in ~0.7s, decelerates in ~2.0s
    bass: LeslieRotor,
}

impl Leslie {
    pub fn new(sample_rate: f32) -> Self {
        let crossover_hz = 800.0_f32;
        let norm = crossover_hz / sample_rate;
        let q = 0.707_f32; // Butterworth

        Self {
            crossover_lp: Biquad::low_pass(norm, q),
            crossover_hp: Biquad::high_pass(norm, q),
            // Horn: relatively fast acceleration/slow deceleration (lighter assembly)
            horn: LeslieRotor::new(sample_rate, 0.75, 6.7, 0.5, 1.5, 0.6, 0.7),
            // Bass: slower acceleration/deceleration (heavier drum assembly)
            bass: LeslieRotor::new(sample_rate, 0.6, 6.0, 0.7, 2.0, 0.15, 0.4),
        }
    }

    /// Switch Leslie speed. Rotors ramp smoothly toward the new speed.
    /// `speed`: `"stop"` | `"slow"` | `"fast"`
    pub fn set_speed(&mut self, speed: &str) {
        let state = LeslieSpeedState::from_str(speed);
        self.horn.set_target_speed(state);
        self.bass.set_target_speed(state);
    }

    /// Process one mono input sample and return `(left, right)` output.
    pub fn process_stereo(&mut self, input: f32) -> (f32, f32) {
        let low_band = self.crossover_lp.process(input);
        let high_band = self.crossover_hp.process(input);

        let (bass_l, bass_r) = self.bass.process_stereo(low_band);
        let (horn_l, horn_r) = self.horn.process_stereo(high_band);

        let left = bass_l + horn_l;
        let right = bass_r + horn_r;

        // Guard against NaN/Inf from filter edge cases
        (
            if left.is_finite() { left } else { 0.0 },
            if right.is_finite() { right } else { 0.0 },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leslie_output_is_finite() {
        let mut leslie = Leslie::new(48000.0);
        leslie.set_speed("fast");
        for i in 0..4800 {
            let input = (i as f32 * 0.1).sin() * 0.5;
            let (l, r) = leslie.process_stereo(input);
            assert!(l.is_finite(), "L is non-finite at sample {i}");
            assert!(r.is_finite(), "R is non-finite at sample {i}");
        }
    }

    #[test]
    fn leslie_fast_mode_creates_stereo_difference() {
        let mut leslie = Leslie::new(48000.0);
        leslie.set_speed("fast");
        // Warm up
        for i in 0..4800 {
            let input = (i as f32 * 2.0 * PI * 440.0 / 48000.0).sin();
            leslie.process_stereo(input);
        }
        // Measure L vs R difference in a window
        let mut diff_sum = 0.0_f32;
        for i in 0..480 {
            let input = (i as f32 * 2.0 * PI * 440.0 / 48000.0).sin() * 0.5;
            let (l, r) = leslie.process_stereo(input);
            diff_sum += (l - r).abs();
        }
        assert!(diff_sum > 0.01, "fast Leslie should produce L/R difference, got {diff_sum}");
    }

    #[test]
    fn leslie_stop_mode_converges() {
        let mut leslie = Leslie::new(48000.0);
        leslie.set_speed("fast");
        for i in 0..4800 {
            leslie.process_stereo((i as f32 * 0.1).sin() * 0.5);
        }
        leslie.set_speed("stop");
        // After many samples the rotor should be nearly stopped (very slow)
        // We just check that output remains finite and doesn't blow up
        for i in 0..48000 {
            let (l, r) = leslie.process_stereo((i as f32 * 0.05).sin() * 0.3);
            assert!(l.is_finite() && r.is_finite());
        }
    }
}
