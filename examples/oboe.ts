/**
 * Plays the Adagio in G minor (attr. Albinoni / arr. Giazotto, 1958).
 * Tempo: 66 BPM  |  Key: G minor  |  ~16 bars
 *
 * One of the most haunting oboe solos in the repertoire.
 *
 * Run with: node --import tsx examples/oboe.ts
 */
import { Oboe } from '../src/index.ts';

const synth = new Oboe({
  sampleRate: 48000,
  masterVolume: 0.60,
  // Deep, reverent hall
  reverb: { roomSize: 0.85, damping: 0.42, wet: 0.36, dry: 0.64, preDelayMs: 20 },
});
await synth.start();

const BPM = 66;
const Q   = 60_000 / BPM;  // quarter ≈ 909 ms
const E_N = Q / 2;
const S   = Q / 4;
const DQ  = Q * 1.5;
const H   = Q * 2;
const DH  = Q * 3;
const W   = Q * 4;

import { G3, A3, Bb3, B3, C4, D4, Eb4, E4, F4, Fs4, G4, A4, Bb4, B4, C5, D5, Eb5, F5, G5 } from './util/notes.ts';

const seq: [number, number, number, number][] = [];
let t = 0;

function n(note: number, dur: number, vel = 80) {
  seq.push([note, t, dur * 0.93, vel]);
  t += dur;
}

// ── Adagio melody ─────────────────────────────────────────────────────────────
// Bar 1-2: opening statement on G
n(G4, DQ, 78); n(A4, E_N, 75);
n(Bb4, Q, 80); n(A4, Q, 78); n(G4, Q, 76); n(F4, Q, 74);

// Bar 3-4: descend to D, resolve
n(E4, Q, 78); n(D4, H, 82); n(Eb4, Q, 78);
n(D4, W, 80);

// Bar 5-6: rise again, Bb major character
n(Bb3, Q, 75); n(C4, Q, 77); n(D4, Q, 79); n(Eb4, Q, 81);
n(F4, DQ, 84); n(G4, E_N, 82);
n(F4, Q, 80); n(Eb4, Q, 78); n(D4, H, 76);

// Bar 7-8: expressive high phrase
n(G4, Q, 85); n(F4, E_N, 83); n(Eb4, E_N, 81);
n(D4, Q, 80); n(Eb4, Q, 82); n(F4, Q, 84); n(G4, Q, 86);
n(A4, DH, 90);
n(Bb4, Q, 88);

// Bar 9-10: second theme, C minor inflection
n(C5, Q, 92); n(Bb4, Q, 90); n(A4, Q, 88); n(G4, Q, 86);
n(F4, DQ, 85); n(G4, E_N, 83);
n(A4, Q, 85); n(Bb4, Q, 87); n(C5, H, 90);

// Bar 11-12: descending chromatic figure
n(D5, Q, 94); n(C5, E_N, 92); n(Bb4, E_N, 90);
n(A4, Q, 88); n(G4, Q, 86); n(F4, Q, 84); n(Eb4, Q, 82);
n(D4, H, 80); n(Eb4, Q, 78); n(F4, Q, 79);

// Bar 13-14: climax — highest notes
n(G4, Q, 88); n(A4, Q, 90); n(Bb4, Q, 92); n(C5, Q, 94);
n(D5, Q, 96); n(Eb5, Q, 98); n(F5, Q, 100); n(G5, Q, 102);
n(F5, DQ, 100); n(Eb5, E_N, 98);
n(D5, Q, 96); n(C5, H, 94);

// Bar 15-16: final descent and resolution
n(Bb4, Q, 90); n(A4, Q, 88); n(G4, Q, 86); n(F4, Q, 84);
n(E4, Q, 80); n(D4, Q, 78); n(C4, Q, 76); n(B3, Q, 74);
n(Bb3, Q, 72); n(A3, Q, 70); n(G3, W + H, 80);  // final G minor resolution, ring out

const totalMs = t + Q * 2;
console.log('Playing: Adagio in G minor — attr. Albinoni / arr. Giazotto');
console.log(`Tempo: ${BPM} BPM  |  Key: G minor  |  Duration: ${(totalMs / 1000).toFixed(1)}s\n`);

for (const [note, startMs, durationMs, velocity] of seq) {
  setTimeout(() => synth.noteOn(note, velocity), startMs);
  setTimeout(() => synth.noteOff(note), startMs + durationMs);
}

await new Promise(r => setTimeout(r, totalMs + 5000));
synth.stop();
console.log('Done.');
