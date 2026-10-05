//! Stereo, block-based effects.
//!
//! All effects process planar stereo blocks in place. Block length is at most
//! `MAX_BLOCK` frames. Effects must never allocate in `process`.

pub mod chorus;
pub mod drive;
pub mod eq;
pub mod leslie;
pub mod limiter;
pub mod reverb;

pub const MAX_BLOCK: usize = 512;

pub trait StereoEffect: Send {
    /// Process a stereo block in place. `left.len() == right.len() <= MAX_BLOCK`.
    fn process(&mut self, left: &mut [f32], right: &mut [f32]);
    /// Clear all internal state (delay lines, envelopes).
    fn reset(&mut self);
}

/// Default glide time of smoothed scalar parameters (gains, mix, width ...).
pub(crate) const PARAM_RAMP_S: f32 = 0.02;

/// Linear parameter ramp over a fixed number of samples.
///
/// Ramps are timed in samples, not per `process` call: the engine splits
/// blocks at event boundaries (down to a single frame), so a per-block ramp
/// can degenerate into an instant step. A new target restarts the ramp from
/// the current value.
#[derive(Clone, Copy, Debug)]
pub(crate) struct ParamRamp {
    cur: f32,
    target: f32,
    step: f32,
    left: u32,
    len: u32,
}

impl ParamRamp {
    pub(crate) fn new(value: f32, len: u32) -> Self {
        Self { cur: value, target: value, step: 0.0, left: 0, len: len.max(1) }
    }

    /// A ramp of `secs` seconds at `sample_rate` (or at a control rate).
    pub(crate) fn with_time(value: f32, secs: f32, sample_rate: f32) -> Self {
        Self::new(value, (secs * sample_rate).round() as u32)
    }

    pub(crate) fn set(&mut self, target: f32) {
        if target != self.target {
            self.target = target;
            self.left = self.len;
            self.step = (target - self.cur) / self.len as f32;
        }
    }

    /// Jump to the target.
    pub(crate) fn snap(&mut self) {
        self.cur = self.target;
        self.left = 0;
    }

    /// Advance one sample and return the new value.
    #[inline(always)]
    pub(crate) fn next(&mut self) -> f32 {
        if self.left > 0 {
            self.left -= 1;
            self.cur = if self.left == 0 { self.target } else { self.cur + self.step };
        }
        self.cur
    }

    #[inline(always)]
    pub(crate) fn value(&self) -> f32 {
        self.cur
    }

    #[inline(always)]
    pub(crate) fn is_moving(&self) -> bool {
        self.left > 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ramp_is_timed_in_samples_not_calls() {
        let mut r = ParamRamp::new(0.0, 100);
        r.set(1.0);
        let v: Vec<f32> = (0..100).map(|_| r.next()).collect();
        assert!((v[0] - 0.01).abs() < 1e-6 && (v[49] - 0.5).abs() < 1e-5);
        assert_eq!(v[99], 1.0);
        assert!(!r.is_moving());
        // Retarget mid-ramp: continues from the current value.
        r.set(0.0);
        r.next();
        r.set(2.0);
        let a = r.value();
        assert!((r.next() - (a + (2.0 - a) / 100.0)).abs() < 1e-6);
    }
}
