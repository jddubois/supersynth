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
//! * Two virtual microphones (left / right, 135° apart around the cabinet).
//!   For each mic the path length to the rotating source is modelled as a
//!   modulated delay `D - R cos(phi - theta_mic)` read with cubic
//!   interpolation (Doppler), combined with directivity amplitude modulation
//!   and, for the horn, a directivity low-pass that closes when the horn mouth
//!   faces away from the mic.
//! * The horn also reaches each mic via a cabinet reflection (opposite side,
//!   longer path, attenuated) which gives the characteristic complex,
//!   "swirling" phase pattern instead of a plain vibrato.
//!
//! Rotor phases advance at audio rate, delay / gain / filter targets are
//! computed every 16 samples and ramped linearly in between.

use super::chorus::DelayBuf;
use super::StereoEffect;
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
/// Mic angles (radians) around the cabinet.
const MIC_THETA: [f32; 2] = [-0.375 * PI, 0.375 * PI];

#[derive(Clone, Copy)]
struct RotorSpec {
    slow_hz: f32,
    fast_hz: f32,
    accel_tau_s: f32,
    decel_tau_s: f32,
    /// Static mic distance (ms) and rotation radius (ms of path length).
    base_ms: f32,
    radius_ms: f32,
    /// Amplitude modulation depth (0..1).
    am_depth: f32,
}

const HORN: RotorSpec = RotorSpec {
    slow_hz: 0.80,
    fast_hz: 6.75,
    accel_tau_s: 0.45,
    decel_tau_s: 0.65,
    base_ms: 1.2,
    radius_ms: 0.50,
    am_depth: 0.55,
};

const DRUM: RotorSpec = RotorSpec {
    slow_hz: 0.66,
    fast_hz: 5.90,
    accel_tau_s: 2.2,
    decel_tau_s: 1.8,
    base_ms: 1.2,
    radius_ms: 0.28,
    am_depth: 0.3,
};

/// Horn cabinet reflection: extra path (ms) and gain.
const REFL_MS: f32 = 1.35;
const REFL_GAIN: f32 = 0.32;
/// Horn directivity low-pass corner when facing toward / away from the mic.
const HORN_LP_OPEN_HZ: f32 = 16000.0;
const HORN_LP_CLOSED_HZ: f32 = 3500.0;
/// Output gain normalization.
const OUT_GAIN: f32 = 1.0;

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
    /// Per mic: horn direct delay, horn reflection delay, drum delay (samples).
    horn_d: [Ramp; 2],
    refl_d: [Ramp; 2],
    drum_d: [Ramp; 2],
    /// Per mic gains and horn LP coefficient.
    horn_g: [Ramp; 2],
    refl_g: [Ramp; 2],
    drum_g: [Ramp; 2],
    horn_lp_a: [Ramp; 2],
    horn_lp: [f32; 2],
    lp_open: f32,
    lp_closed: f32,
    mix: f32,
    mix_target: f32,
    sub_left: usize,
}

impl Leslie {
    pub fn new(sample_rate: f32) -> Self {
        let sr = sample_rate;
        let q = std::f32::consts::FRAC_1_SQRT_2;
        let lp = Biquad::new(Coeffs::low_pass(CROSSOVER_HZ, q, sr));
        let hp = Biquad::new(Coeffs::high_pass(CROSSOVER_HZ, q, sr));
        let max_ms = HORN.base_ms + HORN.radius_ms + REFL_MS + 1.0;
        let max = (max_ms * 1e-3 * sr) as usize + 8;
        let onepole = |hz: f32| 1.0 - (-TAU * hz.min(0.45 * sr) / sr).exp();
        let mut l = Self {
            sr,
            xo_lp: [lp, lp],
            xo_hp: [hp, hp],
            horn: Rotor::new(HORN, sr, 0.0),
            drum: Rotor::new(DRUM, sr, 0.37),
            horn_buf: DelayBuf::new(max),
            drum_buf: DelayBuf::new(max),
            horn_d: [Ramp::default(); 2],
            refl_d: [Ramp::default(); 2],
            drum_d: [Ramp::default(); 2],
            horn_g: [Ramp::default(); 2],
            refl_g: [Ramp::default(); 2],
            drum_g: [Ramp::default(); 2],
            horn_lp_a: [Ramp::default(); 2],
            horn_lp: [0.0; 2],
            lp_open: onepole(HORN_LP_OPEN_HZ),
            lp_closed: onepole(HORN_LP_CLOSED_HZ),
            mix: 1.0,
            mix_target: 1.0,
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
        self.mix_target = if mix.is_finite() { mix.clamp(0.0, 1.0) } else { 1.0 };
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
            .chain(self.horn_g.iter_mut())
            .chain(self.refl_g.iter_mut())
            .chain(self.drum_g.iter_mut())
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
        for (m, theta) in MIC_THETA.iter().enumerate() {
            let ch = (ph - theta).cos(); // +1: horn mouth faces the mic
            let cd = (pd - theta).cos();
            // Doppler: path shortens as the source points toward the mic.
            self.horn_d[m].set((HORN.base_ms - HORN.radius_ms * ch) * ms);
            self.refl_d[m].set((HORN.base_ms + REFL_MS + HORN.radius_ms * ch) * ms);
            self.drum_d[m].set((DRUM.base_ms - DRUM.radius_ms * cd) * ms);
            // Directivity AM.
            let toward = 0.5 * (1.0 + ch);
            self.horn_g[m].set(1.0 - HORN.am_depth * (1.0 - toward));
            self.refl_g[m].set(REFL_GAIN * (1.0 - HORN.am_depth * toward));
            self.drum_g[m].set(1.0 - DRUM.am_depth * 0.5 * (1.0 - cd));
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
        let dmix = (self.mix_target - self.mix) / n as f32;
        let mut mix = self.mix;
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
                    *o = OUT_GAIN
                        * (self.horn_lp[m] * self.horn_g[m].tick()
                            + refl * self.refl_g[m].tick()
                            + drum * self.drum_g[m].tick());
                }
                mix += dmix;
                left[j] = dl + mix * (out[0] - dl);
                right[j] = dr + mix * (out[1] - dr);
            }
            self.sub_left -= k;
            i += k;
        }
        self.mix = self.mix_target;
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
        let mut a = vec![0.1; 64];
        let mut b = vec![0.1; 64];
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
