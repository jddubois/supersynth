//! Tube-style overdrive with 4x oversampling.
//!
//! Signal path per channel:
//!
//! ```text
//! x * drive -> 2x up (55-tap halfband) -> 2x up (15-tap halfband)
//!   -> asymmetric soft saturator (at 4x rate)
//!   -> 2x down (15-tap) -> 2x down (55-tap)
//!   -> tone low-pass -> DC blocker -> * level
//! ```
//!
//! The saturator is `f(x + bias) - f(bias)` with `f` a rational tanh-like
//! curve; a non-zero bias makes the transfer curve asymmetric (even harmonics,
//! the warm triode character), and the subtraction keeps silence at zero.
//! Remaining DC from the asymmetry is removed by the DC blocker.
//!
//! Halfband FIRs are Kaiser-windowed and implemented polyphase: for the
//! interpolator the odd phase is a pure delay, for the decimator one phase is a
//! single centre tap, so each stage costs about (taps/2) MACs per input sample.

use super::eq::{SmoothStereoBiquad, COEFF_RAMP_S};
use super::StereoEffect;
use crate::dsp::biquad::Coeffs;
use std::f64::consts::PI;

/// Saturation curve: tanh via its [7/6] continued-fraction (Lambert)
/// approximant, |error| < 1e-4, clamped where it reaches ±1 (|x| = 4.97).
/// Unlike low-order clamped approximations, the residual kink there is tiny
/// (slope step 3.5e-4), so harmonics decay almost as fast as for the analytic
/// tanh and 4x oversampling keeps aliasing ~70 dB down. ~3x cheaper than
/// `f32::tanh`.
#[inline(always)]
fn sat(x: f32) -> f32 {
    let x = x.clamp(-4.972, 4.972);
    let x2 = x * x;
    let num = x * (135_135.0 + x2 * (17_325.0 + x2 * (378.0 + x2)));
    let den = 135_135.0 + x2 * (62_370.0 + x2 * (3_150.0 + 28.0 * x2));
    (num / den).clamp(-1.0, 1.0)
}

fn bessel_i0(x: f64) -> f64 {
    let mut sum = 1.0;
    let mut term = 1.0;
    let q = x * x / 4.0;
    for k in 1..50 {
        term *= q / (k * k) as f64;
        sum += term;
        if term < 1e-12 * sum {
            break;
        }
    }
    sum
}

/// Even-index taps (j = 0, 2, .., 2c) of a Kaiser-windowed halfband lowpass of
/// length 2c+1 (c odd), normalized for exact unity DC gain. The centre tap is
/// 0.5 by construction and not returned.
fn halfband_taps(c: usize, beta: f64) -> Vec<f32> {
    assert!(c % 2 == 1);
    let i0b = bessel_i0(beta);
    let mut taps: Vec<f64> = (0..=c)
        .map(|i| {
            let n = (2 * i) as f64 - c as f64; // odd offset from centre
            let sinc = (PI * n / 2.0).sin() / (PI * n);
            let r = n / (c as f64 + 1.0);
            sinc * bessel_i0(beta * (1.0 - r * r).sqrt()) / i0b
        })
        .collect();
    let s: f64 = taps.iter().sum();
    taps.iter_mut().for_each(|t| *t *= 0.5 / s);
    taps.into_iter().map(|t| t as f32).collect()
}

/// History ring that always exposes the last `n` samples as a contiguous
/// slice (each sample is written twice).
#[derive(Clone)]
struct Hist {
    buf: Vec<f32>,
    n: usize,
    p: usize,
}

impl Hist {
    fn new(n: usize) -> Self {
        Self { buf: vec![0.0; 2 * n], n, p: 0 }
    }

    /// Push a sample; returns the last `n` samples oldest-first.
    #[inline(always)]
    fn push(&mut self, x: f32) -> &[f32] {
        self.buf[self.p] = x;
        self.buf[self.p + self.n] = x;
        self.p += 1;
        if self.p == self.n {
            self.p = 0;
        }
        &self.buf[self.p..self.p + self.n]
    }

    fn clear(&mut self) {
        self.buf.iter_mut().for_each(|v| *v = 0.0);
    }
}

/// Dot product of equal-length slices whose length is a multiple of 8
/// (tap arrays are zero-padded), written so it auto-vectorizes.
#[inline(always)]
fn dot(a: &[f32], b: &[f32]) -> f32 {
    let mut acc = [0.0f32; 8];
    for (ca, cb) in a.chunks_exact(8).zip(b.chunks_exact(8)) {
        for j in 0..8 {
            acc[j] += ca[j] * cb[j];
        }
    }
    ((acc[0] + acc[4]) + (acc[1] + acc[5])) + ((acc[2] + acc[6]) + (acc[3] + acc[7]))
}

/// 2x halfband interpolator / decimator pair state for one channel.
#[derive(Clone)]
struct Halfband {
    /// Even taps reversed (oldest-first order to match `Hist`) and
    /// zero-padded at the old end to a multiple of 8; x2 for the
    /// interpolator, x1 for the decimator.
    up_taps: Vec<f32>,
    dn_taps: Vec<f32>,
    up_hist: Hist,
    dn_hist: Hist,
    /// Decimator centre-tap delay line for odd-phase samples.
    odd: Vec<f32>,
    odd_i: usize,
    /// Index of the odd-phase (pure delay) sample in the interpolator history.
    odd_tap: usize,
}

impl Halfband {
    fn new(c: usize, beta: f64) -> Self {
        let taps = halfband_taps(c, beta);
        let len = (c + 1).div_ceil(8) * 8;
        let mut rev = vec![0.0f32; len - (c + 1)];
        rev.extend(taps.iter().rev());
        let dn_taps = rev.clone();
        rev.iter_mut().for_each(|t| *t *= 2.0);
        Self {
            up_taps: rev,
            dn_taps,
            up_hist: Hist::new(len),
            dn_hist: Hist::new(len),
            odd: vec![0.0; c.div_ceil(2)],
            odd_i: 0,
            // x[k - (c-1)/2]; the history is oldest-first, newest at len-1.
            odd_tap: len - 1 - (c - 1) / 2,
        }
    }

    /// One input sample -> two output samples at twice the rate.
    #[inline(always)]
    fn up(&mut self, x: f32) -> (f32, f32) {
        let h = self.up_hist.push(x);
        let even = dot(&self.up_taps, h);
        (even, h[self.odd_tap])
    }

    /// Two input samples (v[2k], v[2k+1]) -> one output sample.
    #[inline(always)]
    fn down(&mut self, v0: f32, v1: f32) -> f32 {
        let h = self.dn_hist.push(v0);
        let mut y = dot(&self.dn_taps, h);
        // centre tap: 0.5 * v_odd[k - (c+1)/2]
        y += 0.5 * self.odd[self.odd_i];
        self.odd[self.odd_i] = v1;
        self.odd_i += 1;
        if self.odd_i == self.odd.len() {
            self.odd_i = 0;
        }
        y
    }

    fn clear(&mut self) {
        self.up_hist.clear();
        self.dn_hist.clear();
        self.odd.iter_mut().for_each(|v| *v = 0.0);
    }
}

#[derive(Clone)]
struct Channel {
    s1: Halfband,
    s2: Halfband,
    dc_x1: f32,
    dc_y1: f32,
}

const MIN_TONE_HZ: f32 = 300.0;

pub struct Drive {
    sr: f32,
    ch: [Channel; 2],
    tone: SmoothStereoBiquad,
    ramp: u32,
    dc_r: f32,
    drive: f32,
    bias: f32,
    level: f32,
    t_drive: f32,
    t_bias: f32,
    t_level: f32,
    tone_hz: f32,
}

impl Drive {
    pub fn new(sample_rate: f32) -> Self {
        let ch = Channel { s1: Halfband::new(27, 7.0), s2: Halfband::new(7, 6.0), dc_x1: 0.0, dc_y1: 0.0 };
        let mut d = Self {
            sr: sample_rate,
            ch: [ch.clone(), ch],
            tone: SmoothStereoBiquad::new(),
            ramp: ((COEFF_RAMP_S * sample_rate) as u32).max(1),
            // DC blocker corner ~10 Hz.
            dc_r: (-2.0 * std::f32::consts::PI * 10.0 / sample_rate).exp(),
            drive: 1.0,
            bias: 0.0,
            level: 1.0,
            t_drive: 1.0,
            t_bias: 0.0,
            t_level: 1.0,
            tone_hz: 0.0,
        };
        d.set_params(3.0, 0.15, 6000.0, 0.5);
        d.drive = d.t_drive;
        d.bias = d.t_bias;
        d.level = d.t_level;
        let (c, en) = d.tone_coeffs(d.tone_hz);
        d.tone.snap(c, en);
        d
    }

    fn tone_coeffs(&self, hz: f32) -> (Coeffs, bool) {
        let nyq = 0.45 * self.sr;
        (Coeffs::low_pass(hz.clamp(MIN_TONE_HZ, nyq), std::f32::consts::FRAC_1_SQRT_2, self.sr), hz < nyq)
    }

    /// `drive` 1..20 (input gain into the saturator), `bias` 0..0.5
    /// (asymmetry), `tone_hz` post low-pass corner (>= 0.45*sr disables it),
    /// `level` output gain (linear). All changes are smoothed.
    pub fn set_params(&mut self, drive: f32, bias: f32, tone_hz: f32, level: f32) {
        let fin = |x: f32, d: f32| if x.is_finite() { x } else { d };
        self.t_drive = fin(drive, 1.0).clamp(1.0, 20.0);
        self.t_bias = fin(bias, 0.0).clamp(0.0, 0.5);
        self.t_level = fin(level, 1.0).clamp(0.0, 4.0);
        let hz = fin(tone_hz, 20000.0).max(MIN_TONE_HZ);
        if hz != self.tone_hz {
            self.tone_hz = hz;
            let (c, en) = self.tone_coeffs(hz);
            self.tone.set_target(c, en, self.ramp);
        }
    }
}

impl StereoEffect for Drive {
    fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        let n = left.len().min(right.len());
        if n == 0 {
            return;
        }
        let inv = 1.0 / n as f32;
        let dd = (self.t_drive - self.drive) * inv;
        let db = (self.t_bias - self.bias) * inv;
        for (ci, buf) in [&mut *left, &mut *right].into_iter().enumerate() {
            let ch = &mut self.ch[ci];
            let (mut drive, mut bias) = (self.drive, self.bias);
            for x in buf[..n].iter_mut() {
                drive += dd;
                bias += db;
                let off = sat(bias);
                let (a, b) = ch.s1.up(*x * drive);
                let (a0, a1) = ch.s2.up(a);
                let (b0, b1) = ch.s2.up(b);
                let ya = ch.s2.down(sat(a0 + bias) - off, sat(a1 + bias) - off);
                let yb = ch.s2.down(sat(b0 + bias) - off, sat(b1 + bias) - off);
                *x = ch.s1.down(ya, yb);
            }
        }
        self.drive = self.t_drive;
        self.bias = self.t_bias;

        self.tone.process(&mut left[..n], &mut right[..n]);

        let dl = (self.t_level - self.level) * inv;
        let r = self.dc_r;
        for (ci, buf) in [&mut *left, &mut *right].into_iter().enumerate() {
            let ch = &mut self.ch[ci];
            let mut level = self.level;
            let (mut x1, mut y1) = (ch.dc_x1, ch.dc_y1);
            for x in buf[..n].iter_mut() {
                level += dl;
                let y = *x - x1 + r * y1;
                x1 = *x;
                y1 = y;
                *x = y * level;
            }
            ch.dc_x1 = x1;
            ch.dc_y1 = if y1.abs() < 1e-20 { 0.0 } else { y1 };
        }
        self.level = self.t_level;
    }

    fn reset(&mut self) {
        for ch in self.ch.iter_mut() {
            ch.s1.clear();
            ch.s2.clear();
            ch.dc_x1 = 0.0;
            ch.dc_y1 = 0.0;
        }
        self.tone.reset();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// In-place radix-2 complex FFT (test helper).
    fn fft(re: &mut [f64], im: &mut [f64]) {
        let n = re.len();
        let mut j = 0;
        for i in 1..n {
            let mut bit = n >> 1;
            while j & bit != 0 {
                j ^= bit;
                bit >>= 1;
            }
            j |= bit;
            if i < j {
                re.swap(i, j);
                im.swap(i, j);
            }
        }
        let mut len = 2;
        while len <= n {
            let ang = -2.0 * PI / len as f64;
            for s in (0..n).step_by(len) {
                for k in 0..len / 2 {
                    let (wr, wi) = ((ang * k as f64).cos(), (ang * k as f64).sin());
                    let (ar, ai) = (re[s + k], im[s + k]);
                    let (br, bi) = (re[s + k + len / 2], im[s + k + len / 2]);
                    let (tr, ti) = (br * wr - bi * wi, br * wi + bi * wr);
                    re[s + k] = ar + tr;
                    im[s + k] = ai + ti;
                    re[s + k + len / 2] = ar - tr;
                    im[s + k + len / 2] = ai - ti;
                }
            }
            len <<= 1;
        }
    }

    /// Returns (harmonic energy, non-harmonic energy below `kmax`) of a steady
    /// drive output for a sine on an exact FFT bin.
    fn spectrum_split(y: &[f32], k0: usize, kmax: usize) -> (f64, f64) {
        let n = y.len();
        let mut re: Vec<f64> = y
            .iter()
            .enumerate()
            .map(|(i, &v)| v as f64 * (0.5 - 0.5 * (2.0 * PI * i as f64 / n as f64).cos()))
            .collect();
        let mut im = vec![0.0; n];
        fft(&mut re, &mut im);
        let (mut harm, mut other) = (0.0, 0.0);
        for k in 3..n / 2 {
            let p = re[k] * re[k] + im[k] * im[k];
            let near = (1..).map(|m| m * k0).take_while(|&h| h < n / 2 + 3).any(|h| k.abs_diff(h) <= 2);
            if near {
                harm += p;
            } else if k < kmax {
                other += p;
            }
        }
        (harm, other)
    }

    #[test]
    fn halfband_dc_gain_and_passband() {
        let mut hb = Halfband::new(27, 7.0);
        let mut last = (0.0, 0.0);
        for _ in 0..200 {
            last = hb.up(1.0);
        }
        assert!((last.0 - 1.0).abs() < 1e-5 && (last.1 - 1.0).abs() < 1e-6);
        let mut y = 0.0;
        for _ in 0..200 {
            y = hb.down(1.0, 1.0);
        }
        assert!((y - 1.0).abs() < 1e-5);
    }

    #[test]
    fn output_is_finite_and_bounded() {
        let mut d = Drive::new(48000.0);
        d.set_params(20.0, 0.5, 20000.0, 1.0);
        let mut l: Vec<f32> = (0..48000).map(|i| (i as f32 * 0.07).sin() * 3.0).collect();
        let mut r = l.clone();
        for (a, b) in l.chunks_mut(512).zip(r.chunks_mut(512)) {
            d.process(a, b);
        }
        assert!(l.iter().all(|v| v.is_finite() && v.abs() < 3.0));
    }

    #[test]
    fn no_dc_with_bias() {
        let mut d = Drive::new(48000.0);
        d.set_params(8.0, 0.4, 8000.0, 1.0);
        let mut l: Vec<f32> = (0..96000).map(|i| (i as f32 * 0.05).sin() * 0.5).collect();
        let mut r = l.clone();
        for (a, b) in l.chunks_mut(256).zip(r.chunks_mut(256)) {
            d.process(a, b);
        }
        let dc = l[48000..].iter().sum::<f32>() / 48000.0;
        assert!(dc.abs() < 1e-3, "dc {dc}");
    }

    #[test]
    fn oversampling_suppresses_aliasing() {
        let sr = 48000.0;
        let n = 8192;
        let k0 = 257; // ~1.5 kHz, coprime with n so aliases miss harmonic bins
        let f0 = k0 as f32 * sr / n as f32;
        let mut d = Drive::new(sr);
        d.set_params(10.0, 0.2, 30000.0, 0.5);
        let total = n * 3;
        let mut l: Vec<f32> = (0..total)
            .map(|i| (2.0 * std::f32::consts::PI * f0 * i as f32 / sr).sin() * 0.8)
            .collect();
        let mut r = l.clone();
        for (a, b) in l.chunks_mut(512).zip(r.chunks_mut(512)) {
            d.process(a, b);
        }
        let kmax = n * 20 / 48; // alias energy in the audible band (< 20 kHz)
        let (h, o) = spectrum_split(&l[total - n..], k0, kmax);
        let os_db = 10.0 * (o / h).log10();

        // Naive (no oversampling) reference with the same curve.
        let naive: Vec<f32> = (0..n)
            .map(|i| {
                let x = (2.0 * std::f32::consts::PI * f0 * i as f32 / sr).sin() * 0.8 * 10.0;
                sat(x + 0.2) - sat(0.2)
            })
            .collect();
        let (h2, o2) = spectrum_split(&naive, k0, kmax);
        let naive_db = 10.0 * (o2 / h2).log10();
        println!("alias/harmonic energy: oversampled {os_db:.1} dB, naive {naive_db:.1} dB");
        assert!(os_db < -60.0, "aliasing too high: {os_db} dB");
        assert!(os_db < naive_db - 20.0);
    }
}
