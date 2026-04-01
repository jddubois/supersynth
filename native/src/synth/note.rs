use super::oscillator::{Oscillator, OscillatorParams};

pub struct Note {
    pub midi_note: u8,
    pub frequency: f32,
    oscillators: Vec<Oscillator>,
    pub is_released: bool,
    sample_rate: f32,
}

impl Note {
    pub fn new(midi_note: u8, oscillator_params: Vec<OscillatorParams>, sample_rate: f32) -> Self {
        let frequency = midi_note_to_frequency(midi_note);
        let oscillators = oscillator_params
            .into_iter()
            .map(|p| Oscillator::new(p, sample_rate))
            .collect();
        Self { midi_note, frequency, oscillators, is_released: false, sample_rate }
    }

    /// Add a new oscillator to this note. If the note is already released, the oscillator
    /// starts in release phase so it doesn't sustain indefinitely.
    pub fn add_oscillator(&mut self, params: OscillatorParams) {
        let mut osc = Oscillator::new(params, self.sample_rate);
        if self.is_released {
            osc.release();
        }
        self.oscillators.push(osc);
    }

    /// Update the amplitude of all oscillators with the given id on this note.
    /// Used for real-time drawbar control without retriggering the note.
    pub fn update_oscillator_amplitude(&mut self, oscillator_id: u32, amplitude: f32) {
        for osc in &mut self.oscillators {
            if osc.oscillator_id() == oscillator_id {
                osc.update_amplitude(amplitude);
            }
        }
    }

    /// Begin the release phase on any oscillators tagged with the given id.
    pub fn remove_oscillator(&mut self, oscillator_id: u32) {
        for osc in &mut self.oscillators {
            if osc.oscillator_id() == oscillator_id && !osc.is_released {
                osc.release();
                return;
            }
        }
    }

    pub fn next_sample(&mut self) -> f32 {
        let mut sample = 0.0;
        for osc in &mut self.oscillators {
            sample += osc.next_sample();
        }
        self.oscillators.retain(|o| !o.is_finished());
        sample
    }

    pub fn release(&mut self) {
        self.is_released = true;
        for osc in &mut self.oscillators {
            osc.release();
        }
    }

    pub fn is_finished(&self) -> bool {
        self.oscillators.is_empty()
    }
}

pub fn midi_note_to_frequency(note: u8) -> f32 {
    440.0 * 2.0_f32.powf((note as f32 - 69.0) / 12.0)
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a4_is_440hz() {
        let freq = midi_note_to_frequency(69);
        assert!((freq - 440.0).abs() < 0.01, "A4 should be 440 Hz, got {freq}");
    }

    #[test]
    fn note_output_finite_until_finished() {
        use crate::synth::oscillator::OscillatorParams;
        use crate::synth::waveform::Waveform;
        let params = vec![OscillatorParams::new(midi_note_to_frequency(69), Waveform::Sine)];
        let mut note = Note::new(69, params, 48000.0);
        note.release();
        for _ in 0..48000 {
            let s = note.next_sample();
            assert!(s.is_finite(), "note produced non-finite sample");
            if note.is_finished() { break; }
        }
    }
}
