/**
 * Plays the Aria from Bach's Goldberg Variations (BWV 988, 1741).
 * Tempo: 52 BPM  |  Key: G major  |  ~16 bars of the sarabande melody
 *
 * The Goldberg Aria is one of the most celebrated pieces in the keyboard
 * repertoire — its ornate, unhurried melody is quintessential harpsichord.
 *
 * Run with: node --import tsx examples/harpsichord.ts
 */
import { Harpsichord } from '../src/index.ts';

const synth = new Harpsichord({
  sampleRate: 48000,
  masterVolume: 0.62,
  // Intimate chamber reverb — the harpsichord belongs in a small baroque hall
  reverb: { roomSize: 0.55, damping: 0.60, wet: 0.20, dry: 0.80, preDelayMs: 8 },
});
await synth.start();

const BPM = 52;
const Q   = 60_000 / BPM;  // quarter ≈ 1154 ms
const E_N = Q / 2;
const S   = Q / 4;
const DQ  = Q * 1.5;
const H   = Q * 2;
const DH  = Q * 3;

import { G2, D3, E3, Fs3, G3, A3, B3, C4, D4, E4, Fs4, G4, A4, B4, C5, D5, E5, Fs5, G5, A5 } from './util/notes.ts';

const seq: [number, number, number, number][] = [];
let t = 0;

function n(note: number, dur: number, vel = 75) {
  seq.push([note, t, dur * 0.94, vel]);
  t += dur;
}
function r(dur: number) { t += dur; }

// ── Goldberg Aria — 3/4 time ──────────────────────────────────────────────────
// Pickup note (beat 3 of bar 0)
r(H);          // beats 1–2 rest (for 3/4 feel)
n(D5, E_N, 72); // pickup — anacrusis into bar 1

// Section A (bars 1–8): first half of the Aria
// Bar 1
n(G5, DQ, 80); n(Fs5, E_N, 76); n(E5, E_N, 74); n(D5, E_N, 72);
// Bar 2
n(C5, Q,  76); n(B4, E_N, 74); n(A4, E_N, 72); n(G4, Q, 70);
r(E_N); n(D5, E_N, 72);
// Bar 3
n(G4, Q,  74); n(A4, E_N, 76); n(B4, E_N, 78); n(G4, Q, 74);
// Bar 4
n(C5, Q,  78); n(B4, Q, 76); n(A4, Q, 74);
// Bar 5
n(D5, DQ, 80); n(C5, E_N, 78); n(B4, E_N, 76); n(A4, E_N, 74);
// Bar 6
n(B4, Q,  76); n(C5, E_N, 78); n(D5, E_N, 80); n(G4, Q, 72);
// Bar 7
n(Fs4, Q, 74); n(G4, E_N, 76); n(A4, E_N, 78); n(D4, Q, 70);
// Bar 8 — first section close on D
n(G4, Q,  76); n(Fs4, E_N, 74); n(E4, E_N, 72); n(D4, H, 78);
r(E_N); n(D5, E_N, 72); // pickup to section B

// Section B (bars 9–16): second half, slightly more chromatic
// Bar 9
n(G5, DQ, 82); n(Fs5, E_N, 78); n(E5, E_N, 76); n(D5, E_N, 74);
// Bar 10
n(C5, E_N, 76); n(B4, E_N, 74); n(A4, Q, 72); n(B4, Q, 76);
r(E_N); n(E5, E_N, 78);
// Bar 11
n(Fs5, Q, 82); n(E5, E_N, 80); n(D5, E_N, 78); n(C5, Q, 76);
// Bar 12
n(D5, Q,  80); n(C5, Q, 78); n(B4, Q, 76);
// Bar 13
n(C5, Q,  80); n(D5, E_N, 82); n(E5, E_N, 84); n(Fs5, Q, 86);
// Bar 14
n(G5, Q,  88); n(Fs5, E_N, 86); n(E5, E_N, 84); n(D5, Q, 82);
// Bar 15
n(E5, Q,  84); n(D5, E_N, 82); n(C5, E_N, 80); n(B4, Q, 78);
// Bar 16 — full close on G, let it ring
n(A4, Q,  76); n(G4, DH, 80);  // final resolution

const totalMs = t + Q * 3;
console.log('Playing: Goldberg Variations, Aria — Johann Sebastian Bach (BWV 988)');
console.log(`Tempo: ${BPM} BPM  |  Key: G major  |  Duration: ${(totalMs / 1000).toFixed(1)}s\n`);

for (const [note, startMs, durationMs, velocity] of seq) {
  setTimeout(() => synth.noteOn(note, velocity), startMs);
  setTimeout(() => synth.noteOff(note), startMs + durationMs);
}

await new Promise(r => setTimeout(r, totalMs + 5000));
synth.stop();
console.log('Done.');
