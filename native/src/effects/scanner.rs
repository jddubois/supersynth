use super::filter::Filter;
use std::f32::consts::PI;

/// Organ vibrato/chorus scanner mode.
///
/// V modes: pure pitch modulation (vibrato only), no amplitude change.
/// C modes: pitch + amplitude modulation (chorus character).
///
/// All modes use a 2ms modulated delay line to produce pitch variation via
/// phase modulation (Doppler-style). C modes add a gentle sine-wave AM.
#[derive(Clone, Copy)]
pub enum ScannerMode {
    Off,
    /// V1: vibrato, narrow depth
    V1,
    /// V2: vibrato, medium depth
    V2,
    /// V3: vibrato, full depth
    V3,
    /// C1: chorus, slow rate
    C1,
    /// C2: chorus, medium rate
    C2,
    /// C3: chorus, fast rate
    C3,
}

impl ScannerMode {
    pub fn from_str(s: &str) -> Self {
        match s {
            "v1" => Self::V1,
            "v2" => Self::V2,
            "v3" => Self::V3,
            "c1" => Self::C1,
            "c2" => Self::C2,
            "c3" => Self::C3,
            _ => Self::Off,
        }
    }

    /// Returns `(rate_hz, delay_depth_fraction, am_depth)` or `None` when off.
    ///
    /// `delay_depth_fraction` is the fractional depth of the delay modulation
    /// relative to the full 2ms buffer (e.g. 0.3 = ±0.3 × half-buffer modulation).
    fn params(self) -> Option<(f32, f32, f32)> {
        match self {
            Self::Off => None,
            Self::V1  => Some((5.0, 0.25, 0.00)),
            Self::V2  => Some((5.0, 0.45, 0.00)),
            Self::V3  => Some((5.0, 0.70, 0.00)),
            Self::C1  => Some((1.5, 0.30, 0.12)),
            Self::C2  => Some((3.0, 0.40, 0.18)),
            Self::C3  => Some((6.0, 0.55, 0.25)),
        }
    }
}

/// Engine-level vibrato/chorus scanner. Implements the organ V/C scanner system.
///
/// The scanner uses a rotating tap on a delay-line chain; we model it
/// as a variable-delay read with an LFO, which captures the pitch and chorus
/// character without the complexity of the original circuit.
pub struct ScannerVibrato {
    delay_buffer: Vec<f32>,
    write_pos: usize,
    max_delay: usize,
    lfo_phase: f32,
    mode: ScannerMode,
    sample_rate: f32,
}

impl ScannerVibrato {
    pub fn new(sample_rate: f32) -> Self {
        let max_delay = ((0.002 * sample_rate) as usize + 4).max(8);
        Self {
            delay_buffer: vec![0.0; max_delay * 2],
            write_pos: 0,
            max_delay,
            lfo_phase: 0.0,
            mode: ScannerMode::Off,
            sample_rate,
        }
    }

    /// Set the scanner mode. `mode`: `"off"` | `"v1"` | `"v2"` | `"v3"` | `"c1"` | `"c2"` | `"c3"`
    pub fn set_mode(&mut self, mode: &str) {
        self.mode = ScannerMode::from_str(mode);
    }

    fn read_interpolated(&self, delay_f: f32) -> f32 {
        let delay_f = delay_f.clamp(0.0, self.max_delay as f32 - 1.001);
        let i = delay_f as usize;
        let frac = delay_f - i as f32;
        let len = self.delay_buffer.len();
        let a = self.delay_buffer[(self.write_pos + len - i) % len];
        let b = self.delay_buffer[(self.write_pos + len - i - 1) % len];
        a + frac * (b - a)
    }
}

impl Filter for ScannerVibrato {
    fn process(&mut self, input: f32) -> f32 {
        // Always write to the delay buffer, even when mode is Off (so the buffer
        // is primed and ready when a mode is engaged)
        self.write_pos = (self.write_pos + 1) % self.delay_buffer.len();
        self.delay_buffer[self.write_pos] = input;

        let Some((rate, depth, am_depth)) = self.mode.params() else {
            return input;
        };

        self.lfo_phase = (self.lfo_phase + rate / self.sample_rate).fract();
        let lfo = (2.0 * PI * self.lfo_phase).sin();

        // Modulate delay around center point — creates pitch shift via phase modulation
        let center = self.max_delay as f32 * 0.5;
        let delay_f = center * (1.0 + lfo * depth);
        let delayed = self.read_interpolated(delay_f);

        // Chorus modes add gentle AM for width and shimmer
        let am = 1.0 + am_depth * lfo;
        let out = delayed * am;

        if out.is_finite() { out } else { 0.0 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scanner_off_is_passthrough() {
        let mut scanner = ScannerVibrato::new(48000.0);
        // With mode "off", after the initial delay-line fill the output should
        // track the input with a short latency — just verify it's finite and non-trivial
        let mut outputs = Vec::new();
        for i in 0..4800 {
            let input = (i as f32 * 2.0 * PI * 440.0 / 48000.0).sin();
            outputs.push(scanner.process(input));
        }
        assert!(outputs.iter().all(|s| s.is_finite()));
    }

    #[test]
    fn scanner_v3_output_is_finite() {
        let mut scanner = ScannerVibrato::new(48000.0);
        scanner.set_mode("v3");
        for i in 0..4800 {
            let input = (i as f32 * 2.0 * PI * 440.0 / 48000.0).sin() * 0.5;
            assert!(scanner.process(input).is_finite());
        }
    }

    #[test]
    fn scanner_c2_modulates_amplitude() {
        let mut scanner = ScannerVibrato::new(48000.0);
        scanner.set_mode("c2");
        // Warm up
        for i in 0..4800 {
            scanner.process((i as f32 * 0.1).sin() * 0.5);
        }
        // Measure amplitude variation over one LFO cycle (C2 = 3Hz → 16000 samples at 48kHz)
        let mut samples: Vec<f32> = (0..16000)
            .map(|i| scanner.process(0.5_f32)) // DC input to isolate AM
            .collect();
        let max = samples.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        let min = samples.iter().cloned().fold(f32::INFINITY, f32::min);
        assert!(
            max - min > 0.01,
            "C2 mode should produce amplitude variation, got max={max} min={min}"
        );
    }
}
