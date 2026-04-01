/**
 * Plays "Ode to Joy" from Beethoven's Symphony No. 9, Op. 125 (1824).
 * Tempo: 120 BPM  |  Key: D major  |  Two passes with a louder finish
 *
 * The crisp, percussive attack of the marimba suits the directness of
 * Beethoven's famous theme perfectly.
 *
 * Run with: node --import tsx examples/marimba.ts
 */
import { Marimba } from '../src/index.ts';

const synth = new Marimba({
  sampleRate: 48000,
  masterVolume: 0.68,
  // Moderate hall — marimba needs some bloom but stays present
  reverb: { roomSize: 0.62, damping: 0.50, wet: 0.22, dry: 0.78, preDelayMs: 10 },
});
await synth.start();

const BPM = 120;
const Q   = 60_000 / BPM;  // quarter = 500 ms
const E_N = Q / 2;
const DQ  = Q * 1.5;
const H   = Q * 2;

import { A3, Cs4, D4, E4, Fs4, G4, A4, B4, Cs5, D5, E5, Fs5, G5 } from './util/notes.ts';

const seq: [number, number, number, number][] = [];
let t = 0;

function n(note: number, dur: number, vel = 88) {
  seq.push([note, t, dur * 0.75, vel]);  // staccato — marimba decays naturally
  t += dur;
}
function r(dur: number) { t += dur; }

// ── Ode to Joy — 2 passes (louder and higher octave on second pass) ───────────
for (let rep = 0; rep < 2; rep++) {
  const loud = rep === 1 ? 10 : 0;
  const shift = rep === 1 ? 12 : 0;  // octave up on second pass

  // "Freude, schöner Götterfunken" — phrase 1
  n(E4 + shift, Q,  85+loud); n(E4 + shift, Q,  85+loud);
  n(Fs4 + shift, Q, 88+loud); n(G4 + shift, Q, 90+loud);
  n(G4 + shift, Q,  90+loud); n(Fs4 + shift, Q, 88+loud);
  n(E4 + shift, Q,  85+loud); n(D4 + shift, Q, 82+loud);

  n(Cs4 + shift, Q, 80+loud); n(Cs4 + shift, Q, 80+loud);
  n(D4 + shift, Q,  82+loud); n(E4 + shift,  Q, 85+loud);
  n(E4 + shift, DQ, 87+loud); n(D4 + shift, E_N, 84+loud);
  n(D4 + shift, H,  84+loud);

  // Phrase 2 (same as 1 with different ending)
  n(E4 + shift, Q,  85+loud); n(E4 + shift, Q,  85+loud);
  n(Fs4 + shift, Q, 88+loud); n(G4 + shift, Q, 90+loud);
  n(G4 + shift, Q,  90+loud); n(Fs4 + shift, Q, 88+loud);
  n(E4 + shift, Q,  85+loud); n(D4 + shift, Q, 82+loud);

  n(Cs4 + shift, Q, 80+loud); n(Cs4 + shift, Q, 80+loud);
  n(D4 + shift, Q,  82+loud); n(E4 + shift,  Q, 85+loud);
  n(D4 + shift, DQ, 84+loud); n(Cs4 + shift, E_N, 80+loud);
  n(Cs4 + shift, H, 80+loud);

  // Bridge — "Wer ein holdes Weib errungen"
  n(D4 + shift, Q,  84+loud); n(D4 + shift, Q,  84+loud);
  n(E4 + shift, Q,  85+loud); n(Cs4 + shift, Q, 80+loud);
  n(D4 + shift, Q,  84+loud); n(E4 + shift, E_N, 85+loud);
  n(Fs4 + shift, E_N, 87+loud); n(E4 + shift, Q, 85+loud);
  n(Cs4 + shift, Q, 80+loud);

  n(D4 + shift, Q,  84+loud); n(E4 + shift, E_N, 85+loud);
  n(Fs4 + shift, E_N, 87+loud); n(E4 + shift, Q, 85+loud);
  n(D4 + shift, Q,  82+loud); n(Cs4 + shift, Q, 80+loud);
  n(D4 + shift, Q,  84+loud); n(A3 + shift, Q, 78+loud);

  // Final phrase — same as phrase 1 ending
  n(E4 + shift, Q,  85+loud); n(E4 + shift, Q,  85+loud);
  n(Fs4 + shift, Q, 88+loud); n(G4 + shift, Q, 90+loud);
  n(G4 + shift, Q,  90+loud); n(Fs4 + shift, Q, 88+loud);
  n(E4 + shift, Q,  85+loud); n(D4 + shift, Q, 82+loud);

  n(Cs4 + shift, Q, 80+loud); n(Cs4 + shift, Q, 80+loud);
  n(D4 + shift, Q,  82+loud); n(E4 + shift,  Q, 85+loud);
  n(D4 + shift, DQ, 84+loud); n(Cs4 + shift, E_N, 80+loud);
  n(D4 + shift, H,  88+loud);

  r(H);  // gap before repeat
}

const totalMs = t + Q;
console.log('Playing: Ode to Joy — Ludwig van Beethoven (Symphony No. 9, Op. 125)');
console.log(`Tempo: ${BPM} BPM  |  Key: D major  |  Duration: ${(totalMs / 1000).toFixed(1)}s\n`);

for (const [note, startMs, durationMs, velocity] of seq) {
  setTimeout(() => synth.noteOn(note, velocity), startMs);
  setTimeout(() => synth.noteOff(note), startMs + durationMs);
}

await new Promise(r => setTimeout(r, totalMs + 2500));
synth.stop();
console.log('Done.');
