/**
 * Plays the "Trumpet Voluntary" (Prince of Denmark's March) by Jeremiah Clarke.
 * Tempo: 96 BPM  |  Key: D major  |  ~16 bars
 *
 * Run with: node --import tsx examples/trumpet.ts
 */
import { Trumpet } from '../src/index.ts';

const synth = new Trumpet({
  sampleRate: 48000,
  masterVolume: 0.62,
  // Hall reverb — ceremonial brass needs space
  reverb: { roomSize: 0.78, damping: 0.4, wet: 0.32, dry: 0.68, preDelayMs: 18 },
});
await synth.start();

const BPM = 96;
const Q   = 60_000 / BPM;  // quarter ≈ 625 ms
const E_N = Q / 2;
const DQ  = Q * 1.5;
const H   = Q * 2;
const DH  = Q * 3;

import { D4, E4, Fs4, G4, A4, B4, Cs5, D5, E5, Fs5, G5, A5 } from './util/notes.ts';

// [note, startMs, durationMs, velocity]
const notes: [number, number, number, number][] = [

  // ── A SECTION ────────────────────���────────────────────────────────────────
  // Bar 1-2: characteristic dotted-note fanfare rhythm
  [D4,  0,     DQ*0.9,  90], [E4,  DQ, E_N*0.9, 85],
  [Fs4, 2*Q,   Q*0.9,   88], [A4,  3*Q,  DQ*0.9,  92],
  [G4,  3*Q+DQ, E_N*0.9, 86],
  [Fs4, 4*Q,   H*0.9,   85],

  // Bar 3-4
  [E4,  6*Q,   DQ*0.9,  88], [Fs4, 6*Q+DQ, E_N*0.9, 83],
  [G4,  7*Q,   Q*0.9,   86], [A4,  8*Q,    DQ*0.9,  92],
  [G4,  8*Q+DQ, E_N*0.9, 87],
  [Fs4, 9*Q,   H*0.9,   85],

  // Bar 5-6: ascending fanfare to high D
  [A4,  11*Q,  DQ*0.9,  90], [A4,  11*Q+DQ, E_N*0.9, 85],
  [Fs4, 12*Q,  E_N*0.9, 85], [G4,  12*Q+E_N, E_N*0.9, 87],
  [A4,  13*Q,  Q*0.9,   90], [B4,  14*Q, Q*0.9,   92],
  [Cs5, 15*Q,  H*0.9,   95],

  // Bar 7-8: D major scale descent, cadence
  [D5,  17*Q,  E_N*0.9, 98], [Cs5, 17*Q+E_N, E_N*0.9, 95],
  [B4,  18*Q,  E_N*0.9, 92], [A4,  18*Q+E_N, E_N*0.9, 90],
  [G4,  19*Q,  Q*0.9,   88], [Fs4, 20*Q,  Q*0.9,   85],
  [E4,  21*Q,  Q*0.9,   82], [D4,  22*Q,  DH*0.92, 90],

  // ── B SECTION ───────────────────────────────────────��─────────────────────
  // Bar 9-10: higher register, more stately
  [Fs4, 26*Q,  DQ*0.9,  88], [G4,  26*Q+DQ, E_N*0.9, 84],
  [A4,  27*Q,  Q*0.9,   90], [D5,  28*Q,   DQ*0.9,  95],
  [Cs5, 28*Q+DQ, E_N*0.9, 90],
  [B4,  29*Q,  H*0.9,   88],

  // Bar 11-12
  [A4,  31*Q,  DQ*0.9,  88], [B4,  31*Q+DQ, E_N*0.9, 85],
  [Cs5, 32*Q,  Q*0.9,   90], [D5,  33*Q,   DQ*0.9,  96],
  [Cs5, 33*Q+DQ, E_N*0.9, 92],
  [B4,  34*Q,  H*0.9,   90],

  // Bar 13-14: ascending run and peak
  [G4,  36*Q,  E_N*0.9, 85], [A4,  36*Q+E_N, E_N*0.9, 87],
  [B4,  37*Q,  E_N*0.9, 90], [Cs5, 37*Q+E_N, E_N*0.9, 92],
  [D5,  38*Q,  E_N*0.9, 95], [E5,  38*Q+E_N, E_N*0.9, 97],
  [Fs5, 39*Q,  Q*0.9,   100],
  [E5,  40*Q,  E_N*0.9, 96], [D5,  40*Q+E_N, E_N*0.9, 94],

  // Bar 15-16: final cadence, let the trumpet ring
  [Cs5, 41*Q,  Q*0.9,   92], [B4,  42*Q,  Q*0.9,   90],
  [A4,  43*Q,  Q*0.9,   88], [Fs4, 44*Q,  Q*0.9,   86],
  [G4,  45*Q,  Q*0.9,   88], [E4,  46*Q,  Q*0.9,   85],
  [D4,  47*Q,  DH*0.95, 95],
];

const totalMs = 50 * Q;
console.log('Playing: Trumpet Voluntary (Prince of Denmark\'s March) — Jeremiah Clarke');
console.log(`Tempo: ${BPM} BPM  |  Key: D major  |  Duration: ${(totalMs / 1000).toFixed(1)}s\n`);

for (const [note, startMs, durationMs, velocity] of notes) {
  setTimeout(() => synth.noteOn(note, velocity), startMs);
  setTimeout(() => synth.noteOff(note), startMs + durationMs);
}

await new Promise(r => setTimeout(r, totalMs + 3000));
synth.stop();
console.log('Done.');
