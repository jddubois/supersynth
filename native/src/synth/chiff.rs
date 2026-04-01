use super::waveform::Waveform;

/// Organ key-contact click — a very short, percussive noise burst that
/// simulates the transient produced when an organ circuit is switched in.
///
/// Structurally similar to [`Chiff`] but with a much steeper decay envelope
/// and a fixed band-pass centred around 500 Hz, giving the characteristic
/// "thump" of a key press regardless of the underlying oscillator waveform.
pub struct KeyClick {
    // Biquad band-pass state
    bp_x1: f32,
    bp_x2: f32,
    bp_y1: f32,
    bp_y2: f32,
    bp_a0: f32,  // b0/a0
    bp_a2: f32,  // b2/a0  (b1 = 0 for band-pass)
    bp_b1: f32,  // a1/a0
    bp_b2: f32,  // a2/a0
    elapsed_samples: u32,
    duration_samples: u32,
    intensity: f32,
    rng_state: u32,
}

impl KeyClick {
    /// Create a new KeyClick transient.
    ///
    /// - `intensity` — peak amplitude (0.0 = silent, 0.5 = typical organ key-click)
    /// - `duration` — total duration in seconds (default: 0.003 = 3 ms)
    pub fn new(sample_rate: f32, intensity: f32, duration: f32) -> Self {
        let duration_samples = ((duration * sample_rate) as u32).max(1);

        // Fixed band-pass at ~500 Hz with wide bandwidth (~800 Hz)
        let center_freq = 500.0_f32;
        let bandwidth = 800.0_f32;
        let omega = 2.0 * std::f32::consts::PI * center_freq / sample_rate;
        let q = center_freq / bandwidth.max(1.0);
        let alpha = omega.sin() / (2.0 * q);

        let b0 = alpha;
        let b2 = -alpha;
        let a0 = 1.0 + alpha;
        let a1 = -2.0 * omega.cos();
        let a2 = 1.0 - alpha;

        Self {
            bp_x1: 0.0, bp_x2: 0.0, bp_y1: 0.0, bp_y2: 0.0,
            bp_a0: b0 / a0,
            bp_a2: b2 / a0,
            bp_b1: a1 / a0,
            bp_b2: a2 / a0,
            elapsed_samples: 0,
            duration_samples,
            intensity,
            rng_state: 0xDEADF00D_u32,
        }
    }

    pub fn is_finished(&self) -> bool {
        self.elapsed_samples >= self.duration_samples
    }

    pub fn next_sample(&mut self) -> f32 {
        if self.is_finished() {
            return 0.0;
        }

        // XorShift32 noise
        self.rng_state ^= self.rng_state << 13;
        self.rng_state ^= self.rng_state >> 17;
        self.rng_state ^= self.rng_state << 5;
        let noise = (self.rng_state as f32 / u32::MAX as f32) * 2.0 - 1.0;

        // Band-pass biquad (Direct Form 1, b1 = 0)
        let mut filtered = self.bp_a0 * noise
            + self.bp_a2 * self.bp_x2
            - self.bp_b1 * self.bp_y1
            - self.bp_b2 * self.bp_y2;
        if !filtered.is_finite() {
            filtered = 0.0;
        }
        self.bp_x2 = self.bp_x1;
        self.bp_x1 = noise;
        self.bp_y2 = self.bp_y1;
        self.bp_y1 = filtered;

        // Steep exponential decay — much faster than Chiff (exponent −12 vs −4)
        let t = self.elapsed_samples as f32 / self.duration_samples as f32;
        let envelope = (-12.0 * t).exp();
        self.elapsed_samples += 1;

        filtered * envelope * self.intensity
    }
}

#[cfg(test)]
mod key_click_tests {
    use super::*;

    #[test]
    fn key_click_finishes_after_duration() {
        let mut click = KeyClick::new(48000.0, 0.5, 0.003);
        let dur = (0.003 * 48000.0) as u32;
        for _ in 0..dur { click.next_sample(); }
        assert!(click.is_finished());
    }

    #[test]
    fn key_click_output_is_finite() {
        let mut click = KeyClick::new(48000.0, 0.5, 0.003);
        for _ in 0..200 {
            assert!(click.next_sample().is_finite());
        }
    }

    #[test]
    fn zero_intensity_key_click_is_silent() {
        let mut click = KeyClick::new(48000.0, 0.0, 0.003);
        for _ in 0..200 {
            assert_eq!(click.next_sample(), 0.0);
        }
    }
}

/// Generates breathy pipe attack transient noise — band-pass filtered
/// white noise with a fast exponential decay envelope.
pub struct Chiff {
    bp_x1: f32,
    bp_x2: f32,
    bp_y1: f32,
    bp_y2: f32,
    bp_a0: f32,
    bp_a2: f32,
    bp_b1: f32,
    bp_b2: f32,
    elapsed_samples: u32,
    duration_samples: u32,
    intensity: f32,
    rng_state: u32,
}

impl Chiff {
    pub fn new(frequency: f32, sample_rate: f32, intensity: f32, duration: f32, waveform: &Waveform) -> Self {
        let seed = (frequency * 1000.0) as u32 ^ 0xDEADBEEF;
        let variation = ((seed % 400) as f32 / 1000.0) - 0.2;
        let intensity = (intensity * (1.0 + variation)).max(0.0);
        let duration_samples = (duration * sample_rate) as u32;

        let freq_scale = if frequency < 100.0 {
            1.5
        } else if frequency < 300.0 {
            1.5 + (frequency - 100.0) / 200.0
        } else {
            2.5
        };

        let (center_freq, bandwidth) = match waveform {
            Waveform::Triangle         => (frequency * freq_scale, frequency * 1.5),
            Waveform::Sine             => (frequency * (freq_scale + 0.5), frequency * 1.0),
            Waveform::Flute            => (frequency * (freq_scale + 0.3), frequency * 1.2),
            // Principal pipe chiff: centered around 2–3× fundamental so the noise spectrum
            // overlaps with the pipe's lower harmonics and fills the 400–800 Hz band naturally.
            // Higher centre (freq_scale+1.5) moves chiff to 4–5×f, emptying that band and
            // collapsing the render to a bass-dominated profile.
            Waveform::Principal        => (frequency * (freq_scale + 0.5), frequency * 1.5),
            Waveform::Trumpet
            | Waveform::Sawtooth       => (frequency * freq_scale, frequency * 3.0),
            Waveform::Square
            | Waveform::Pulse(_)       => (frequency * freq_scale, frequency * 2.0),
            // KarplusStrong's noise-burst excitation is built into the delay line;
            // chiff is never triggered for it (chiff_intensity will always be 0).
            Waveform::KarplusStrong(_)
            | Waveform::Noise(_)       => (frequency * freq_scale, frequency * 1.5),
        };

        let nyquist = sample_rate * 0.45;
        let center_freq = center_freq.min(nyquist);
        let bandwidth = bandwidth.min(nyquist);

        let omega = 2.0 * std::f32::consts::PI * center_freq / sample_rate;
        let q = center_freq / bandwidth.max(1.0);
        let alpha = omega.sin() / (2.0 * q);

        let b0 = alpha;
        let b2 = -alpha;
        let a0 = 1.0 + alpha;
        let a1 = -2.0 * omega.cos();
        let a2 = 1.0 - alpha;

        Self {
            bp_x1: 0.0, bp_x2: 0.0, bp_y1: 0.0, bp_y2: 0.0,
            bp_a0: b0 / a0, bp_a2: b2 / a0, bp_b1: a1 / a0, bp_b2: a2 / a0,
            elapsed_samples: 0,
            duration_samples,
            intensity,
            rng_state: seed,
        }
    }

    pub fn is_finished(&self) -> bool {
        self.elapsed_samples >= self.duration_samples
    }

    pub fn next_sample(&mut self) -> f32 {
        if self.is_finished() {
            return 0.0;
        }

        // xorshift32 white noise
        self.rng_state ^= self.rng_state << 13;
        self.rng_state ^= self.rng_state >> 17;
        self.rng_state ^= self.rng_state << 5;
        let noise = (self.rng_state as f32 / u32::MAX as f32) * 2.0 - 1.0;

        // Band-pass biquad (Direct Form 1, b1=0 for band-pass)
        let mut filtered = self.bp_a0 * noise
            + self.bp_a2 * self.bp_x2
            - self.bp_b1 * self.bp_y1
            - self.bp_b2 * self.bp_y2;
        if !filtered.is_finite() {
            filtered = 0.0;
        }
        self.bp_x2 = self.bp_x1;
        self.bp_x1 = noise;
        self.bp_y2 = self.bp_y1;
        self.bp_y1 = filtered;

        // Delayed-peak envelope: t·e^(-6t) scaled to peak = 1.0 at t=1/6 (≈17% of duration).
        // At t=0 the chiff is silent (blends with the attack ramp), peaks as the note
        // speaks, then decays to ~4% by t=1.0 — clean enough to avoid a cutoff click.
        // Normalization: peak of (t·e^{-6t}) at t=1/6 is (1/6)·e^{-1} = 1/(6e), so ×6e.
        let t = self.elapsed_samples as f32 / self.duration_samples as f32;
        let envelope = 6.0 * std::f32::consts::E * t * (-6.0 * t).exp();
        self.elapsed_samples += 1;

        filtered * envelope * self.intensity
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chiff_finishes_after_duration() {
        let mut chiff = Chiff::new(440.0, 48000.0, 0.3, 0.05, &Waveform::Triangle);
        let duration_samples = (0.05 * 48000.0) as u32;
        for _ in 0..duration_samples {
            chiff.next_sample();
        }
        assert!(chiff.is_finished());
    }

    #[test]
    fn chiff_output_is_finite() {
        let mut chiff = Chiff::new(440.0, 48000.0, 0.3, 0.05, &Waveform::Sine);
        for _ in 0..2400 {
            let s = chiff.next_sample();
            assert!(s.is_finite(), "chiff produced non-finite sample");
        }
    }

    #[test]
    fn zero_intensity_chiff_is_silent() {
        let mut chiff = Chiff::new(440.0, 48000.0, 0.0, 0.05, &Waveform::Flute);
        for _ in 0..2400 {
            assert_eq!(chiff.next_sample(), 0.0);
        }
    }
}
