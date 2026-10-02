//! Part / master tone-shaping EQ: low cut, low shelf, mid peak, high shelf,
//! high cut. Also hosts [`SmoothStereoBiquad`], the click-free coefficient-
//! gliding biquad shared by the other effects (reverb tone, drive tone).
//!
//! Click-free parameter changes: every band glides its coefficients linearly
//! from the old to the new set over [`COEFF_RAMP_S`]. Linear interpolation of
//! biquad coefficients keeps the denominator inside the (convex) stability
//! triangle `|a2| < 1, |a1| < 1 + a2`, so every intermediate filter is stable.
//! Disabled bands cost nothing: a band that is switched off glides to the
//! identity filter and is then skipped; a band that is switched on starts from
//! identity with cleared state and glides to its target.

use super::StereoEffect;
use crate::dsp::biquad::Coeffs;

/// Coefficient glide time for all smoothed filters (seconds).
pub(crate) const COEFF_RAMP_S: f32 = 0.012;

#[inline]
fn coeff_lerp_step(from: &Coeffs, to: &Coeffs, n: f32) -> Coeffs {
    Coeffs {
        b0: (to.b0 - from.b0) / n,
        b1: (to.b1 - from.b1) / n,
        b2: (to.b2 - from.b2) / n,
        a1: (to.a1 - from.a1) / n,
        a2: (to.a2 - from.a2) / n,
    }
}

#[inline]
fn flush(x: f32) -> f32 {
    if x.abs() < 1e-20 {
        0.0
    } else {
        x
    }
}

/// Stereo (shared-coefficient) TDF-II biquad whose coefficients glide to new
/// targets, and which is skipped entirely when disabled.
#[derive(Clone, Debug)]
pub(crate) struct SmoothStereoBiquad {
    cur: Coeffs,
    target: Coeffs,
    step: Coeffs,
    remaining: u32,
    /// `[channel][z1, z2]`
    z: [[f32; 2]; 2],
    /// Processing is needed (enabled, or gliding towards identity).
    active: bool,
    /// The target is "off": deactivate once the glide finishes.
    disabling: bool,
}

impl SmoothStereoBiquad {
    pub(crate) fn new() -> Self {
        Self {
            cur: Coeffs::IDENTITY,
            target: Coeffs::IDENTITY,
            step: Coeffs::default(),
            remaining: 0,
            z: [[0.0; 2]; 2],
            active: false,
            disabling: false,
        }
    }

    /// Jump straight to `c` (no glide). Use at construction / reset.
    pub(crate) fn snap(&mut self, c: Coeffs, enabled: bool) {
        self.cur = if enabled { c } else { Coeffs::IDENTITY };
        self.target = self.cur;
        self.remaining = 0;
        self.active = enabled;
        self.disabling = false;
        self.z = [[0.0; 2]; 2];
    }

    /// Glide to `c` (or to identity, then bypass, when `enabled == false`)
    /// over `ramp` samples.
    pub(crate) fn set_target(&mut self, c: Coeffs, enabled: bool, ramp: u32) {
        let ramp = ramp.max(1);
        if !self.active {
            if !enabled {
                return;
            }
            // Start from a transparent filter with clean state.
            self.cur = Coeffs::IDENTITY;
            self.z = [[0.0; 2]; 2];
            self.active = true;
        }
        self.target = if enabled { c } else { Coeffs::IDENTITY };
        self.disabling = !enabled;
        self.step = coeff_lerp_step(&self.cur, &self.target, ramp as f32);
        self.remaining = ramp;
    }

    #[inline]
    pub(crate) fn is_active(&self) -> bool {
        self.active
    }

    pub(crate) fn reset(&mut self) {
        self.z = [[0.0; 2]; 2];
    }

    /// Process a stereo block in place.
    pub(crate) fn process(&mut self, l: &mut [f32], r: &mut [f32]) {
        if !self.active {
            return;
        }
        let n = l.len().min(r.len());
        let [[mut l1, mut l2], [mut r1, mut r2]] = self.z;
        let mut i = 0;
        // Gliding segment: coefficients advance one step per sample.
        if self.remaining > 0 {
            let s = self.step;
            let mut c = self.cur;
            while i < n && self.remaining > 0 {
                c.b0 += s.b0;
                c.b1 += s.b1;
                c.b2 += s.b2;
                c.a1 += s.a1;
                c.a2 += s.a2;
                self.remaining -= 1;
                if self.remaining == 0 {
                    c = self.target;
                }
                let x = l[i];
                let y = c.b0 * x + l1;
                l1 = c.b1 * x - c.a1 * y + l2;
                l2 = c.b2 * x - c.a2 * y;
                l[i] = y;
                let x = r[i];
                let y = c.b0 * x + r1;
                r1 = c.b1 * x - c.a1 * y + r2;
                r2 = c.b2 * x - c.a2 * y;
                r[i] = y;
                i += 1;
            }
            self.cur = c;
        }
        // Steady segment.
        let c = self.cur;
        for (xl, xr) in l[i..n].iter_mut().zip(r[i..n].iter_mut()) {
            let x = *xl;
            let y = c.b0 * x + l1;
            l1 = c.b1 * x - c.a1 * y + l2;
            l2 = c.b2 * x - c.a2 * y;
            *xl = y;
            let x = *xr;
            let y = c.b0 * x + r1;
            r1 = c.b1 * x - c.a1 * y + r2;
            r2 = c.b2 * x - c.a2 * y;
            *xr = y;
        }
        self.z = [[flush(l1), flush(l2)], [flush(r1), flush(r2)]];
        if self.remaining == 0 && self.disabling {
            // Now exactly identity: bypass from here on.
            self.active = false;
            self.disabling = false;
            self.z = [[0.0; 2]; 2];
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EqParams {
    /// Low shelf gain (dB, ±24). 0 = band off.
    pub low_gain_db: f32,
    /// Low shelf corner (Hz).
    pub low_freq: f32,
    /// Mid peaking gain (dB, ±24). 0 = band off.
    pub mid_gain_db: f32,
    /// Mid peaking centre (Hz).
    pub mid_freq: f32,
    /// Mid peaking Q (0.1 .. 10).
    pub mid_q: f32,
    /// High shelf gain (dB, ±24). 0 = band off.
    pub high_gain_db: f32,
    /// High shelf corner (Hz).
    pub high_freq: f32,
    /// 12 dB/oct Butterworth high-pass (Hz). 0 = off.
    pub low_cut_hz: f32,
    /// 12 dB/oct Butterworth low-pass (Hz). 0 = off.
    pub high_cut_hz: f32,
}

impl Default for EqParams {
    fn default() -> Self {
        Self {
            low_gain_db: 0.0,
            low_freq: 150.0,
            mid_gain_db: 0.0,
            mid_freq: 1000.0,
            mid_q: 0.7,
            high_gain_db: 0.0,
            high_freq: 6000.0,
            low_cut_hz: 0.0,
            high_cut_hz: 0.0,
        }
    }
}

/// Gains smaller than this (dB) are treated as "band off".
const GAIN_EPS_DB: f32 = 0.01;
const BUTTERWORTH_Q: f32 = std::f32::consts::FRAC_1_SQRT_2;

/// Five-band stereo EQ: low cut → low shelf → mid peak → high shelf → high cut.
pub struct Eq {
    sr: f32,
    params: EqParams,
    bands: [SmoothStereoBiquad; 5],
    ramp: u32,
}

impl Eq {
    pub fn new(sample_rate: f32) -> Self {
        let mut eq = Self {
            sr: sample_rate,
            params: EqParams::default(),
            bands: std::array::from_fn(|_| SmoothStereoBiquad::new()),
            ramp: ((COEFF_RAMP_S * sample_rate) as u32).max(1),
        };
        let targets = eq.targets(&eq.params);
        for (b, (c, en)) in eq.bands.iter_mut().zip(targets) {
            b.snap(c, en);
        }
        eq
    }

    /// Sanitize and compute `(coeffs, enabled)` for every band.
    fn targets(&self, p: &EqParams) -> [(Coeffs, bool); 5] {
        let sr = self.sr;
        let nyq = 0.45 * sr;
        let fin = |x: f32, d: f32| if x.is_finite() { x } else { d };
        let g = |x: f32| fin(x, 0.0).clamp(-24.0, 24.0);

        let low_cut = fin(p.low_cut_hz, 0.0);
        let hp_on = low_cut > 0.0;
        let hp = Coeffs::high_pass(low_cut.clamp(10.0, nyq), BUTTERWORTH_Q, sr);

        let lg = g(p.low_gain_db);
        let ls_on = lg.abs() >= GAIN_EPS_DB;
        let ls = Coeffs::low_shelf(fin(p.low_freq, 150.0).clamp(20.0, nyq.min(5000.0)), lg, sr);

        let mg = g(p.mid_gain_db);
        let mid_on = mg.abs() >= GAIN_EPS_DB;
        let mid = Coeffs::peaking(
            fin(p.mid_freq, 1000.0).clamp(20.0, nyq),
            fin(p.mid_q, 0.7).clamp(0.1, 10.0),
            mg,
            sr,
        );

        let hg = g(p.high_gain_db);
        let hs_on = hg.abs() >= GAIN_EPS_DB;
        let hs = Coeffs::high_shelf(fin(p.high_freq, 6000.0).clamp(200.0, nyq), hg, sr);

        let high_cut = fin(p.high_cut_hz, 0.0);
        let lp_on = high_cut > 0.0 && high_cut < nyq;
        let lp = Coeffs::low_pass(high_cut.clamp(20.0, nyq), BUTTERWORTH_Q, sr);

        [(hp, hp_on), (ls, ls_on), (mid, mid_on), (hs, hs_on), (lp, lp_on)]
    }

    /// Set all bands. Coefficients glide over ~12 ms; safe to call between
    /// any two blocks.
    pub fn set_params(&mut self, p: EqParams) {
        let targets = self.targets(&p);
        for (b, (c, en)) in self.bands.iter_mut().zip(targets) {
            b.set_target(c, en, self.ramp);
        }
        self.params = p;
    }

    pub fn params(&self) -> EqParams {
        self.params
    }

    /// True when every band is off and settled, i.e. `process` is an exact
    /// no-op and the caller may skip it.
    pub fn is_flat(&self) -> bool {
        self.bands.iter().all(|b| !b.is_active())
    }
}

impl StereoEffect for Eq {
    fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        for b in self.bands.iter_mut() {
            b.process(left, right);
        }
    }

    fn reset(&mut self) {
        for b in self.bands.iter_mut() {
            b.reset();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    const SR: f32 = 48000.0;

    fn sine(f: f32, n: usize) -> Vec<f32> {
        (0..n).map(|i| (2.0 * PI * f * i as f32 / SR).sin() * 0.5).collect()
    }

    /// Steady-state RMS gain (dB) of the EQ for a sine.
    fn gain_db(eq: &mut Eq, f: f32) -> f32 {
        let x = sine(f, 48000);
        let mut l = x.clone();
        let mut r = x.clone();
        for (cl, cr) in l.chunks_mut(256).zip(r.chunks_mut(256)) {
            eq.process(cl, cr);
        }
        let tail = 24000;
        let rms = |v: &[f32]| (v.iter().map(|s| s * s).sum::<f32>() / v.len() as f32).sqrt();
        20.0 * (rms(&l[tail..]) / rms(&x[tail..])).log10()
    }

    #[test]
    fn default_is_flat_and_bit_transparent() {
        let mut eq = Eq::new(SR);
        assert!(eq.is_flat());
        let x = sine(440.0, 1024);
        let mut l = x.clone();
        let mut r = x.clone();
        eq.process(&mut l, &mut r);
        assert_eq!(l, x);
        assert_eq!(r, x);
    }

    #[test]
    fn bands_have_expected_gain() {
        let mut eq = Eq::new(SR);
        eq.set_params(EqParams { mid_gain_db: 6.0, mid_freq: 1000.0, mid_q: 1.0, ..Default::default() });
        let g = gain_db(&mut eq, 1000.0);
        assert!((g - 6.0).abs() < 0.2, "mid peak gain {g}");
        let mut eq = Eq::new(SR);
        eq.set_params(EqParams { low_cut_hz: 100.0, ..Default::default() });
        assert!(gain_db(&mut eq, 25.0) < -20.0);
        assert!(gain_db(&mut eq, 2000.0).abs() < 0.1);
        let mut eq = Eq::new(SR);
        eq.set_params(EqParams { high_cut_hz: 2000.0, high_gain_db: -6.0, ..Default::default() });
        assert!(gain_db(&mut eq, 10000.0) < -30.0);
        let mut eq = Eq::new(SR);
        eq.set_params(EqParams { low_gain_db: 9.0, low_freq: 200.0, ..Default::default() });
        let g = gain_db(&mut eq, 30.0);
        assert!((g - 9.0).abs() < 0.5, "low shelf {g}");
    }

    #[test]
    fn disabling_returns_to_flat() {
        let mut eq = Eq::new(SR);
        eq.set_params(EqParams { high_gain_db: 4.0, low_cut_hz: 40.0, ..Default::default() });
        assert!(!eq.is_flat());
        let mut l = vec![0.1; 512];
        let mut r = vec![0.1; 512];
        eq.process(&mut l, &mut r);
        eq.set_params(EqParams::default());
        for _ in 0..4 {
            eq.process(&mut l, &mut r);
        }
        assert!(eq.is_flat());
    }

    #[test]
    fn parameter_jumps_do_not_click() {
        // A low sine; abruptly change heavy settings every block and verify the
        // output slope never exceeds what a smooth signal of this level allows.
        let mut eq = Eq::new(SR);
        let x = sine(100.0, 48000);
        let mut l = x.clone();
        let mut r = x.clone();
        for (k, (cl, cr)) in l.chunks_mut(128).zip(r.chunks_mut(128)).enumerate() {
            let p = if k % 2 == 0 {
                EqParams { low_gain_db: 12.0, mid_gain_db: -12.0, mid_freq: 300.0, ..Default::default() }
            } else {
                EqParams { low_cut_hz: 60.0, high_cut_hz: 3000.0, ..Default::default() }
            };
            eq.set_params(p);
            eq.process(cl, cr);
        }
        let max_step = l.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0f32, f32::max);
        // 100 Hz at amplitude <= 0.5*4 (12 dB): slope <= 2*pi*100/48000*2 = 0.026
        assert!(max_step < 0.06, "max step {max_step}");
        assert!(l.iter().all(|v| v.is_finite()));
    }
}
