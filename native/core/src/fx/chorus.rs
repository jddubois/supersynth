//! Stereo chorus / ensemble, plus the fractional delay buffer shared by the
//! modulated effects (reverb, leslie).
//!
//! Three modulated voices per side read one delay line per channel with
//! 4-point Lagrange interpolation. Each voice has its own LFO phase (L voices
//! at 0°/120°/240°, R voices offset by 60°), a slightly different rate, and a
//! small second, faster LFO component (as in classic string-ensemble chips),
//! which gives the lush, non-static "ensemble" motion rather than a single
//! obvious sweep.

use super::{ParamRamp, StereoEffect, PARAM_RAMP_S};
use std::f32::consts::TAU;

// ---------------------------------------------------------------------------
// Shared delay buffer
// ---------------------------------------------------------------------------

/// 4-point, 3rd-order Lagrange interpolation. `f` in [0, 1) is the position
/// between `p1` (f = 0) and `p2` (f = 1); `p0` precedes `p1`, `p3` follows
/// `p2`.
#[inline(always)]
pub(crate) fn lagrange3(p0: f32, p1: f32, p2: f32, p3: f32, f: f32) -> f32 {
    let fm1 = f - 1.0;
    let fm2 = f - 2.0;
    let fp1 = f + 1.0;
    let a = fp1 * f;
    let b = fm1 * fm2;
    (-(f * b) * p0 + 3.0 * fp1 * b * p1 - 3.0 * a * fm2 * p2 + a * fm1 * p3) * (1.0 / 6.0)
}

/// Power-of-two circular buffer. `push` stores the newest sample; delay 0 is
/// the most recently pushed sample.
#[derive(Clone)]
pub(crate) struct DelayBuf {
    buf: Vec<f32>,
    mask: usize,
    w: usize,
    max_frac: f32,
}

impl DelayBuf {
    /// A buffer able to serve (fractional) delays up to at least `max_delay`.
    pub(crate) fn new(max_delay: usize) -> Self {
        let len = (max_delay + 4).next_power_of_two();
        Self { buf: vec![0.0; len], mask: len - 1, w: 0, max_frac: (len - 3) as f32 }
    }

    #[inline(always)]
    pub(crate) fn push(&mut self, x: f32) {
        self.w = (self.w + 1) & self.mask;
        self.buf[self.w] = x;
    }

    /// Integer-delay read (0 = newest).
    #[inline(always)]
    pub(crate) fn tap(&self, d: usize) -> f32 {
        self.buf[self.w.wrapping_sub(d) & self.mask]
    }

    /// Fractional-delay read with cubic Lagrange interpolation. `d` is clamped
    /// to [1, capacity - 3] so the four points are always valid.
    #[inline(always)]
    pub(crate) fn read_cubic(&self, d: f32) -> f32 {
        let d = d.clamp(1.0, self.max_frac);
        let i = d as usize;
        let f = d - i as f32;
        let m = self.mask;
        let base = self.w.wrapping_sub(i);
        let b = &self.buf;
        let p0 = b[base.wrapping_add(1) & m];
        let p1 = b[base & m];
        let p2 = b[base.wrapping_sub(1) & m];
        let p3 = b[base.wrapping_sub(2) & m];
        lagrange3(p0, p1, p2, p3, f)
    }

    pub(crate) fn clear(&mut self) {
        self.buf.iter_mut().for_each(|v| *v = 0.0);
    }
}

#[inline(always)]
pub(crate) fn flush_denormal(x: f32) -> f32 {
    if x.abs() < 1e-20 {
        0.0
    } else {
        x
    }
}

// ---------------------------------------------------------------------------
// Chorus
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ChorusParams {
    /// Main LFO rate (Hz, 0.01 .. 10).
    pub rate_hz: f32,
    /// Peak-to-peak delay sweep (ms, 0 .. 20).
    pub depth_ms: f32,
    /// Minimum (base) delay (ms, 0.5 .. 40).
    pub delay_ms: f32,
    /// Dry/wet (0 = dry only, 1 = wet only).
    pub mix: f32,
    /// Feedback (-0.9 .. 0.9).
    pub feedback: f32,
    /// Stereo width of the wet signal (0 = mono, 1 = full).
    pub width: f32,
}

impl Default for ChorusParams {
    fn default() -> Self {
        Self { rate_hz: 0.6, depth_ms: 3.0, delay_ms: 10.0, mix: 0.5, feedback: 0.0, width: 1.0 }
    }
}

impl ChorusParams {
    fn sanitized(self) -> Self {
        let f = |x: f32, d: f32, lo: f32, hi: f32| if x.is_finite() { x.clamp(lo, hi) } else { d };
        let d = Self::default();
        Self {
            rate_hz: f(self.rate_hz, d.rate_hz, 0.01, 10.0),
            depth_ms: f(self.depth_ms, d.depth_ms, 0.0, MAX_DEPTH_MS),
            delay_ms: f(self.delay_ms, d.delay_ms, 0.5, MAX_BASE_MS),
            mix: f(self.mix, d.mix, 0.0, 1.0),
            feedback: f(self.feedback, d.feedback, -0.9, 0.9),
            width: f(self.width, d.width, 0.0, 1.0),
        }
    }
}

const VOICES: usize = 3;
const SUB: usize = 16;
const MAX_DEPTH_MS: f32 = 20.0;
const MAX_BASE_MS: f32 = 40.0;
/// Relative rates of the three voices (irrational-ish ratios so the voices
/// never lock into a repeating pattern).
const RATE_MULT: [f32; VOICES] = [1.0, 1.0731, 0.9187];
/// Secondary (fast) LFO: rate multiple of the main rate and relative depth.
const FAST_MULT: [f32; VOICES] = [6.93, 7.71, 8.37];
const FAST_DEPTH: f32 = 0.12;
/// Wet gain for the sum of three voices (between 1/3 and 1/sqrt 3: the voices
/// are partly correlated).
const VOICE_GAIN: f32 = 0.45;
/// Parameter smoothing time constant for delay/depth (seconds).
const SMOOTH_S: f32 = 0.05;

pub struct Chorus {
    sr: f32,
    params: ChorusParams,
    buf: [DelayBuf; 2],
    /// Main / fast LFO phases in cycles, `[side][voice]`.
    phase: [[f32; VOICES]; 2],
    phase_fast: [[f32; VOICES]; 2],
    /// Current read delays (samples), their end-of-sub-block targets and
    /// per-sample increments.
    pos: [[f32; VOICES]; 2],
    pos_tgt: [[f32; VOICES]; 2],
    dpos: [[f32; VOICES]; 2],
    delay_s: f32,
    depth_s: f32,
    smooth_a: f32,
    mix: ParamRamp,
    fb: ParamRamp,
    width: ParamRamp,
    sub_left: usize,
}

impl Chorus {
    pub fn new(sample_rate: f32) -> Self {
        let sr = sample_rate;
        let max = ((MAX_BASE_MS + MAX_DEPTH_MS * (1.0 + FAST_DEPTH)) * 1e-3 * sr) as usize + 8;
        let mut phase = [[0.0; VOICES]; 2];
        for (s, side) in phase.iter_mut().enumerate() {
            for (v, p) in side.iter_mut().enumerate() {
                *p = v as f32 / VOICES as f32 + s as f32 / (2.0 * VOICES as f32);
            }
        }
        let p = ChorusParams::default();
        let mut c = Self {
            sr,
            params: p,
            buf: [DelayBuf::new(max), DelayBuf::new(max)],
            phase,
            phase_fast: [[0.0, 0.37, 0.71], [0.19, 0.55, 0.88]],
            pos: [[0.0; VOICES]; 2],
            pos_tgt: [[0.0; VOICES]; 2],
            dpos: [[0.0; VOICES]; 2],
            delay_s: p.delay_ms * 1e-3 * sr,
            depth_s: p.depth_ms * 1e-3 * sr,
            smooth_a: 1.0 - crate::dsp::one_pole_coeff(SMOOTH_S, sr / SUB as f32),
            mix: ParamRamp::with_time(p.mix, PARAM_RAMP_S, sr),
            fb: ParamRamp::with_time(p.feedback, PARAM_RAMP_S, sr),
            width: ParamRamp::with_time(p.width, PARAM_RAMP_S, sr),
            sub_left: 0,
        };
        c.init_positions();
        c
    }

    fn init_positions(&mut self) {
        for s in 0..2 {
            for v in 0..VOICES {
                let d = self.voice_delay(s, v);
                self.pos[s][v] = d;
                self.pos_tgt[s][v] = d;
                self.dpos[s][v] = 0.0;
            }
        }
    }

    pub fn set_params(&mut self, p: ChorusParams) {
        let p = p.sanitized();
        self.params = p;
        self.mix.set(p.mix);
        self.fb.set(p.feedback);
        self.width.set(p.width);
    }

    pub fn params(&self) -> ChorusParams {
        self.params
    }

    #[inline]
    fn voice_delay(&self, s: usize, v: usize) -> f32 {
        let lfo = ((TAU * self.phase[s][v]).sin() + FAST_DEPTH * (TAU * self.phase_fast[s][v]).sin())
            * (1.0 / (1.0 + FAST_DEPTH));
        (self.delay_s + self.depth_s * 0.5 * (1.0 + lfo)).max(2.0)
    }

    /// Control-rate update (every SUB samples): advance LFOs, smooth delay
    /// parameters, set per-sample delay increments.
    fn control(&mut self) {
        let p = self.params;
        let a = self.smooth_a;
        self.delay_s += a * (p.delay_ms * 1e-3 * self.sr - self.delay_s);
        self.depth_s += a * (p.depth_ms * 1e-3 * self.sr - self.depth_s);
        let inc = p.rate_hz * SUB as f32 / self.sr;
        for s in 0..2 {
            for v in 0..VOICES {
                let ph = &mut self.phase[s][v];
                *ph += inc * RATE_MULT[v];
                *ph -= ph.floor();
                let pf = &mut self.phase_fast[s][v];
                *pf += inc * FAST_MULT[v];
                *pf -= pf.floor();
                let d = self.voice_delay(s, v);
                self.pos[s][v] = self.pos_tgt[s][v];
                self.pos_tgt[s][v] = d;
                self.dpos[s][v] = (d - self.pos[s][v]) / SUB as f32;
            }
        }
    }
}

impl StereoEffect for Chorus {
    fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        let n = left.len().min(right.len());
        if n == 0 {
            return;
        }
        let mut i = 0;
        while i < n {
            if self.sub_left == 0 {
                self.control();
                self.sub_left = SUB;
            }
            let k = self.sub_left.min(n - i);
            for j in i..i + k {
                let (mix, fb, width) = (self.mix.next(), self.fb.next(), self.width.next());
                let mut wet = [0.0f32; 2];
                let mut avg = [0.0f32; 2];
                for s in 0..2 {
                    let mut acc = 0.0;
                    for v in 0..VOICES {
                        self.pos[s][v] += self.dpos[s][v];
                        // Read before writing (feedback): delay d means the
                        // sample pushed d samples ago -> tap index d - 1.
                        acc += self.buf[s].read_cubic(self.pos[s][v] - 1.0);
                    }
                    wet[s] = acc * VOICE_GAIN;
                    avg[s] = acc * (1.0 / VOICES as f32);
                }
                let (dl, dr) = (left[j], right[j]);
                // Feed back the voice *average* so the loop gain is <= |fb| < 1
                // even where the voices are fully correlated (low frequencies).
                self.buf[0].push(flush_denormal(dl + fb * avg[0]));
                self.buf[1].push(flush_denormal(dr + fb * avg[1]));
                let m = 0.5 * (wet[0] + wet[1]);
                let sd = 0.5 * (wet[0] - wet[1]) * width;
                left[j] = dl * (1.0 - mix) + (m + sd) * mix;
                right[j] = dr * (1.0 - mix) + (m - sd) * mix;
            }
            self.sub_left -= k;
            i += k;
        }
    }

    fn reset(&mut self) {
        self.buf[0].clear();
        self.buf[1].clear();
        self.delay_s = self.params.delay_ms * 1e-3 * self.sr;
        self.depth_s = self.params.depth_ms * 1e-3 * self.sr;
        self.init_positions();
        self.sub_left = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    #[test]
    fn lagrange_is_exact_on_cubics_and_integer_points() {
        let f = |x: f32| 0.3 * x * x * x - x * x + 2.0 * x - 1.0;
        for k in 0..10 {
            let t = k as f32 / 10.0;
            let y = lagrange3(f(-1.0), f(0.0), f(1.0), f(2.0), t);
            assert!((y - f(t)).abs() < 1e-4);
        }
        assert_eq!(lagrange3(9.0, 1.5, 7.0, 3.0, 0.0), 1.5);
    }

    #[test]
    fn delaybuf_fractional_read() {
        let mut b = DelayBuf::new(64);
        for i in 0..100 {
            b.push(i as f32);
        }
        // newest = 99; delay 10.25 -> 88.75
        assert!((b.read_cubic(10.25) - 88.75).abs() < 1e-4);
        assert_eq!(b.tap(3), 96.0);
    }

    fn run(c: &mut Chorus, f: f32, secs: f32, sr: f32) -> (Vec<f32>, Vec<f32>) {
        let n = (secs * sr) as usize;
        let x: Vec<f32> = (0..n).map(|i| (2.0 * PI * f * i as f32 / sr).sin() * 0.5).collect();
        let mut l = x.clone();
        let mut r = x;
        for (a, b) in l.chunks_mut(256).zip(r.chunks_mut(256)) {
            c.process(a, b);
        }
        (l, r)
    }

    #[test]
    fn zero_mix_is_dry() {
        let sr = 48000.0;
        let mut c = Chorus::new(sr);
        c.set_params(ChorusParams { mix: 0.0, ..Default::default() });
        // ramp from default mix (0.5) takes 20 ms; skip it
        let mut a = vec![0.0; 2048];
        let mut b = vec![0.0; 2048];
        c.process(&mut a, &mut b);
        let x: Vec<f32> = (0..256).map(|i| (i as f32 * 0.05).sin()).collect();
        let (mut l, mut r) = (x.clone(), x.clone());
        c.process(&mut l, &mut r);
        assert_eq!(l, x);
        assert_eq!(r, x);
    }

    #[test]
    fn mono_in_gives_stereo_out_and_stays_finite() {
        let sr = 48000.0;
        let mut c = Chorus::new(sr);
        c.set_params(ChorusParams { mix: 1.0, feedback: 0.9, ..Default::default() });
        let (l, r) = run(&mut c, 440.0, 2.0, sr);
        assert!(l.iter().chain(r.iter()).all(|v| v.is_finite() && v.abs() < 10.0));
        let diff: f32 = l.iter().zip(&r).map(|(a, b)| (a - b).abs()).sum::<f32>() / l.len() as f32;
        assert!(diff > 0.01, "no stereo difference: {diff}");
    }

    /// Mix / feedback changes right before a 1-frame block (the engine
    /// splits blocks at events) must still be ramped, not applied as a step.
    #[test]
    fn param_change_in_one_frame_block_is_smooth() {
        let sr = 48000.0;
        let mut c = Chorus::new(sr);
        c.set_params(ChorusParams { mix: 0.0, ..Default::default() });
        run(&mut c, 200.0, 0.2, sr);
        let x: Vec<f32> = (0..9600).map(|i| (2.0 * PI * 200.0 * i as f32 / sr).sin() * 0.5).collect();
        let (mut l, mut r) = (x.clone(), x.clone());
        c.process(&mut l[..1000], &mut r[..1000]);
        c.set_params(ChorusParams { mix: 1.0, feedback: 0.7, ..Default::default() });
        c.process(&mut l[1000..1001], &mut r[1000..1001]);
        for (a, b) in l[1001..].chunks_mut(64).zip(r[1001..].chunks_mut(64)) {
            c.process(a, b);
        }
        let reference = max_step(&l[5000..]).max(max_step(&x));
        let step = max_step(&l[990..1100]);
        println!("chorus mix 0 -> 1 in a 1-frame block: max step {step:.4} (steady {reference:.4})");
        assert!(step < 1.5 * reference, "step {step} vs {reference}");
    }

    fn max_step(v: &[f32]) -> f32 {
        v.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0, f32::max)
    }

    #[test]
    fn works_at_extreme_rates() {
        for sr in [22050.0, 192000.0] {
            let mut c = Chorus::new(sr);
            c.set_params(ChorusParams {
                rate_hz: 10.0,
                depth_ms: 20.0,
                delay_ms: 40.0,
                mix: 0.5,
                feedback: -0.9,
                width: 1.0,
            });
            let (l, r) = run(&mut c, 1000.0, 0.5, sr);
            assert!(l.iter().chain(r.iter()).all(|v| v.is_finite()));
        }
    }
}
