/**
 * Plays "When the Saints Go Marching In" — one of the most iconic trombone pieces
 * in jazz and New Orleans brass band tradition.
 * Tempo: 108 BPM  |  Key: F major  |  Verse + chorus x2
 *
 * Run with: node --import tsx examples/trombone.ts
 */
import { Trombone } from '../src/index.ts';

const synth = new Trombone({
  sampleRate: 48000,
  masterVolume: 0.62,
  reverb: { roomSize: 0.58, damping: 0.5, wet: 0.22, dry: 0.78, preDelayMs: 12 },
});
await synth.start();

const BPM = 108;
const Q   = 60_000 / BPM;  // quarter ≈ 556 ms
const E_N = Q / 2;
const DQ  = Q * 1.5;
const H   = Q * 2;
const DH  = Q * 3;
const W   = Q * 4;

import { F3, G3, A3, Bb3, C4, D4, E4, F4, G4, A4, Bb4, C5, D5, F5 } from './util/notes.ts';

const seq: [number, number, number, number][] = [];
let t = 0;

function n(note: number, dur: number, vel = 88) {
  seq.push([note, t, dur * 0.88, vel]);
  t += dur;
}
function rest(dur: number) { t += dur; }

// ── "When the Saints Go Marching In" ─────────────────────────────────────────
// Played twice through — verse then chorus treatment

for (let rep = 0; rep < 2; rep++) {
  const loud = rep === 1 ? 10 : 0;  // louder on repeat

  // "Oh when the saints go marching in"
  rest(Q);                                     // pickup rest
  n(F4,  Q,  82+loud);                         // "Oh"
  n(A4,  Q,  85+loud);                         // "when"
  n(Bb4, Q,  88+loud);                         // "the"
  n(C5,  DH, 95+loud);                         // "saints" (long)

  n(F4,  Q,  82+loud);                         // "go"
  n(A4,  Q,  85+loud);                         // "march"
  n(Bb4, Q,  88+loud);                         // "ing"
  n(C5,  DH, 95+loud);                         // "in" (long)

  // "Oh when the saints go marching in" (repeat line)
  n(F4,  Q,  82+loud);
  n(A4,  Q,  85+loud);
  n(Bb4, Q,  88+loud);
  n(C5,  Q,  92+loud);
  n(A4,  Q,  88+loud);

  n(F4,  Q,  82+loud);
  n(A4,  Q,  85+loud);
  n(F4,  Q,  82+loud);
  n(A4,  H,  88+loud);

  // "Oh Lord I want to be in that number"
  n(G4,  H,  88+loud);
  n(G4,  Q,  85+loud);
  n(F4,  Q,  82+loud);

  n(F4,  Q,  82+loud);
  n(A4,  Q,  85+loud);
  n(C5,  Q,  90+loud);
  n(A4,  Q,  88+loud);

  n(C5,  DQ, 93+loud);
  n(Bb4, E_N, 90+loud);
  n(A4,  Q,   88+loud);
  n(G4,  Q,   85+loud);

  // "When the saints go marching in"
  n(F4,  Q,  82+loud);
  n(G4,  Q,  85+loud);
  n(A4,  Q,  88+loud);
  n(Bb4, Q,  90+loud);
  n(C5,  W,  95+loud);

  // ── Second phrase — higher register on repeat ───────────────────────────
  if (rep === 1) {
    n(F5,  Q,  98);
    n(F5,  Q,  98);
    n(F5,  H,  100);
    n(D5,  Q,  96);
    n(C5,  Q,  94);
    n(Bb4, Q,  92);
    n(A4,  Q,  90);
    n(G4,  Q,  88);
    n(F4,  W,  90);
  } else {
    rest(W * 2);  // instrumental rest before second verse
  }
}

const totalMs = t + Q * 2;
console.log('Playing: When the Saints Go Marching In — traditional New Orleans jazz');
console.log(`Tempo: ${BPM} BPM  |  Key: F major  |  Duration: ${(totalMs / 1000).toFixed(1)}s\n`);

for (const [note, startMs, durationMs, velocity] of seq) {
  setTimeout(() => synth.noteOn(note, velocity), startMs);
  setTimeout(() => synth.noteOff(note), startMs + durationMs);
}

await new Promise(r => setTimeout(r, totalMs + 3000));
synth.stop();
console.log('Done.');
