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
