/**
 * Plays the main theme from "Axel F" (Beverly Hills Cop, 1984) by Harold Faltermeyer.
 * Tempo: 109 BPM  |  Key: F minor  |  Iconic 80s digital synth lead
 *
 * Run with: node --import tsx examples/synth-lead.ts
 */
import { SynthLead } from '../src/index.ts';

const synth = new SynthLead({
  sampleRate: 48000,
  masterVolume: 0.60,
  reverb: { roomSize: 0.5, damping: 0.55, wet: 0.18, dry: 0.82, preDelayMs: 8 },
});
await synth.start();

const BPM = 109;
const Q   = 60_000 / BPM;  // quarter ≈ 550 ms
const E_N = Q / 2;
const S   = Q / 4;
const DQ  = Q * 1.5;
const H   = Q * 2;

import { F3, Ab3, Bb3, C4, Db4, Eb4, F4, G4, Ab4, Bb4, C5, Db5, Eb5, F5 } from './util/notes.ts';

const seq: [number, number, number, number][] = [];
let t = 0;

function n(note: number, dur: number, vel = 90) {
  seq.push([note, t, dur * 0.85, vel]);
  t += dur;
}
function r(dur: number) { t += dur; }

// ── Axel F main theme — 4 repetitions ────────────────────────────────────────
for (let rep = 0; rep < 4; rep++) {
  const loud = rep >= 2 ? 8 : 0;  // build volume on second half

  // Bar 1-2: signature opening motif (descending-ascending figure)
  n(Ab4, E_N, 95+loud); r(E_N);
  n(Ab4, S,   92+loud); n(Bb4, S, 90+loud);
  n(Ab4, Q,   92+loud); n(F4, Q, 88+loud);

  n(Ab4, E_N, 90+loud); r(E_N);
  n(C5,  E_N, 95+loud); r(E_N);
  n(Bb4, Q, 92+loud); n(Ab4, Q, 90+loud);

  // Bar 3-4
  n(Eb4, E_N, 88+loud); r(E_N);
  n(Eb4, S,   85+loud); n(F4, S, 87+loud);
  n(Eb4, Q,   85+loud); n(C4, Q, 82+loud);

  n(Eb4, E_N, 85+loud); r(E_N);
  n(Ab4, E_N, 90+loud); r(E_N);
  n(G4,  Q,   88+loud); n(Ab4, Q, 90+loud);

  // Bar 5-6: second phrase, step up
  n(Bb4, E_N, 92+loud); r(E_N);
  n(Bb4, S,   90+loud); n(C5, S, 92+loud);
  n(Bb4, Q,   90+loud); n(Ab4, Q, 88+loud);

  n(Bb4, E_N, 90+loud); r(E_N);
  n(Eb5, E_N, 97+loud); r(E_N);
  n(Db5, Q,   95+loud); n(C5,  Q, 93+loud);

  // Bar 7-8: resolve back down, rest before repeat
  n(Ab4, E_N, 90+loud); r(E_N);
  n(Ab4, S,   88+loud); n(Bb4, S, 90+loud);
  n(Ab4, Q,   88+loud); n(F4, Q, 85+loud);

  n(Eb4, Q,  82+loud); n(F4, Q, 85+loud);
  n(Ab4, H,  90+loud);
  r(H);  // gap before repeat
}

const totalMs = t + Q;
console.log('Playing: Axel F (Beverly Hills Cop theme) — Harold Faltermeyer');
console.log(`Tempo: ${BPM} BPM  |  Key: F minor  |  Duration: ${(totalMs / 1000).toFixed(1)}s\n`);

for (const [note, startMs, durationMs, velocity] of seq) {
  setTimeout(() => synth.noteOn(note, velocity), startMs);
  setTimeout(() => synth.noteOff(note), startMs + durationMs);
}

await new Promise(r => setTimeout(r, totalMs + 2500));
synth.stop();
console.log('Done.');
