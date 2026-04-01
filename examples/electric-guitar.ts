/**
 * Plays the intro riff from "Smoke on the Water" by Deep Purple.
 * Key: G minor  |  Tempo: 112 BPM  |  4-bar riff × 4 repeats
 *
 * Run with: node --import tsx examples/electric-guitar.ts
 */
import { ElectricGuitar } from '../src/index.ts';
import { G3, Bb3, C4, Db4 } from './util/notes.ts';

const synth = new ElectricGuitar({
  sampleRate: 48000,
  masterVolume: 0.70,
  // Moderate room reverb — present but not washy
  reverb: { roomSize: 0.65, damping: 0.50, wet: 0.20, dry: 0.80, preDelayMs: 12 },
});
await synth.start();

const BPM = 112;
const Q  = 60_000 / BPM;   // quarter note ≈ 535.7 ms

// ── 4-bar riff in beats (quarter-note units) ──────────────────────────────────
//
//  Phrase A (bar 1): G3 · Bb3  C4  [dotted-Q  E  Q  rest]
//  Phrase B (bar 2): G3 · Bb3  Db4  C4  [dotted-Q  E  E  Q  rest]
//  Phrase C (bar 3): same as A
//  Phrase D (bar 4): Bb3 ·  G3  [dotted-Q  dotted-H]
//
// [note, startBeat, durationBeats, velocity]
const riff: [number, number, number, number][] = [
  // Bar 1 — Phrase A
  [G3,  0.0,  1.35, 92],
  [Bb3, 1.5,  0.35, 88],
  [C4,  2.0,  0.85, 90],

  // Bar 2 — Phrase B (adds Db4 passing note)
  [G3,  4.0,  1.35, 92],
  [Bb3, 5.5,  0.35, 88],
  [Db4, 6.0,  0.35, 85],
  [C4,  6.5,  0.85, 90],

  // Bar 3 — Phrase C (= Phrase A)
  [G3,  8.0,  1.35, 92],
  [Bb3, 9.5,  0.35, 88],
  [C4,  10.0, 0.85, 90],

  // Bar 4 — Phrase D (resolution)
  [Bb3, 12.0, 1.35, 88],
  [G3,  13.5, 2.35, 85],   // held to end of bar
];

const BARS_PER_REPEAT = 16; // 4 bars × quarter notes per bar
const REPEATS = 4;
const totalBeats = BARS_PER_REPEAT * REPEATS;
const totalMs = totalBeats * Q;

console.log('Playing: Smoke on the Water (intro riff) — Deep Purple');
console.log(`Tempo: ${BPM} BPM  |  Key: G minor  |  Duration: ${(totalMs / 1000).toFixed(1)}s\n`);

for (let rep = 0; rep < REPEATS; rep++) {
  const offset = rep * BARS_PER_REPEAT;
  for (const [note, startBeat, durationBeats, velocity] of riff) {
    const startMs    = (offset + startBeat)   * Q;
    const durationMs =  durationBeats          * Q;
    setTimeout(() => synth.noteOn(note, velocity), startMs);
    setTimeout(() => synth.noteOff(note), startMs + durationMs);
  }
}

await new Promise(resolve => setTimeout(resolve, totalMs + 2000));
synth.stop();
console.log('Done.');
