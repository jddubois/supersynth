//! supersynth-core — real-time synthesis of real instruments from spectral models.
//!
//! - [`model`]: spectral instrument models (analysed from real recordings)
//! - [`voice`]: the additive/noise resynthesis voice and pooled noise
//! - [`engine`]: lock-free command queue, scheduling, parts, mixing
//! - [`fx`]: stereo effects (reverb, EQ, chorus, drive, rotary, limiter)
//! - [`thread`]: starting threads, natively and in WebAssembly

pub mod dsp;
pub mod engine;
pub mod fx;
pub mod model;
pub mod thread;
pub mod voice;
