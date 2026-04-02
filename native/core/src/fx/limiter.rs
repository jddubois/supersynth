//! Transparent, stereo-linked lookahead peak limiter for the master bus.
//!
//! Gain computer (per sample, on the *undelayed* input):
//!
//! 1. `req(t) = min(1, c' / max(|L|, |R|))` — the gain that sample needs
//!    (`c'` is the ceiling minus a 1e-4 dB rounding guard).
//! 2. `m(t)` = sliding minimum of `req` over the last `LA + 1` samples
//!    (monotonic-deque, amortised O(1)).
//! 3. Release envelope `e(t)` (see below): it has an instant-attack component,
//!    hence `e(t) <= m(t)`.
//! 4. Two cascaded moving averages whose combined support is exactly `LA + 1`
//!    samples (a smooth, S-shaped attack ramp spread over the lookahead).
//!
//! The audio is delayed by `LA` samples. Because the averaging kernel only
//! spans samples whose `m` window contains the sample currently leaving the
//! delay line, the applied gain is provably `<= req` of that sample, so the
//! output never exceeds the ceiling. A final clamp to ±ceiling guards against
//! float rounding only (it is counted; the tests assert it never acts).
//!
//! Below the ceiling the gain is exactly 1.0 (the averaging stages track how
//! many non-unity values they hold and snap back to an exact sum), so the
//! limiter is bit-transparent apart from the lookahead delay.
//!
//! Program-dependent release (dual envelope): a *fast* envelope (instant
//! attack, release = `release_ms`) and a *slow* envelope (120 ms attack,
//! release = 3 x `release_ms`) both follow `m`; the gain uses the lower of the
//! two. An isolated peak only moves the fast envelope, so it recovers quickly;
//! sustained limiting also pulls the slow envelope down, which then governs a
//! gentler release (less pumping and LF distortion).

use super::StereoEffect;
use crate::dsp::{amp_to_db, db_to_amp, one_pole_coeff};

const LOOKAHEAD_S: f32 = 0.0015;
const SLOW_ATTACK_S: f32 = 0.12;
const SLOW_FACTOR: f32 = 3.0;
/// Gain-computer target relative to the ceiling (-0.0001 dB).
const GUARD: f32 = 0.999_988;
/// Envelopes snap to exactly unity once above this (-0.009 dB) while no
/// limiting is required; the step is further smoothed by the attack ramp.
const SNAP: f32 = 0.999;

/// Smooth saturating safety curve: identity for |x| <= 0.9, then a tanh knee
/// that approaches ±1.0 asymptotically (C1-continuous at the knee).
#[inline]
pub fn soft_clip(x: f32) -> f32 {
    const KNEE: f32 = 0.9;
    const HEAD: f32 = 1.0 - KNEE;
    let a = x.abs();
    if a <= KNEE {
        x
    } else {
        let y = KNEE + HEAD * ((a - KNEE) / HEAD).tanh();
        y.copysign(x)
    }
}

/// Moving average over a fixed window with exact recovery to unity.
struct BoxAvg {
    buf: Vec<f32>,
    idx: usize,
    sum: f64,
    non_unity: usize,
    inv_len: f64,
}

impl BoxAvg {
    fn new(len: usize) -> Self {
        let len = len.max(1);
        Self { buf: vec![1.0; len], idx: 0, sum: len as f64, non_unity: 0, inv_len: 1.0 / len as f64 }
    }

    #[inline]
    fn process(&mut self, x: f32) -> f32 {
        let old = self.buf[self.idx];
        self.buf[self.idx] = x;
        self.idx += 1;
        if self.idx == self.buf.len() {
            self.idx = 0;
        }
        self.non_unity = self.non_unity + (x != 1.0) as usize - (old != 1.0) as usize;
        if self.non_unity == 0 {
            // All ones: reset the running sum exactly (kills rounding drift).
            self.sum = self.buf.len() as f64;
            1.0
        } else {
            self.sum += x as f64 - old as f64;
            (self.sum * self.inv_len) as f32
        }
    }

    fn reset(&mut self) {
        self.buf.iter_mut().for_each(|v| *v = 1.0);
        self.idx = 0;
        self.sum = self.buf.len() as f64;
        self.non_unity = 0;
    }
}

/// Sliding-window minimum (monotonic deque in a fixed ring buffer).
struct SlidingMin {
    val: Vec<f32>,
    time: Vec<u64>,
    head: usize,
    len: usize,
    window: u64,
    t: u64,
}

impl SlidingMin {
    fn new(window: usize) -> Self {
        let cap = window + 2;
        Self { val: vec![1.0; cap], time: vec![0; cap], head: 0, len: 0, window: window as u64, t: 0 }
    }

    #[inline]
    fn process(&mut self, x: f32) -> f32 {
        let cap = self.val.len();
        // Drop dominated entries from the back.
        while self.len > 0 {
            let back = (self.head + self.len - 1) % cap;
            if self.val[back] >= x {
                self.len -= 1;
            } else {
                break;
            }
        }
        let slot = (self.head + self.len) % cap;
        self.val[slot] = x;
        self.time[slot] = self.t;
        self.len += 1;
        // Drop expired entries from the front.
        while self.t - self.time[self.head] >= self.window {
            self.head = (self.head + 1) % cap;
            self.len -= 1;
        }
        self.t += 1;
        self.val[self.head]
    }

    fn reset(&mut self) {
        self.head = 0;
        self.len = 0;
        self.t = 0;
    }
}

pub struct Limiter {
    sr: f32,
    ceiling: f32,
    release_ms: f32,
    la: usize,
    delay: [Vec<f32>; 2],
    didx: usize,
    min: SlidingMin,
    env_fast: f32,
    env_slow: f32,
    rel_fast: f32,
    rel_slow: f32,
    att_slow: f32,
    box1: BoxAvg,
    box2: BoxAvg,
    gain: f32,
    safety_clamps: u64,
}

impl Limiter {
    pub fn new(sample_rate: f32) -> Self {
        let la = ((LOOKAHEAD_S * sample_rate).round() as usize).max(2);
        // Cascade of two boxes of lengths n1, n2 has support n1 + n2 - 1,
        // which must equal the min window LA + 1.
        let n1 = (la + 2) / 2;
        let n2 = la + 2 - n1;
        let mut l = Self {
            sr: sample_rate,
            ceiling: db_to_amp(-1.0),
            release_ms: 80.0,
            la,
            delay: [vec![0.0; la], vec![0.0; la]],
            didx: 0,
            min: SlidingMin::new(la + 1),
            env_fast: 1.0,
            env_slow: 1.0,
            rel_fast: 0.0,
            rel_slow: 0.0,
            att_slow: one_pole_coeff(SLOW_ATTACK_S, sample_rate),
            box1: BoxAvg::new(n1),
            box2: BoxAvg::new(n2),
            gain: 1.0,
            safety_clamps: 0,
        };
        l.set_release_ms(80.0);
        l
    }

    /// Output ceiling in dBFS (clamped to -40 .. 0). Default -1 dBFS.
    pub fn set_ceiling_db(&mut self, db: f32) {
        let db = if db.is_finite() { db.clamp(-40.0, 0.0) } else { -1.0 };
        self.ceiling = db_to_amp(db);
    }

    /// Nominal release time in ms (clamped to 5 .. 2000). Default 80 ms.
    pub fn set_release_ms(&mut self, ms: f32) {
        let ms = if ms.is_finite() { ms.clamp(5.0, 2000.0) } else { 80.0 };
        self.release_ms = ms;
        self.rel_fast = one_pole_coeff(ms * 1e-3, self.sr);
        self.rel_slow = one_pole_coeff(ms * 1e-3 * SLOW_FACTOR, self.sr);
    }

    /// Current gain reduction as a positive number of dB (0 = no limiting).
    pub fn gain_reduction_db(&self) -> f32 {
        (-amp_to_db(self.gain)).max(0.0)
    }

    /// Processing latency (lookahead) in samples.
    pub fn latency(&self) -> usize {
        self.la
    }

    /// Number of samples that needed the final rounding-guard clamp.
    pub fn safety_clamps(&self) -> u64 {
        self.safety_clamps
    }
}

impl StereoEffect for Limiter {
    fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        let n = left.len().min(right.len());
        let c = self.ceiling;
        for i in 0..n {
            let (xl, xr) = (left[i], right[i]);
            // Treat non-finite input as silence rather than poisoning state.
            let (xl, xr) = (if xl.is_finite() { xl } else { 0.0 }, if xr.is_finite() { xr } else { 0.0 });
            let peak = xl.abs().max(xr.abs());
            // Tiny margin (1e-4 dB) so float rounding of the averaged gain can
            // never push a sample over the ceiling.
            let req = if peak > c * GUARD { c * GUARD / peak } else { 1.0 };
            let m = self.min.process(req);

            // Fast envelope: instant attack, so env_fast <= m always.
            if m < self.env_fast {
                self.env_fast = m;
            } else {
                self.env_fast = m + (self.env_fast - m) * self.rel_fast;
                if self.env_fast > SNAP && m == 1.0 {
                    self.env_fast = 1.0;
                }
            }
            // Slow envelope: only sustained reduction pulls it down.
            let a = if m < self.env_slow { self.att_slow } else { self.rel_slow };
            self.env_slow = m + (self.env_slow - m) * a;
            if self.env_slow > SNAP && m == 1.0 {
                self.env_slow = 1.0;
            }
            let env = self.env_fast.min(self.env_slow);

            let g = self.box2.process(self.box1.process(env));
            self.gain = g;

            // Delay line (LA samples): read oldest, write newest.
            let dl = &mut self.delay[0][self.didx];
            let yl = *dl * g;
            *dl = xl;
            let dr = &mut self.delay[1][self.didx];
            let yr = *dr * g;
            *dr = xr;
            self.didx += 1;
            if self.didx == self.la {
                self.didx = 0;
            }

            let (ol, or) = (yl.clamp(-c, c), yr.clamp(-c, c));
            if ol != yl || or != yr {
                self.safety_clamps += 1;
            }
            left[i] = ol;
            right[i] = or;
        }
    }

    fn reset(&mut self) {
        self.delay[0].iter_mut().for_each(|v| *v = 0.0);
        self.delay[1].iter_mut().for_each(|v| *v = 0.0);
        self.didx = 0;
        self.min.reset();
        self.env_fast = 1.0;
        self.env_slow = 1.0;
        self.box1.reset();
        self.box2.reset();
        self.gain = 1.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::noise::Rng;

    const SR: f32 = 48000.0;

    fn run(lim: &mut Limiter, l: &mut [f32], r: &mut [f32]) {
        for (a, b) in l.chunks_mut(173).zip(r.chunks_mut(173)) {
            lim.process(a, b);
        }
    }

    fn max_abs(v: &[f32]) -> f32 {
        v.iter().fold(0.0f32, |m, x| m.max(x.abs()))
    }

    #[test]
    fn transparent_below_ceiling() {
        let mut lim = Limiter::new(SR);
        let mut rng = Rng::new(1);
        let x: Vec<f32> = (0..48000).map(|_| rng.bipolar() * 0.85).collect();
        let y0: Vec<f32> = (0..48000).map(|_| rng.bipolar() * 0.85).collect();
        let (mut l, mut r) = (x.clone(), y0.clone());
        run(&mut lim, &mut l, &mut r);
        let la = lim.latency();
        assert_eq!(&l[la..], &x[..x.len() - la]);
        assert_eq!(&r[la..], &y0[..y0.len() - la]);
        assert_eq!(lim.gain_reduction_db(), 0.0);
    }

    #[test]
    fn never_exceeds_ceiling_random_loud() {
        for sr in [22050.0, 44100.0, 48000.0, 96000.0, 192000.0] {
            let mut lim = Limiter::new(sr);
            let mut rng = Rng::new(7);
            let n = (sr * 3.0) as usize;
            // Bursty loud noise with varying level.
            let mut l: Vec<f32> = (0..n)
                .map(|i| rng.gauss() * (1.0 + 6.0 * ((i as f32 / sr * 3.0).sin().abs())))
                .collect();
            let mut r: Vec<f32> = (0..n).map(|_| rng.gauss() * 2.0).collect();
            run(&mut lim, &mut l, &mut r);
            let c = db_to_amp(-1.0);
            assert!(max_abs(&l) <= c && max_abs(&r) <= c);
            assert!(lim.safety_clamps() == 0, "gain computer let {} samples through", lim.safety_clamps());
        }
    }

    #[test]
    fn steps_and_spikes() {
        let mut lim = Limiter::new(SR);
        lim.set_ceiling_db(-3.0);
        let c = db_to_amp(-3.0);
        let n = 200_000;
        let mut l = vec![0.1f32; n];
        for v in l[10000..40000].iter_mut() {
            *v = 3.0;
        }
        for i in (45000..100_000).step_by(5000) {
            l[i] = if i % 2 == 0 { 50.0 } else { -50.0 };
        }
        let mut r = vec![0.0f32; n];
        r[60001] = 1000.0; // single-sample spike on one channel only
        let src = l.clone();
        run(&mut lim, &mut l, &mut r);
        assert!(max_abs(&l) <= c && max_abs(&r) <= c);
        assert_eq!(lim.safety_clamps(), 0);
        // Inside the step the output sits at the ceiling.
        assert!((l[30000] - c).abs() < 0.01 * c, "{}", l[30000]);
        // Long after the last spike the gain is exactly 1 again.
        let la = lim.latency();
        assert_eq!(l[n - 1], src[n - 1 - la]);
        assert_eq!(lim.gain_reduction_db(), 0.0);
    }

    #[test]
    fn release_recovers() {
        let mut lim = Limiter::new(SR);
        let mut l = vec![0.0f32; 96000];
        for v in l.iter_mut().take(4800) {
            *v = 4.0;
        }
        for v in l.iter_mut().skip(4800) {
            *v = 0.2;
        }
        let mut r = l.clone();
        run(&mut lim, &mut l[..9600], &mut r[..9600]);
        assert!(lim.gain_reduction_db() > 0.5);
        run(&mut lim, &mut l[9600..], &mut r[9600..]);
        assert_eq!(lim.gain_reduction_db(), 0.0);
    }

    #[test]
    fn non_finite_input_is_safe() {
        let mut lim = Limiter::new(SR);
        let mut l = vec![f32::NAN, f32::INFINITY, 0.5, -f32::INFINITY, 2.0];
        let mut r = vec![0.0; 5];
        lim.process(&mut l, &mut r);
        let mut z = vec![0.0; 200];
        let mut z2 = vec![0.0; 200];
        lim.process(&mut z, &mut z2);
        assert!(l.iter().chain(z.iter()).all(|v| v.is_finite()));
    }

    #[test]
    fn soft_clip_shape() {
        assert_eq!(soft_clip(0.5), 0.5);
        assert_eq!(soft_clip(-0.9), -0.9);
        assert!(soft_clip(100.0) <= 1.0 && soft_clip(-100.0) >= -1.0);
        let mut prev = soft_clip(-3.0);
        for k in -299..300 {
            let y = soft_clip(k as f32 * 0.01);
            assert!(y >= prev);
            prev = y;
        }
        // C1 at the knee
        let e = 1e-3;
        let slope = (soft_clip(0.9 + e) - soft_clip(0.9)) / e;
        assert!((slope - 1.0).abs() < 0.02);
    }
}
