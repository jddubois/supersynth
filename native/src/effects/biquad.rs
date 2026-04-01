use super::filter::Filter;

/// General second-order biquad filter (Direct Form 1).
/// Supports low-pass, high-pass, band-pass, notch, and peak EQ.
pub struct Biquad {
    b0: f32, b1: f32, b2: f32,
    a1: f32, a2: f32,
    x1: f32, x2: f32,
    y1: f32, y2: f32,
}

#[allow(dead_code)]
impl Biquad {
    /// Low-pass filter. `freq` is normalized (0.0–0.5, i.e. Hz / sample_rate).
    pub fn low_pass(freq: f32, q: f32) -> Self {
        let omega = 2.0 * std::f32::consts::PI * freq;
        let alpha = omega.sin() / (2.0 * q);
        let cos_w = omega.cos();
        let b0 = (1.0 - cos_w) / 2.0;
        let b1 = 1.0 - cos_w;
        let b2 = (1.0 - cos_w) / 2.0;
        let a0 = 1.0 + alpha;
        let a1 = -2.0 * cos_w;
        let a2 = 1.0 - alpha;
        Self::from_coeffs(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
    }

    /// High-pass filter. `freq` is normalized (0.0–0.5).
    pub fn high_pass(freq: f32, q: f32) -> Self {
        let omega = 2.0 * std::f32::consts::PI * freq;
        let alpha = omega.sin() / (2.0 * q);
        let cos_w = omega.cos();
        let b0 = (1.0 + cos_w) / 2.0;
        let b1 = -(1.0 + cos_w);
        let b2 = (1.0 + cos_w) / 2.0;
        let a0 = 1.0 + alpha;
        let a1 = -2.0 * cos_w;
        let a2 = 1.0 - alpha;
        Self::from_coeffs(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
    }

    /// Band-pass filter. `freq` is normalized (0.0–0.5).
    pub fn band_pass(freq: f32, q: f32) -> Self {
        let omega = 2.0 * std::f32::consts::PI * freq;
        let alpha = omega.sin() / (2.0 * q);
        let cos_w = omega.cos();
        let b0 = alpha;
        let b1 = 0.0;
        let b2 = -alpha;
        let a0 = 1.0 + alpha;
        let a1 = -2.0 * cos_w;
        let a2 = 1.0 - alpha;
        Self::from_coeffs(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
    }

    /// Notch filter. `freq` is normalized (0.0–0.5).
    pub fn notch(freq: f32, q: f32) -> Self {
        let omega = 2.0 * std::f32::consts::PI * freq;
        let alpha = omega.sin() / (2.0 * q);
        let cos_w = omega.cos();
        let b0 = 1.0;
        let b1 = -2.0 * cos_w;
        let b2 = 1.0;
        let a0 = 1.0 + alpha;
        let a1 = -2.0 * cos_w;
        let a2 = 1.0 - alpha;
        Self::from_coeffs(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
    }

    /// Low-shelf filter. `freq_normalized` is Hz / sample_rate, `gain_db` is boost/cut in dB,
    /// `slope` is shelf slope (1.0 = maximum slope without peaking).
    pub fn low_shelf(freq_normalized: f32, gain_db: f32, slope: f32) -> Self {
        let omega = 2.0 * std::f32::consts::PI * freq_normalized.clamp(1e-6, 0.4999);
        let a     = 10.0_f32.powf(gain_db / 40.0);
        let sin_w = omega.sin();
        let cos_w = omega.cos();
        let alpha = sin_w / 2.0 * ((a + 1.0 / a) * (1.0 / slope - 1.0) + 2.0).sqrt();

        let b0 =  a * ((a + 1.0) - (a - 1.0) * cos_w + 2.0 * alpha * a.sqrt());
        let b1 =  2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w);
        let b2 =  a * ((a + 1.0) - (a - 1.0) * cos_w - 2.0 * alpha * a.sqrt());
        let a0 =       (a + 1.0) + (a - 1.0) * cos_w + 2.0 * alpha * a.sqrt();
        let a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cos_w);
        let a2 =        (a + 1.0) + (a - 1.0) * cos_w - 2.0 * alpha * a.sqrt();
        Self::from_coeffs(b0/a0, b1/a0, b2/a0, a1/a0, a2/a0)
    }

    /// Peaking EQ filter. `freq_normalized` is Hz / sample_rate, `gain_db` is boost/cut in dB,
    /// `q` is the quality factor (higher Q = narrower peak, Q=4 ≈ 252 Hz bandwidth at 1 kHz).
    pub fn peaking_eq(freq_normalized: f32, gain_db: f32, q: f32) -> Self {
        let omega = 2.0 * std::f32::consts::PI * freq_normalized.clamp(1e-6, 0.4999);
        let a     = 10.0_f32.powf(gain_db / 40.0);
        let alpha = omega.sin() / (2.0 * q);
        let cos_w = omega.cos();
        let b0 =  1.0 + alpha * a;
        let b1 = -2.0 * cos_w;
        let b2 =  1.0 - alpha * a;
        let a0 =  1.0 + alpha / a;
        let a1 = -2.0 * cos_w;
        let a2 =  1.0 - alpha / a;
        Self::from_coeffs(b0/a0, b1/a0, b2/a0, a1/a0, a2/a0)
    }

    /// High-shelf filter. `freq_normalized` is Hz / sample_rate, `gain_db` is boost/cut in dB,
    /// `slope` is shelf slope (1.0 = maximum slope without peaking).
    pub fn high_shelf(freq_normalized: f32, gain_db: f32, slope: f32) -> Self {
        let omega = 2.0 * std::f32::consts::PI * freq_normalized.clamp(1e-6, 0.4999);
        let a     = 10.0_f32.powf(gain_db / 40.0);
        let sin_w = omega.sin();
        let cos_w = omega.cos();
        let alpha = sin_w / 2.0 * ((a + 1.0 / a) * (1.0 / slope - 1.0) + 2.0).sqrt();

        let b0 =  a * ((a + 1.0) + (a - 1.0) * cos_w + 2.0 * alpha * a.sqrt());
        let b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w);
        let b2 =  a * ((a + 1.0) + (a - 1.0) * cos_w - 2.0 * alpha * a.sqrt());
        let a0 =       (a + 1.0) - (a - 1.0) * cos_w + 2.0 * alpha * a.sqrt();
        let a1 =  2.0 * ((a - 1.0) - (a + 1.0) * cos_w);
        let a2 =        (a + 1.0) - (a - 1.0) * cos_w - 2.0 * alpha * a.sqrt();
        Self::from_coeffs(b0/a0, b1/a0, b2/a0, a1/a0, a2/a0)
    }

    /// Update biquad coefficients in-place without resetting the delay-line state.
    /// Use this to retune a live filter without causing audible clicks.
    pub fn update_coeffs_from(&mut self, src: &Biquad) {
        self.b0 = src.b0; self.b1 = src.b1; self.b2 = src.b2;
        self.a1 = src.a1; self.a2 = src.a2;
    }

    fn from_coeffs(b0: f32, b1: f32, b2: f32, a1: f32, a2: f32) -> Self {
        Self { b0, b1, b2, a1, a2, x1: 0.0, x2: 0.0, y1: 0.0, y2: 0.0 }
    }
}

impl Filter for Biquad {
    fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2
              - self.a1 * self.y1 - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = if y.is_finite() { y } else { 0.0 };
        self.y1
    }

    fn reset(&mut self) {
        self.x1 = 0.0; self.x2 = 0.0; self.y1 = 0.0; self.y2 = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn low_pass_attenuates_high_freq() {
        // Filter at 1kHz/48kHz ≈ 0.021, signal at 0.4 (near Nyquist) should be attenuated
        let mut lp = Biquad::low_pass(1000.0 / 48000.0, 0.707);
        let two_pi = 2.0 * std::f32::consts::PI;
        let freq_norm = 0.4; // near Nyquist
        let mut max_out = 0.0_f32;
        // Steady state: run 1000 samples and check peak output
        for i in 500..1000 {
            let x = (two_pi * freq_norm * i as f32).sin();
            let y = lp.process(x);
            max_out = max_out.max(y.abs());
        }
        assert!(max_out < 0.1, "high-freq should be attenuated, got {max_out}");
    }

    #[test]
    fn biquad_output_always_finite() {
        let mut bp = Biquad::band_pass(0.1, 1.0);
        for i in 0..1000 {
            let x = ((i as f32) * 0.37).sin();
            assert!(bp.process(x).is_finite());
        }
    }

    #[test]
    fn low_shelf_boosts_low_freq() {
        let sr = 48000.0_f32;
        let two_pi = 2.0 * std::f32::consts::PI;
        // Test at 150 Hz, well inside the boost region of a 300 Hz low shelf
        let mut lo = Biquad::low_shelf(300.0 / sr, 10.0, 1.0);
        let mut hi = Biquad::low_shelf(300.0 / sr, 0.0, 1.0);
        let mut peak_boosted = 0.0_f32;
        let mut peak_unity = 0.0_f32;
        for i in 500..1500 {
            let x = (two_pi * 150.0 / sr * i as f32).sin();
            peak_boosted = peak_boosted.max(lo.process(x).abs());
            peak_unity   = peak_unity.max(hi.process(x).abs());
        }
        assert!(
            peak_boosted > peak_unity * 1.5,
            "low shelf 10dB boost should amplify 150Hz: boosted={peak_boosted} unity={peak_unity}"
        );
    }

    #[test]
    fn shelf_is_unity_at_zero_gain() {
        let sr = 48000.0_f32;
        let two_pi = 2.0 * std::f32::consts::PI;
        let mut lo = Biquad::low_shelf(80.0 / sr, 0.0, 1.0);
        let mut hi = Biquad::high_shelf(10000.0 / sr, 0.0, 1.0);
        // Run 500 samples to settle, then check amplitude at 1 kHz
        for i in 0..500 {
            let x = (two_pi * 1000.0 / sr * i as f32).sin();
            lo.process(x);
            hi.process(x);
        }
        let mut peak_lo = 0.0_f32;
        let mut peak_hi = 0.0_f32;
        let mut peak_in = 0.0_f32;
        for i in 500..900 {
            let x = (two_pi * 1000.0 / sr * i as f32).sin();
            peak_lo = peak_lo.max(lo.process(x).abs());
            peak_hi = peak_hi.max(hi.process(x).abs());
            peak_in = peak_in.max(x.abs());
        }
        assert!((peak_lo - peak_in).abs() < 0.05, "low shelf not unity at 0dB: {peak_lo} vs {peak_in}");
        assert!((peak_hi - peak_in).abs() < 0.05, "high shelf not unity at 0dB: {peak_hi} vs {peak_in}");
    }
}
