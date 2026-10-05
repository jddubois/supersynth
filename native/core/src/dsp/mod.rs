//! Low-level DSP building blocks shared by voices and effects.

pub mod biquad;
pub mod denormal;
pub mod fft;
pub mod noise;
pub mod simd;

/// Processing block size (frames). Parameters are updated once per block and
/// ramped linearly across it; events are split to sample accuracy.
pub const BLOCK: usize = 64;

#[inline]
pub fn db_to_amp(db: f32) -> f32 {
    if db <= -150.0 {
        0.0
    } else {
        (db * (std::f32::consts::LN_10 / 20.0)).exp()
    }
}

#[inline]
pub fn amp_to_db(a: f32) -> f32 {
    if a <= 1e-8 {
        -160.0
    } else {
        20.0 * a.log10()
    }
}

#[inline]
pub fn midi_to_hz(note: f32) -> f32 {
    440.0 * ((note - 69.0) / 12.0).exp2()
}

#[inline]
pub fn cents_to_ratio(c: f32) -> f32 {
    (c / 1200.0).exp2()
}

/// Equal-power pan law. `pan` in [-1, 1]; returns (left, right) gains.
#[inline]
pub fn pan_gains(pan: f32) -> (f32, f32) {
    let p = (pan.clamp(-1.0, 1.0) + 1.0) * std::f32::consts::FRAC_PI_4;
    (p.cos(), p.sin())
}

/// One-pole smoothing coefficient for a time constant in seconds.
#[inline]
pub fn one_pole_coeff(tau_s: f32, sample_rate: f32) -> f32 {
    if tau_s <= 0.0 {
        0.0
    } else {
        (-1.0 / (tau_s * sample_rate)).exp()
    }
}
