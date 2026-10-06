//! Sympathetic string resonance (piano).
//!
//! A piano's strings share one soundboard: every string whose damper is off (its key held, or
//! the sustain pedal down) picks up the partials of the notes being played that fall on its own
//! harmonics, and rings on with them. With the pedal down this is the bloom of the whole
//! undamped instrument; with it up, the strings of held keys still sing along with what is
//! played around them.
//!
//! Each string is a delay-line resonator tuned to its note, with a one-pole low-pass in the
//! loop (upper harmonics die sooner) and a loop gain set by its decay rate: slow while its
//! damper is off, the damper's rate when it rests on the string. The part's output drives the
//! strings, except that a string whose own note is sounding hears the output without that
//! note: the played note already is its string (the recording holds its own resonance), and
//! feeding it back would double it. Strings that are damped and silent are skipped.

/// Lowest string (MIDI) and number of strings.
pub const LOW_NOTE: u8 = 21;
pub const STRINGS: usize = 88;

/// Decay (dB/s) of an undamped string: 3 dB/s in the bass (T60 20 s) rising to 30 dB/s at
/// the top (2 s): the soundboard takes energy from the short treble strings faster.
fn free_rate(note: f32) -> f32 {
    let t = ((note - 21.0) / 87.0).clamp(0.0, 1.0);
    3.0 * (10.0f32).powf(t)
}

struct Res {
    buf: Box<[f32]>,
    mask: usize,
    w: usize,
    /// loop delay (samples), loop low-pass coefficient and state
    delay: f32,
    lp_a: f32,
    lp: f32,
    /// loop gain per pass, current and target (ramped per block)
    g: f32,
    g_target: f32,
    /// decay rates (dB/s): free and with the damper on
    free: f32,
    damped: f32,
    /// input gain (0 while the string's own note sounds), current and target
    input: f32,
    input_target: f32,
    pan: (f32, f32),
    /// the damper rests (all but) fully on the string; the string has no damper
    stopped: bool,
    undamped: bool,
    /// peak output of the last block: a damped string below the floor is skipped
    level: f32,
}

pub struct StringBank {
    sr: f32,
    strings: Vec<Res>,
}

/// Level below which a damped string is silent (and skipped).
const SILENT: f32 = 1e-7;

impl StringBank {
    /// `damper_rate(note)`: the damper's decay rate (dB/s) of each string, 0 for strings
    /// without a damper (the top of the keyboard), which take no part.
    pub fn new(sr: f32, damper_rate: impl Fn(f32) -> f32) -> Self {
        // a fixed per-string detune (±1.5 cents): the strings beat gently against the notes
        let mut seed = 0x9E37_79B9u32;
        let strings = (0..STRINGS)
            .map(|i| {
                let note = LOW_NOTE as f32 + i as f32;
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                let cents = (seed as f32 / u32::MAX as f32 - 0.5) * 3.0;
                let f0 = 440.0 * 2f32.powf((note - 69.0 + cents / 100.0) / 12.0);
                // loop low-pass: corner well above the fundamental, never above ~9 kHz
                let fc = (f0 * 16.0).min(9000.0).min(0.4 * sr);
                let lp_a = 1.0 - (-std::f32::consts::TAU * fc / sr).exp();
                // its phase delay at the fundamental shortens the line
                let delay = (sr / f0 - (1.0 - lp_a) / lp_a).max(2.0);
                let len = (delay.ceil() as usize + 4).next_power_of_two();
                let d = damper_rate(note);
                let pan = crate::dsp::pan_gains(0.55 * ((note - 64.0) / 40.0).clamp(-1.0, 1.0));
                Res {
                    buf: vec![0.0; len].into_boxed_slice(),
                    mask: len - 1,
                    w: 0,
                    delay,
                    lp_a,
                    lp: 0.0,
                    g: 0.0,
                    g_target: 0.0,
                    free: free_rate(note),
                    damped: if d > 0.0 { d.max(free_rate(note)) } else { free_rate(note) },
                    input: 0.0,
                    input_target: 0.0,
                    pan,
                    stopped: true,
                    undamped: d <= 0.0,
                    level: 0.0,
                }
            })
            .collect();
        Self { sr, strings }
    }

    /// Set each string's damper for the next block: `damp(i)` 0..1 (0 = off).
    pub fn set_state(&mut self, damp: impl Fn(usize) -> f32) {
        let sr = self.sr;
        for (i, s) in self.strings.iter_mut().enumerate() {
            let d = damp(i).clamp(0.0, 1.0);
            let rate = s.free + d * (s.damped - s.free);
            s.g_target = 10f32.powf(-rate * s.delay / sr / 20.0);
            // A damper resting on the string leaves it next to no response. Strings without a
            // damper rang while the instrument was recorded: their resonance is part of every
            // recording already.
            s.stopped = d > 0.99 || s.undamped;
            s.input_target = if s.stopped { 0.0 } else { 1.0 };
        }
    }

    /// Whether string `i` picks up sound in the next block (its damper is off).
    pub fn listening(&self, i: usize) -> bool {
        self.strings.get(i).is_some_and(|s| s.input_target > 0.0 || s.input > 0.0)
    }

    pub fn reset(&mut self) {
        for s in self.strings.iter_mut() {
            s.buf.fill(0.0);
            s.lp = 0.0;
            s.level = 0.0;
        }
    }

    /// Add the strings' sound to `out_l`/`out_r`, driven by `input` (mono) at `gain`. `own`:
    /// for strings whose own note sounds, that note's part of `input` (string index, signal),
    /// which they do not hear.
    pub fn process(&mut self, input: &[f32], own: &[(usize, &[f32])], out_l: &mut [f32], out_r: &mut [f32], gain: f32) {
        let n = input.len().min(out_l.len()).min(out_r.len());
        if n == 0 {
            return;
        }
        let inv_n = 1.0 / n as f32;
        for (i, s) in self.strings.iter_mut().enumerate() {
            // silent, with nothing to pick up (damped, or its own note sounding): skip
            if s.level < SILENT && s.input_target == 0.0 && s.input == 0.0 {
                if s.level > 0.0 {
                    s.buf.fill(0.0);
                    s.lp = 0.0;
                    s.level = 0.0;
                }
                s.g = s.g_target;
                continue;
            }
            let dg = (s.g_target - s.g) * inv_n;
            let di = (s.input_target - s.input) * inv_n;
            let (mut g, mut gi) = (s.g, s.input);
            let d_int = s.delay.floor() as usize;
            let fr = s.delay - d_int as f32;
            let (a, mask) = (s.lp_a, s.mask);
            let (mut lp, mut w) = (s.lp, s.w);
            let mut peak = 0.0f32;
            let (pl, pr) = (s.pan.0 * gain, s.pan.1 * gain);
            let mine = own.iter().find(|o| o.0 == i).map(|o| o.1);
            for k in 0..n {
                let x = match mine {
                    Some(m) => input[k] - m[k],
                    None => input[k],
                };
                g += dg;
                gi += di;
                let r0 = s.buf[(w + mask + 1 - d_int) & mask];
                let r1 = s.buf[(w + mask - d_int) & mask];
                let y = r0 + (r1 - r0) * fr;
                lp += a * (y - lp);
                let v = lp * g;
                s.buf[w] = v + x * gi;
                w = (w + 1) & mask;
                peak = peak.max(v.abs());
                out_l[k] += v * pl;
                out_r[k] += v * pr;
            }
            if lp.abs() < 1e-20 {
                lp = 0.0;
            }
            s.g = s.g_target;
            s.input = s.input_target;
            s.lp = lp;
            s.w = w;
            s.level = peak;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_undamped_string_rings_at_its_pitch_and_a_damped_one_stops() {
        let sr = 48000.0;
        let mut b = StringBank::new(sr, |_| 150.0);
        // A3 (220 Hz) undamped, everything else damped; drive with a 440 Hz burst (its 2nd harmonic)
        let a3 = 57 - LOW_NOTE as usize;
        b.set_state(|i| if i == a3 { 0.0 } else { 1.0 });
        let mut out_l = vec![0.0f32; 4800];
        let mut out_r = vec![0.0f32; 4800];
        let input: Vec<f32> = (0..4800).map(|k| (std::f32::consts::TAU * 440.0 * k as f32 / sr).sin() * 0.1).collect();
        for c in 0..75 {
            let (i, l, r) = (&input[c * 64..(c + 1) * 64], &mut out_l[c * 64..(c + 1) * 64], &mut out_r[c * 64..(c + 1) * 64]);
            b.process(i, &[], l, r, 1.0);
        }
        // then silence: the string rings on
        let zeros = vec![0.0f32; 64];
        let mut tail = vec![0.0f32; 48000];
        let mut tr = vec![0.0f32; 48000];
        for c in 0..750 {
            b.process(&zeros, &[], &mut tail[c * 64..(c + 1) * 64], &mut tr[c * 64..(c + 1) * 64], 1.0);
        }
        let rms = |x: &[f32]| (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt();
        let early = rms(&tail[..4800]);
        assert!(early > 1e-4, "undamped string rings: {early}");
        // its pitch: zero crossings of the tail ~ 440 Hz (the harmonic it picked up)
        let zc = tail[..24000].windows(2).filter(|w| w[0] < 0.0 && w[1] >= 0.0).count() as f32 / 0.5;
        assert!((zc - 440.0).abs() < 30.0, "rings at {zc} Hz");
        // damp it: gone within half a second
        b.set_state(|_| 1.0);
        let mut t2 = vec![0.0f32; 24000];
        let mut t2r = vec![0.0f32; 24000];
        for c in 0..375 {
            b.process(&zeros, &[], &mut t2[c * 64..(c + 1) * 64], &mut t2r[c * 64..(c + 1) * 64], 1.0);
        }
        assert!(rms(&t2[19200..]) < early * 1e-3, "damped string still rings");
    }

    #[test]
    fn a_sounding_note_does_not_feed_its_own_string() {
        let sr = 48000.0;
        let mut b = StringBank::new(sr, |_| 150.0);
        let a4 = 69 - LOW_NOTE as usize;
        // only A4 undamped, and A4 itself is the note sounding
        b.set_state(|i| if i == a4 { 0.0 } else { 1.0 });
        let input: Vec<f32> = (0..64).map(|k| (std::f32::consts::TAU * 440.0 * k as f32 / sr).sin()).collect();
        let mut l = vec![0.0f32; 64];
        let mut r = vec![0.0f32; 64];
        for _ in 0..200 {
            l.fill(0.0);
            r.fill(0.0);
            b.process(&input, &[(a4, &input)], &mut l, &mut r, 1.0);
        }
        assert!(l.iter().all(|v| v.abs() < 1e-6));
    }
}
