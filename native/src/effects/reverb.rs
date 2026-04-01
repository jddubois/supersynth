use super::biquad::Biquad;
use super::filter::Filter;

struct CombFilter {
    buffer: Vec<f32>,
    index: usize,
    feedback: f32,
    damp1: f32,
    damp2: f32,
    filterstore: f32,
}

impl CombFilter {
    fn new(size: usize, feedback: f32, damping: f32) -> Self {
        Self {
            buffer: vec![0.0; size],
            index: 0,
            feedback,
            damp1: damping,
            damp2: 1.0 - damping,
            filterstore: 0.0,
        }
    }

    fn process(&mut self, input: f32) -> f32 {
        let output = self.buffer[self.index];
        self.filterstore = output * self.damp2 + self.filterstore * self.damp1;
        self.buffer[self.index] = input + self.filterstore * self.feedback;
        self.index = (self.index + 1) % self.buffer.len();
        output
    }
}

struct AllPassFilter {
    buffer: Vec<f32>,
    index: usize,
}

const ALLPASS_FEEDBACK: f32 = 0.5;

impl AllPassFilter {
    fn new(size: usize) -> Self {
        Self { buffer: vec![0.0; size], index: 0 }
    }

    fn process(&mut self, input: f32) -> f32 {
        let buffered = self.buffer[self.index];
        let output = -input + buffered;
        self.buffer[self.index] = input + buffered * ALLPASS_FEEDBACK;
        self.index = (self.index + 1) % self.buffer.len();
        output
    }
}

/// Freeverb — Schroeder-Moorer reverb.
/// 8 parallel comb filters → 4 series all-pass filters.
///
/// Two biquad filters are applied to the wet reverb signal only:
/// 1. High-pass at 100 Hz — removes sub-bass comb resonances from bass organ notes.
/// 2. Peaking EQ at 1008 Hz (+9 dB, Q=4) — lifts the 898–1131 Hz reverb contribution
///    to match the natural resonance of a historic cathedral pipe organ without
///    broadly boosting adjacent bands (800 Hz or 1270 Hz).
pub struct Freeverb {
    combs: Vec<CombFilter>,
    allpasses: Vec<AllPassFilter>,
    pre_delay: Vec<f32>,
    pre_delay_index: usize,
    wet: f32,
    dry: f32,
    /// High-pass on wet reverb output — cuts sub-bass comb resonances below ~100 Hz.
    wet_hp: Biquad,
    /// Peaking EQ on wet reverb output — +9 dB at 1008 Hz, Q=4, to lift the deficit band.
    wet_hs: Biquad,
}

const COMB_TUNINGS: [usize; 8] = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116];
const ALLPASS_TUNINGS: [usize; 4] = [556, 441, 341, 225];
const REFERENCE_RATE: f32 = 44100.0;

pub struct FreeverbParams {
    pub room_size: f32,
    pub damping: f32,
    pub wet: f32,
    pub dry: f32,
    pub pre_delay_ms: f32,
}

impl Default for FreeverbParams {
    fn default() -> Self {
        Self { room_size: 0.85, damping: 0.5, wet: 0.35, dry: 0.65, pre_delay_ms: 20.0 }
    }
}

impl Freeverb {
    pub fn new(sample_rate: f32, params: &FreeverbParams) -> Self {
        let scale = sample_rate / REFERENCE_RATE;
        let combs = COMB_TUNINGS.iter()
            .map(|&s| CombFilter::new(((s as f32) * scale) as usize, params.room_size, params.damping))
            .collect();
        let allpasses = ALLPASS_TUNINGS.iter()
            .map(|&s| AllPassFilter::new(((s as f32) * scale) as usize))
            .collect();
        let pre_delay_samples = ((sample_rate * params.pre_delay_ms) / 1000.0).round() as usize;
        // HP at 100 Hz, Q=0.707 (Butterworth) — removes sub-bass comb resonances.
        // The Freeverb comb delays at 48kHz resonate at ~28-40 Hz (fundamental)
        // and ~55-79 Hz (2nd harmonic). Bass organ notes excite these resonances
        // via the high-feedback comb filters. The HP removes the artifact from the
        // wet reverb signal while the dry path retains the natural bass.
        let wet_hp = Biquad::high_pass(100.0 / sample_rate, 0.707);
        // Peaking EQ at 1008 Hz, +9 dB, Q=4 — targets the 898-1131 Hz deficit band
        // precisely. Q=4 gives ~252 Hz bandwidth (-3dB at ~882 Hz and ~1134 Hz),
        // so 800 Hz and 1270 Hz receive only ~+3 dB, avoiding broad over-boost.
        let wet_hs = Biquad::peaking_eq(1008.0 / sample_rate, 9.0, 4.0);
        Self {
            combs,
            allpasses,
            pre_delay: vec![0.0; pre_delay_samples.max(1)],
            pre_delay_index: 0,
            wet: params.wet,
            dry: params.dry,
            wet_hp,
            wet_hs,
        }
    }
}

impl Filter for Freeverb {
    fn process(&mut self, input: f32) -> f32 {
        let delayed = self.pre_delay[self.pre_delay_index];
        self.pre_delay[self.pre_delay_index] = input;
        self.pre_delay_index = (self.pre_delay_index + 1) % self.pre_delay.len();

        let mut comb_out = 0.0;
        for c in &mut self.combs {
            comb_out += c.process(delayed);
        }
        comb_out /= self.combs.len() as f32;

        let mut out = comb_out;
        for ap in &mut self.allpasses {
            out = ap.process(out);
        }

        // Apply HP then peaking EQ to reverb wet signal only.
        // HP removes sub-bass comb resonances; peaking EQ lifts 898-1131 Hz deficit
        // to match the cathedral organ's natural upper-partial resonance character.
        let wet_hp = self.wet_hp.process(out * self.wet);
        let wet_signal = self.wet_hs.process(wet_hp);
        wet_signal + input * self.dry
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dry_only_passes_through() {
        let params = FreeverbParams { wet: 0.0, dry: 1.0, ..Default::default() };
        let mut verb = Freeverb::new(48000.0, &params);
        // After pre-delay drains, dry signal should pass through unchanged
        let pre_delay_samples = ((48000.0 * 20.0) / 1000.0) as usize;
        for _ in 0..pre_delay_samples {
            verb.process(1.0);
        }
        let out = verb.process(1.0);
        assert!((out - 1.0).abs() < 0.01, "dry pass-through failed: {out}");
    }

    #[test]
    fn reverb_output_is_finite() {
        let mut verb = Freeverb::new(48000.0, &FreeverbParams::default());
        for i in 0..48000 {
            let input = if i < 100 { 1.0 } else { 0.0 };
            assert!(verb.process(input).is_finite());
        }
    }
}
