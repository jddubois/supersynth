//! High-quality stereo algorithmic reverb (send effect, 100 % wet).
//!
//! # Structure
//!
//! ```text
//!  in L/R ─ HP 25 Hz ─┬─ predelay ─┬─ early reflections (18 taps / side, LP) ──────┐
//!                     │            └─ 4 allpass diffusers / side ─┐              │
//!                     │                                           ▼              ▼
//!                     │         ┌──── 16-line FDN (Hadamard) ◄── inject   late + early
//!                     │         │  per-line: modulated delay (cubic interp)        │
//!                     │         │            -> low shelf -> high shelf (absorption)│
//!                     │         └──── output taps (two orthogonal sign vectors) ────┤
//!                                                                     width, low/high cut
//! ```
//!
//! * **Late reverb**: a 16-line feedback delay network with an orthonormal
//!   16x16 Hadamard feedback matrix (fast Walsh-Hadamard transform, 64 adds).
//!   Line lengths are distinct primes spread over ~31–142 ms at `size = 1`
//!   (scaled by `0.3 + 0.7 * size`), so modal and echo densities are high and
//!   no two lines share periodicities.
//! * **Frequency-dependent decay** (Jot): each line `i` of length `m_i`
//!   samples carries an absorption filter whose magnitude is
//!   `10^(-3 m_i / (fs * RT60(f)))`. It is the cascade of a first-order low
//!   shelf (crossover 250 Hz, DC gain set by `decay * low_mult`) and a
//!   first-order high shelf (crossover 4 kHz, Nyquist gain set by
//!   `decay * high_mult`), with the mid-band gain folded in. The three
//!   log-gains are solved jointly so that DC, the 1 kHz reference and Nyquist
//!   hit their targets exactly (no shelf leakage into the mid band). Because
//!   the matrix is orthonormal and every line decays at the same rate *per
//!   second*, the measured RT60 tracks `decay` closely (tests: within 1 % at
//!   1 kHz; within 0.2 % broadband without modulation).
//! * **Modulation**: 8 of the 16 lines (alternating through the length range)
//!   are modulated by a slow sine whose rate (0.1–0.9 Hz base, re-randomized
//!   ±25 % every cycle) and amplitude are re-drawn each cycle, so there is no
//!   periodic pattern; depth is at most 0.5 ms (`modulation = 1`), i.e. a few
//!   cents of pitch deviation. Modulated (or gliding) lines are read with
//!   4-point Lagrange interpolation (< 0.1 dB loss below fs/8); the others use
//!   exact integer reads. The Hadamard matrix spreads every line into every
//!   other on each pass, so 8 modulated lines decorrelate the whole tail.
//!   The interpolator's loss near Nyquist makes content above ~12 kHz decay
//!   somewhat faster (the broadband, white-weighted T30 reads ~6 % short with
//!   modulation on); the RT at 1 kHz and up to ~10 kHz is unaffected.
//! * **Input diffusion**: four Schroeder allpasses per channel (distinct
//!   lengths L/R) before injection, so the FDN is fed with an already dense,
//!   decorrelated signal.
//! * **Early reflections**: 18 taps per side between 5 and 80 ms (scaled with
//!   `size`), density increasing with time, level ∝ distance^-0.6, mixed
//!   signs, 2/3 of taps from the same-side input, followed by a gentle 1-pole
//!   low-pass.
//! * **Stereo**: L and R are two orthogonal ±1 combinations of the 16 line
//!   outputs (decorrelated tails), then an energy-preserving width matrix.
//! * Wet tone: 2nd-order Butterworth low cut / high cut with gliding
//!   coefficients.
//!
//! # Level
//! The late level is partially normalized: at a fixed size, impulse-response
//! energy grows as `sqrt(decay)` instead of linearly. Since the stored energy
//! is also spread over longer lines in bigger rooms (energy ∝ RT / size, as in
//! Sabine's diffuse-field formula), all presets end up within ~2 dB of each
//! other (late IR energy ≈ -10 dB per input channel), so presets can be
//! swapped on a send without level jumps.
//!
//! # Parameter changes (`set_params`)
//! * `decay`, `low_mult`, `high_mult`: the absorption filters glide over
//!   100 ms (linear in dB per second, filters recomputed every 16 samples).
//!   Swapping them at once is audible: cathedral -> room changes the longest
//!   line's per-pass gain 0.87 -> 0.20 (-13 dB) within one sample, a step on
//!   the ringing tail (see `tests::decay_change_glides`).
//! * `predelay_ms`, `size` (early-reflection pattern): crossfaded over 50 ms
//!   between the old and new tap sets.
//! * `size` (FDN line lengths): delay lengths **glide** toward their new
//!   values at ≤ 0.03 samples/sample (≈ 50 cents of transient pitch bend on the
//!   decaying tail), so a full 0 → 1 size change settles over ~3–4 s. No
//!   clicks; call `reset()` for an instant change.
//! * `diffusion`, `early`, `width`, low/high cut: glide over 50 ms (timed in
//!   samples, independent of the block size); the late level (which follows
//!   `decay`) over 100 ms with the absorption; `modulation` one-pole, 100 ms.
//!
//! # Cost
//! All buffers are allocated in `new` (sized for the actual sample rate and
//! the maximum parameter ranges); `process` never allocates. Measured: 10 s
//! of stereo audio at 48 kHz in ~65 ms on an Apple M1 Max core (~0.65 %),
//! see `tests::calibration`.

use super::chorus::{flush_denormal, DelayBuf};
use super::eq::{SmoothStereoBiquad, COEFF_RAMP_S};
use super::{ParamRamp, StereoEffect};
use crate::dsp::biquad::{Biquad, Coeffs};
use crate::dsp::noise::Rng;
use std::f32::consts::{LN_10, TAU};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ReverbParams {
    /// RT60 at mid frequencies, seconds (0.2 .. 12)
    pub decay: f32,
    /// RT60 multiplier below ~250 Hz (0.5 .. 2.0)
    pub low_mult: f32,
    /// RT60 multiplier above ~4 kHz (0.1 .. 1.0)
    pub high_mult: f32,
    /// 0..1, scales delay lengths / early reflection spacing
    pub size: f32,
    /// 0 .. 250
    pub predelay_ms: f32,
    /// 0..1
    pub diffusion: f32,
    /// early reflections level 0..1
    pub early: f32,
    /// stereo width 0..1
    pub width: f32,
    /// wet high-pass (Hz); <= 10 Hz disables it
    pub low_cut_hz: f32,
    /// wet low-pass (Hz); >= 0.45 * sample rate (or <= 0) disables it
    pub high_cut_hz: f32,
    /// 0..1 (0 = none)
    pub modulation: f32,
}

impl Default for ReverbParams {
    fn default() -> Self {
        Self::preset("hall").unwrap()
    }
}

impl ReverbParams {
    /// Named presets: "room", "studio", "chamber", "hall", "concert-hall",
    /// "church", "cathedral", "plate". Case-insensitive; `_` and spaces are
    /// accepted in place of `-`.
    pub fn preset(name: &str) -> Option<ReverbParams> {
        let key: String = name
            .trim()
            .chars()
            .map(|c| if c == '_' || c == ' ' { '-' } else { c.to_ascii_lowercase() })
            .collect();
        #[allow(clippy::too_many_arguments)]
        let p = |decay, low_mult, high_mult, size, predelay_ms, diffusion, early, width, low_cut_hz, high_cut_hz, modulation| {
            Some(ReverbParams {
                decay,
                low_mult,
                high_mult,
                size,
                predelay_ms,
                diffusion,
                early,
                width,
                low_cut_hz,
                high_cut_hz,
                modulation,
            })
        };
        match key.as_str() {
            //               decay  lowx  highx size  pre   diff  early width lcut   hcut     mod
            "room" => p(0.6, 1.10, 0.55, 0.20, 3.0, 0.70, 0.60, 0.80, 80.0, 9000.0, 0.15),
            "studio" => p(0.9, 1.00, 0.60, 0.32, 8.0, 0.70, 0.50, 0.90, 90.0, 10000.0, 0.20),
            "chamber" => p(1.4, 1.10, 0.60, 0.45, 12.0, 0.80, 0.45, 0.90, 70.0, 9000.0, 0.25),
            "hall" => p(2.2, 1.30, 0.50, 0.70, 22.0, 0.75, 0.40, 1.00, 50.0, 8500.0, 0.25),
            "concert-hall" | "concerthall" => p(2.8, 1.35, 0.45, 0.80, 28.0, 0.80, 0.40, 1.00, 40.0, 8000.0, 0.25),
            "church" => p(4.0, 1.40, 0.40, 0.88, 35.0, 0.80, 0.45, 1.00, 40.0, 7000.0, 0.30),
            "cathedral" => p(7.0, 1.50, 0.35, 1.00, 55.0, 0.85, 0.35, 1.00, 35.0, 6000.0, 0.30),
            "plate" => p(1.8, 0.80, 0.80, 0.40, 10.0, 0.95, 0.00, 1.00, 100.0, 11000.0, 0.40),
            _ => None,
        }
    }

    fn sanitized(self) -> Self {
        let d = Self::preset("hall").unwrap();
        let f = |x: f32, def: f32, lo: f32, hi: f32| if x.is_finite() { x.clamp(lo, hi) } else { def };
        Self {
            decay: f(self.decay, d.decay, 0.2, 12.0),
            low_mult: f(self.low_mult, d.low_mult, 0.5, 2.0),
            high_mult: f(self.high_mult, d.high_mult, 0.1, 1.0),
            size: f(self.size, d.size, 0.0, 1.0),
            predelay_ms: f(self.predelay_ms, d.predelay_ms, 0.0, MAX_PREDELAY_MS),
            diffusion: f(self.diffusion, d.diffusion, 0.0, 1.0),
            early: f(self.early, d.early, 0.0, 1.0),
            width: f(self.width, d.width, 0.0, 1.0),
            low_cut_hz: f(self.low_cut_hz, 0.0, 0.0, 2000.0),
            high_cut_hz: f(self.high_cut_hz, 0.0, 0.0, 96000.0),
            modulation: f(self.modulation, d.modulation, 0.0, 1.0),
        }
    }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const N: usize = 16;
/// Control-rate period (samples): modulation / glide updates.
const SUB: usize = 16;
/// Early-reflection taps per channel.
const NT: usize = 18;
/// FDN line lengths at size = 1 (ms). Successive ratios 1.08–1.15, none
/// rational with small terms; converted to distinct primes per sample rate.
const LINE_MS: [f32; N] = [
    31.3, 35.9, 40.7, 45.1, 50.3, 55.7, 61.1, 67.3, 73.9, 80.3, 88.1, 96.7, 105.1, 115.3, 127.9, 141.7,
];
const MAX_PREDELAY_MS: f32 = 250.0;
const ER_MIN_MS: f32 = 5.0;
const ER_MAX_MS: f32 = 80.0;
const MAX_MOD_MS: f32 = 0.5;
/// Maximum glide speed of line lengths on `size` change (samples / sample).
const SIZE_SLEW: f32 = 0.03;
const LOW_XOVER_HZ: f32 = 250.0;
const HIGH_XOVER_HZ: f32 = 4000.0;
/// Frequency at which `decay` is realized exactly.
const MID_REF_HZ: f32 = 1000.0;
const INPUT_HP_HZ: f32 = 25.0;
const ER_LP_HZ: f32 = 7500.0;
const FADE_S: f32 = 0.05;
/// Glide time of the absorption filters (and late level) on decay changes.
const ABSORB_GLIDE_S: f32 = 0.1;
/// Input diffuser lengths (ms) and allpass coefficients at diffusion = 1.
const AP_MS: [[f32; 4]; 2] = [[4.13, 6.29, 9.71, 14.27], [4.61, 6.89, 10.57, 13.09]];
const AP_G: [f32; 4] = [0.72, 0.70, 0.64, 0.62];
/// Level calibration (see tests::calibration).
const LATE_NORM: f32 = 0.62;
const ER_NORM: f32 = 0.76;
/// Constant added to the reverb input: keeps every recursive state well above
/// the denormal range (it is ~-360 dBFS and removed by the wet tone filters).
const ANTI_DENORMAL: f32 = 1e-18;

#[inline]
fn size_scale(size: f32) -> f32 {
    0.3 + 0.7 * size
}

// `is_multiple_of` is avoided on purpose (keeps the crate building on older
// toolchains, e.g. distro rustc on the Pi).
#[allow(unknown_lints, clippy::manual_is_multiple_of)]
fn is_prime(n: usize) -> bool {
    if n < 2 {
        return false;
    }
    if n & 1 == 0 {
        return n == 2;
    }
    let mut d = 3;
    while d * d <= n {
        if n % d == 0 {
            return false;
        }
        d += 2;
    }
    true
}

/// Distinct prime line lengths (samples) for a size.
fn line_lengths(sr: f32, size: f32) -> [f32; N] {
    let scale = size_scale(size);
    let mut used = [0usize; N];
    let mut out = [0.0f32; N];
    for i in 0..N {
        let mut p = ((LINE_MS[i] * scale * 1e-3 * sr).round() as usize).max(17);
        while !is_prime(p) || used[..i].contains(&p) {
            p += 1;
        }
        used[i] = p;
        out[i] = p as f32;
    }
    out
}

/// In-place orthonormal 16-point fast Walsh-Hadamard transform.
#[inline(always)]
fn hadamard16(y: &mut [f32; N]) {
    let mut h = 1;
    while h < N {
        let mut i = 0;
        while i < N {
            for j in i..i + h {
                let a = y[j];
                let b = y[j + h];
                y[j] = a + b;
                y[j + h] = a - b;
            }
            i += 2 * h;
        }
        h *= 2;
    }
    for v in y.iter_mut() {
        *v *= 0.25;
    }
}

/// Sylvester Hadamard entry (row r, column c).
fn walsh(r: usize, c: usize) -> f32 {
    if (r & c).count_ones() & 1 == 0 {
        1.0
    } else {
        -1.0
    }
}

/// Schroeder allpass `H(z) = (z^-M - g) / (1 - g z^-M)`.
struct Allpass {
    buf: Vec<f32>,
    idx: usize,
}

impl Allpass {
    fn new(len: usize) -> Self {
        Self { buf: vec![0.0; len.max(1)], idx: 0 }
    }

    #[inline(always)]
    fn process(&mut self, x: f32, g: f32) -> f32 {
        let d = self.buf[self.idx];
        let v = x + g * d;
        self.buf[self.idx] = v;
        self.idx += 1;
        if self.idx == self.buf.len() {
            self.idx = 0;
        }
        d - g * v
    }

    fn clear(&mut self) {
        self.buf.iter_mut().for_each(|v| *v = 0.0);
    }
}

/// Predelay + early-reflection tap set (delays in samples, relative to the
/// newest input sample).
#[derive(Clone, Copy)]
struct TapConfig {
    pre: usize,
    er: [[usize; NT]; 2],
}

/// Per-line first-order shelving absorption filters (struct of arrays so the
/// per-sample loop vectorizes).
#[derive(Clone, Copy, Default)]
struct Absorb {
    ls_b0: [f32; N],
    ls_b1: [f32; N],
    ls_a1: [f32; N],
    hs_b0: [f32; N],
    hs_b1: [f32; N],
    hs_a1: [f32; N],
}

pub struct Reverb {
    sr: f32,
    params: ReverbParams,

    in_hp: [Biquad; 2],

    // Predelay / early reflections (shared buffer per input channel).
    pre: [DelayBuf; 2],
    cfg: [TapConfig; 2],
    cfg_cur: usize,
    fade_left: u32,
    fade_len: u32,
    pending: Option<TapConfig>,
    er_u: [[f32; NT]; 2],
    er_g: [[f32; NT]; 2],
    er_src: [[usize; NT]; 2],
    er_lp_a: f32,
    er_lp: [f32; 2],

    // Input diffusion.
    ap: [[Allpass; 4]; 2],

    // FDN.
    lines: [DelayBuf; N],
    len_target: [f32; N],
    len_cur: [f32; N],
    gliding: bool,
    pos: [f32; N],
    pos_tgt: [f32; N],
    dpos: [f32; N],
    /// Line is read at a constant integer delay this sub-block (fast path).
    int_read: [bool; N],
    int_d: [usize; N],
    lfo_phase: [f32; N],
    lfo_rate: [f32; N],
    lfo_amp: [f32; N],
    lfo_base: [f32; N],
    mod_depth: f32,
    mod_smooth: f32,
    rng: Rng,
    /// Decay rates (ln gain per sample) at mid / low / high frequencies,
    /// gliding at control rate.
    rate_k: [ParamRamp; 3],
    absorb: Absorb,
    ls_s: [f32; N],
    hs_s: [f32; N],
    k_ls: f32,
    k_hs: f32,
    /// Fractions of the low / high shelf log-gain present at the 1 kHz
    /// reference (used to make the mid-band RT exact).
    w_low_ref: f32,
    w_high_ref: f32,
    inj_l: [f32; N],
    inj_r: [f32; N],
    out_l: [f32; N],
    out_r: [f32; N],

    // Output stage: late gain, early gain, width a / b, diffusion.
    ramps: [ParamRamp; 5],
    tone_hp: SmoothStereoBiquad,
    tone_lp: SmoothStereoBiquad,
    ramp: u32,

    sub_left: usize,
}

impl Reverb {
    pub fn new(sample_rate: f32, params: ReverbParams) -> Self {
        let sr = sample_rate;
        let p = params.sanitized();
        let ms = sr * 1e-3;
        let mut rng = Rng::new(0x005E_ED2E_7E4B);

        // Buffers sized for the maximum parameter ranges at this sample rate.
        let pre_max = ((MAX_PREDELAY_MS + ER_MAX_MS * size_scale(1.0)) * ms) as usize + 8;
        let max_lines = line_lengths(sr, 1.0);
        let mod_max = MAX_MOD_MS * ms;
        let lines: [DelayBuf; N] =
            std::array::from_fn(|i| DelayBuf::new((max_lines[i] + mod_max) as usize + 8));
        let ap: [[Allpass; 4]; 2] =
            std::array::from_fn(|c| std::array::from_fn(|k| Allpass::new((AP_MS[c][k] * ms).round() as usize)));

        // Early-reflection pattern: positions in [0,1] with density increasing
        // over time, gains ~ distance^-0.6 with random spread and signs.
        let mut er_u = [[0.0; NT]; 2];
        let mut er_g = [[0.0; NT]; 2];
        let mut er_src = [[0usize; NT]; 2];
        for c in 0..2 {
            let mut e = 0.0;
            for k in 0..NT {
                let s = (k as f32 + 0.25 + 0.5 * rng.uniform()) / NT as f32;
                let u = s.powf(0.7);
                er_u[c][k] = u;
                let t = ER_MIN_MS + (ER_MAX_MS - ER_MIN_MS) * u;
                let sign = if k < 2 || rng.uniform() < 0.6 { 1.0 } else { -1.0 };
                let g = sign * (ER_MIN_MS / t).powf(0.6) * (0.65 + 0.35 * rng.uniform());
                er_g[c][k] = g;
                e += g * g;
                // 2/3 of the taps from the same side.
                er_src[c][k] = if k % 3 == 2 { 1 - c } else { c };
            }
            let norm = 1.0 / e.sqrt();
            er_g[c].iter_mut().for_each(|g| *g *= norm);
        }

        // Injection / output sign vectors: Walsh rows with a common random
        // sign flip per line (keeps mutual orthogonality, breaks structure).
        let flip: [f32; N] = std::array::from_fn(|_| if rng.uniform() < 0.5 { 1.0 } else { -1.0 });
        let inj_l = std::array::from_fn(|i| 0.5 * flip[i] * walsh(5, i));
        let inj_r = std::array::from_fn(|i| 0.5 * flip[i] * walsh(10, i));
        let out_l = std::array::from_fn(|i| 0.25 * flip[i] * walsh(3, i));
        let out_r = std::array::from_fn(|i| 0.25 * flip[i] * walsh(12, i));

        // LFO base rates: geometric 0.1 .. 0.9 Hz, shuffled across lines.
        let mut lfo_base: [f32; N] = std::array::from_fn(|i| 0.1 * 9f32.powf(i as f32 / (N - 1) as f32));
        for i in (1..N).rev() {
            let j = (rng.uniform() * (i + 1) as f32) as usize;
            lfo_base.swap(i, j.min(i));
        }
        let lfo_phase = std::array::from_fn(|_| rng.uniform());

        // Bilinear constants of the absorption shelves and their (warped)
        // normalized frequency at the mid reference.
        let pi = std::f32::consts::PI;
        let k_ls = 1.0 / (pi * LOW_XOVER_HZ / sr).tan();
        let k_hs = 1.0 / (pi * HIGH_XOVER_HZ.min(0.4 * sr) / sr).tan();
        let t_ref = (pi * MID_REF_HZ / sr).tan();
        let (tl, th) = (t_ref * k_ls, t_ref * k_hs);

        let hp = Biquad::new(Coeffs::high_pass(INPUT_HP_HZ, std::f32::consts::FRAC_1_SQRT_2, sr));
        let len = line_lengths(sr, p.size);
        let mut r = Self {
            sr,
            params: p,
            in_hp: [hp, hp],
            pre: [DelayBuf::new(pre_max), DelayBuf::new(pre_max)],
            cfg: [TapConfig { pre: 0, er: [[0; NT]; 2] }; 2],
            cfg_cur: 0,
            fade_left: 0,
            fade_len: ((FADE_S * sr) as u32).max(1),
            pending: None,
            er_u,
            er_g,
            er_src,
            er_lp_a: 1.0 - (-TAU * ER_LP_HZ.min(0.45 * sr) / sr).exp(),
            er_lp: [0.0; 2],
            ap,
            lines,
            len_target: len,
            len_cur: len,
            gliding: false,
            pos: len,
            pos_tgt: len,
            dpos: [0.0; N],
            int_read: [false; N],
            int_d: [0; N],
            lfo_phase,
            lfo_rate: lfo_base,
            lfo_amp: [1.0; N],
            lfo_base,
            mod_depth: p.modulation * MAX_MOD_MS * ms,
            mod_smooth: 1.0 - crate::dsp::one_pole_coeff(0.1, sr / SUB as f32),
            rng,
            rate_k: [ParamRamp::with_time(0.0, ABSORB_GLIDE_S, sr / SUB as f32); 3],
            absorb: Absorb::default(),
            ls_s: [0.0; N],
            hs_s: [0.0; N],
            k_ls,
            k_hs,
            w_low_ref: 1.0 / (1.0 + tl * tl),
            w_high_ref: th * th / (1.0 + th * th),
            inj_l,
            inj_r,
            out_l,
            out_r,
            ramps: [
                ParamRamp::with_time(0.0, ABSORB_GLIDE_S, sr),
                ParamRamp::with_time(0.0, FADE_S, sr),
                ParamRamp::with_time(0.0, FADE_S, sr),
                ParamRamp::with_time(0.0, FADE_S, sr),
                ParamRamp::with_time(0.0, FADE_S, sr),
            ],
            tone_hp: SmoothStereoBiquad::new(),
            tone_lp: SmoothStereoBiquad::new(),
            ramp: ((COEFF_RAMP_S * sr) as u32).max(1),
            sub_left: 0,
        };
        r.cfg[0] = r.tap_config(&p);
        r.cfg[1] = r.cfg[0];
        r.set_rate_targets();
        r.rate_k.iter_mut().for_each(ParamRamp::snap);
        r.update_absorption();
        let (hp, hp_on, lp, lp_on) = r.tone_coeffs(&p);
        r.tone_hp.snap(hp, hp_on);
        r.tone_lp.snap(lp, lp_on);
        r.set_ramp_targets();
        r.ramps.iter_mut().for_each(ParamRamp::snap);
        r
    }

    pub fn params(&self) -> ReverbParams {
        self.params
    }

    /// Update parameters; safe to call between any two blocks (see the module
    /// docs for how each parameter transitions).
    pub fn set_params(&mut self, p: ReverbParams) {
        let p = p.sanitized();
        let old = self.params;
        self.params = p;

        if p.size != old.size || p.predelay_ms != old.predelay_ms {
            let cfg = self.tap_config(&p);
            if self.fade_left == 0 {
                self.cfg[1 - self.cfg_cur] = cfg;
                self.fade_left = self.fade_len;
            } else {
                self.pending = Some(cfg);
            }
        }
        if p.size != old.size {
            self.len_target = line_lengths(self.sr, p.size);
            self.gliding = true;
        }
        if p.decay != old.decay || p.low_mult != old.low_mult || p.high_mult != old.high_mult {
            // Glides in `control`.
            self.set_rate_targets();
        }
        self.set_ramp_targets();
        if p.low_cut_hz != old.low_cut_hz || p.high_cut_hz != old.high_cut_hz {
            let (hp, hp_on, lp, lp_on) = self.tone_coeffs(&p);
            self.tone_hp.set_target(hp, hp_on, self.ramp);
            self.tone_lp.set_target(lp, lp_on, self.ramp);
        }
    }

    fn tap_config(&self, p: &ReverbParams) -> TapConfig {
        let ms = self.sr * 1e-3;
        let scale = size_scale(p.size);
        let pre = (p.predelay_ms * ms).round() as usize;
        let mut er = [[0usize; NT]; 2];
        for (c, row) in er.iter_mut().enumerate() {
            for (k, d) in row.iter_mut().enumerate() {
                let t = (ER_MIN_MS + (ER_MAX_MS - ER_MIN_MS) * self.er_u[c][k]) * scale;
                *d = pre + (t * ms).round() as usize;
            }
        }
        TapConfig { pre, er }
    }

    fn tone_coeffs(&self, p: &ReverbParams) -> (Coeffs, bool, Coeffs, bool) {
        let q = std::f32::consts::FRAC_1_SQRT_2;
        let nyq = 0.45 * self.sr;
        let hp_on = p.low_cut_hz > 10.0;
        let lp_on = p.high_cut_hz > 0.0 && p.high_cut_hz < nyq;
        (
            Coeffs::high_pass(p.low_cut_hz.clamp(10.0, nyq), q, self.sr),
            hp_on,
            Coeffs::low_pass(p.high_cut_hz.clamp(20.0, nyq), q, self.sr),
            lp_on,
        )
    }

    /// Targets of the output-stage ramps: late gain, early gain, width a / b,
    /// diffusion.
    fn set_ramp_targets(&mut self) {
        let p = self.params;
        let phi = (1.0 - p.width) * std::f32::consts::FRAC_PI_4;
        let tgt = [LATE_NORM * (2.0 / p.decay).powf(0.25), ER_NORM * p.early, phi.cos(), phi.sin(), p.diffusion];
        for (r, t) in self.ramps.iter_mut().zip(tgt) {
            r.set(t);
        }
    }

    /// Targets of the decay-rate glide (ln gain per sample at mid, low and
    /// high frequencies). Gliding these linearly glides the tail's dB/s.
    fn set_rate_targets(&mut self) {
        let p = self.params;
        let k = -3.0 * LN_10 / self.sr;
        let tgt = [k / p.decay, k / (p.decay * p.low_mult), k / (p.decay * p.high_mult)];
        for (r, t) in self.rate_k.iter_mut().zip(tgt) {
            r.set(t);
        }
    }

    /// Recompute the per-line absorption filters from `len_cur` (Jot):
    /// |H_i(f)| = 10^(-3 m_i / (fs RT60(f))).
    ///
    /// For small per-pass losses the log-magnitude of a first-order shelf with
    /// log-gain `e` is `e * w(f)`, with `w = 1/(1+W^2)` (low shelf) or
    /// `W^2/(1+W^2)` (high shelf), `W` the warped frequency over the corner.
    /// So `ln|H(f)| = c + a w_lo(f) + b w_hi(f)`. We solve for `c, a, b` such
    /// that DC, the 1 kHz reference and Nyquist hit their targets exactly,
    /// which removes the shelves' leakage into the mid band.
    fn update_absorption(&mut self) {
        let [km, kl, kh] = self.rate_k.map(|r| r.value());
        let (kls, khs) = (self.k_ls, self.k_hs);
        let (wl, wh) = (self.w_low_ref, self.w_high_ref);
        let inv = 1.0 / (1.0 - wl - wh);
        let a = &mut self.absorb;
        for i in 0..N {
            let m = self.len_cur[i];
            let (lm, ll, lh) = (km * m, kl * m, kh * m);
            let c = (lm - wl * ll - wh * lh) * inv;
            let gm = c.exp();
            // Low shelf, DC gain G = e^(ll - c), HF gain 1:
            //   H(s) = (s + sqrt G) / (s + 1/sqrt G), bilinear with K = cot(pi fc / fs).
            let sg = (0.5 * (ll - c)).exp();
            let (n0, n1) = (kls + sg, sg - kls);
            let (d0, d1) = (kls + 1.0 / sg, 1.0 / sg - kls);
            a.ls_b0[i] = gm * n0 / d0;
            a.ls_b1[i] = gm * n1 / d0;
            a.ls_a1[i] = d1 / d0;
            // High shelf, DC gain 1, Nyquist gain G = e^(lh - c):
            //   H(s) = (G s + sqrt G) / (s + sqrt G).
            let sg = (0.5 * (lh - c)).exp();
            let g = sg * sg;
            let (n0, n1) = (g * khs + sg, sg - g * khs);
            let (d0, d1) = (khs + sg, sg - khs);
            a.hs_b0[i] = n0 / d0;
            a.hs_b1[i] = n1 / d0;
            a.hs_a1[i] = d1 / d0;
        }
    }

    /// Control-rate update: size and decay glides, modulation targets.
    fn control(&mut self) {
        let mut absorb_dirty = false;
        if self.rate_k.iter().any(ParamRamp::is_moving) {
            self.rate_k.iter_mut().for_each(|r| {
                r.next();
            });
            absorb_dirty = true;
        }
        if self.gliding {
            let step = SIZE_SLEW * SUB as f32;
            let mut still = false;
            for i in 0..N {
                let d = self.len_target[i] - self.len_cur[i];
                if d.abs() <= step {
                    self.len_cur[i] = self.len_target[i];
                } else {
                    self.len_cur[i] += step.copysign(d);
                    still = true;
                }
            }
            self.gliding = still;
            absorb_dirty = true;
        }
        if absorb_dirty {
            self.update_absorption();
        }

        let target_depth = self.params.modulation * MAX_MOD_MS * self.sr * 1e-3;
        self.mod_depth += self.mod_smooth * (target_depth - self.mod_depth);
        let depth = self.mod_depth;
        let dt = SUB as f32 / self.sr;
        for i in 0..N {
            let mut ph = self.lfo_phase[i] + self.lfo_rate[i] * dt;
            if ph >= 1.0 {
                // New cycle: re-draw rate and amplitude (sin is 0 here, so the
                // amplitude change is continuous).
                ph -= 1.0;
                self.lfo_rate[i] = self.lfo_base[i] * (0.75 + 0.5 * self.rng.uniform());
                self.lfo_amp[i] = 0.6 + 0.4 * self.rng.uniform();
            }
            self.lfo_phase[i] = ph;
            let m = if i % 2 == 1 { depth * self.lfo_amp[i] * (TAU * ph).sin() } else { 0.0 };
            let tgt = (self.len_cur[i] + m).max(4.0);
            self.pos[i] = self.pos_tgt[i];
            self.pos_tgt[i] = tgt;
            self.dpos[i] = (tgt - self.pos[i]) * (1.0 / SUB as f32);
            self.int_read[i] = self.dpos[i] == 0.0 && tgt.fract() == 0.0;
            // delay d -> tap d - 1 (we read before writing)
            self.int_d[i] = tgt as usize - 1;
        }
    }

    #[inline(always)]
    fn er_sum(pre: &[DelayBuf; 2], d: &[usize; NT], g: &[f32; NT], src: &[usize; NT]) -> f32 {
        let mut s = 0.0;
        for k in 0..NT {
            s += g[k] * pre[src[k]].tap(d[k]);
        }
        s
    }

    /// Run `l.len()` (<= SUB) samples; input already high-passed.
    fn run(&mut self, l: &mut [f32], r: &mut [f32]) {
        let Self {
            pre,
            cfg,
            cfg_cur,
            fade_left,
            fade_len,
            pending,
            er_g,
            er_src,
            er_lp_a,
            er_lp,
            ap,
            lines,
            pos,
            dpos,
            int_read,
            int_d,
            absorb,
            ls_s,
            hs_s,
            inj_l,
            inj_r,
            out_l,
            out_r,
            ramps,
            ..
        } = self;
        let a = *absorb;
        let mut p = *pos;
        let dp = *dpos;
        let mut lss = *ls_s;
        let mut hss = *hs_s;
        let (er_a, mut er_state) = (*er_lp_a, *er_lp);
        let inv_fade = 1.0 / *fade_len as f32;

        for (xl, xr) in l.iter_mut().zip(r.iter_mut()) {
            let [late_g, er_gain, wa, wb, diff] = std::array::from_fn(|k| ramps[k].next());

            pre[0].push(*xl + ANTI_DENORMAL);
            pre[1].push(*xr + ANTI_DENORMAL);

            // Predelayed late input + early reflections (crossfading between
            // tap sets after predelay / size changes).
            let c0 = &cfg[*cfg_cur];
            let mut in_l = pre[0].tap(c0.pre);
            let mut in_r = pre[1].tap(c0.pre);
            let mut el = Self::er_sum(pre, &c0.er[0], &er_g[0], &er_src[0]);
            let mut erv = Self::er_sum(pre, &c0.er[1], &er_g[1], &er_src[1]);
            if *fade_left > 0 {
                let c1 = &cfg[1 - *cfg_cur];
                let f = 1.0 - *fade_left as f32 * inv_fade;
                in_l += f * (pre[0].tap(c1.pre) - in_l);
                in_r += f * (pre[1].tap(c1.pre) - in_r);
                el += f * (Self::er_sum(pre, &c1.er[0], &er_g[0], &er_src[0]) - el);
                erv += f * (Self::er_sum(pre, &c1.er[1], &er_g[1], &er_src[1]) - erv);
                *fade_left -= 1;
                if *fade_left == 0 {
                    *cfg_cur = 1 - *cfg_cur;
                    if let Some(next) = pending.take() {
                        cfg[1 - *cfg_cur] = next;
                        *fade_left = *fade_len;
                    }
                }
            }
            er_state[0] += er_a * (el - er_state[0]);
            er_state[1] += er_a * (erv - er_state[1]);

            // Input diffusion.
            let mut dl = in_l;
            let mut dr = in_r;
            for k in 0..4 {
                dl = ap[0][k].process(dl, diff * AP_G[k]);
                dr = ap[1][k].process(dr, diff * AP_G[k]);
            }

            // FDN: read (delay d -> tap d-1, since we read before writing).
            let mut y = [0.0f32; N];
            for i in 0..N {
                y[i] = if int_read[i] {
                    lines[i].tap(int_d[i])
                } else {
                    p[i] += dp[i];
                    lines[i].read_cubic(p[i] - 1.0)
                };
            }
            // Absorption: low shelf then high shelf (TDF-II, first order).
            for i in 0..N {
                let x = y[i];
                let o = a.ls_b0[i] * x + lss[i];
                lss[i] = a.ls_b1[i] * x - a.ls_a1[i] * o;
                let o2 = a.hs_b0[i] * o + hss[i];
                hss[i] = a.hs_b1[i] * o - a.hs_a1[i] * o2;
                y[i] = o2;
            }
            let mut ol = 0.0;
            let mut or = 0.0;
            for i in 0..N {
                ol += out_l[i] * y[i];
                or += out_r[i] * y[i];
            }
            hadamard16(&mut y);
            for i in 0..N {
                lines[i].push(y[i] + inj_l[i] * dl + inj_r[i] * dr);
            }

            let wl = late_g * ol + er_gain * er_state[0];
            let wr = late_g * or + er_gain * er_state[1];
            *xl = wa * wl + wb * wr;
            *xr = wb * wl + wa * wr;
        }

        *pos = p;
        for i in 0..N {
            lss[i] = flush_denormal(lss[i]);
            hss[i] = flush_denormal(hss[i]);
        }
        *ls_s = lss;
        *hs_s = hss;
        *er_lp = [flush_denormal(er_state[0]), flush_denormal(er_state[1])];
    }
}

impl StereoEffect for Reverb {
    fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        let n = left.len().min(right.len());
        if n == 0 {
            return;
        }
        let (left, right) = (&mut left[..n], &mut right[..n]);
        self.in_hp[0].process_block(left);
        self.in_hp[1].process_block(right);

        let mut i = 0;
        while i < n {
            if self.sub_left == 0 {
                self.control();
                self.sub_left = SUB;
            }
            let k = self.sub_left.min(n - i);
            self.run(&mut left[i..i + k], &mut right[i..i + k]);
            self.sub_left -= k;
            i += k;
        }

        self.tone_hp.process(left, right);
        self.tone_lp.process(left, right);
    }

    fn reset(&mut self) {
        for b in self.in_hp.iter_mut() {
            b.reset();
        }
        for b in self.pre.iter_mut() {
            b.clear();
        }
        if let Some(c) = self.pending.take() {
            self.cfg[self.cfg_cur] = c;
        } else if self.fade_left > 0 {
            self.cfg_cur = 1 - self.cfg_cur;
        }
        self.fade_left = 0;
        self.er_lp = [0.0; 2];
        for c in self.ap.iter_mut() {
            for a in c.iter_mut() {
                a.clear();
            }
        }
        for l in self.lines.iter_mut() {
            l.clear();
        }
        self.len_cur = self.len_target;
        self.gliding = false;
        self.rate_k.iter_mut().for_each(ParamRamp::snap);
        self.update_absorption();
        self.pos = self.len_cur;
        self.pos_tgt = self.len_cur;
        self.dpos = [0.0; N];
        self.int_read = [false; N];
        self.sub_left = 0;
        self.ls_s = [0.0; N];
        self.hs_s = [0.0; N];
        self.tone_hp.reset();
        self.tone_lp.reset();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48000.0;

    fn flat(decay: f32, size: f32) -> ReverbParams {
        ReverbParams {
            decay,
            low_mult: 1.0,
            high_mult: 1.0,
            size,
            predelay_ms: 10.0,
            diffusion: 0.75,
            early: 0.0,
            width: 1.0,
            low_cut_hz: 0.0,
            high_cut_hz: 0.0,
            modulation: 0.3,
        }
    }

    /// Stereo impulse response (unit impulse on both inputs).
    fn impulse_response(sr: f32, p: ReverbParams, secs: f32) -> (Vec<f32>, Vec<f32>) {
        let mut rev = Reverb::new(sr, p);
        let n = (secs * sr) as usize;
        let mut l = vec![0.0f32; n];
        let mut r = vec![0.0f32; n];
        l[0] = 1.0;
        r[0] = 1.0;
        for (a, b) in l.chunks_mut(MAX_BLOCK_TEST).zip(r.chunks_mut(MAX_BLOCK_TEST)) {
            rev.process(a, b);
        }
        (l, r)
    }

    const MAX_BLOCK_TEST: usize = 256;

    /// RT60 from the Schroeder backward-integrated energy decay curve, by a
    /// least-squares fit over -5 .. -35 dB (T30).
    fn schroeder_rt60(e: &[f64], sr: f32) -> f32 {
        let mut edc = vec![0.0f64; e.len()];
        let mut acc = 0.0;
        for i in (0..e.len()).rev() {
            acc += e[i];
            edc[i] = acc;
        }
        let total = edc[0];
        let db: Vec<f64> = edc.iter().map(|v| 10.0 * (v / total).max(1e-30).log10()).collect();
        let start = db.iter().position(|&v| v <= -5.0).unwrap();
        let end = db.iter().position(|&v| v <= -35.0).expect("IR too short for T30");
        let (mut sx, mut sy, mut sxx, mut sxy) = (0.0, 0.0, 0.0, 0.0);
        let cnt = (end - start) as f64;
        for (i, &v) in db.iter().enumerate().take(end).skip(start) {
            let t = i as f64 / sr as f64;
            sx += t;
            sy += v;
            sxx += t * t;
            sxy += t * v;
        }
        let slope = (cnt * sxy - sx * sy) / (cnt * sxx - sx * sx);
        (-60.0 / slope) as f32
    }

    fn energy(l: &[f32], r: &[f32]) -> Vec<f64> {
        l.iter().zip(r).map(|(a, b)| (*a as f64).powi(2) + (*b as f64).powi(2)).collect()
    }

    /// Band-limit an IR around `f` with a band-pass (Q = 1.4, ~1 octave).
    fn band(x: &[f32], f: f32, sr: f32) -> Vec<f32> {
        let mut bq = Biquad::new(Coeffs::band_pass(f, 1.4, sr));
        let mut y = x.to_vec();
        bq.process_block(&mut y);
        y
    }

    #[test]
    fn rt60_broadband_matches_decay() {
        for &(decay, size, sr) in &[(1.0f32, 0.3f32, SR), (2.2, 0.7, SR), (4.0, 0.9, 44100.0), (8.0, 1.0, SR)] {
            let (l, r) = impulse_response(sr, flat(decay, size), decay * 0.8 + 0.5);
            let rt = schroeder_rt60(&energy(&l, &r), sr);
            println!("broadband: decay {decay} s size {size} sr {sr}: measured RT60 {rt:.3} s ({:+.1} %)", 100.0 * (rt / decay - 1.0));
            assert!((rt / decay - 1.0).abs() < 0.2, "decay {decay}: measured {rt}");
        }
    }

    #[test]
    fn rt60_frequency_dependent() {
        // Hall-like: low x1.5, high x0.4. Check the mid band (1 kHz) matches
        // `decay`, the low band is longer and the high band shorter.
        let p = ReverbParams { low_mult: 1.5, high_mult: 0.4, ..flat(3.0, 0.8) };
        let (l, r) = impulse_response(SR, p, 4.5);
        let rt_at = |f: f32| schroeder_rt60(&energy(&band(&l, f, SR), &band(&r, f, SR)), SR);
        let (lo, mid, hi) = (rt_at(80.0), rt_at(1000.0), rt_at(10000.0));
        println!("3-band: target low 4.5 / mid 3.0 / high 1.2 s -> measured {lo:.3} / {mid:.3} / {hi:.3} s");
        assert!((mid / 3.0 - 1.0).abs() < 0.2, "mid {mid}");
        assert!((lo / 4.5 - 1.0).abs() < 0.2, "low {lo}");
        assert!((hi / 1.2 - 1.0).abs() < 0.25, "high {hi}");
    }

    #[test]
    fn presets_exist_and_have_sensible_rt() {
        for name in ["room", "studio", "chamber", "hall", "concert-hall", "church", "cathedral", "plate"] {
            let p = ReverbParams::preset(name).unwrap();
            assert_eq!(p, p.sanitized(), "{name} out of range");
        }
        assert!(ReverbParams::preset("Concert_Hall").is_some());
        assert!(ReverbParams::preset("bogus").is_none());
        let c = ReverbParams::preset("cathedral").unwrap().decay;
        assert!((6.0..=8.0).contains(&c));
    }

    #[test]
    fn tail_is_decorrelated() {
        let (l, r) = impulse_response(SR, flat(2.0, 0.7), 1.2);
        let (a, b) = ((0.2 * SR) as usize, (1.0 * SR) as usize);
        let (mut sxy, mut sxx, mut syy) = (0.0f64, 0.0f64, 0.0f64);
        for i in a..b {
            let (x, y) = (l[i] as f64, r[i] as f64);
            sxy += x * y;
            sxx += x * x;
            syy += y * y;
        }
        let corr = sxy / (sxx * syy).sqrt();
        println!("L/R tail correlation: {corr:.3}");
        assert!(corr.abs() < 0.5, "corr {corr}");
        // Width 0 -> mono.
        let (l, r) = impulse_response(SR, ReverbParams { width: 0.0, ..flat(1.0, 0.5) }, 0.5);
        assert!(l.iter().zip(&r).all(|(a, b)| (a - b).abs() < 1e-6));
    }

    /// A dense, non-grainy tail behaves like exponentially decaying Gaussian
    /// noise: 5 ms window energies scatter around the fitted decay by ~0.5 dB.
    /// Sparse echoes, flutter or ringing modes show up as much larger scatter.
    #[test]
    fn tail_is_dense_and_smooth() {
        for name in ["room", "hall", "cathedral"] {
            let p = ReverbParams {
                early: 0.0,
                low_cut_hz: 0.0,
                high_cut_hz: 0.0,
                // single-slope decay so the linear fit is exact
                low_mult: 1.0,
                high_mult: 1.0,
                ..ReverbParams::preset(name).unwrap()
            };
            let secs = (p.decay * 0.5).max(0.4) + 0.15;
            let (l, r) = impulse_response(SR, p, secs + 0.1);
            let win = (0.005 * SR) as usize;
            let start = ((p.predelay_ms * 1e-3 + 0.1) * SR) as usize;
            let end = start + ((secs - 0.15) * SR) as usize;
            let db: Vec<(f64, f64)> = (start..end - win)
                .step_by(win)
                .map(|i| {
                    let e: f64 = (i..i + win).map(|k| (l[k] as f64).powi(2) + (r[k] as f64).powi(2)).sum();
                    (i as f64 / SR as f64, 10.0 * e.log10())
                })
                .collect();
            let n = db.len() as f64;
            let (sx, sy) = db.iter().fold((0.0, 0.0), |a, v| (a.0 + v.0, a.1 + v.1));
            let (mx, my) = (sx / n, sy / n);
            let slope = db.iter().map(|v| (v.0 - mx) * (v.1 - my)).sum::<f64>()
                / db.iter().map(|v| (v.0 - mx).powi(2)).sum::<f64>();
            let resid = (db.iter().map(|v| (v.1 - my - slope * (v.0 - mx)).powi(2)).sum::<f64>() / n).sqrt();
            println!("{name}: tail energy scatter around decay fit {resid:.2} dB (5 ms windows)");
            assert!(resid < 0.8, "{name}: grainy/fluttery tail, scatter {resid} dB");
        }
    }

    #[test]
    fn long_silence_stays_finite_and_quiet() {
        let mut rev = Reverb::new(SR, ReverbParams::preset("cathedral").unwrap());
        let mut l = vec![0.0f32; 512];
        let mut r = vec![0.0f32; 512];
        l[0] = 1.0;
        rev.process(&mut l, &mut r);
        let blocks = (60.0 * SR / 512.0) as usize;
        let mut last_peak = 0.0f32;
        for _ in 0..blocks {
            l.iter_mut().for_each(|v| *v = 0.0);
            r.iter_mut().for_each(|v| *v = 0.0);
            rev.process(&mut l, &mut r);
            assert!(l.iter().chain(&r).all(|v| v.is_finite()));
            last_peak = l.iter().chain(&r).fold(0.0, |m, v| m.max(v.abs()));
        }
        assert!(last_peak < 1e-6, "peak after 60 s: {last_peak}");
    }

    #[test]
    fn stable_at_max_decay_with_param_changes() {
        let p = ReverbParams {
            decay: 12.0,
            low_mult: 2.0,
            high_mult: 1.0,
            size: 1.0,
            predelay_ms: 250.0,
            diffusion: 1.0,
            early: 1.0,
            width: 1.0,
            low_cut_hz: 0.0,
            high_cut_hz: 0.0,
            modulation: 1.0,
        };
        let mut rev = Reverb::new(SR, p);
        let mut rng = Rng::new(3);
        let mut win = Vec::new();
        let blk = 480;
        for b in 0..(30.0 * SR) as usize / blk {
            let t = b as f32 * blk as f32 / SR;
            let mut l: Vec<f32> = (0..blk).map(|_| if t < 2.0 { rng.gauss() * 0.3 } else { 0.0 }).collect();
            let mut r: Vec<f32> = (0..blk).map(|_| if t < 2.0 { rng.gauss() * 0.3 } else { 0.0 }).collect();
            // Wiggle parameters while noise is playing.
            if t < 2.0 && b % 20 == 0 {
                let s = (b as f32 * 0.1).sin() * 0.5 + 0.5;
                rev.set_params(ReverbParams { size: s, predelay_ms: 250.0 * s, diffusion: s, ..p });
            }
            if b == (2.0 * SR) as usize / blk {
                rev.set_params(p);
            }
            rev.process(&mut l, &mut r);
            assert!(l.iter().chain(&r).all(|v| v.is_finite() && v.abs() < 100.0));
            win.push(l.iter().chain(&r).map(|v| (*v as f64).powi(2)).sum::<f64>());
        }
        // After the input stops (+ glide settling), energy per second must
        // decrease monotonically.
        let per_s: Vec<f64> = win.chunks(100).map(|c| c.iter().sum()).collect();
        for k in 8..per_s.len() - 1 {
            assert!(per_s[k + 1] < per_s[k], "energy grew at {k} s: {:?}", &per_s[k..k + 2]);
        }
    }

    #[test]
    fn all_sample_rates_and_presets_work() {
        for sr in [22050.0f32, 44100.0, 96000.0, 192000.0] {
            for name in ["room", "cathedral", "plate"] {
                let (l, r) = impulse_response(sr, ReverbParams::preset(name).unwrap(), 0.3);
                assert!(l.iter().chain(&r).all(|v| v.is_finite()));
                assert!(l.iter().any(|v| v.abs() > 1e-4));
            }
        }
    }

    #[test]
    fn parameter_changes_do_not_click() {
        // Steady noise into the reverb, jump predelay / size / early / width /
        // cuts every 100 ms; the output must not contain spikes much larger
        // than its running RMS.
        let mut rev = Reverb::new(SR, ReverbParams::preset("hall").unwrap());
        let mut rng = Rng::new(9);
        let blk = 256;
        let mut out = Vec::new();
        for b in 0..(4.0 * SR) as usize / blk {
            if b % 19 == 0 && b > 0 {
                let k = (b / 19) % 3;
                let name = ["room", "cathedral", "plate"][k];
                rev.set_params(ReverbParams::preset(name).unwrap());
            }
            let mut l: Vec<f32> = (0..blk).map(|_| rng.gauss() * 0.1).collect();
            let mut r: Vec<f32> = (0..blk).map(|_| rng.gauss() * 0.1).collect();
            rev.process(&mut l, &mut r);
            out.extend_from_slice(&l);
        }
        let rms = (out.iter().map(|v| v * v).sum::<f32>() / out.len() as f32).sqrt();
        let peak = out.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        println!("param-change test: rms {rms:.4}, peak {peak:.4}, crest {:.1}", peak / rms);
        assert!(peak / rms < 8.0);
    }

    /// Switching decay (cathedral 7 s -> room 0.6 s) on a ringing tail must
    /// not step the tail level. Two identical reverbs, only one switched; the
    /// level ratio between them may only change gradually.
    #[test]
    fn decay_change_glides() {
        let cath = ReverbParams::preset("cathedral").unwrap();
        let room = ReverbParams::preset("room").unwrap();
        for (what, to) in [
            ("decay/low/high", ReverbParams { decay: room.decay, low_mult: room.low_mult, high_mult: room.high_mult, ..cath }),
            ("full preset", room),
        ] {
            let mut a = Reverb::new(SR, cath);
            let mut b = Reverb::new(SR, cath);
            let mut rng = Rng::new(5);
            let blk = 64;
            let switch = (3.2 * SR) as usize / blk;
            let win = (0.001 * SR) as usize; // 1 ms
            let (mut ea, mut eb) = (Vec::new(), Vec::new());
            for k in 0..switch + (0.2 * SR) as usize / blk {
                let noise = k * blk < (3.0 * SR) as usize;
                let mut l: Vec<f32> = (0..blk).map(|_| if noise { rng.gauss() * 0.1 } else { 0.0 }).collect();
                let mut r = l.clone();
                let (mut l2, mut r2) = (l.clone(), r.clone());
                if k == switch {
                    a.set_params(to);
                }
                a.process(&mut l, &mut r);
                b.process(&mut l2, &mut r2);
                if k >= switch {
                    ea.extend(l.iter().zip(&r).map(|(x, y)| (x * x + y * y) as f64));
                    eb.extend(l2.iter().zip(&r2).map(|(x, y)| (x * x + y * y) as f64));
                }
            }
            // Level ratio over the first 2 ms after the switch (before the two
            // tails diverge into different noise), and over the next 200 ms.
            let ratio_db = |a: &[f64], b: &[f64]| 10.0 * (a.iter().sum::<f64>() / b.iter().sum::<f64>()).log10();
            let step = ratio_db(&ea[..2 * win], &eb[..2 * win]);
            let later = ratio_db(&ea[150 * win..], &eb[150 * win..]);
            println!("{what} switch on a cathedral tail: level step {step:+.2} dB in the first 2 ms ({later:+.1} dB after 150 ms)");
            assert!(step.abs() < 0.3, "{what}: tail level stepped by {step:.2} dB");
            assert!(later < -6.0, "{what}: decay change not effective");
        }
    }

    /// Level calibration + CPU cost. Run with
    /// `cargo test --release reverb::tests::calibration -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn calibration() {
        for name in ["room", "studio", "chamber", "hall", "concert-hall", "church", "cathedral", "plate"] {
            let p = ReverbParams::preset(name).unwrap();
            let (l, r) = impulse_response(SR, ReverbParams { early: 0.0, ..p }, p.decay * 1.5 + 0.5);
            let late: f64 = l.iter().map(|v| (*v as f64).powi(2)).sum();
            let (l2, _) = impulse_response(SR, ReverbParams { early: 1.0, decay: 0.2, ..p }, 0.15);
            let (l3, _) = impulse_response(SR, ReverbParams { early: 0.0, decay: 0.2, ..p }, 0.15);
            let er: f64 = l2.iter().zip(&l3).map(|(a, b)| ((a - b) as f64).powi(2)).sum();
            let _ = r;
            println!("{name:>13}: late IR energy {:+.1} dB, ER (early=1) energy {:+.1} dB", 10.0 * late.log10(), 10.0 * er.log10());
        }
        bench(SR, "hall");
        bench(SR, "cathedral");
    }

    fn bench(sr: f32, name: &str) {
        let mut rev = Reverb::new(sr, ReverbParams::preset(name).unwrap());
        let mut rng = Rng::new(1);
        let blk = 128;
        let input: Vec<f32> = (0..blk).map(|_| rng.gauss() * 0.1).collect();
        let n_blocks = (10.0 * sr) as usize / blk;
        let mut l = vec![0.0; blk];
        let mut r = vec![0.0; blk];
        // Best of 5 runs (robust against other load on the machine).
        let mut dt = f64::MAX;
        for _ in 0..5 {
            let t0 = std::time::Instant::now();
            for _ in 0..n_blocks {
                l.copy_from_slice(&input);
                r.copy_from_slice(&input);
                rev.process(&mut l, &mut r);
            }
            dt = dt.min(t0.elapsed().as_secs_f64());
        }
        println!("CPU {name} @ {sr} Hz: 10 s of stereo audio in {:.1} ms ({:.2} % of one core)", dt * 1e3, dt * 10.0);
    }
}
