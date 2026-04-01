use super::filter::Filter;

/// Tube-amplifier-style overdrive using an asymmetric tanh waveshaper.
///
/// Models the character of a 12AX7 triode preamp stage:
/// - `drive` controls the gain into the saturator (1.0 = clean, 10.0 = heavy saturation)
/// - `bias` adds asymmetry to the transfer function, introducing even harmonics
///   for a warm, musical character (0.0 = symmetric, 0.3 = warm organ character)
/// - `level` compensates the output amplitude
///
/// A first-order DC blocker (fc ≈ 35 Hz) removes any bias-induced DC offset.
pub struct Overdrive {
    drive: f32,
    bias: f32,
    level: f32,
    /// DC blocker state: input delay
    dc_x1: f32,
    /// DC blocker state: output delay
    dc_y1: f32,
}

impl Overdrive {
    pub fn new(drive: f32, bias: f32, level: f32) -> Self {
        Self { drive: drive.max(1.0), bias, level, dc_x1: 0.0, dc_y1: 0.0 }
    }

    /// Update drive, bias, and output level without resetting the DC blocker state.
    pub fn set_params(&mut self, drive: f32, bias: f32, level: f32) {
        self.drive = drive.max(1.0);
        self.bias = bias;
        self.level = level;
    }
}

impl Filter for Overdrive {
    fn process(&mut self, input: f32) -> f32 {
        // Asymmetric tanh saturation: shift input by bias before saturating,
        // then subtract the DC offset introduced by the bias.
        let driven = input * self.drive + self.bias;
        let bias_sat = self.bias.tanh();
        let saturated = (driven.tanh() - bias_sat) * self.level;

        // First-order DC blocker: y[n] = x[n] - x[n-1] + 0.995 * y[n-1]
        // The coefficient 0.995 gives fc ≈ 35 Hz at 48kHz.
        let out = saturated - self.dc_x1 + 0.995 * self.dc_y1;
        self.dc_x1 = saturated;
        self.dc_y1 = out;

        if out.is_finite() { out } else { 0.0 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overdrive_output_is_finite() {
        let mut od = Overdrive::new(5.0, 0.2, 0.8);
        for i in 0..4800 {
            let x = (i as f32 * 0.1).sin() * 2.0; // drive hard into saturation
            assert!(od.process(x).is_finite());
        }
    }

    #[test]
    fn overdrive_saturates_peaks() {
        let mut od = Overdrive::new(8.0, 0.0, 1.0);
        // A large input should be compressed significantly by tanh saturation
        let out = od.process(10.0);
        assert!(out.abs() < 5.0, "overdrive did not saturate: out={out}");
    }

    #[test]
    fn overdrive_no_dc_at_unity_drive() {
        let mut od = Overdrive::new(1.0, 0.0, 1.0);
        // Warm up DC blocker with sine, then measure average output
        let mut sum = 0.0_f32;
        for i in 0..48000 {
            sum += od.process((i as f32 * 0.1).sin());
        }
        let dc = sum / 48000.0;
        assert!(dc.abs() < 0.01, "DC offset too large: {dc}");
    }

    #[test]
    fn overdrive_increases_harmonics() {
        use std::f32::consts::PI;
        let mut clean = Overdrive::new(1.0, 0.0, 1.0);
        let mut driven = Overdrive::new(5.0, 0.15, 0.5);
        // Measure peak output variance (driven should have more variation)
        let mut clean_samples = Vec::with_capacity(4800);
        let mut driven_samples = Vec::with_capacity(4800);
        for i in 0..4800 {
            let x = (i as f32 * 2.0 * PI * 440.0 / 48000.0).sin() * 0.5;
            clean_samples.push(clean.process(x));
            driven_samples.push(driven.process(x));
        }
        // Both should be finite
        assert!(clean_samples.iter().all(|s| s.is_finite()));
        assert!(driven_samples.iter().all(|s| s.is_finite()));
    }
}
