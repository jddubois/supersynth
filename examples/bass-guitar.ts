/**
 * Plays the opening riff of "Seven Nation Army" by The White Stripes on bass guitar.
 * Tempo: 124 BPM  |  Key: A  |  Four repetitions of the iconic 7-note descending riff.
 *
 * Run with: node --import tsx examples/bass-guitar.ts
 */
import { BassGuitar } from '../src/index.ts';

const synth = new BassGuitar({
  sampleRate: 48000,
  masterVolume: 0.7,
  // Tight room reverb — minimal but adds punch on low strings
  reverb: { roomSize: 0.35, damping: 0.7, wet: 0.12, dry: 0.88, preDelayMs: 5 },
});
await synth.start();

const BPM  = 124;
const Q    = 60_000 / BPM;   // quarter  ≈ 484 ms
const DQ   = Q * 1.5;         // dotted quarter
const E_N  = Q * 0.5;         // eighth
const H    = Q * 2;           // half

import { E2, Fs2, G2, A2, C3 } from './util/notes.ts';

// The iconic 7-note descending riff: A A C A G F# E
// Rhythmic feel: DQ  E  E  Q  Q  Q  H
const riff: [number, number, number, number][] = [
  [A2,  0,       DQ * 0.92, 95],
  [A2,  DQ,      E_N * 0.9, 88],
  [C3,  DQ+E_N,  E_N * 0.9, 85],
  [A2,  DQ+2*E_N, Q * 0.9,  90],
  [G2,  DQ+3*E_N, Q * 0.9,  88],
  [Fs2, DQ+4*E_N, Q * 0.9,  85],
  [E2,  DQ+5*E_N, H * 0.92, 92],
];

const PHRASE_MS = DQ + 5 * E_N + H + Q; // phrase + one-beat gap before repeat

const REPEATS = 4;

console.log("Playing: Seven Nation Army (opening riff) — The White Stripes");
console.log(`Tempo: ${BPM} BPM  |  Key: A  |  Duration: ${((REPEATS * PHRASE_MS) / 1000).toFixed(1)}s\n`);

for (let rep = 0; rep < REPEATS; rep++) {
  const offset = rep * PHRASE_MS;
  for (const [note, startBeat, dur, vel] of riff) {
    setTimeout(() => synth.noteOn(note, vel),        offset + startBeat);
    setTimeout(() => synth.noteOff(note),             offset + startBeat + dur);
  }
}

await new Promise(r => setTimeout(r, REPEATS * PHRASE_MS + 2000));
synth.stop();
console.log('Done.');
