/**
 * Plays the main hymn theme from Holst's "Jupiter" (The Planets, Op. 32, 1914–16).
 * Tempo: 60 BPM  |  Key: C major  |  ~16 bars
 *
 * "Jupiter" contains the melody "I Vow to Thee, My Country" — one of the most
 * celebrated horn/brass themes in the orchestral repertoire.
 *
 * Run with: node --import tsx examples/french-horn.ts
 */
import { FrenchHorn } from '../src/index.ts';

const synth = new FrenchHorn({
  sampleRate: 48000,
  masterVolume: 0.60,
  // Large hall reverb — horns need to fill a concert hall
  reverb: { roomSize: 0.88, damping: 0.38, wet: 0.38, dry: 0.62, preDelayMs: 22 },
});
await synth.start();

const BPM = 60;
const Q   = 60_000 / BPM;  // quarter = 1000 ms
const E_N = Q / 2;
const DQ  = Q * 1.5;
const H   = Q * 2;
const DH  = Q * 3;
const W   = Q * 4;

import { G3, A3, B3, C4, D4, E4, F4, G4, A4, B4, C5, D5, E5, F5, G5 } from './util/notes.ts';

// ── Sequence: [note, startMs, durationMs, velocity] ──────────────────────────
const seq: [number, number, number, number][] = [];
let t = 0;

function n(note: number, dur: number, vel = 85) {
  seq.push([note, t, dur * 0.92, vel]);
  t += dur;
}

// ── Jupiter Hymn — 16 bars ────────────────────────────────────────────────────
// Phrase 1 (bars 1-4): stepwise, rising character
n(C4, Q, 80); n(D4, Q, 82); n(E4, Q, 85); n(G4, Q, 88);
n(E4, Q, 85); n(D4, Q, 82); n(E4, Q, 85); n(F4, H, 88);
n(E4, Q, 85); n(D4, Q, 82); n(C4, H, 80);
n(D4, Q, 82); n(E4, E_N, 84); n(F4, E_N, 86); n(E4, Q, 84); n(D4, H, 82);

// Phrase 2 (bars 5-8): sequencing up
n(E4, Q, 85); n(F4, Q, 87); n(G4, Q, 90); n(A4, Q, 92);
n(G4, Q, 90); n(F4, Q, 87); n(E4, Q, 85); n(D4, H, 82);
n(E4, Q, 85); n(F4, Q, 87); n(G4, Q, 90); n(A4, Q, 92);
n(B4, DQ, 95); n(C5, E_N, 97); n(C5, H, 98);

// Phrase 3 (bars 9-12): full upper range, climax
n(B4, Q, 96); n(A4, Q, 94); n(G4, Q, 92); n(F4, Q, 90);
n(E4, Q, 88); n(F4, Q, 90); n(G4, Q, 92); n(A4, H, 94);
n(G4, Q, 90); n(F4, Q, 88); n(E4, Q, 85); n(D4, Q, 82);
n(C4, DQ, 80); n(D4, E_N, 82); n(E4, H, 85);

// Phrase 4 (bars 13-16): broad final statement
n(G4, Q, 90); n(A4, Q, 92); n(B4, Q, 95); n(C5, Q, 97);
n(B4, Q, 95); n(A4, Q, 92); n(G4, Q, 90); n(F4, H, 88);
n(E4, Q, 85); n(D4, Q, 82); n(C4, Q, 80); n(D4, Q, 82);
n(G3, DH, 78);             // final low G — resolves back to earth
n(C4, W, 88);               // final C major resolution — let it ring

const totalMs = t + Q * 2;
console.log('Playing: Jupiter (The Planets, Op. 32) — Gustav Holst');
console.log(`Tempo: ${BPM} BPM  |  Key: C major  |  Duration: ${(totalMs / 1000).toFixed(1)}s\n`);

for (const [note, startMs, durationMs, velocity] of seq) {
  setTimeout(() => synth.noteOn(note, velocity), startMs);
  setTimeout(() => synth.noteOff(note), startMs + durationMs);
}

await new Promise(r => setTimeout(r, totalMs + 4000));
synth.stop();
console.log('Done.');
