//! Transparent, stereo-linked lookahead peak limiter for the master bus.
//!
//! Gain computer (per sample, on the *undelayed* input):
//!
//! 1. `req(t) = min(1, c' / p(t))` — the gain that sample needs (`c'` is the
//!    ceiling minus a 1e-4 dB rounding guard). `p(t)` is the stereo *true
//!    peak* around the sample: `max(|L|, |R|)` and the 4x-oversampled
//!    inter-sample peaks of the two segments adjacent to it (12-tap-per-phase
//!    windowed-sinc interpolator, within ±0.2 dB up to 0.4 fs). Sample-peak
//!    detection alone lets reconstructed peaks exceed the ceiling by up to
//!    several dB (e.g. +3 dB for a sine at fs/4 sampled at ±45°).
//! 2. `m(t)` = sliding minimum of `req` over the last `LA + 1` samples
//!    (monotonic-deque, amortised O(1)).
//! 3. Release envelope `e(t)` (see below): it has an instant-attack component,
//!    hence `e(t) <= m(t)`.
//! 4. Two cascaded moving averages whose combined support is exactly `LA + 1`
//!    samples (a smooth, S-shaped attack ramp spread over the lookahead).
//!
//! The audio is delayed by `LA` samples (plus the interpolator's 6). Because
//! the averaging kernel only spans samples whose `m` window contains the
//! sample currently leaving the delay line, the applied gain is provably
//! `<= req` of that sample, so the output never exceeds the ceiling. A final
//! clamp to ±ceiling guards against float rounding only (it is counted; the
//! tests assert it never acts).
//!
//! Ceiling changes glide over 20 ms, and the final clamp uses the ceiling the
//! sample was gained for (delayed with it), so samples already inside the
//! lookahead are never hard-clipped by a lowered ceiling.
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

use super::{ParamRamp, StereoEffect};
use crate::dsp::{amp_to_db, db_to_amp, one_pole_coeff};

const LOOKAHEAD_S: f32 = 0.0015;
/// Ceiling glide time (at least the lookahead is enforced).
const CEILING_RAMP_S: f32 = 0.02;
/// True-peak interpolator: taps per phase, and its delay (samples).
const TP_TAPS: usize = 12;
const TP_LAG: usize = TP_TAPS / 2;
const TP_KAISER_BETA: f64 = 3.0;
const SLOW_ATTACK_S: f32 = 0.12;
const SLOW_FACTOR: f32 = 3.0;
/// Gain-computer target relative to the ceiling (-0.0001 dB).
const GUARD: f32 = 0.999_988;
/// Envelopes snap to exactly unity once above this (-0.009 dB) while no
/// limiting is required; the step is further smoothed by the attack ramp.
const SNAP: f32 = 0.999;

/// Last-resort output safety: identity for |x| <= `ceiling` (so it never
/// touches limiter output, which is already within the ceiling), above it a
/// tanh knee that approaches ±1.0 asymptotically (C1-continuous at the knee);
/// a hard clamp at ±1.0 when the ceiling is 0 dBFS.
#[inline]
pub fn safety_clip(x: f32, ceiling: f32) -> f32 {
    let a = x.abs();
    if a <= ceiling {
        x
    } else {
        let head = 1.0 - ceiling;
        let y = if head > 1e-6 { ceiling + head * ((a - ceiling) / head).tanh() } else { 1.0 };
        y.copysign(x)
    }
}

/// Polyphase taps of the 4x true-peak interpolator: phase `p` gives the
/// signal at `(p + 1) / 4` of the way between history samples `TP_LAG - 1`
/// and `TP_LAG` (history is oldest-first). Kaiser-windowed sinc, each phase
/// normalized to unity DC gain.
fn tp_taps() -> [[f32; TP_TAPS]; 3] {
    let i0 = |x: f64| {
        let (mut sum, mut term, q) = (1.0, 1.0, x * x / 4.0);
        for k in 1..50 {
            term *= q / (k * k) as f64;
            sum += term;
        }
        sum
    };
    let half = TP_LAG as f64;
    std::array::from_fn(|p| {
        let mut h = [0.0f64; TP_TAPS];
        for (j, v) in h.iter_mut().enumerate() {
            let t = (TP_LAG - 1) as f64 + (p + 1) as f64 / 4.0 - j as f64;
            let sinc = (std::f64::consts::PI * t).sin() / (std::f64::consts::PI * t);
            *v = sinc * i0(TP_KAISER_BETA * (1.0 - (t / half).powi(2)).max(0.0).sqrt()) / i0(TP_KAISER_BETA);
        }
        let s: f64 = h.iter().sum();
        h.map(|v| (v / s) as f32)
    })
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
    ceiling: ParamRamp,
    release_ms: f32,
    la: usize,
    /// Audio delay (`la + TP_LAG`) and the ceiling each sample was gained for
    /// (`la`, gain-computer time).
    delay: [Vec<f32>; 2],
    didx: usize,
    ceil_delay: Vec<f32>,
    cidx: usize,
    /// Highest ceiling among the samples output by the last `process` call.
    out_ceiling: f32,
    /// True-peak detector: per-channel history (each sample written twice so
    /// the last `TP_TAPS` are contiguous), taps, previous segment peak.
    tp_hist: [[f32; 2 * TP_TAPS]; 2],
    tp_pos: usize,
    tp_taps: [[f32; TP_TAPS]; 3],
    tp_prev: f32,
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
        let ceiling = db_to_amp(-1.0);
        let mut l = Self {
            sr: sample_rate,
            ceiling: ParamRamp::new(ceiling, ((CEILING_RAMP_S * sample_rate) as u32).max(la as u32)),
            release_ms: 80.0,
            la,
            delay: [vec![0.0; la + TP_LAG], vec![0.0; la + TP_LAG]],
            didx: 0,
            ceil_delay: vec![ceiling; la],
            cidx: 0,
            out_ceiling: ceiling,
            tp_hist: [[0.0; 2 * TP_TAPS]; 2],
            tp_pos: 0,
            tp_taps: tp_taps(),
            tp_prev: 0.0,
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
    /// Changes glide over 20 ms.
    pub fn set_ceiling_db(&mut self, db: f32) {
        let db = if db.is_finite() { db.clamp(-40.0, 0.0) } else { -1.0 };
        self.ceiling.set(db_to_amp(db));
    }

    /// Upper bound of the output of the last `process` call: the highest
    /// ceiling its samples were limited to (during a ceiling glide this is
    /// not the current target). Use as the knee of [`safety_clip`].
    pub fn output_ceiling(&self) -> f32 {
        self.out_ceiling
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

    /// Processing latency (lookahead + true-peak interpolator) in samples.
    pub fn latency(&self) -> usize {
        self.la + TP_LAG
    }

    /// Number of samples that needed the final rounding-guard clamp.
    pub fn safety_clamps(&self) -> u64 {
        self.safety_clamps
    }
}

impl StereoEffect for Limiter {
    fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        let n = left.len().min(right.len());
        let mut out_ceiling = 0.0f32;
        for i in 0..n {
            let (xl, xr) = (left[i], right[i]);
            // Treat non-finite input as silence rather than poisoning state.
            let (xl, xr) = (if xl.is_finite() { xl } else { 0.0 }, if xr.is_finite() { xr } else { 0.0 });

            // True peak around sample b = (this one - TP_LAG): its own value
            // and the inter-sample peaks of the segments [b-1, b], [b, b+1].
            let p = self.tp_pos;
            self.tp_hist[0][p] = xl;
            self.tp_hist[0][p + TP_TAPS] = xl;
            self.tp_hist[1][p] = xr;
            self.tp_hist[1][p + TP_TAPS] = xr;
            self.tp_pos = if p + 1 == TP_TAPS { 0 } else { p + 1 };
            let (hl, hr) = (
                &self.tp_hist[0][self.tp_pos..self.tp_pos + TP_TAPS],
                &self.tp_hist[1][self.tp_pos..self.tp_pos + TP_TAPS],
            );
            let mut seg = 0.0f32;
            for h in self.tp_taps.iter() {
                let (mut yl, mut yr) = (0.0f32, 0.0f32);
                for j in 0..TP_TAPS {
                    yl += h[j] * hl[j];
                    yr += h[j] * hr[j];
                }
                seg = seg.max(yl.abs()).max(yr.abs());
            }
            let peak = hl[TP_LAG - 1].abs().max(hr[TP_LAG - 1].abs()).max(seg).max(self.tp_prev);
            self.tp_prev = seg;

            let c = self.ceiling.next();
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

            // Ceiling the outgoing sample was gained for (LA steps ago).
            let co = std::mem::replace(&mut self.ceil_delay[self.cidx], c);
            self.cidx += 1;
            if self.cidx == self.la {
                self.cidx = 0;
            }
            out_ceiling = out_ceiling.max(co);

            // Delay line (LA + TP_LAG samples): read oldest, write newest.
            let dl = &mut self.delay[0][self.didx];
            let yl = *dl * g;
            *dl = xl;
            let dr = &mut self.delay[1][self.didx];
            let yr = *dr * g;
            *dr = xr;
            self.didx += 1;
            if self.didx == self.delay[0].len() {
                self.didx = 0;
            }

            let (ol, or) = (yl.clamp(-co, co), yr.clamp(-co, co));
            if ol != yl || or != yr {
                self.safety_clamps += 1;
            }
            left[i] = ol;
            right[i] = or;
        }
        if n > 0 {
            self.out_ceiling = out_ceiling;
        }
    }

    fn reset(&mut self) {
        self.delay[0].iter_mut().for_each(|v| *v = 0.0);
        self.delay[1].iter_mut().for_each(|v| *v = 0.0);
        self.didx = 0;
        self.ceiling.snap();
        let c = self.ceiling.value();
        self.ceil_delay.iter_mut().for_each(|v| *v = c);
        self.cidx = 0;
        self.out_ceiling = c;
        self.tp_hist = [[0.0; 2 * TP_TAPS]; 2];
        self.tp_pos = 0;
        self.tp_prev = 0.0;
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
        // Full-band white noise overshoots a lot between samples (sample
        // peak 0.6 reconstructs to +1 dBTP); at 0.3 its true peak is about
        // -5 dBTP, below the -1 dBFS ceiling.
        let x: Vec<f32> = (0..48000).map(|_| rng.bipolar() * 0.3).collect();
        let y0: Vec<f32> = (0..48000).map(|_| rng.bipolar() * 0.3).collect();
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

    /// Reconstructed (true) peak: 16x oversampling with a long Kaiser-windowed
    /// sinc (accurate to < 0.01 dB below 0.45 fs).
    fn true_peak(x: &[f32]) -> f32 {
        const H: i64 = 48;
        let i0 = |x: f64| (1..40).fold((1.0f64, 1.0f64), |(s, t), k| {
            let t = t * x * x / 4.0 / (k * k) as f64;
            (s + t, t)
        }).0;
        let beta = 9.0;
        let mut peak = 0.0f64;
        for i in H..x.len() as i64 - H {
            for k in 0..16 {
                let t = i as f64 + k as f64 / 16.0;
                let mut y = 0.0f64;
                for j in i - H + 1..=i + H {
                    let d = t - j as f64;
                    let sinc = if d == 0.0 { 1.0 } else { (std::f64::consts::PI * d).sin() / (std::f64::consts::PI * d) };
                    let w = i0(beta * (1.0 - (d / H as f64).powi(2)).max(0.0).sqrt()) / i0(beta);
                    y += x[j as usize] as f64 * sinc * w;
                }
                peak = peak.max(y.abs());
            }
        }
        peak as f32
    }

    /// Inter-sample peaks: a sine at fs/4 sampled at ±45° has sample peaks
    /// 3 dB below its true peak; with sample-peak detection only, it passed
    /// unlimited at +1.6 dBFS (2.6 dB over the -1 dBFS ceiling).
    #[test]
    fn true_peak_stays_below_ceiling() {
        let c = db_to_amp(-1.0);
        let n = 9600;
        let sine: Vec<f32> =
            (0..n).map(|i| 1.2 * (std::f32::consts::FRAC_PI_2 * i as f32 + std::f32::consts::FRAC_PI_4).sin()).collect();
        // Loud noise with a slow level swing: program-like (4-pole low-pass
        // at ~3 kHz) and nearly full-band (2-pole at ~11 kHz, only -15 dB
        // at Nyquist).
        let noise = |coef: f32, poles: usize, seed: u64| {
            let mut rng = Rng::new(seed);
            let mut st = [0.0f32; 4];
            (0..n)
                .map(|i| {
                    let mut v = rng.gauss();
                    for s in st.iter_mut().take(poles) {
                        *s += coef * (v - *s);
                        v = *s;
                    }
                    v * (1.5 + (i as f32 * 0.002).sin()) * 2.0
                })
                .collect::<Vec<f32>>()
        };
        // 4x detection can miss up to ~0.5 dB of a peak near Nyquist (the
        // peak falls between the 4x points); ITU-R BS.1770 accepts the same.
        for (what, x, tol_db) in [
            ("fs/4 sine at 45 deg", sine, 0.05),
            ("loud low-passed noise", noise(0.3, 4, 11), 0.15),
            ("loud near-full-band noise", noise(0.6, 2, 12), 0.5),
        ] {
            let mut lim = Limiter::new(SR);
            let (mut l, mut r) = (x.clone(), x.clone());
            run(&mut lim, &mut l, &mut r);
            let skip = 2000; // initial attack
            let tp = true_peak(&l[skip..]);
            let sp = max_abs(&l[skip..]);
            println!(
                "{what}: in {:+.2} dBTP; out sample peak {:+.2} dBFS, true peak {:+.2} dBTP (ceiling -1.00)",
                amp_to_db(true_peak(&x[skip..])),
                amp_to_db(sp),
                amp_to_db(tp)
            );
            assert!(sp <= c);
            assert!(tp <= c * db_to_amp(tol_db), "{what}: true peak {} dB over the ceiling", amp_to_db(tp / c));
            assert_eq!(lim.safety_clamps(), 0);
        }
    }

    /// Lowering the ceiling while limiting: the samples already in the
    /// lookahead were gained for the old ceiling; they must not be
    /// hard-clipped by the new one (the ceiling glides instead).
    #[test]
    fn ceiling_change_does_not_hard_clip() {
        let mut lim = Limiter::new(SR);
        let mut rng = Rng::new(4);
        let blk = 64;
        let mut out = Vec::new();
        for k in 0..(0.5 * SR) as usize / blk {
            if k == 200 {
                lim.set_ceiling_db(-7.0);
            }
            let mut l: Vec<f32> = (0..blk).map(|_| rng.gauss()).collect();
            let mut r: Vec<f32> = (0..blk).map(|_| rng.gauss()).collect();
            lim.process(&mut l, &mut r);
            out.extend_from_slice(&l);
        }
        // Samples that needed the hard safety clamp (before the fix: the
        // ones inside the lookahead when the ceiling dropped).
        println!("ceiling -1 -> -7 dB while limiting: {} hard-clamped samples", lim.safety_clamps());
        assert_eq!(lim.safety_clamps(), 0);
        let at = 200 * blk;
        let c_new = db_to_amp(-7.0);
        assert!(max_abs(&out[at + (0.03 * SR) as usize..]) <= c_new);
    }

    /// CPU cost on the master bus. Run with
    /// `cargo test --release limiter -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn bench() {
        let mut lim = Limiter::new(SR);
        let mut rng = Rng::new(2);
        let blk = 64;
        let input: Vec<f32> = (0..blk).map(|_| rng.gauss() * 2.0).collect();
        let (mut l, mut r) = (vec![0.0f32; blk], vec![0.0f32; blk]);
        let mut dt = f64::MAX;
        for _ in 0..5 {
            let t0 = std::time::Instant::now();
            for _ in 0..(10.0 * SR) as usize / blk {
                l.copy_from_slice(&input);
                r.copy_from_slice(&input);
                lim.process(&mut l, &mut r);
            }
            dt = dt.min(t0.elapsed().as_secs_f64());
        }
        println!("limiter: 10 s of loud stereo at 48 kHz in {:.1} ms ({:.3} % of one core)", dt * 1e3, dt * 10.0);
    }

    // --- safety clip (tests above also run against the pre-fix limiter) ---

    /// The engine's safety clip after the limiter must not touch anything at
    /// or below the ceiling. The old fixed 0.9 knee (-0.92 dBFS) waveshaped
    /// every limited peak once the ceiling was above it.
    #[test]
    fn safety_clip_is_transparent_up_to_ceiling() {
        let old_soft_clip = |x: f32| {
            let a = x.abs();
            if a <= 0.9 {
                x
            } else {
                (0.9 + 0.1 * ((a - 0.9) / 0.1).tanh()).copysign(x)
            }
        };
        for db in [-0.3f32, 0.0] {
            let mut lim = Limiter::new(SR);
            lim.set_ceiling_db(db);
            let mut rng = Rng::new(3);
            let mut l: Vec<f32> = (0..48000).map(|_| rng.gauss() * 1.5).collect();
            let mut r = l.clone();
            let (mut touched, mut worst_old, mut worst_new) = (0, 0.0f32, 0.0f32);
            for (a, b) in l.chunks_mut(64).zip(r.chunks_mut(64)) {
                lim.process(a, b);
                let knee = lim.output_ceiling();
                for &v in a.iter() {
                    let o = old_soft_clip(v);
                    touched += (o != v) as usize;
                    worst_old = worst_old.max(amp_to_db(v.abs() / o.abs()));
                    let s = safety_clip(v, knee);
                    worst_new = worst_new.max((s - v).abs());
                }
            }
            println!(
                "ceiling {db} dBFS: old 0.9-knee clip altered {touched} of 48000 samples (up to {worst_old:.2} dB); \
                 safety_clip max change {worst_new}"
            );
            assert_eq!(worst_new, 0.0);
        }
    }

    #[test]
    fn safety_clip_shape() {
        for c in [0.5f32, 0.9, 1.0] {
            assert_eq!(safety_clip(0.5 * c, c), 0.5 * c);
            assert_eq!(safety_clip(-c, c), -c);
            assert!(safety_clip(100.0, c) <= 1.0 && safety_clip(-100.0, c) >= -1.0);
            let mut prev = safety_clip(-3.0, c);
            for k in -299..300 {
                let y = safety_clip(k as f32 * 0.01, c);
                assert!(y >= prev);
                prev = y;
            }
        }
        // C1 at the knee
        let e = 1e-3;
        let slope = (safety_clip(0.9 + e, 0.9) - safety_clip(0.9, 0.9)) / e;
        assert!((slope - 1.0).abs() < 0.02);
    }
}
