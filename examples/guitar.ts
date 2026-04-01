/**
 * Plays the intro to "Nothing Else Matters" by Metallica using the guitar voice.
 * Run with: node --import tsx examples/midi-guitar.ts
 */
import { Guitar } from '../src/index.ts';
import { E2, Fs2, A2, G3, A3, B3, C4, D4, E4, Fs4, A4 } from './util/notes.ts';

const synth = new Guitar({
  sampleRate: 48000,
  masterVolume: 0.7,
  reverb: { roomSize: 0.5, damping: 0.6, wet: 0.2, dry: 0.8, preDelayMs: 8 },
});
await synth.start();

// 67 BPM, 6/4 time — one arpeggio step per eighth note
const BPM = 67;
const EIGHTH_MS = (60_000 / BPM) / 2; // ≈ 448 ms

// [midiNote, eighthNoteOffset, velocity]
// 8 measures: Em Em Am Am D/F# D/F# Em Em
const sequence: [number, number, number][] = [
  // Measures 1–2: Em (open strings — E B E G E B)
  [E2, 0, 95], [B3, 1, 78], [E4, 2, 72], [G3, 3, 75], [E4, 4, 72], [B3, 5, 75],
  [E2, 6, 92], [B3, 7, 78], [E4, 8, 72], [G3, 9, 75], [E4, 10, 72], [B3, 11, 75],

  // Measures 3–4: Am (A E A C A E)
  [A2, 12, 95], [E4, 13, 78], [A4, 14, 72], [C4, 15, 75], [A4, 16, 72], [E4, 17, 75],
  [A2, 18, 92], [E4, 19, 78], [A4, 20, 72], [C4, 21, 75], [A4, 22, 72], [E4, 23, 75],

  // Measures 5–6: D/F# (F# A D F# D A)
  [Fs2, 24, 95], [A3, 25, 78], [D4, 26, 72], [Fs4, 27, 75], [D4, 28, 72], [A3, 29, 75],
  [Fs2, 30, 92], [A3, 31, 78], [D4, 32, 72], [Fs4, 33, 75], [D4, 34, 72], [A3, 35, 75],

  // Measures 7–8: Em (return)
  [E2, 36, 95], [B3, 37, 78], [E4, 38, 72], [G3, 39, 75], [E4, 40, 72], [B3, 41, 75],
  [E2, 42, 92], [B3, 43, 78], [E4, 44, 72], [G3, 45, 75], [E4, 46, 72], [B3, 47, 75],
];

const totalMs = 48 * EIGHTH_MS;

console.log('Playing: Nothing Else Matters (intro) — Metallica');
console.log(`Tempo: ${BPM} BPM  |  Duration: ${(totalMs / 1000).toFixed(1)}s\n`);

for (const [note, beat, velocity] of sequence) {
  setTimeout(() => synth.noteOn(note, velocity), beat * EIGHTH_MS);
  // Release slightly before the next note so arpeggios stay distinct
  setTimeout(() => synth.noteOff(note), (beat + 0.85) * EIGHTH_MS);
}

await new Promise(resolve => setTimeout(resolve, totalMs + 2000));
synth.stop();
console.log('Done.');
