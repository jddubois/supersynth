//! Flush denormals to zero while rendering.
//!
//! Decaying filter states, envelopes and smoothers end up in the subnormal range, where every
//! operation can cost a hundred times more on many CPUs. [`FlushDenormals`] switches the
//! current thread's floating-point unit to flush-to-zero (and treat denormal inputs as zero)
//! for its lifetime and restores the previous mode when dropped, so it can wrap rendering on
//! any thread (the audio callback, or offline rendering on the caller's thread).
//!
//! x86/x86-64: MXCSR FTZ and DAZ bits; AArch64: FPCR FZ bit. Elsewhere it does nothing.

/// Flush-to-zero mode for the current thread while this guard lives.
pub struct FlushDenormals {
    #[allow(dead_code)] // unused where the platform has no flush-to-zero control
    prev: Option<imp::Mode>,
}

impl FlushDenormals {
    #[allow(clippy::new_without_default)]
    pub fn new() -> Self {
        let prev = imp::get();
        if let Some(m) = prev {
            imp::set(imp::flushing(m));
        }
        Self { prev }
    }
}

impl Drop for FlushDenormals {
    fn drop(&mut self) {
        if let Some(m) = self.prev {
            imp::set(m);
        }
    }
}

#[cfg(any(target_arch = "x86_64", all(target_arch = "x86", target_feature = "sse")))]
mod imp {
    pub type Mode = u32;
    const FTZ: u32 = 1 << 15;
    const DAZ: u32 = 1 << 6;

    pub fn get() -> Option<Mode> {
        let mut csr = 0u32;
        // SAFETY: stores the 32-bit MXCSR register into `csr`.
        unsafe {
            core::arch::asm!("stmxcsr dword ptr [{}]", in(reg) &mut csr, options(nostack, preserves_flags));
        }
        Some(csr)
    }

    pub fn set(csr: Mode) {
        // SAFETY: loads MXCSR from `csr`, a value read from it with only the FTZ/DAZ bits
        // changed (both valid on every SSE2 CPU).
        unsafe {
            core::arch::asm!("ldmxcsr dword ptr [{}]", in(reg) &csr, options(nostack, readonly, preserves_flags));
        }
    }

    pub fn flushing(m: Mode) -> Mode {
        m | FTZ | DAZ
    }
}

#[cfg(target_arch = "aarch64")]
mod imp {
    pub type Mode = u64;
    /// FPCR.FZ: flush denormal inputs and results to zero (single and double precision).
    const FZ: u64 = 1 << 24;

    pub fn get() -> Option<Mode> {
        let v: u64;
        // SAFETY: reads the floating-point control register.
        unsafe {
            core::arch::asm!("mrs {}, fpcr", out(reg) v, options(nomem, nostack, preserves_flags));
        }
        Some(v)
    }

    pub fn set(v: Mode) {
        // SAFETY: writes back a value read from FPCR with only the FZ bit changed.
        unsafe {
            core::arch::asm!("msr fpcr, {}", in(reg) v, options(nomem, nostack, preserves_flags));
        }
    }

    pub fn flushing(m: Mode) -> Mode {
        m | FZ
    }
}

#[cfg(not(any(target_arch = "x86_64", all(target_arch = "x86", target_feature = "sse"), target_arch = "aarch64")))]
mod imp {
    pub type Mode = ();

    pub fn get() -> Option<Mode> {
        None
    }

    pub fn set(_: Mode) {}

    pub fn flushing(m: Mode) -> Mode {
        m
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::hint::black_box;

    fn denormal_product() -> f32 {
        black_box(1e-30f32) * black_box(1e-10f32)
    }

    #[test]
    #[cfg(any(target_arch = "x86_64", target_arch = "x86", target_arch = "aarch64"))]
    fn flushes_while_alive_and_restores_after() {
        assert!(denormal_product() > 0.0, "denormals are kept by default");
        {
            let _g = FlushDenormals::new();
            assert_eq!(denormal_product(), 0.0);
            {
                let _inner = FlushDenormals::new();
                assert_eq!(denormal_product(), 0.0);
            }
            assert_eq!(denormal_product(), 0.0, "an inner guard restores the outer mode");
        }
        assert!(denormal_product() > 0.0, "the previous mode is restored");
    }
}
