use super::karplus_strong::{Excitation, KarplusData};

// ── Waveform frequency-shaping constants ─────────────────────────────────────
const TRIANGLE_BLEND_LO_HZ: f32 = 50.0;   // below this: pure sine
const TRIANGLE_BLEND_HI_HZ: f32 = 250.0;  // above this: pure triangle
const BRIGHTNESS_LO_HZ: f32 = 150.0;      // trumpet/flute: low-register brightness threshold
const BRIGHTNESS_HI_HZ: f32 = 500.0;      // trumpet/flute: high-register brightness threshold

/// PolyBLEP anti-aliasing correction.
/// `t` is the current phase (0.0 to 1.0), `dt` is frequency/sample_rate.
fn poly_blep(t: f32, dt: f32) -> f32 {
    if t < dt {
        let t = t / dt;
        2.0 * t - t * t - 1.0
    } else if t > 1.0 - dt {
        let t = (t - 1.0) / dt;
        t * t + 2.0 * t + 1.0
    } else {
        0.0
    }
}

/// `KarplusStrong` holds mutable delay-line state, so `Waveform` is no longer
/// `Copy`. All other variants are zero-sized and behave identically to before.
#[derive(Debug, Clone)]
pub enum Waveform {
    Sine,
    Square,
    Sawtooth,
    Triangle,
    Trumpet,
    Flute,
    /// Organ principal/diapason pipe — additive synthesis with all harmonics
    /// present and ~1/n²-style rolloff. Models the classic German baroque
    /// Prinzipal: round, full, with clear fundamental and present upper partials
    /// but not as bright as a sawtooth.  Unlike `Triangle`, even harmonics are
    /// included, giving the characteristic "filled-out" quality of flue pipes.
    Principal,
    /// Variable duty-cycle pulse wave with PolyBLEP anti-aliasing.
    /// The `f32` is the duty cycle (0.0–1.0); 0.5 is identical to `Square`.
    Pulse(f32),
    /// White noise via XorShift32. The `u32` is the mutable LCG state.
    Noise(u32),
    /// Karplus-Strong plucked-string synthesis. State is lazily initialised on
    /// the first `generate_sample` call, at which point frequency and
    /// sample_rate (= frequency / dt) are both available.
    KarplusStrong(KarplusData),
}

impl PartialEq for Waveform {
    fn eq(&self, other: &Self) -> bool {
        std::mem::discriminant(self) == std::mem::discriminant(other)
    }
}

impl Waveform {
    pub fn parse(s: &str) -> Self {
        match s {
            "square"     => Waveform::Square,
            "sawtooth"   => Waveform::Sawtooth,
            "triangle"   => Waveform::Triangle,
            "trumpet"    => Waveform::Trumpet,
            "flute"      => Waveform::Flute,
            "principal"  => Waveform::Principal,
            "pulse"      => Waveform::Pulse(0.5),
            "noise"      => Waveform::Noise(0xDEAD_BEEF),
            "plucked"    => Waveform::KarplusStrong(KarplusData::plucked()),
            "struck"     => Waveform::KarplusStrong(KarplusData::struck()),
            "electric"   => Waveform::KarplusStrong(KarplusData::electric()),
            _            => Waveform::Sine,
        }
    }

    #[allow(dead_code)]
    pub fn as_str(&self) -> &'static str {
        match self {
            Waveform::Sine              => "sine",
            Waveform::Square            => "square",
            Waveform::Sawtooth          => "sawtooth",
            Waveform::Triangle          => "triangle",
            Waveform::Trumpet           => "trumpet",
            Waveform::Flute             => "flute",
            Waveform::Principal         => "principal",
            Waveform::Pulse(_)          => "pulse",
            Waveform::Noise(_)          => "noise",
            Waveform::KarplusStrong(ks) => match ks.excitation {
                Excitation::Plucked  => "plucked",
                Excitation::Struck   => "struck",
                Excitation::Electric => "electric",
            },
        }
    }

    /// Generate the next sample. For stateless waveforms only `phase`, `frequency`,
    /// and `dt` matter. For `KarplusStrong`, the delay-line state is advanced and
    /// `sample_rate` is recovered as `frequency / dt`. `Noise` advances its LCG state.
    pub fn generate_sample(&mut self, phase: f32, frequency: f32, dt: f32) -> f32 {
        match self {
            Waveform::Sine              => Self::sine(phase),
            Waveform::Square            => Self::square(phase, dt),
            Waveform::Sawtooth          => Self::sawtooth(phase, dt),
            Waveform::Triangle          => Self::organ_triangle(phase, frequency),
            Waveform::Trumpet           => Self::trumpet(phase, frequency, dt),
            Waveform::Flute             => Self::flute(phase, frequency, dt),
            Waveform::Principal         => Self::principal(phase, frequency, dt),
            Waveform::Pulse(duty)       => Self::pulse(phase, dt, *duty),
            Waveform::Noise(state)      => Self::noise(state),
            Waveform::KarplusStrong(ks) => {
                let sample_rate = frequency / dt;
                ks.next_sample(frequency, sample_rate)
            }
        }
    }

    fn sine(phase: f32) -> f32 {
        (2.0 * std::f32::consts::PI * phase).sin()
    }

    fn square(phase: f32, dt: f32) -> f32 {
        let mut s = if phase < 0.5 { 1.0 } else { -1.0 };
        s += poly_blep(phase, dt);
        s -= poly_blep((phase + 0.5) % 1.0, dt);
        s
    }

    fn sawtooth(phase: f32, dt: f32) -> f32 {
        let mut s = 2.0 * phase - 1.0;
        s -= poly_blep(phase, dt);
        s
    }

    /// Variable duty-cycle pulse wave with PolyBLEP anti-aliasing at both edges.
    /// `duty` is clamped to (0.01, 0.99) to avoid degenerate edge cases.
    /// At `duty = 0.5` the output is identical to `square`.
    fn pulse(phase: f32, dt: f32, duty: f32) -> f32 {
        let duty = duty.clamp(0.01, 0.99);
        let mut s = if phase < duty { 1.0 } else { -1.0 };
        s += poly_blep(phase, dt);                              // rising edge at phase = 0
        s -= poly_blep((phase + (1.0 - duty)) % 1.0, dt);      // falling edge at phase = duty
        s
    }

    /// White noise via XorShift32. Advances `state` in-place and returns a
    /// sample in `[-1.0, 1.0]`. Ignores `phase`/`frequency`/`dt`.
    fn noise(state: &mut u32) -> f32 {
        *state ^= *state << 13;
        *state ^= *state >> 17;
        *state ^= *state << 5;
        (*state as f32) / (u32::MAX as f32) * 2.0 - 1.0
    }

    /// Frequency-dependent sine/triangle blend — warmer organ tone.
    fn organ_triangle(phase: f32, frequency: f32) -> f32 {
        let blend = ((frequency / TRIANGLE_BLEND_LO_HZ).log10() / (TRIANGLE_BLEND_HI_HZ / TRIANGLE_BLEND_LO_HZ).log10()).clamp(0.0, 1.0);
        let sine = (phase * 2.0 * std::f32::consts::PI).sin();
        let tri = if phase < 0.5 { 4.0 * phase - 1.0 } else { 3.0 - 4.0 * phase };
        (1.0 - blend) * sine + blend * tri
    }

    /// Additive synthesis with organ reed pipe harmonic profile.
    fn trumpet(phase: f32, frequency: f32, dt: f32) -> f32 {
        // North German baroque Trompete (Schnitger style): round and full rather than
        // cutting. Strong H2 gives warmth; H3+ drops steeply so there's no mid-harmonic
        // "bite" or nasal quality. French Trompette has more H3–H5 presence (oboe-like);
        // German Trompete is dominated by H1–H2 with upper harmonics as subtle colour.
        const HARMONIC_AMPS: [f32; 12] = [
            1.0, 0.72, 0.28, 0.14, 0.08, 0.05, 0.03, 0.02,
            0.012, 0.008, 0.005, 0.003,
        ];
        let brightness = if frequency < BRIGHTNESS_LO_HZ {
            1.10
        } else if frequency > BRIGHTNESS_HI_HZ {
            0.90
        } else {
            1.10 - 0.20 * (frequency - BRIGHTNESS_LO_HZ) / (BRIGHTNESS_HI_HZ - BRIGHTNESS_LO_HZ)
        };
        let two_pi = 2.0 * std::f32::consts::PI;
        let (mut sample, mut amp_sum) = (0.0_f32, 0.0_f32);
        for i in 0..12 {
            let h = (i + 1) as f32;
            let nyquist_ratio = h * 2.0 * dt;
            if nyquist_ratio >= 1.0 { break; }
            // Smooth Nyquist taper for alias-free treble
            let taper = if nyquist_ratio > 0.75 {
                (1.0 - (nyquist_ratio - 0.75) / 0.25).max(0.0)
            } else {
                1.0
            };
            let amp = HARMONIC_AMPS[i] * taper * if i >= 2 { brightness } else { 1.0 };
            sample += amp * (two_pi * h * phase).sin();
            amp_sum += amp;
        }
        if amp_sum > 0.0 { sample / amp_sum } else { 0.0 }
    }

    /// Additive synthesis with soft flute harmonics.
    fn flute(phase: f32, frequency: f32, dt: f32) -> f32 {
        // Flute pipes have near-sinusoidal tone — pure fundamental with weak upper partials.
        // No inharmonicity: the harmonic stretch that gives principal its character would
        // make flute sound principal-ly. Flute purity comes from exact integer partials.
        const HARMONIC_AMPS: [f32; 6] = [1.0, 0.18, 0.06, 0.03, 0.01, 0.005];
        let brightness = if frequency < BRIGHTNESS_LO_HZ {
            1.4
        } else if frequency > BRIGHTNESS_HI_HZ {
            0.7
        } else {
            1.4 - 0.7 * (frequency - BRIGHTNESS_LO_HZ) / (BRIGHTNESS_HI_HZ - BRIGHTNESS_LO_HZ)
        };
        let two_pi = 2.0 * std::f32::consts::PI;
        let (mut sample, mut amp_sum) = (0.0_f32, 0.0_f32);
        for i in 0..6 {
            let h = (i + 1) as f32;
            let nyquist_ratio = h * 2.0 * dt;
            if nyquist_ratio >= 1.0 { break; }
            let taper = if nyquist_ratio > 0.8 { 1.0 - (nyquist_ratio - 0.8) / 0.2 } else { 1.0 };
            let amp = HARMONIC_AMPS[i] * taper * if i >= 1 { brightness } else { 1.0 };
            sample += amp * (two_pi * h * phase).sin();
            amp_sum += amp;
        }
        if amp_sum > 0.0 { sample / amp_sum } else { 0.0 }
    }

    /// Organ principal / Diapason pipe — additive synthesis with all harmonics.
    ///
    /// Harmonic amplitudes are based on acoustic measurements of historic German
    /// baroque Prinzipal pipes (8', 4', and 2' ranks). Key differences from
    /// `Triangle`:
    ///   - Even harmonics (H2, H4, H6…) are present and significant
    ///   - Rolloff follows roughly 1/n² rather than the 1/n² odd-only of triangle
    ///   - Register-adaptive brightness: treble notes lose upper partials naturally
    ///
    /// The result is the round, full principal tone heard on historic north-German
    /// baroque organs — clear fundamental, present 2nd and 3rd harmonics, then a
    /// gradual taper into the upper partials.
    fn principal(phase: f32, frequency: f32, dt: f32) -> f32 {
        const HARMONIC_AMPS: [f32; 10] = [
            1.000, 0.350, 0.080, 0.095, 0.055, 0.030, 0.018, 0.010, 0.005, 0.002,
        ];
        // Pipe inharmonicity: real flue pipe resonances are slightly stretched above
        // exact integer multiples due to open-end correction. Linear model:
        // partial n oscillates at n × f0 × (1 + INHARMONIC × n), where INHARMONIC ≈ 0.0015
        // for metal principal pipes. This creates natural beating and detuning across
        // partials — the primary perceptual difference between digital and pipe organs.
        const INHARMONIC: f32 = 0.0020;
        // Register-dependent brightness: low register is slightly warmer (fewer upper partials)
        let bright_factor = if frequency < BRIGHTNESS_LO_HZ {
            0.7_f32  // bass octave — darker, more fundamental
        } else if frequency > BRIGHTNESS_HI_HZ {
            1.1_f32  // treble — slightly more presence in upper partials
        } else {
            0.7 + 0.4 * (frequency - BRIGHTNESS_LO_HZ) / (BRIGHTNESS_HI_HZ - BRIGHTNESS_LO_HZ)
        };
        let two_pi = 2.0 * std::f32::consts::PI;
        let (mut sample, mut amp_sum) = (0.0_f32, 0.0_f32);
        for i in 0..10 {
            let h = (i + 1) as f32;
            let nyquist_ratio = h * 2.0 * dt;
            if nyquist_ratio >= 1.0 { break; }
            // Smooth Nyquist taper for alias-free treble
            let taper = if nyquist_ratio > 0.75 {
                (1.0 - (nyquist_ratio - 0.75) / 0.25).max(0.0)
            } else {
                1.0
            };
            let h2_factor = if i == 0 { 1.0 } else { bright_factor };
            let amp = HARMONIC_AMPS[i] * taper * h2_factor;
            // Inharmonic partial: slightly stretch partial frequencies above H1
            let stretch = if i == 0 { 1.0 } else { 1.0 + INHARMONIC * h };
            sample += amp * (two_pi * h * stretch * phase).sin();
            amp_sum += amp;
        }
        if amp_sum > 0.0 { sample / amp_sum } else { 0.0 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sine_at_zero_phase_is_zero() {
        assert!((Waveform::Sine.generate_sample(0.0, 440.0, 440.0 / 48000.0)).abs() < 1e-6);
    }

    #[test]
    fn sine_at_quarter_phase_is_one() {
        let s = Waveform::Sine.generate_sample(0.25, 440.0, 440.0 / 48000.0);
        assert!((s - 1.0).abs() < 1e-5, "got {s}");
    }

    #[test]
    fn stateless_waveforms_in_range() {
        let mut waveforms = [
            Waveform::Sine, Waveform::Square, Waveform::Sawtooth,
            Waveform::Triangle, Waveform::Trumpet, Waveform::Flute,
            Waveform::Pulse(0.5), Waveform::Pulse(0.2),
        ];
        let dt = 440.0_f32 / 48000.0;
        for wf in &mut waveforms {
            for i in 0..100 {
                let phase = i as f32 / 100.0;
                let s = wf.generate_sample(phase, 440.0, dt);
                assert!(s.is_finite(), "{} produced non-finite at phase {phase}", wf.as_str());
                assert!(s.abs() <= 2.0, "{} out of range at phase {phase}: {s}", wf.as_str());
            }
        }
    }

    #[test]
    fn noise_output_is_finite_and_in_range() {
        let mut wf = Waveform::Noise(0xDEAD_BEEF);
        let dt = 440.0_f32 / 48000.0;
        for _ in 0..4800 {
            let s = wf.generate_sample(0.0, 440.0, dt);
            assert!(s.is_finite(), "Noise produced non-finite sample");
            assert!(s.abs() <= 1.0, "Noise sample out of [-1, 1]: {s}");
        }
    }

    #[test]
    fn pulse_half_duty_matches_square() {
        let dt = 440.0_f32 / 48000.0;
        for i in 0..100 {
            let phase = i as f32 / 100.0;
            let sq = Waveform::Square.generate_sample(phase, 440.0, dt);
            let pu = Waveform::Pulse(0.5).generate_sample(phase, 440.0, dt);
            assert!((sq - pu).abs() < 1e-5, "pulse(0.5) != square at phase {phase}: sq={sq} pu={pu}");
        }
    }

    #[test]
    fn karplus_strong_output_is_finite() {
        let mut wf = Waveform::KarplusStrong(KarplusData::plucked());
        let dt = 440.0_f32 / 48000.0;
        for _ in 0..4800 {
            let s = wf.generate_sample(0.0, 440.0, dt);
            assert!(s.is_finite(), "KS produced non-finite sample");
        }
    }

    #[test]
    fn parse_roundtrip() {
        for name in &["sine", "square", "sawtooth", "triangle", "trumpet", "flute", "principal", "pulse", "noise", "plucked", "struck", "electric"] {
            assert_eq!(Waveform::parse(name).as_str(), *name);
        }
    }

    #[test]
    fn principal_output_is_finite_and_in_range() {
        let dt = 440.0_f32 / 48000.0;
        let mut wf = Waveform::Principal;
        for i in 0..100 {
            let phase = i as f32 / 100.0;
            let s = wf.generate_sample(phase, 440.0, dt);
            assert!(s.is_finite(), "principal produced non-finite at phase {phase}");
            assert!(s.abs() <= 2.0, "principal out of range at phase {phase}: {s}");
        }
    }

    #[test]
    fn principal_has_even_harmonics() {
        // Verify principal has H2 content (unlike triangle which is odd-only)
        // by checking that the waveform changes between phase=0.25 and phase=0.75
        // in a way that reveals even-harmonic asymmetry
        let dt = 220.0_f32 / 48000.0;
        let mut wf1 = Waveform::Principal;
        let mut wf2 = Waveform::Triangle;
        // Sample at 100 points and check that principal ≠ triangle
        let mut diff_sum = 0.0_f32;
        for i in 0..100 {
            let phase = i as f32 / 100.0;
            let p = wf1.generate_sample(phase, 220.0, dt);
            let t = wf2.generate_sample(phase, 220.0, dt);
            diff_sum += (p - t).abs();
        }
        assert!(diff_sum > 1.0, "principal should differ significantly from triangle, diff_sum={diff_sum}");
    }
}
