/**
 * Plays the opening ritornello theme from Vivaldi's "Spring" (The Four Seasons, Op. 8 No. 1).
 * Tempo: 128 BPM (Allegro)  |  Key: E major  |  ~16 bars
 *
 * Run with: node --import tsx examples/violin.ts
 */
import { Violin } from '../src/index.ts';

const synth = new Violin({
  sampleRate: 48000,
  masterVolume: 0.6,
  reverb: { roomSize: 0.6, damping: 0.5, wet: 0.25, dry: 0.75, preDelayMs: 12 },
});
await synth.start();

const BPM = 128;
const Q   = 60_000 / BPM;   // quarter ≈ 469 ms
const E_N = Q / 2;            // eighth  ≈ 234 ms
const DQ  = Q * 1.5;          // dotted quarter
const H   = Q * 2;

import { E3, Fs3, Gs3, A3, B3, Cs4, Ds4, E4, Fs4, Gs4, A4, B4, Cs5, Ds5, E5, Fs5, Gs5, A5, B5 } from './util/notes.ts';

// ── Sequence: [note, startMs, durationMs, velocity] ──────────────────────────
const notes: [number, number, number, number][] = [

  // ── Ritornello A (bars 1–4): three ascending E notes, ornamental descent ──────
  // Bar 1: E5 E5 E5 — triumphant fanfare feel
  [E5,  0*E_N,   E_N*0.9, 90], [E5,  1*E_N,  E_N*0.9, 90], [E5,  2*E_N,  E_N*0.9, 90],
  [Cs5, 3*E_N,   E_N*0.9, 84], [Ds5, 4*E_N,  E_N*0.9, 87], [E5,  5*E_N,  Q*0.88,  92],

  // Bar 2: step down, B4 fanfare
  [B4,  8*E_N,   E_N*0.9, 85], [B4,  9*E_N,  E_N*0.9, 85], [B4, 10*E_N,  E_N*0.9, 85],
  [Gs4, 11*E_N,  E_N*0.9, 80], [A4,  12*E_N, E_N*0.9, 82], [B4, 13*E_N,  Q*0.88,  88],

  // Bar 3: ascending E major scale from E4
  [E4,  16*E_N,  E_N*0.9, 78], [Fs4, 17*E_N, E_N*0.9, 80], [Gs4, 18*E_N, E_N*0.9, 82],
  [A4,  19*E_N,  E_N*0.9, 84], [B4,  20*E_N, E_N*0.9, 86], [Cs5, 21*E_N, E_N*0.9, 88],

  // Bar 4: ascending to peak, then cadence
  [Ds5, 22*E_N,  E_N*0.9, 90], [E5,  23*E_N, DQ*0.88, 95],
  [Cs5, 26*E_N,  E_N*0.9, 88], [B4,  27*E_N, Q*0.88,  85],

  // ── Ritornello B (bars 5–8): second motif, A major colour ───────────────────
  // Bar 5-6: A major ascending arpeggio
  [A3,  32*E_N,  E_N*0.9, 75], [Cs4, 33*E_N, E_N*0.9, 78],
  [E4,  34*E_N,  E_N*0.9, 82], [A4,  35*E_N, E_N*0.9, 86],
  [Cs5, 36*E_N,  E_N*0.9, 90], [E5,  37*E_N, E_N*0.9, 93],
  [Cs5, 38*E_N,  E_N*0.9, 90], [A4,  39*E_N, E_N*0.9, 87],

  // Bar 7: descending chromatic ornament, E major
  [Gs5, 40*E_N,  E_N*0.9, 92], [Fs5, 41*E_N, E_N*0.9, 90],
  [E5,  42*E_N,  E_N*0.9, 88], [Ds5, 43*E_N, E_N*0.9, 86],
  [Cs5, 44*E_N,  E_N*0.9, 84], [B4,  45*E_N, E_N*0.9, 82],

  // Bar 8: cadential resolution
  [A4,  46*E_N,  E_N*0.9, 80], [Gs4, 47*E_N, Q*0.88,  78],

  // ── Ritornello C (bars 9–12): return of opening, fuller ──────────────────────
  [E5,  48*E_N,  E_N*0.9, 92], [E5,  49*E_N, E_N*0.9, 92], [E5, 50*E_N, E_N*0.9, 92],
  [Cs5, 51*E_N,  E_N*0.9, 86], [Ds5, 52*E_N, E_N*0.9, 89], [E5, 53*E_N, Q*0.88,  95],
  [B4,  56*E_N,  E_N*0.9, 87], [B4,  57*E_N, E_N*0.9, 87], [B4, 58*E_N, E_N*0.9, 87],
  [Gs4, 59*E_N,  E_N*0.9, 82], [A4,  60*E_N, E_N*0.9, 84], [B4, 61*E_N, Q*0.88,  90],

  // Bars 13–14: descending E major scale (brilliant passage)
  [B5,  64*E_N,  E_N*0.9, 96], [A5,  65*E_N, E_N*0.9, 94],
  [Gs5, 66*E_N,  E_N*0.9, 92], [Fs5, 67*E_N, E_N*0.9, 90],
  [E5,  68*E_N,  E_N*0.9, 88], [Ds5, 69*E_N, E_N*0.9, 86],
  [Cs5, 70*E_N,  E_N*0.9, 84], [B4,  71*E_N, E_N*0.9, 82],
  [A4,  72*E_N,  E_N*0.9, 80], [Gs4, 73*E_N, E_N*0.9, 78],
  [Fs4, 74*E_N,  E_N*0.9, 76], [E4,  75*E_N, E_N*0.9, 74],

  // Bars 15–16: final E major cadence, let it ring
  [Fs4, 76*E_N,  E_N*0.9, 80], [Gs4, 77*E_N, E_N*0.9, 84],
  [A4,  78*E_N,  E_N*0.9, 88], [B4,  79*E_N, E_N*0.9, 90],
  [E5,  80*E_N,  H*0.95,  95],
];

const totalMs = 82 * E_N + H;
console.log('Playing: "Spring" (The Four Seasons, Op. 8 No. 1) — Antonio Vivaldi');
console.log(`Tempo: ${BPM} BPM  |  Key: E major  |  Duration: ${(totalMs / 1000).toFixed(1)}s\n`);

for (const [note, startMs, durationMs, velocity] of notes) {
  setTimeout(() => synth.noteOn(note, velocity), startMs);
  setTimeout(() => synth.noteOff(note), startMs + durationMs);
}

await new Promise(r => setTimeout(r, totalMs + 2500));
synth.stop();
console.log('Done.');
