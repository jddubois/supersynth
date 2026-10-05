//! Biquad filters (RBJ cookbook), transposed direct form II.

use std::f32::consts::PI;

#[derive(Clone, Copy, Debug, Default)]
pub struct Coeffs {
    pub b0: f32,
    pub b1: f32,
    pub b2: f32,
    pub a1: f32,
    pub a2: f32,
}

impl Coeffs {
    pub const IDENTITY: Coeffs = Coeffs { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0 };

    fn norm(b0: f32, b1: f32, b2: f32, a0: f32, a1: f32, a2: f32) -> Self {
        Self { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
    }

    fn w(freq: f32, sr: f32) -> (f32, f32) {
        let w = 2.0 * PI * (freq / sr).clamp(1e-6, 0.4999);
        (w.cos(), w.sin())
    }

    pub fn low_pass(freq: f32, q: f32, sr: f32) -> Self {
        let (c, s) = Self::w(freq, sr);
        let alpha = s / (2.0 * q);
        Self::norm((1.0 - c) / 2.0, 1.0 - c, (1.0 - c) / 2.0, 1.0 + alpha, -2.0 * c, 1.0 - alpha)
    }

    pub fn high_pass(freq: f32, q: f32, sr: f32) -> Self {
        let (c, s) = Self::w(freq, sr);
        let alpha = s / (2.0 * q);
        Self::norm((1.0 + c) / 2.0, -(1.0 + c), (1.0 + c) / 2.0, 1.0 + alpha, -2.0 * c, 1.0 - alpha)
    }

    /// Band-pass with 0 dB peak gain.
    pub fn band_pass(freq: f32, q: f32, sr: f32) -> Self {
        let (c, s) = Self::w(freq, sr);
        let alpha = s / (2.0 * q);
        Self::norm(alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * c, 1.0 - alpha)
    }

    pub fn peaking(freq: f32, q: f32, gain_db: f32, sr: f32) -> Self {
        let (c, s) = Self::w(freq, sr);
        let a = 10f32.powf(gain_db / 40.0);
        let alpha = s / (2.0 * q);
        Self::norm(1.0 + alpha * a, -2.0 * c, 1.0 - alpha * a, 1.0 + alpha / a, -2.0 * c, 1.0 - alpha / a)
    }

    pub fn low_shelf(freq: f32, gain_db: f32, sr: f32) -> Self {
        let (c, s) = Self::w(freq, sr);
        let a = 10f32.powf(gain_db / 40.0);
        let alpha = s / 2.0 * std::f32::consts::SQRT_2;
        let sa = 2.0 * a.sqrt() * alpha;
        Self::norm(
            a * ((a + 1.0) - (a - 1.0) * c + sa),
            2.0 * a * ((a - 1.0) - (a + 1.0) * c),
            a * ((a + 1.0) - (a - 1.0) * c - sa),
            (a + 1.0) + (a - 1.0) * c + sa,
            -2.0 * ((a - 1.0) + (a + 1.0) * c),
            (a + 1.0) + (a - 1.0) * c - sa,
        )
    }

    pub fn high_shelf(freq: f32, gain_db: f32, sr: f32) -> Self {
        let (c, s) = Self::w(freq, sr);
        let a = 10f32.powf(gain_db / 40.0);
        let alpha = s / 2.0 * std::f32::consts::SQRT_2;
        let sa = 2.0 * a.sqrt() * alpha;
        Self::norm(
            a * ((a + 1.0) + (a - 1.0) * c + sa),
            -2.0 * a * ((a - 1.0) + (a + 1.0) * c),
            a * ((a + 1.0) + (a - 1.0) * c - sa),
            (a + 1.0) - (a - 1.0) * c + sa,
            2.0 * ((a - 1.0) - (a + 1.0) * c),
            (a + 1.0) - (a - 1.0) * c - sa,
        )
    }

    /// Power gain |H(e^jw)|^2 at a frequency.
    pub fn power_at(&self, freq: f32, sr: f32) -> f32 {
        let w = 2.0 * PI * freq / sr;
        let (c1, s1) = (w.cos(), w.sin());
        let (c2, s2) = ((2.0 * w).cos(), (2.0 * w).sin());
        let nr = self.b0 + self.b1 * c1 + self.b2 * c2;
        let ni = -(self.b1 * s1 + self.b2 * s2);
        let dr = 1.0 + self.a1 * c1 + self.a2 * c2;
        let di = -(self.a1 * s1 + self.a2 * s2);
        (nr * nr + ni * ni) / (dr * dr + di * di)
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Biquad {
    pub c: Coeffs,
    z1: f32,
    z2: f32,
}

impl Biquad {
    pub fn new(c: Coeffs) -> Self {
        Self { c, z1: 0.0, z2: 0.0 }
    }

    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        let c = &self.c;
        let y = c.b0 * x + self.z1;
        self.z1 = c.b1 * x - c.a1 * y + self.z2;
        self.z2 = c.b2 * x - c.a2 * y;
        y
    }

    /// Zero state values that have decayed below 1e-20. `process` (per
    /// sample) never flushes, so per-sample users must call this once per
    /// block: after the input stops, an IIR state otherwise decays into the
    /// subnormal range and stays there (~1e-44 limit cycle), which costs
    /// ~100x per operation on x86 without FTZ/DAZ.
    #[inline]
    pub fn flush_denormals(&mut self) {
        if self.z1.abs() < 1e-20 {
            self.z1 = 0.0;
        }
        if self.z2.abs() < 1e-20 {
            self.z2 = 0.0;
        }
    }

    pub fn process_block(&mut self, buf: &mut [f32]) {
        let c = self.c;
        let (mut z1, mut z2) = (self.z1, self.z2);
        for x in buf.iter_mut() {
            let y = c.b0 * *x + z1;
            z1 = c.b1 * *x - c.a1 * y + z2;
            z2 = c.b2 * *x - c.a2 * y;
            *x = y;
        }
        self.z1 = z1;
        self.z2 = z2;
        self.flush_denormals();
    }

    pub fn reset(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Per-sample processing of silence after a signal: without a flush the
    /// state of a low-corner filter settles in the subnormal range.
    #[test]
    fn flush_denormals_clears_decayed_state() {
        let mut bq = Biquad::new(Coeffs::low_pass(800.0, std::f32::consts::FRAC_1_SQRT_2, 48000.0));
        for i in 0..1000 {
            bq.process((i as f32 * 0.1).sin());
        }
        let mut unflushed = bq;
        let mut subnormal = 0;
        for k in 0..48000 {
            let y = unflushed.process(0.0);
            subnormal += (y != 0.0 && !y.is_normal()) as usize;
            bq.process(0.0);
            if k % 64 == 63 {
                bq.flush_denormals();
            }
        }
        println!("per-sample biquad, 1 s of silence: {subnormal} subnormal outputs without flush");
        assert!(subnormal > 1000, "expected the unflushed filter to go subnormal");
        assert_eq!((bq.z1, bq.z2), (0.0, 0.0));
        assert_eq!(bq.process(0.0), 0.0);
    }
}
