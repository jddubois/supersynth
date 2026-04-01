use super::biquad::Biquad;
use super::filter::Filter;

const LOW_SHELF_FREQ_HZ:   f32 = 300.0;
const HIGH_SHELF_FREQ_HZ:  f32 = 10_000.0;
const MAX_BASS_BOOST_DB:   f32 = 10.0;
const MAX_TREBLE_BOOST_DB: f32 = 4.0;
const SHELF_SLOPE:         f32 = 1.0;
/// Boost is proportional to how many dB below full volume. At 40 dB below full,
/// the boost reaches its maximum. This keeps the boost near-zero at typical
/// listening levels and only applies significant correction at very low volumes.
const REFERENCE_RANGE_DB:  f32 = 40.0;

/// Volume-dependent equal-loudness contour filter (Fletcher-Munson / ISO 226 approximation).
///
/// Applies a low-shelf boost (up to 10 dB at 300 Hz) and a high-shelf boost (up to 4 dB
/// at 10 kHz) as master_volume decreases. Boost scales with dB reduction from full volume,
/// so it stays near-zero at typical listening levels and increases only at very low volumes.
pub struct LoudnessFilter {
    low_shelf:   Biquad,
    high_shelf:  Biquad,
    sample_rate: f32,
}

/// Returns boost in dB given a linear volume (0.0–1.0) and a max boost.
/// Scales proportionally to how many dB below full volume, clamped to [0, max_boost].
fn boost_db(volume: f32, max_boost: f32) -> f32 {
    let volume_db = (volume.max(1e-6)).log10() * 20.0; // 0 dB at volume=1, negative below
    let factor = (-volume_db / REFERENCE_RANGE_DB).clamp(0.0, 1.0);
    max_boost * factor
}

impl LoudnessFilter {
    pub fn new(sample_rate: f32, master_volume: f32) -> Self {
        let volume    = master_volume.clamp(0.0, 1.0);
        let bass_db   = boost_db(volume, MAX_BASS_BOOST_DB);
        let treble_db = boost_db(volume, MAX_TREBLE_BOOST_DB);
        Self {
            low_shelf:  Biquad::low_shelf(LOW_SHELF_FREQ_HZ / sample_rate, bass_db, SHELF_SLOPE),
            high_shelf: Biquad::high_shelf(HIGH_SHELF_FREQ_HZ / sample_rate, treble_db, SHELF_SLOPE),
            sample_rate,
        }
    }

    /// Recompute shelf coefficients for a new master volume without resetting delay-line
    /// state, so volume changes during playback do not produce audible clicks.
    pub fn update_volume(&mut self, volume: f32) {
        let volume    = volume.clamp(0.0, 1.0);
        let bass_db   = boost_db(volume, MAX_BASS_BOOST_DB);
        let treble_db = boost_db(volume, MAX_TREBLE_BOOST_DB);
        let new_lo = Biquad::low_shelf(LOW_SHELF_FREQ_HZ / self.sample_rate, bass_db, SHELF_SLOPE);
        let new_hi = Biquad::high_shelf(HIGH_SHELF_FREQ_HZ / self.sample_rate, treble_db, SHELF_SLOPE);
        self.low_shelf.update_coeffs_from(&new_lo);
        self.high_shelf.update_coeffs_from(&new_hi);
    }
}

impl Filter for LoudnessFilter {
    fn process(&mut self, input: f32) -> f32 {
        let x = self.low_shelf.process(input);
        self.high_shelf.process(x)
    }

    fn reset(&mut self) {
        self.low_shelf.reset();
        self.high_shelf.reset();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unity_at_full_volume() {
        let sr = 48000.0_f32;
        let two_pi = 2.0 * std::f32::consts::PI;
        let mut f = LoudnessFilter::new(sr, 1.0);
        // Settle the filter
        for i in 0..300 {
            let x = (two_pi * 200.0 / sr * i as f32).sin();
            f.process(x);
        }
        let mut peak_out = 0.0_f32;
        let mut peak_in  = 0.0_f32;
        for i in 300..700 {
            let x = (two_pi * 200.0 / sr * i as f32).sin();
            peak_out = peak_out.max(f.process(x).abs());
            peak_in  = peak_in.max(x.abs());
        }
        assert!((peak_out - peak_in).abs() < 0.05, "not unity at full volume: out={peak_out} in={peak_in}");
    }

    #[test]
    fn low_volume_boosts_bass() {
        let sr = 48000.0_f32;
        let two_pi = 2.0 * std::f32::consts::PI;
        // 150 Hz sits well inside the boost region of the 300 Hz low shelf
        let mut quiet = LoudnessFilter::new(sr, 0.0);
        let mut loud  = LoudnessFilter::new(sr, 1.0);
        let mut peak_quiet = 0.0_f32;
        let mut peak_loud  = 0.0_f32;
        for i in 500..1500 {
            let x = (two_pi * 150.0 / sr * i as f32).sin();
            peak_quiet = peak_quiet.max(quiet.process(x).abs());
            peak_loud  = peak_loud.max(loud.process(x).abs());
        }
        assert!(
            peak_quiet > peak_loud * 1.5,
            "quiet volume should have more bass boost: quiet={peak_quiet} loud={peak_loud}"
        );
    }

    #[test]
    fn update_volume_changes_gain() {
        let sr = 48000.0_f32;
        let two_pi = 2.0 * std::f32::consts::PI;
        let mut f = LoudnessFilter::new(sr, 1.0);
        let mut peak_loud = 0.0_f32;
        for i in 200..700 {
            let x = (two_pi * 150.0 / sr * i as f32).sin();
            peak_loud = peak_loud.max(f.process(x).abs());
        }
        f.update_volume(0.0);
        let mut peak_quiet = 0.0_f32;
        for i in 700..1700 {
            let x = (two_pi * 150.0 / sr * i as f32).sin();
            peak_quiet = peak_quiet.max(f.process(x).abs());
        }
        assert!(peak_quiet > peak_loud, "update_volume did not increase bass: quiet={peak_quiet} loud={peak_loud}");
    }

    #[test]
    fn output_is_finite() {
        let mut f = LoudnessFilter::new(48000.0, 0.0);
        for i in 0..4800 {
            let x = ((i as f32) * 0.23).sin();
            assert!(f.process(x).is_finite(), "non-finite output at sample {i}");
        }
    }
}
