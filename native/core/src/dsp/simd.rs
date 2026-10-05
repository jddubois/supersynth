//! Run-time choice of the instruction set for the hot loops.
//!
//! The voice code is written as plain loops over arrays that the compiler vectorises: with
//! the baseline instruction set of each target (SSE2 on x86-64, NEON on AArch64) and, on
//! x86-64, copies compiled for SSE4.1 (4 lanes, with single-instruction rounding, as NEON
//! has) and AVX2 (8 lanes), chosen at run time. Every copy performs the same IEEE operations
//! in the same order — no fused multiply-adds, no reassociation — so their output is
//! bit-identical; only the speed differs.
//!
//! `SUPERSYNTH_SIMD=sse4.1` or `=baseline` in the environment (read when an engine is
//! created) caps the instruction set: `sse4.1` estimates the speed of a 4-lane NEON CPU
//! (Raspberry Pi 5) on an AVX2 machine.

use std::sync::atomic::{AtomicU8, Ordering};

const UNKNOWN: u8 = 0;
const BASELINE: u8 = 1;
const SSE41: u8 = 2;
const WIDE: u8 = 3;

static MODE: AtomicU8 = AtomicU8::new(UNKNOWN);

fn detect() -> u8 {
    let cap = match std::env::var("SUPERSYNTH_SIMD").as_deref() {
        Ok("baseline") => BASELINE,
        Ok("sse4.1") | Ok("sse4") => SSE41,
        _ => WIDE,
    };
    #[cfg(target_arch = "x86_64")]
    {
        if std::arch::is_x86_feature_detected!("avx2") {
            return cap.min(WIDE);
        }
        if std::arch::is_x86_feature_detected!("sse4.1") {
            return cap.min(SSE41);
        }
    }
    let _ = cap;
    BASELINE
}

/// Decide the instruction set now (allocates to read the environment: call it off the audio
/// thread, e.g. when an engine is created).
pub fn init() {
    if MODE.load(Ordering::Relaxed) == UNKNOWN {
        MODE.store(detect(), Ordering::Relaxed);
    }
}

/// The copy of the hot loops in use.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Level {
    Baseline,
    Sse41,
    Avx2,
}

#[inline]
pub fn level() -> Level {
    let mut m = MODE.load(Ordering::Relaxed);
    if m == UNKNOWN {
        init();
        m = MODE.load(Ordering::Relaxed);
    }
    match m {
        WIDE => Level::Avx2,
        SSE41 => Level::Sse41,
        _ => Level::Baseline,
    }
}

/// Whether the AVX2 copy of the hot loops runs.
#[inline]
pub fn wide() -> bool {
    level() == Level::Avx2
}

/// Name of the instruction set in use ("avx2", "sse4.1", "sse2", "neon", …).
pub fn name() -> &'static str {
    if wide() {
        "avx2"
    } else if level() == Level::Sse41 {
        "sse4.1"
    } else if cfg!(target_arch = "aarch64") {
        "neon"
    } else if cfg!(target_arch = "x86_64") {
        "sse2"
    } else {
        "scalar"
    }
}
