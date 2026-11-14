//! Rotary speaker (Leslie 122/147 style) as a stereo effect.
//!
//! Model:
//! * Input is summed to mono and split by a 4th-order Linkwitz-Riley crossover
//!   at 800 Hz (LP + HP sum to an allpass, so a stopped rotor is transparent
//!   in magnitude).
//! * Each rotor (treble horn, bass drum) has its own angular velocity that
//!   follows the selected speed with separate acceleration / deceleration
//!   time constants (the light horn spins up in under a second, the heavy
//!   drum takes several seconds).
//! * Two virtual microphones per rotor (left / right, around the cabinet).
//!   Each rotor reaches each mic by two paths: directly, with a path length
//!   `D - R cos(phi - theta_mic)` read as a modulated delay with cubic
//!   interpolation (Doppler), and by a cabinet reflection from its far side
//!   (longer, and lengthening while the direct path shortens). Each path has
//!   its own directivity (loudest when the rotor's mouth faces it), and the
//!   horn's direct path a low-pass that closes when the mouth faces away.
//! * The two paths are nearly as loud as each other, so they interfere: every
//!   partial of the tone passes through its own notches twice (or more) per
//!   turn. That, more than the Doppler shift, is the swirl of a rotary
//!   speaker: per partial the level swings 12–17 dB while the level of the
//!   whole tone moves far less.
//!
//! The speeds, path lengths, gains and mic angles below were fitted to
//! recordings of a tonewheel organ through its rotary speaker at the fast
//! speed (the FreePats rock organ, `tools/ssm/freepats.py`): per partial, the
//! swing of the level, its rate, the swing of the pitch and the likeness of
//! the two channels, below and above the crossover (`tools/ssm/rotary_eval.py`).
//!
//! Rotor phases advance at audio rate, delay / gain / filter targets are
//! computed every 16 samples and ramped linearly in between.

use super::chorus::DelayBuf;
use super::{ParamRamp, StereoEffect, PARAM_RAMP_S};
use crate::dsp::biquad::{Biquad, Coeffs};
use std::f32::consts::{PI, TAU};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LeslieSpeed {
    Stop,
    Slow,
    Fast,
}

const SUB: usize = 16;
const CROSSOVER_HZ: f32 = 800.0;

#[derive(Clone, Copy)]
struct RotorSpec {
    slow_hz: f32,
    fast_hz: f32,
    accel_tau_s: f32,
    decel_tau_s: f32,
    /// Static mic distance (ms) and rotation radius (ms of path length).
    base_ms: f32,
    radius_ms: f32,
    /// Directivity of the direct path: its level falls by this share (0..1) when the
    /// rotor's mouth faces away from the mic.
    am_depth: f32,
    /// Cabinet reflection: extra path (ms), gain, and the share its level falls by when
    /// the mouth faces the mic (and so away from the reflecting side).
    refl_ms: f32,
    refl_gain: f32,
    refl_am: f32,
    /// Mic angles around the cabinet: ± this many half turns from the front.
    mic: f32,
}

impl RotorSpec {
    /// Gain that keeps the rotor's long-term power at the input's: the two paths add as
    /// powers over a turn (their interference averages out), each with its directivity.
    fn norm(&self) -> f32 {
        let mean_sq = |depth: f32| 1.0 - depth + 0.375 * depth * depth;
        (mean_sq(self.am_depth) + self.refl_gain * self.refl_gain * mean_sq(self.refl_am)).sqrt().recip()
    }

    fn max_ms(&self) -> f32 {
        self.base_ms + self.refl_ms + self.radius_ms
    }
}

const HORN: RotorSpec = RotorSpec {
    slow_hz: 0.80,
    fast_hz: 7.05,
    accel_tau_s: 0.45,
    decel_tau_s: 0.65,
    base_ms: 1.2,
    radius_ms: 0.759,
    am_depth: 0.751,
    refl_ms: 2.345,
    refl_gain: 0.967,
    refl_am: 0.154,
    mic: 0.375,
};

const DRUM: RotorSpec = RotorSpec {
    slow_hz: 0.66,
    fast_hz: 5.95,
    accel_tau_s: 2.2,
    decel_tau_s: 1.8,
    base_ms: 2.0,
    radius_ms: 0.856,
    am_depth: 0.51,
    refl_ms: 5.306,
    refl_gain: 0.81,
    refl_am: 0.22,
    mic: 0.305,
};

/// Horn directivity low-pass corner when facing toward / away from the mic.
const HORN_LP_OPEN_HZ: f32 = 16000.0;
const HORN_LP_CLOSED_HZ: f32 = 3500.0;

struct Rotor {
    spec: RotorSpec,
    rate: f32,
    target: f32,
    /// Phase in cycles [0, 1).
    phase: f64,
    a_up: f32,
    a_dn: f32,
}

impl Rotor {
    fn new(spec: RotorSpec, sr: f32, initial_phase: f64) -> Self {
        let ctl_sr = sr / SUB as f32;
        Self {
            spec,
            rate: spec.slow_hz,
            target: spec.slow_hz,
            phase: initial_phase,
            a_up: 1.0 - crate::dsp::one_pole_coeff(spec.accel_tau_s, ctl_sr),
            a_dn: 1.0 - crate::dsp::one_pole_coeff(spec.decel_tau_s, ctl_sr),
        }
    }

    fn set_speed(&mut self, s: LeslieSpeed) {
        self.target = match s {
            LeslieSpeed::Stop => 0.0,
            LeslieSpeed::Slow => self.spec.slow_hz,
            LeslieSpeed::Fast => self.spec.fast_hz,
        };
    }

    /// Advance by one control period; returns the new angle (radians).
    fn advance(&mut self, dt: f64) -> f32 {
        let a = if self.target > self.rate { self.a_up } else { self.a_dn };
        self.rate += a * (self.target - self.rate);
        if self.rate.abs() < 1e-4 && self.target == 0.0 {
            self.rate = 0.0;
        }
        self.phase += self.rate as f64 * dt;
        self.phase -= self.phase.floor();
        (self.phase * std::f64::consts::TAU) as f32
    }
}

/// A linearly ramped control value.
#[derive(Clone, Copy, Default)]
struct Ramp {
    v: f32,
    d: f32,
}

impl Ramp {
    #[inline(always)]
    fn set(&mut self, target: f32) {
        self.d = (target - self.v) / SUB as f32;
    }
    #[inline(always)]
    fn tick(&mut self) -> f32 {
        self.v += self.d;
        self.v
    }
}

pub struct Leslie {
    sr: f32,
    xo_lp: [Biquad; 2],
    xo_hp: [Biquad; 2],
    horn: Rotor,
    drum: Rotor,
    horn_buf: DelayBuf,
    drum_buf: DelayBuf,
    /// Per mic: delays (samples) of the horn's direct path and reflection, and the drum's.
    horn_d: [Ramp; 2],
    refl_d: [Ramp; 2],
    drum_d: [Ramp; 2],
    drum_refl_d: [Ramp; 2],
    /// Per mic gains and horn LP coefficient.
    horn_g: [Ramp; 2],
    refl_g: [Ramp; 2],
    drum_g: [Ramp; 2],
    drum_refl_g: [Ramp; 2],
    horn_lp_a: [Ramp; 2],
    horn_lp: [f32; 2],
    lp_open: f32,
    lp_closed: f32,
    mix: ParamRamp,
    sub_left: usize,
}

impl Leslie {
    pub fn new(sample_rate: f32) -> Self {
        let sr = sample_rate;
        let q = std::f32::consts::FRAC_1_SQRT_2;
        let lp = Biquad::new(Coeffs::low_pass(CROSSOVER_HZ, q, sr));
        let hp = Biquad::new(Coeffs::high_pass(CROSSOVER_HZ, q, sr));
        let max = |spec: &RotorSpec| ((spec.max_ms() + 1.0) * 1e-3 * sr) as usize + 8;
        let onepole = |hz: f32| 1.0 - (-TAU * hz.min(0.45 * sr) / sr).exp();
        let mut l = Self {
            sr,
            xo_lp: [lp, lp],
            xo_hp: [hp, hp],
            horn: Rotor::new(HORN, sr, 0.0),
            drum: Rotor::new(DRUM, sr, 0.37),
            horn_buf: DelayBuf::new(max(&HORN)),
            drum_buf: DelayBuf::new(max(&DRUM)),
            horn_d: [Ramp::default(); 2],
            refl_d: [Ramp::default(); 2],
            drum_d: [Ramp::default(); 2],
            drum_refl_d: [Ramp::default(); 2],
            horn_g: [Ramp::default(); 2],
            refl_g: [Ramp::default(); 2],
            drum_g: [Ramp::default(); 2],
            drum_refl_g: [Ramp::default(); 2],
            horn_lp_a: [Ramp::default(); 2],
            horn_lp: [0.0; 2],
            lp_open: onepole(HORN_LP_OPEN_HZ),
            lp_closed: onepole(HORN_LP_CLOSED_HZ),
            mix: ParamRamp::with_time(1.0, PARAM_RAMP_S, sr),
            sub_left: 0,
        };
        l.control(0.0);
        l.snap_ramps();
        l
    }

    /// Select rotor speed; both rotors glide with their own inertia.
    pub fn set_speed(&mut self, speed: LeslieSpeed) {
        self.horn.set_speed(speed);
        self.drum.set_speed(speed);
    }

    /// Dry/wet mix (0 = dry, 1 = fully through the cabinet). Smoothed.
    pub fn set_mix(&mut self, mix: f32) {
        self.mix.set(if mix.is_finite() { mix.clamp(0.0, 1.0) } else { 1.0 });
    }

    /// Current (horn, drum) rotation rates in Hz.
    pub fn rotor_rates(&self) -> (f32, f32) {
        (self.horn.rate, self.drum.rate)
    }

    fn snap_ramps(&mut self) {
        for r in self
            .horn_d
            .iter_mut()
            .chain(self.refl_d.iter_mut())
            .chain(self.drum_d.iter_mut())
            .chain(self.drum_refl_d.iter_mut())
            .chain(self.horn_g.iter_mut())
            .chain(self.refl_g.iter_mut())
            .chain(self.drum_g.iter_mut())
            .chain(self.drum_refl_g.iter_mut())
            .chain(self.horn_lp_a.iter_mut())
        {
            r.v += r.d * SUB as f32;
            r.d = 0.0;
        }
    }

    /// Compute end-of-sub-block targets for all modulated quantities.
    fn control(&mut self, dt: f64) {
        let ms = self.sr * 1e-3;
        let ph = self.horn.advance(dt);
        let pd = self.drum.advance(dt);
        let (hn, dn) = (HORN.norm(), DRUM.norm());
        for (m, side) in [-1.0f32, 1.0].into_iter().enumerate() {
            let ch = (ph - side * HORN.mic * PI).cos(); // +1: horn mouth faces the mic
            let cd = (pd - side * DRUM.mic * PI).cos();
            // Doppler: the direct path shortens as the source points toward the mic, the
            // reflection from the far side lengthens.
            self.horn_d[m].set((HORN.base_ms - HORN.radius_ms * ch) * ms);
            self.refl_d[m].set((HORN.base_ms + HORN.refl_ms + HORN.radius_ms * ch) * ms);
            self.drum_d[m].set((DRUM.base_ms - DRUM.radius_ms * cd) * ms);
            self.drum_refl_d[m].set((DRUM.base_ms + DRUM.refl_ms + DRUM.radius_ms * cd) * ms);
            // Directivity AM.
            let toward = 0.5 * (1.0 + ch);
            let toward_d = 0.5 * (1.0 + cd);
            self.horn_g[m].set(hn * (1.0 - HORN.am_depth * (1.0 - toward)));
            self.refl_g[m].set(hn * HORN.refl_gain * (1.0 - HORN.refl_am * toward));
            self.drum_g[m].set(dn * (1.0 - DRUM.am_depth * (1.0 - toward_d)));
            self.drum_refl_g[m].set(dn * DRUM.refl_gain * (1.0 - DRUM.refl_am * toward_d));
            self.horn_lp_a[m].set(self.lp_closed + (self.lp_open - self.lp_closed) * toward);
        }
    }
}

impl StereoEffect for Leslie {
    fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        let n = left.len().min(right.len());
        if n == 0 {
            return;
        }
        let dt = SUB as f64 / self.sr as f64;
        let mut i = 0;
        while i < n {
            if self.sub_left == 0 {
                self.control(dt);
                self.sub_left = SUB;
            }
            let k = self.sub_left.min(n - i);
            for j in i..i + k {
                let (dl, dr) = (left[j], right[j]);
                let mono = 0.5 * (dl + dr);
                let lo = self.xo_lp[0].process(mono);
                let lo = self.xo_lp[1].process(lo);
                // LR4 (squared Butterworth): LP + HP sum to an allpass.
                let hi = self.xo_hp[0].process(mono);
                let hi = self.xo_hp[1].process(hi);
                self.horn_buf.push(hi);
                self.drum_buf.push(lo);
                let mut out = [0.0f32; 2];
                for (m, o) in out.iter_mut().enumerate() {
                    let direct = self.horn_buf.read_cubic(self.horn_d[m].tick());
                    let a = self.horn_lp_a[m].tick();
                    self.horn_lp[m] += a * (direct - self.horn_lp[m]);
                    let refl = self.horn_buf.read_cubic(self.refl_d[m].tick());
                    let drum = self.drum_buf.read_cubic(self.drum_d[m].tick());
                    let drum_refl = self.drum_buf.read_cubic(self.drum_refl_d[m].tick());
                    *o = self.horn_lp[m] * self.horn_g[m].tick()
                        + refl * self.refl_g[m].tick()
                        + drum * self.drum_g[m].tick()
                        + drum_refl * self.drum_refl_g[m].tick();
                }
                let mix = self.mix.next();
                left[j] = dl + mix * (out[0] - dl);
                right[j] = dr + mix * (out[1] - dr);
            }
            self.sub_left -= k;
            i += k;
        }
        // The crossover runs per sample (`Biquad::process` never flushes):
        // without this its state settles at ~1e-44 after the input stops.
        for b in self.xo_lp.iter_mut().chain(self.xo_hp.iter_mut()) {
            b.flush_denormals();
        }
        for s in self.horn_lp.iter_mut() {
            if s.abs() < 1e-20 {
                *s = 0.0;
            }
        }
    }

    fn reset(&mut self) {
        for b in self.xo_lp.iter_mut().chain(self.xo_hp.iter_mut()) {
            b.reset();
        }
        self.horn_buf.clear();
        self.drum_buf.clear();
        self.horn_lp = [0.0; 2];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48000.0;

    fn run(les: &mut Leslie, secs: f32, f: f32) -> (Vec<f32>, Vec<f32>) {
        let n = (secs * SR) as usize;
        let mut l: Vec<f32> = (0..n).map(|i| (TAU * f * i as f32 / SR).sin() * 0.5).collect();
        let mut r = l.clone();
        for (a, b) in l.chunks_mut(200).zip(r.chunks_mut(200)) {
            les.process(a, b);
        }
        (l, r)
    }

    #[test]
    fn finite_and_bounded() {
        let mut les = Leslie::new(SR);
        les.set_speed(LeslieSpeed::Fast);
        let (l, r) = run(&mut les, 2.0, 1000.0);
        assert!(l.iter().chain(&r).all(|v| v.is_finite() && v.abs() < 2.0));
    }

    #[test]
    fn fast_creates_stereo_motion() {
        let mut les = Leslie::new(SR);
        les.set_speed(LeslieSpeed::Fast);
        let (l, r) = run(&mut les, 3.0, 2000.0);
        let tail = l.len() - 24000;
        let diff: f32 = l[tail..].iter().zip(&r[tail..]).map(|(a, b)| (a - b).abs()).sum::<f32>() / 24000.0;
        assert!(diff > 0.05, "diff {diff}");
        // Amplitude modulation present: envelope varies over a rotation.
        let blocks: Vec<f32> = l[tail..]
            .chunks(480)
            .map(|c| (c.iter().map(|v| v * v).sum::<f32>() / c.len() as f32).sqrt())
            .collect();
        let (mn, mx) = blocks.iter().fold((f32::MAX, 0.0f32), |(a, b), &v| (a.min(v), b.max(v)));
        assert!(mx / mn > 1.3, "AM ratio {}", mx / mn);
    }

    /// What the rotors were fitted for: a single partial swings by many dB as it
    /// passes through the notches of the two paths, below the crossover as well as above
    /// it, while its long-term power stays close to the input's.
    #[test]
    fn partials_swing_through_notches_at_unity_power() {
        for f in [196.0f32, 392.0, 1568.0, 3136.0] {
            let mut les = Leslie::new(SR);
            les.set_speed(LeslieSpeed::Fast);
            let (l, _) = run(&mut les, 14.0, f);
            let tail = &l[l.len() - 4 * SR as usize..];
            let rms = |c: &[f32]| (c.iter().map(|v| v * v).sum::<f32>() / c.len() as f32).sqrt();
            let mut blocks: Vec<f32> = tail.chunks(480).map(rms).collect();
            blocks.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let swing = 20.0 * (blocks[blocks.len() * 95 / 100] / blocks[blocks.len() * 5 / 100]).log10();
            let power = 20.0 * (rms(tail) / (0.5 * std::f32::consts::FRAC_1_SQRT_2)).log10();
            println!("leslie fast, {f} Hz: level swing {swing:.1} dB, long-term level {power:+.1} dB");
            assert!(swing > 5.0, "{f} Hz: swing {swing} dB");
            assert!(power.abs() < 3.5, "{f} Hz: long-term level {power} dB");
        }
    }

    #[test]
    fn rotors_accelerate_and_stop() {
        let mut les = Leslie::new(SR);
        les.set_speed(LeslieSpeed::Fast);
        run(&mut les, 1.0, 100.0);
        let (h, d) = les.rotor_rates();
        assert!(h > 5.5 && d < 4.0, "horn {h} drum {d}");
        run(&mut les, 10.0, 100.0);
        let (h, d) = les.rotor_rates();
        assert!((h - HORN.fast_hz).abs() < 0.05 && (d - DRUM.fast_hz).abs() < 0.05);
        les.set_speed(LeslieSpeed::Stop);
        run(&mut les, 20.0, 100.0);
        assert_eq!(les.rotor_rates(), (0.0, 0.0));
    }

    #[test]
    fn zero_mix_is_dry() {
        let mut les = Leslie::new(SR);
        les.set_mix(0.0);
        let mut a = vec![0.1; 2048];
        let mut b = vec![0.1; 2048];
        les.process(&mut a, &mut b);
        let x: Vec<f32> = (0..300).map(|i| (i as f32 * 0.1).sin()).collect();
        let (mut l, mut r) = (x.clone(), x.clone());
        les.process(&mut l, &mut r);
        assert_eq!(l, x);
        assert_eq!(r, x);
    }

    /// After the input stops, the output must decay to exact zeros, not to a
    /// subnormal limit cycle (very slow on x86 without FTZ/DAZ).
    #[test]
    fn silence_after_signal_reaches_exact_zero() {
        let mut les = Leslie::new(SR);
        les.set_speed(LeslieSpeed::Fast);
        run(&mut les, 0.5, 440.0);
        let mut subnormal = 0;
        let mut nonzero_tail = 0;
        for b in 0..(2.0 * SR) as usize / 128 {
            let mut l = vec![0.0f32; 128];
            let mut r = vec![0.0f32; 128];
            les.process(&mut l, &mut r);
            for v in l.iter().chain(&r) {
                subnormal += (*v != 0.0 && !v.is_normal()) as usize;
                nonzero_tail += (b * 128 > SR as usize && *v != 0.0) as usize;
            }
        }
        println!("leslie, 2 s of silence: {subnormal} subnormal outputs, {nonzero_tail} non-zero after 1 s");
        assert_eq!(subnormal, 0);
        assert_eq!(nonzero_tail, 0);
    }

    /// CPU cost of silence after a note (shows the subnormal penalty). Run
    /// with `cargo test --release leslie -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn bench_silence() {
        let mut les = Leslie::new(SR);
        les.set_speed(LeslieSpeed::Fast);
        run(&mut les, 0.5, 440.0);
        let (mut l, mut r) = (vec![0.0f32; 128], vec![0.0f32; 128]);
        for _ in 0..1000 {
            les.process(&mut l, &mut r);
        }
        let t0 = std::time::Instant::now();
        for _ in 0..(10.0 * SR) as usize / 128 {
            l.fill(0.0);
            r.fill(0.0);
            les.process(&mut l, &mut r);
        }
        let dt = t0.elapsed().as_secs_f64();
        println!("leslie, 10 s of silence after a note: {:.1} ms ({:.3} % of one core)", dt * 1e3, dt * 10.0);
    }

    /// A mix change right before a 1-frame block (the engine splits blocks
    /// at events) must still be ramped, not applied as a step.
    #[test]
    fn mix_change_in_one_frame_block_is_smooth() {
        let mut les = Leslie::new(SR);
        les.set_speed(LeslieSpeed::Fast);
        les.set_mix(0.0);
        run(&mut les, 0.5, 300.0);
        let x: Vec<f32> = (0..9600).map(|i| (TAU * 300.0 * i as f32 / SR).sin() * 0.5).collect();
        let (mut l, mut r) = (x.clone(), x.clone());
        les.process(&mut l[..1000], &mut r[..1000]);
        les.set_mix(1.0);
        les.process(&mut l[1000..1001], &mut r[1000..1001]);
        for (a, b) in l[1001..].chunks_mut(64).zip(r[1001..].chunks_mut(64)) {
            les.process(a, b);
        }
        let reference = max_step(&l[5000..]).max(max_step(&x));
        let step = max_step(&l[990..1100]);
        println!("leslie mix 0 -> 1 in a 1-frame block: max step {step:.4} (steady {reference:.4})");
        assert!(step < 1.5 * reference, "step {step} vs {reference}");
    }

    fn max_step(v: &[f32]) -> f32 {
        v.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0, f32::max)
    }

    #[test]
    fn extreme_sample_rates() {
        for sr in [22050.0f32, 192000.0] {
            let mut les = Leslie::new(sr);
            les.set_speed(LeslieSpeed::Fast);
            let mut l: Vec<f32> = (0..(sr as usize)).map(|i| (i as f32 * 0.03).sin()).collect();
            let mut r = l.clone();
            for (a, b) in l.chunks_mut(512).zip(r.chunks_mut(512)) {
                les.process(a, b);
            }
            assert!(l.iter().all(|v| v.is_finite()));
        }
    }
}
