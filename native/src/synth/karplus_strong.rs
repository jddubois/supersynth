// ── Karplus-Strong tuning constants ──────────────────────────────────────────
const DELAY_MIN_FREQ_HZ: f32 = 20.0;  // prevents zero-length delay line
// DAMPING_MIN/MAX are per-loop-iteration gain bounds for the feedback path.
// The KS loop runs `frequency` times per second; each iteration multiplies
// amplitude by (damping × averaging-filter-gain).  Valid range is (0, 1).
const DAMPING_MIN: f32 = 0.50;        // permits fast decay at low frequencies
const DAMPING_MAX: f32 = 0.99999;     // stability upper bound; caps effective T60 at ~14 s
const LN_0_001: f32 = -6.9078;        // ln(0.001) = −60 dB, the definition of T60

// ── Excitation-specific tuning ────────────────────────────────────────────────
// Plucked (acoustic guitar): half-sine noise over full buffer, T60 1.5–5.5 s
const PLUCKED_T60_MIN: f32  = 1.5;
const PLUCKED_T60_RANGE: f32 = 4.0;   // total range = MIN + RANGE = 5.5 s max
const PLUCKED_T60_SCALE: f32 = 350.0; // Hz where T60 = MIN + RANGE/e

// Struck (piano): short burst in first 1/8 of buffer, T60 5–30 s
const STRUCK_T60_MIN: f32  = 5.0;
const STRUCK_T60_RANGE: f32 = 25.0;
const STRUCK_T60_SCALE: f32 = 300.0;

// Electric guitar: bridge-position burst (first 1/7 of buffer), T60 2–5 s.
// Shorter than struck/plucked-acoustic to match real electric guitar decay
// without sustain effects; reverb in the signal chain adds perceived sustain.
const ELECTRIC_T60_MIN: f32  = 2.0;
const ELECTRIC_T60_RANGE: f32 = 3.0;
const ELECTRIC_T60_SCALE: f32 = 250.0;
const ELECTRIC_DRIVE: f32 = 1.5;  // tanh drive coefficient
/// One-pole lowpass coefficient applied to the struck excitation noise.
/// Simulates felt hammer softness (0 = bypass/bright, higher = darker/softer).
const STRUCK_HAMMER_FILTER_COEFF: f32 = 0.5;

/// Which physical excitation mechanism to model.
#[derive(Debug, Clone, PartialEq)]
pub enum Excitation {
    /// Fingertip or pick plucks string (acoustic guitar, harp).
    /// Full-buffer half-sine windowed noise; shorter sustain.
    Plucked,
    /// Felt hammer strikes string (piano, harpsichord).
    /// Short impulsive burst in first 1/3 of buffer; long sustain.
    Struck,
    /// Magnetic pickup with light overdrive (electric guitar).
    /// Bridge-position burst (first 1/7) + tanh soft-clip in feedback.
    Electric,
}

/// Karplus-Strong delay-line state, embedded directly in `Waveform::KarplusStrong`.
///
/// Lazily initialised on the first `next_sample` call (frequency and sample_rate
/// are recovered from the oscillator's `generate_sample` arguments). Amplitude
/// scaling and the ADSR envelope are handled by the enclosing `Oscillator`.
#[derive(Debug, Clone)]
pub struct KarplusData {
    pub excitation: Excitation,
    buffer: Vec<f32>,
    pos: usize,
    frac: f32,    // fractional-delay remainder for accurate pitch
    prev: f32,    // previous output, for the one-pole lowpass
    damping: f32,
    initialized: bool,
}

impl KarplusData {
    pub fn plucked()  -> Self { Self::new(Excitation::Plucked)  }
    pub fn struck()   -> Self { Self::new(Excitation::Struck)   }
    pub fn electric() -> Self { Self::new(Excitation::Electric) }

    fn new(excitation: Excitation) -> Self {
        Self {
            excitation,
            buffer: Vec::new(),
            pos: 0,
            frac: 0.0,
            prev: 0.0,
            damping: 0.0, // overwritten in init() before first use
            initialized: false,
        }
    }

    fn init(&mut self, frequency: f32, sample_rate: f32) {
        let delay = sample_rate / frequency.max(DELAY_MIN_FREQ_HZ);
        let len = (delay.floor() as usize).max(2);
        self.frac = delay - delay.floor();

        let mut rng: u32 = (frequency * 997.0) as u32 ^ 0xDEAD_BEEF;
        let next_rng = |rng: &mut u32| -> f32 {
            *rng ^= *rng << 13;
            *rng ^= *rng >> 17;
            *rng ^= *rng << 5;
            (*rng as f32 / u32::MAX as f32) * 2.0 - 1.0
        };

        self.buffer = match self.excitation {
            Excitation::Plucked => {
                // Full-buffer half-sine windowed noise — soft, warm pluck
                (0..len).map(|i| {
                    let noise = next_rng(&mut rng);
                    let window = (std::f32::consts::PI * i as f32 / len as f32).sin();
                    noise * window
                }).collect()
            }
            Excitation::Struck => {
                // Wider burst (1/3 of buffer) simulates the longer string contact time
                // of a felt hammer vs. a plectrum. One-pole lowpass on the noise models
                // the felt absorbing high frequencies.
                let burst = (len / 3).max(2);
                let mut filtered = 0.0_f32;
                (0..len).map(|i| {
                    let noise = next_rng(&mut rng);
                    if i < burst {
                        filtered = filtered * STRUCK_HAMMER_FILTER_COEFF
                            + noise * (1.0 - STRUCK_HAMMER_FILTER_COEFF);
                        let t = i as f32 / burst as f32;
                        filtered * (std::f32::consts::PI * t).sin()
                    } else {
                        0.0
                    }
                }).collect()
            }
            Excitation::Electric => {
                // Bridge-position burst (first 1/4) — still brighter than plucked
                // but 1/7 was too extreme, concentrating energy only in high harmonics
                let burst = (len / 4).max(2);
                (0..len).map(|i| {
                    let noise = next_rng(&mut rng);
                    if i < burst {
                        let t = i as f32 / burst as f32;
                        noise * (std::f32::consts::PI * t).sin()
                    } else {
                        0.0
                    }
                }).collect()
            }
        };

        let (t60_min, t60_range, t60_scale) = match self.excitation {
            Excitation::Plucked  => (PLUCKED_T60_MIN,  PLUCKED_T60_RANGE,  PLUCKED_T60_SCALE),
            Excitation::Struck   => (STRUCK_T60_MIN,   STRUCK_T60_RANGE,   STRUCK_T60_SCALE),
            Excitation::Electric => (ELECTRIC_T60_MIN, ELECTRIC_T60_RANGE, ELECTRIC_T60_SCALE),
        };
        let target_t60 = (t60_range * (-frequency / t60_scale).exp() + t60_min)
            .clamp(t60_min, t60_min + t60_range);

        // The KS delay loop completes `frequency` iterations per second.
        // We need (damping)^(T60 * frequency) = 0.001, so:
        //   damping = exp(ln(0.001) / (T60 * frequency))
        self.damping = (LN_0_001 / (target_t60 * frequency))
            .exp()
            .clamp(DAMPING_MIN, DAMPING_MAX);

        self.pos = 0;
        self.prev = 0.0;
        self.initialized = true;
    }

    /// Advance the delay line by one sample and return the raw output.
    /// Frequency and sample_rate are only used on the very first call (lazy init).
    pub fn next_sample(&mut self, frequency: f32, sample_rate: f32) -> f32 {
        if !self.initialized {
            self.init(frequency, sample_rate);
        }

        let len = self.buffer.len();
        let next_pos = (self.pos + 1) % len;

        // Linear interpolation for fractional-delay pitch accuracy
        let out = (1.0 - self.frac) * self.buffer[self.pos]
                + self.frac          * self.buffer[next_pos];

        // One-pole lowpass in the feedback path — damps high frequencies each cycle
        let raw_feedback = self.damping * 0.5 * (out + self.prev);

        // Electric: soft-clip the feedback for pickup/overdrive character
        let feedback = if self.excitation == Excitation::Electric {
            // tanh soft clip, normalised for unit gain at small amplitudes:
            //   (x·D).tanh() / D  →  x as x→0,  compresses large transients
            // The previous form  tanh(x) / tanh(D)  gave gain > 1 for |x| < D,
            // causing the feedback tail to grow instead of decay (organ effect).
            (raw_feedback * ELECTRIC_DRIVE).tanh() / ELECTRIC_DRIVE
        } else {
            raw_feedback
        };

        self.prev = out;
        self.buffer[self.pos] = feedback;
        self.pos = next_pos;

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_excitations_finite() {
        for ks_fn in [KarplusData::plucked, KarplusData::struck, KarplusData::electric] {
            let mut ks = ks_fn();
            for _ in 0..4800 {
                let s = ks.next_sample(440.0, 48000.0);
                assert!(s.is_finite(), "{:?} produced non-finite sample", ks.excitation);
            }
        }
    }

    #[test]
    fn all_excitations_nonsilent() {
        for ks_fn in [KarplusData::plucked, KarplusData::struck, KarplusData::electric] {
            let mut ks = ks_fn();
            let max = (0..4800)
                .map(|_| ks.next_sample(440.0, 48000.0).abs())
                .fold(0.0_f32, f32::max);
            assert!(max > 0.01, "{:?} was near-silent: {max}", ks.excitation);
        }
    }

    #[test]
    fn struck_sustains_longer_than_plucked() {
        let mut plucked = KarplusData::plucked();
        let mut struck  = KarplusData::struck();
        let rms = |ks: &mut KarplusData| {
            let n = 96_000usize;
            let sum: f32 = (0..n).map(|_| ks.next_sample(440.0, 48000.0).powi(2)).sum();
            (sum / n as f32).sqrt()
        };
        assert!(rms(&mut struck) > rms(&mut plucked), "struck should sustain longer than plucked");
    }

    #[test]
    fn low_note_decays_slower_than_high() {
        let mut low  = KarplusData::plucked();
        let mut high = KarplusData::plucked();
        let rms = |ks: &mut KarplusData, freq: f32| {
            let n = 96_000usize;
            let sum: f32 = (0..n).map(|_| ks.next_sample(freq, 48000.0).powi(2)).sum();
            (sum / n as f32).sqrt()
        };
        assert!(
            rms(&mut low, 82.0) > rms(&mut high, 660.0),
            "low note should sustain more than high"
        );
    }
}
