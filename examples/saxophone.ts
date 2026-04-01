/**
 * Plays the iconic saxophone melody from "Careless Whisper" by George Michael (1984).
 * Tempo: 104 BPM  |  Key: D minor
 *
 * Run with: node --import tsx examples/saxophone.ts
 */
import { Saxophone } from '../src/index.ts';

const synth = new Saxophone({
  sampleRate: 48000,
  masterVolume: 0.62,
  reverb: { roomSize: 0.62, damping: 0.48, wet: 0.28, dry: 0.72, preDelayMs: 16 },
});
await synth.start();

const BPM = 104;
const Q   = 60_000 / BPM;  // quarter ≈ 577 ms
const E_N = Q / 2;
const S   = Q / 4;
const DQ  = Q * 1.5;
const H   = Q * 2;
const DH  = Q * 3;

import { D3, E3, F3, G3, A3, Bb3, C4, D4, E4, F4, G4, A4, Bb4, C5, D5, E5, F5, G5 } from './util/notes.ts';

// ── Sequence: [note, startMs, durationMs, velocity] ──────────────────────────
const seq: [number, number, number, number][] = [];
let t = 0;

function n(note: number, beats: number, vel = 85) {
  seq.push([note, t, beats * Q * 0.9, vel]);
  t += beats * Q;
}

// ── Iconic intro riff (repeated 2x) — the four-bar phrase everyone knows ──────
for (let rep = 0; rep < 2; rep++) {
  // Bar 1: descending figure A–G–F–E
  n(A4, 0.5, 92); n(G4, 0.5, 89); n(F4, 0.5, 86); n(E4, 0.5, 84);
  // Bar 2: resolve down
  n(D4, 0.5, 85); n(C4, 0.5, 82); n(D4, 0.5, 85); n(F4, 0.5, 88);
  // Bar 3: climb back up with blue notes
  n(G4, 0.5, 88); n(A4, 0.5, 90); n(Bb4, 0.5, 92); n(A4, 0.5, 90);
  // Bar 4: long phrase settling on D
  n(G4, 1.0, 88); n(F4, 0.5, 85); n(E4, 0.5, 82);
}

// ── Extended section — verse melody ──────────────────────────────────────────
// Bar 9: gentle start
n(F4, 1.0, 80); n(G4, 0.5, 83); n(A4, 0.5, 86);
// Bar 10
n(Bb4, 1.5, 90); n(A4, 0.5, 88);
// Bar 11
n(G4, 0.5, 86); n(F4, 0.5, 84); n(E4, 0.5, 82); n(D4, 0.5, 80);
// Bar 12
n(E4, 2.0, 82);

// Bar 13-14: climbing figure
n(G4, 0.5, 85); n(A4, 0.5, 87); n(Bb4, 0.5, 89); n(C5, 0.5, 91);
n(D5, 1.5, 95); n(C5, 0.5, 92);
// Bar 15-16: descending resolution
n(Bb4, 0.5, 89); n(A4, 0.5, 87); n(G4, 0.5, 85); n(F4, 0.5, 83);
n(E4, 1.0, 82); n(D4, 1.0, 85);

// ── Final riff statement, with high note flourish ────────────────────────────
n(A4, 0.5, 92); n(G4, 0.5, 89); n(F4, 0.5, 86); n(E4, 0.5, 84);
n(D4, 0.5, 85); n(C4, 0.5, 82); n(D4, 0.5, 85); n(F4, 0.5, 88);
n(G4, 0.5, 88); n(A4, 0.5, 90); n(Bb4, 0.5, 93); n(C5, 0.5, 96);
n(D5, 2.0, 98);   // hold the top note

const totalMs = t + Q;
console.log('Playing: Careless Whisper — George Michael');
console.log(`Tempo: ${BPM} BPM  |  Key: D minor  |  Duration: ${(totalMs / 1000).toFixed(1)}s\n`);

for (const [note, startMs, durationMs, velocity] of seq) {
  setTimeout(() => synth.noteOn(note, velocity), startMs);
  setTimeout(() => synth.noteOff(note), startMs + durationMs);
}

await new Promise(r => setTimeout(r, totalMs + 2500));
synth.stop();
console.log('Done.');
