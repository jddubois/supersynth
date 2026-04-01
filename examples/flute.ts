/**
 * Plays the Badinerie from Bach's Orchestral Suite No. 2 in B minor (BWV 1067).
 * Tempo: 138 BPM  |  Key: B minor  |  ~16 bars
 *
 * The Badinerie ("playfulness") is one of the most virtuosic and famous flute solos
 * in the Baroque repertoire — rapid 16th-note runs in a lively 2/4 metre.
 *
 * Run with: node --import tsx examples/flute.ts
 */
import { Flute } from '../src/index.ts';

const synth = new Flute({
  sampleRate: 48000,
  masterVolume: 0.58,
  reverb: { roomSize: 0.52, damping: 0.55, wet: 0.2, dry: 0.8, preDelayMs: 10 },
});
await synth.start();

const BPM = 138;
const Q   = 60_000 / BPM;  // quarter ≈ 435 ms
const S   = Q / 4;           // sixteenth ≈ 109 ms
const E_N = Q / 2;
const H   = Q * 2;
const D   = S * 0.88;        // note duration (crisp staccato appropriate for Badinerie)

import { A3, B3, Cs4, D4, E4, Fs4, G4, Gs4, A4, B4, Cs5, D5, E5, Fs5, G5, A5 } from './util/notes.ts';

const seq: [number, number, number, number][] = [];
let t = 0;

function n(note: number, dur: number, vel = 82) {
  seq.push([note, t, dur * D / S, vel]);
  t += dur * S;
}
function rest(steps: number) { t += steps * S; }

// ── BWV 1067 Badinerie — melody (simplified, first 16 bars) ──────────────────
// 2/4 time — 8 sixteenth notes per bar

// Bar 1: opening 8-note figure
n(B4, 1, 88); n(Cs5, 1, 85); n(D5, 1, 85); n(E5, 1, 87);
n(Fs5, 1, 90); n(G5, 1, 88); n(Fs5, 1, 86); n(E5, 1, 84);

// Bar 2: descending scale back
n(D5, 1, 84); n(Cs5, 1, 82); n(B4, 1, 82); n(A4, 1, 80);
n(G4, 1, 78); n(Fs4, 1, 76); n(E4, 1, 76); n(D4, 1, 75);

// Bar 3: ascending from D
n(E4, 1, 78); n(Fs4, 1, 80); n(G4, 1, 82); n(A4, 1, 84);
n(B4, 1, 86); n(Cs5, 1, 88); n(D5, 1, 90); n(E5, 1, 92);

// Bar 4: ornamental figure
n(Fs5, 1, 94); n(E5, 1, 92); n(D5, 1, 90); n(Cs5, 1, 88);
n(B4, 2, 85); rest(2); // brief rest then ornament
n(Fs4, 1, 80); n(E4, 1, 78);

// Bar 5: characteristic leaping figure
n(D4, 1, 78); n(A4, 1, 85); n(Fs4, 1, 82); n(A4, 1, 85);
n(G4, 1, 83); n(A4, 1, 85); n(Fs4, 1, 82); n(A4, 1, 85);

// Bar 6
n(E4, 1, 80); n(B4, 1, 86); n(Cs5, 1, 88); n(D5, 1, 90);
n(Cs5, 1, 88); n(B4, 1, 85); n(A4, 1, 83); n(Gs4, 1, 80);

// Bar 7-8: running 16th-note passage
n(A4, 1, 85); n(B4, 1, 87); n(Cs5, 1, 88); n(A4, 1, 85);
n(D5, 1, 90); n(Cs5, 1, 88); n(B4, 1, 86); n(A4, 1, 84);
n(Fs4, 1, 82); n(G4, 1, 83); n(A4, 1, 85); n(Fs4, 1, 82);
n(B4, 2, 88); rest(2); n(Fs4, 1, 82); n(E4, 1, 79);

// Bar 9-10: second section — minor feeling
n(D4, 1, 80); n(E4, 1, 82); n(Fs4, 1, 84); n(G4, 1, 86);
n(A4, 1, 88); n(B4, 1, 90); n(Cs5, 1, 92); n(D5, 1, 94);
n(E5, 1, 96); n(D5, 1, 94); n(Cs5, 1, 92); n(B4, 1, 90);
n(A4, 1, 88); n(G4, 1, 86); n(Fs4, 1, 84); n(E4, 1, 82);

// Bar 11-12: lyrical phrase
n(D4, 2, 80); n(Cs4, 2, 78); n(B3, 2, 76); n(A3, 2, 74);
n(B3, 1, 78); n(Cs4, 1, 80); n(D4, 1, 82); n(E4, 1, 84);
n(Fs4, 1, 86); n(G4, 1, 87); n(A4, 1, 88); n(B4, 1, 90);

// Bar 13-14: climactic ascending run
n(Cs5, 1, 90); n(D5, 1, 92); n(E5, 1, 94); n(Fs5, 1, 96);
n(G5, 1, 97); n(Fs5, 1, 95); n(E5, 1, 93); n(D5, 1, 91);
n(Cs5, 1, 88); n(B4, 1, 86); n(A4, 1, 84); n(Gs4, 1, 82);
n(A4, 1, 84); n(Fs4, 1, 80); n(E4, 1, 78); n(D4, 1, 76);

// Bars 15-16: final cadence — B minor close
n(E4, 1, 82); n(Fs4, 1, 84); n(G4, 1, 86); n(A4, 1, 88);
n(B4, 1, 90); n(A4, 1, 88); n(G4, 1, 86); n(Fs4, 1, 84);
n(E4, 1, 82); n(D4, 1, 80); n(Cs4, 1, 78); n(B3, 1, 76);
n(B3, 4, 88);  // final long note

const totalMs = t + Q;
console.log('Playing: Badinerie from Orchestral Suite No. 2 (BWV 1067) — J. S. Bach');
console.log(`Tempo: ${BPM} BPM  |  Key: B minor  |  Duration: ${(totalMs / 1000).toFixed(1)}s\n`);

for (const [note, startMs, durationMs, velocity] of seq) {
  setTimeout(() => synth.noteOn(note, velocity), startMs);
  setTimeout(() => synth.noteOff(note), startMs + durationMs);
}

await new Promise(r => setTimeout(r, totalMs + 2500));
synth.stop();
console.log('Done.');
