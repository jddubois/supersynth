//! Run-time choice of the instruction set for the hot loops.
//!
//! The voice code is written as plain loops over arrays that the compiler vectorises: with
//! the baseline instruction set of each target (SSE2 on x86-64, NEON on AArch64) and, on
//! x86-64 CPUs that have it, a second copy compiled for AVX2 (8 lanes instead of 4, and
//! single-instruction rounding). Both copies perform the same IEEE operations in the same
//! order — no fused multiply-adds, no reassociation — so their output is bit-identical; only
//! the speed differs.
//!
//! `SUPERSYNTH_SIMD=baseline` in the environment (read when an engine is created) keeps the
//! baseline copy, e.g. to estimate the speed of a 4-lane NEON CPU (Raspberry Pi 5) on an
//! AVX2 machine.

use std::sync::atomic::{AtomicU8, Ordering};

const UNKNOWN: u8 = 0;
const BASELINE: u8 = 1;
const WIDE: u8 = 2;

static MODE: AtomicU8 = AtomicU8::new(UNKNOWN);

fn detect() -> u8 {
    if std::env::var_os("SUPERSYNTH_SIMD").is_some_and(|v| v == "baseline") {
        return BASELINE;
    }
    #[cfg(target_arch = "x86_64")]
    {
        if std::arch::is_x86_feature_detected!("avx2") {
            return WIDE;
        }
    }
    BASELINE
}

/// Decide the instruction set now (allocates to read the environment: call it off the audio
/// thread, e.g. when an engine is created).
pub fn init() {
    if MODE.load(Ordering::Relaxed) == UNKNOWN {
        MODE.store(detect(), Ordering::Relaxed);
    }
}

/// Whether the wide (AVX2) copy of the hot loops runs.
#[inline]
pub fn wide() -> bool {
    match MODE.load(Ordering::Relaxed) {
        WIDE => true,
        BASELINE => false,
        _ => {
            init();
            MODE.load(Ordering::Relaxed) == WIDE
        }
    }
}

/// Name of the instruction set in use ("avx2", "sse2", "neon", …).
pub fn name() -> &'static str {
    if wide() {
        "avx2"
    } else if cfg!(target_arch = "aarch64") {
        "neon"
    } else if cfg!(target_arch = "x86_64") {
        "sse2"
    } else {
        "scalar"
    }
}
