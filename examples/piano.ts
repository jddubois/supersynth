/**
 * Plays Debussy's Arabesque No. 1 in E major using the Karplus-Strong piano voice.
 * Run with: node --import tsx examples/midi-piano.ts
 */
import { Piano } from '../src/index.ts';
import {
  E2, A2, B2,
  Cs3, E3, Fs3, Gs3, A3, B3,
  Cs4, Ds4, E4, Fs4, Gs4, A4, B4,
  Cs5, Ds5, E5, Fs5, Gs5, A5, B5,
} from './util/notes.ts';

const synth = new Piano({
  sampleRate: 48000,
  masterVolume: 0.65,
  reverb: { roomSize: 0.72, damping: 0.45, wet: 0.28, dry: 0.72, preDelayMs: 15 },
});
await synth.start();

// Andantino con moto — "moderate with motion", ~96 BPM
const BPM = 96;
const Q = 60_000 / BPM;   // quarter note ≈ 625 ms
const T = Q / 3;            // triplet eighth ≈ 208 ms (the signature Arabesque feel)
const H = Q * 2;            // half note
const DQ = Q * 1.5;         // dotted quarter

// ── Sequence: [midiNote, startMs, durationMs, velocity] ──────────────────────
//
// Structure mirrors the Arabesque's three sections:
//   A  — E major, flowing triplet arpeggios (bars 1–16)
//   B  — A major / G# minor, warmer colour (bars 17–28)
//   A' — Return of opening theme, abbreviated (bars 29–36)
//
// Left-hand bass chords are played as slightly rolled arpeggios (staggered 30 ms).

const notes: [number, number, number, number][] = [

  // ── A THEME ─── E major ──────────────────────────────────────────────────────

  // Bar 1: rising E major arpeggio (triplets), peak G#5, then descend
  [E4,  0*T,  T*0.85,  60],
  [Gs4, 1*T,  T*0.85,  64],
  [B4,  2*T,  T*0.85,  70],
  [E5,  3*T,  T*0.85,  78],
  [Gs5, 4*T,  T*0.85,  85],
  [B5,  5*T,  T*0.85,  88],
  [Gs5, 6*T,  T*0.85,  84],
  [E5,  7*T,  T*0.85,  80],
  [Cs5, 8*T,  T*0.85,  76],
  [B4,  9*T,  T*0.85,  73],
  [Gs4, 10*T, T*0.85,  70],
  [E4,  11*T, T*0.85,  65],
  // Left: E major
  [E2,  0,    H*0.9,   55],
  [E3,  30,   H*0.9,   50],
  [Gs3, 60,   H*0.9,   48],
  [B3,  90,   H*0.9,   46],

  // Bar 2: melodic phrase — stepwise descent from E5
  [E5,  12*T, DQ*0.9,  88],
  [Ds5, 14*T, T*0.85,  82],
  [Cs5, 15*T, T*0.85,  80],
  [B4,  16*T, T*0.85,  78],
  [A4,  17*T, T*0.85,  75],
  [Gs4, 18*T, T*0.85,  72],
  [Fs4, 19*T, T*0.85,  70],
  [E4,  20*T, DQ*0.9,  72],
  [Fs4, 22*T, T*0.85,  74],
  [Gs4, 23*T, T*0.85,  76],
  // Left: B major
  [B2,  12*T, H*0.9,   52],
  [Fs3, 12*T+30, H*0.9, 48],
  [B3,  12*T+60, H*0.9, 46],

  // Bar 3: second ascending figure — A major colour
  [A3,  24*T, T*0.85,  62],
  [Cs4, 25*T, T*0.85,  66],
  [E4,  26*T, T*0.85,  70],
  [A4,  27*T, T*0.85,  76],
  [Cs5, 28*T, T*0.85,  82],
  [E5,  29*T, T*0.85,  86],
  [Cs5, 30*T, T*0.85,  83],
  [A4,  31*T, T*0.85,  80],
  [E4,  32*T, T*0.85,  76],
  [Cs4, 33*T, T*0.85,  72],
  [A3,  34*T, T*0.85,  68],
  [E3,  35*T, T*0.85,  63],
  // Left: A major
  [A2,  24*T, H*0.9,   52],
  [A3,  24*T+30, H*0.9, 48],
  [Cs4, 24*T+60, H*0.9, 46],

  // Bar 4: resolution back to E — gentle descent
  [B4,  36*T, H*0.9,   82],
  [A4,  39*T, T*0.85,  78],
  [Gs4, 40*T, T*0.85,  75],
  [Fs4, 41*T, T*0.85,  72],
  [E4,  42*T, H*0.9,   78],
  [Fs4, 45*T, T*0.85,  74],
  [Gs4, 46*T, T*0.85,  76],
  [A4,  47*T, T*0.85,  78],
  // Left: E major
  [E2,  36*T, H*0.9,   53],
  [E3,  36*T+30, H*0.9, 49],
  [Gs3, 36*T+60, H*0.9, 47],

  // Bars 5-8: repeat of A theme with slight variation (higher register peak)
  [E4,  48*T, T*0.85,  62],
  [Gs4, 49*T, T*0.85,  66],
  [B4,  50*T, T*0.85,  72],
  [E5,  51*T, T*0.85,  80],
  [Gs5, 52*T, T*0.85,  87],
  [B5,  53*T, T*0.85,  90],
  [A5,  54*T, T*0.85,  87],
  [Fs5, 55*T, T*0.85,  84],
  [E5,  56*T, T*0.85,  80],
  [Cs5, 57*T, T*0.85,  77],
  [A4,  58*T, T*0.85,  73],
  [Fs4, 59*T, T*0.85,  68],
  [E2,  48*T, H*0.9,   53], [E3, 48*T+30, H*0.9, 49], [Gs3, 48*T+60, H*0.9, 47],

  // Bar 6: B major phrase, stepping up
  [Fs4, 60*T, T*0.85,  70],
  [B4,  61*T, T*0.85,  75],
  [Ds5, 62*T, T*0.85,  80],
  [Fs5, 63*T, T*0.85,  86],
  [B5,  64*T, H*0.9,   90],
  [A5,  67*T, T*0.85,  86],
  [Fs5, 68*T, T*0.85,  83],
  [Ds5, 69*T, T*0.85,  80],
  [B4,  70*T, T*0.85,  76],
  [A4,  71*T, T*0.85,  72],
  [B2,  60*T, H*0.9,   52], [Fs3, 60*T+30, H*0.9, 48], [Ds4, 60*T+60, H*0.9, 46],

  // Bar 7: F# minor color
  [Fs4, 72*T, T*0.85,  68],
  [A4,  73*T, T*0.85,  72],
  [Cs5, 74*T, T*0.85,  78],
  [Fs5, 75*T, T*0.85,  84],
  [A5,  76*T, T*0.85,  88],
  [Cs5, 77*T, T*0.85,  85],
  [A4,  78*T, T*0.85,  81],
  [Fs4, 79*T, T*0.85,  77],
  [E4,  80*T, T*0.85,  73],
  [Cs4, 81*T, T*0.85,  70],
  [A3,  82*T, T*0.85,  67],
  [Fs3, 83*T, T*0.85,  63],
  [Fs3, 72*T, H*0.9,   51], [A3, 72*T+30, H*0.9, 47], [Cs4, 72*T+60, H*0.9, 46],

  // Bar 8: Cadential resolution — E major
  [E4,  84*T, H*0.9,   76],
  [Gs4, 87*T, T*0.85,  74],
  [B4,  88*T, T*0.85,  76],
  [E5,  89*T, T*0.85,  80],
  [Gs4, 90*T, T*0.85,  77],
  [E4,  91*T, T*0.85,  74],
  [E2,  84*T, H*0.9,   55], [E3, 84*T+30, H*0.9, 51], [Gs3, 84*T+60, H*0.9, 49], [B3, 84*T+90, H*0.9, 47],

  // ── B THEME ─── A major / G# minor (warmer, more lyrical) ───────────────────

  // Bar 9: A major — gentle ascending phrase
  [A3,  96*T, T*0.85,  68],
  [E4,  97*T, T*0.85,  73],
  [A4,  98*T, T*0.85,  78],
  [Cs5, 99*T, H*0.9,   85],
  [B4,  102*T, T*0.85, 82],
  [A4,  103*T, T*0.85, 80],
  [Gs4, 104*T, T*0.85, 78],
  [Fs4, 105*T, T*0.85, 75],
  [E4,  106*T, T*0.85, 72],
  [Cs4, 107*T, T*0.85, 70],
  [A2,  96*T, H*0.9,   53], [A3, 96*T+30, H*0.9, 49], [Cs4, 96*T+60, H*0.9, 47],

  // Bar 10: G# minor color — tension
  [Gs4, 108*T, T*0.85, 72],
  [B4,  109*T, T*0.85, 76],
  [Ds5, 110*T, T*0.85, 80],
  [Gs5, 111*T, H*0.9,  88],
  [Fs5, 114*T, T*0.85, 84],
  [Ds5, 115*T, T*0.85, 82],
  [B4,  116*T, T*0.85, 79],
  [Gs4, 117*T, T*0.85, 76],
  [Fs4, 118*T, T*0.85, 73],
  [Ds4, 119*T, T*0.85, 70],
  [Gs3, 108*T, H*0.9,  52], [B3, 108*T+30, H*0.9, 48], [Ds4, 108*T+60, H*0.9, 47],

  // Bar 11: E major — partial resolution
  [E4,  120*T, T*0.85, 70],
  [Gs4, 121*T, T*0.85, 74],
  [B4,  122*T, T*0.85, 78],
  [E5,  123*T, DQ*0.9, 85],
  [Cs5, 125*T, T*0.85, 82],
  [B4,  126*T, T*0.85, 79],
  [Gs4, 127*T, T*0.85, 75],
  [E4,  128*T, H*0.9,  72],
  [E2,  120*T, H*0.9,  53], [E3, 120*T+30, H*0.9, 49], [B3, 120*T+60, H*0.9, 47],

  // Bar 12: A major cadence leading to return
  [Cs4, 132*T, T*0.85, 70],
  [E4,  133*T, T*0.85, 74],
  [A4,  134*T, T*0.85, 78],
  [Cs5, 135*T, T*0.85, 82],
  [E5,  136*T, T*0.85, 86],
  [Cs5, 137*T, T*0.85, 83],
  [A4,  138*T, T*0.85, 79],
  [E4,  139*T, T*0.85, 75],
  [Cs4, 140*T, T*0.85, 72],
  [A3,  141*T, T*0.85, 68],
  [E3,  142*T, T*0.85, 64],
  [Cs3, 143*T, T*0.85, 60],
  [A2,  132*T, H*0.9,  53], [E3, 132*T+30, H*0.9, 49],

  // ── A' THEME — abbreviated return ───────────────────────────────────────────

  // Bar 13: Opening triplet arpeggio returns — slightly softer
  [E4,  144*T, T*0.85, 58],
  [Gs4, 145*T, T*0.85, 62],
  [B4,  146*T, T*0.85, 68],
  [E5,  147*T, T*0.85, 74],
  [Gs5, 148*T, T*0.85, 80],
  [B5,  149*T, T*0.85, 83],
  [Gs5, 150*T, T*0.85, 80],
  [E5,  151*T, T*0.85, 77],
  [Cs5, 152*T, T*0.85, 74],
  [B4,  153*T, T*0.85, 71],
  [Gs4, 154*T, T*0.85, 67],
  [E4,  155*T, T*0.85, 62],
  [E2,  144*T, H*0.9,  51], [E3, 144*T+30, H*0.9, 47], [Gs3, 144*T+60, H*0.9, 45],

  // Bar 14: reprise of melodic descent
  [E5,  156*T, DQ*0.9, 82],
  [Ds5, 158*T, T*0.85, 78],
  [Cs5, 159*T, T*0.85, 76],
  [B4,  160*T, T*0.85, 74],
  [A4,  161*T, T*0.85, 71],
  [Gs4, 162*T, T*0.85, 68],
  [Fs4, 163*T, T*0.85, 65],
  [E4,  164*T, H*0.9,  70],
  [B2,  156*T, H*0.9,  50], [Fs3, 156*T+30, H*0.9, 46], [B3, 156*T+60, H*0.9, 44],

  // Bar 15: E major ascent, building to final cadence
  [E4,  168*T, T*0.85, 62],
  [Gs4, 169*T, T*0.85, 66],
  [B4,  170*T, T*0.85, 72],
  [E5,  171*T, T*0.85, 78],
  [Gs5, 172*T, T*0.85, 84],
  [E5,  173*T, T*0.85, 82],
  [Cs5, 174*T, T*0.85, 79],
  [A4,  175*T, T*0.85, 75],
  [Gs4, 176*T, T*0.85, 72],
  [Fs4, 177*T, T*0.85, 69],
  [E4,  178*T, T*0.85, 66],
  [Cs4, 179*T, T*0.85, 62],
  [E2,  168*T, H*0.9,  52], [E3, 168*T+30, H*0.9, 48], [Gs3, 168*T+60, H*0.9, 46],

  // Bar 16: Final resolution — E major, let it ring
  [B3,  180*T, DQ*0.9, 72],
  [E4,  183*T, DQ*0.9, 78],
  [Gs4, 186*T, DQ*0.9, 82],
  [B4,  189*T, H*0.9,  85],
  [E5,  192*T, H*0.9,  88],
  // Rolled E major chord in the bass, let everything sustain
  [E2,  180*T, H*2*0.9, 60],
  [E3,  180*T+30, H*2*0.9, 56],
  [Gs3, 180*T+60, H*2*0.9, 53],
  [B3,  180*T+90, H*2*0.9, 50],
  [E4,  180*T+120, H*2*0.9, 48],
];

const totalMs = 196 * T + H * 3;  // last note + generous ring-out

console.log('Playing: Arabesque No. 1 — Claude Debussy');
console.log(`Tempo: ${BPM} BPM (Andantino con moto)  |  Key: E major  |  Duration: ${(totalMs / 1000).toFixed(1)}s\n`);

for (const [note, startMs, durationMs, velocity] of notes) {
  setTimeout(() => synth.noteOn(note, velocity), startMs);
  setTimeout(() => synth.noteOff(note), startMs + durationMs);
}

await new Promise(resolve => setTimeout(resolve, totalMs + 3000));
synth.stop();
console.log('Done.');
