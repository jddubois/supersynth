/// Configuration for the soft knee limiter.
pub struct LimiterParams {
    /// Level above which gain reduction begins (linear, 0.0–1.0). Default: 0.85.
    pub threshold: f32,
    /// Width of the soft knee transition (linear). Default: 0.15.
    pub knee_width: f32,
    /// Compression ratio above the knee. 1.0 = bypass, 10.0 = strong limiting. Default: 10.0.
    pub ratio: f32,
    /// Peak follower attack time in milliseconds. Default: 1.0.
    pub attack_ms: f32,
    /// Peak follower release time in milliseconds. Default: 100.0.
    pub release_ms: f32,
}

impl Default for LimiterParams {
    fn default() -> Self {
        Self { threshold: 0.85, knee_width: 0.15, ratio: 10.0, attack_ms: 1.0, release_ms: 100.0 }
    }
}

/// Soft knee peak limiter with an envelope follower.
///
/// Transparent below the threshold, applies gain reduction with a smooth quadratic
/// knee transition, then a fixed ratio above the knee. Replaces hard `tanh` clipping
/// while letting polyphonic loudness grow naturally up to the ceiling.
pub struct SoftKneeLimiter {
    threshold: f32,
    knee_width: f32,
    ratio: f32,
    envelope: f32,
    attack_coeff: f32,
    release_coeff: f32,
}

impl SoftKneeLimiter {
    pub fn new(params: &LimiterParams, sample_rate: f32) -> Self {
        Self {
            threshold: params.threshold,
            knee_width: params.knee_width,
            ratio: params.ratio,
            envelope: 0.0,
            attack_coeff: (-1.0 / (params.attack_ms / 1000.0 * sample_rate)).exp(),
            release_coeff: (-1.0 / (params.release_ms / 1000.0 * sample_rate)).exp(),
        }
    }

    pub fn process(&mut self, sample: f32) -> f32 {
        // Peak follower: fast attack on rising peaks, slow release on decay
        let abs_in = sample.abs();
        if abs_in > self.envelope {
            self.envelope = self.attack_coeff * self.envelope + (1.0 - self.attack_coeff) * abs_in;
        } else {
            self.envelope = self.release_coeff * self.envelope + (1.0 - self.release_coeff) * abs_in;
        }

        // Gain computation based on envelope level
        if self.envelope < 1e-10 {
            return sample;
        }

        let low = self.threshold - self.knee_width / 2.0;
        let high = self.threshold + self.knee_width / 2.0;

        let gain = if self.envelope <= low {
            // Below knee: unity gain
            1.0
        } else if self.envelope >= high {
            // Above knee: full ratio compression
            (self.threshold + (self.envelope - self.threshold) / self.ratio) / self.envelope
        } else {
            // In the knee: smooth quadratic interpolation
            let t = (self.envelope - low) / self.knee_width;
            let compressed = (self.threshold + (self.envelope - self.threshold) / self.ratio) / self.envelope;
            1.0 + t * t * (compressed - 1.0)
        };

        sample * gain
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unity_gain_below_threshold() {
        let mut lim = SoftKneeLimiter::new(&LimiterParams::default(), 48000.0);
        // Feed a low-level signal — should pass through without gain reduction
        for _ in 0..100 {
            let out = lim.process(0.3);
            assert!(out.abs() <= 0.3 + 1e-5);
        }
    }

    #[test]
    fn limits_loud_signal() {
        let mut lim = SoftKneeLimiter::new(&LimiterParams::default(), 48000.0);
        // Warm up: let the envelope follower settle (1ms attack ≈ 48 samples, run 4800)
        for _ in 0..4800 {
            lim.process(5.0);
        }
        // After settling, gain reduction should bring output well below 5.0
        let out = lim.process(5.0);
        assert!(out.abs() < 2.0, "limiter did not reduce loud signal: out={}", out.abs());
    }

    #[test]
    fn output_is_finite() {
        let mut lim = SoftKneeLimiter::new(&LimiterParams::default(), 48000.0);
        for i in 0..1000 {
            let s = if i % 2 == 0 { 10.0 } else { -10.0 };
            assert!(lim.process(s).is_finite());
        }
    }
}
