use super::filter::Filter;

/// First-order RC low-pass filter.
/// `cutoff` is a normalized frequency coefficient in (0.0, 1.0).
/// A value of 0.7 gives gentle smoothing; lower values cut more aggressively.
pub struct LowPass {
    cutoff: f32,
    last: f32,
}

impl LowPass {
    pub fn new(cutoff: f32) -> Self {
        Self { cutoff: cutoff.clamp(0.0, 1.0), last: 0.0 }
    }
}

impl Filter for LowPass {
    fn process(&mut self, input: f32) -> f32 {
        self.last = self.last + self.cutoff * (input - self.last);
        self.last
    }

    fn reset(&mut self) {
        self.last = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn low_pass_converges_to_dc() {
        let mut lp = LowPass::new(0.1);
        for _ in 0..1000 {
            lp.process(1.0);
        }
        assert!((lp.last - 1.0).abs() < 0.01, "LowPass did not converge to DC: {}", lp.last);
    }

    #[test]
    fn low_pass_starts_at_zero() {
        let mut lp = LowPass::new(0.5);
        assert_eq!(lp.process(0.0), 0.0);
    }
}
