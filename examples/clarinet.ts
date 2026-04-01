/**
 * Plays the opening glissando and first theme from Gershwin's "Rhapsody in Blue" (1924).
 * Tempo: 90 BPM  |  Key: Bb major / blues inflected
 *
 * The clarinet glissando opening is one of the most recognisable moments in 20th-century
 * music — a trill on low E that slides up three octaves to high Bb.
 *
 * Run with: node --import tsx examples/clarinet.ts
 */
import { Clarinet } from '../src/index.ts';

const synth = new Clarinet({
  sampleRate: 48000,
  masterVolume: 0.62,
  reverb: { roomSize: 0.55, damping: 0.5, wet: 0.18, dry: 0.82, preDelayMs: 10 },
});
await synth.start();

const BPM = 90;
const Q   = 60_000 / BPM;   // quarter ≈ 667 ms
const E_N = Q / 2;
const S   = Q / 4;
const DQ  = Q * 1.5;
const H   = Q * 2;

// ── MIDI note numbers ────────────────────────────────────────────────────────��
import { E3, F3, G3, A3, Bb3, B3, C4, D4, Eb4, E4, F4, G4, A4, Bb4, B4, C5, D5, Eb5, E5, F5, G5, A5, Bb5 } from './util/notes.ts';

const seq: [number, number, number, number][] = [];

// ── Glissando: rapid chromatic ascent E3 → Bb5 ───────────────────────────────
// Approximated as a fast sequence of chromatic notes, accelerating as it rises
const glissNotes = [
  E3, F3, G3, Bb3, C4, D4, Eb4, F4, G4, A4, Bb4, C5, D5, Eb5, F5, G5, A5, Bb5,
];
let t = 0;
for (const note of glissNotes) {
  const dur = 55;
  seq.push([note, t, dur, 60 + Math.floor((t / (glissNotes.length * 60)) * 40)]);
  t += 60;
}
// Sustain the top Bb5 as a long trill-like held note
seq.push([Bb5, t, H * 0.9, 95]);
t += H + E_N;

// ── First theme: bluesy, swagger in Bb ────────────────────────────────────────
// The famous "walking" clarinet theme after the glissando
// Bar 1-2: signature syncopated theme
seq.push([Bb4,  t,       Q*0.9,  92]);   t += Q;
seq.push([A4,   t,       E_N*0.9, 88]);  t += E_N;
seq.push([G4,   t,       E_N*0.9, 85]);  t += E_N;
seq.push([Bb4,  t,       Q*0.9,  90]);   t += Q;
seq.push([A4,   t,       DQ*0.9, 88]);   t += DQ;
seq.push([G4,   t,       E_N*0.9, 85]);  t += E_N;

// Bar 3-4
seq.push([F4,   t,       Q*0.9,  85]);   t += Q;
seq.push([Eb4,  t,       E_N*0.9, 82]);  t += E_N;
seq.push([D4,   t,       E_N*0.9, 80]);  t += E_N;
seq.push([Eb4,  t,       Q*0.9,  83]);   t += Q;
seq.push([D4,   t,       DQ*0.9, 80]);   t += DQ;
seq.push([C4,   t,       E_N*0.9, 78]);  t += E_N;

// Bar 5-6: blue note lick
seq.push([Bb3,  t,       Q*0.9,  80]);   t += Q;
seq.push([C4,   t,       E_N*0.9, 82]);  t += E_N;
seq.push([D4,   t,       E_N*0.9, 84]);  t += E_N;
seq.push([Eb4,  t,       Q*0.9,  86]);   t += Q;
seq.push([F4,   t,       Q*0.9,  88]);   t += Q;
seq.push([G4,   t,       Q*0.9,  90]);   t += Q;
seq.push([A4,   t,       Q*0.9,  92]);   t += Q;

// Bar 7-8: ascending run to climax, hold
seq.push([Bb4,  t,       E_N*0.9, 94]);  t += E_N;
seq.push([C5,   t,       E_N*0.9, 96]);  t += E_N;
seq.push([D5,   t,       E_N*0.9, 98]);  t += E_N;
seq.push([Eb5,  t,       E_N*0.9, 100]); t += E_N;
seq.push([F5,   t,       H*0.95,  102]); t += H + Q;

// Bar 9-12: lyrical second phrase, more relaxed
seq.push([G4,   t,       DQ*0.9,  88]);  t += DQ;
seq.push([F4,   t,       E_N*0.9, 85]);  t += E_N;
seq.push([Eb4,  t,       Q*0.9,   83]);  t += Q;
seq.push([D4,   t,       DQ*0.9,  80]);  t += DQ;
seq.push([C4,   t,       E_N*0.9, 78]);  t += E_N;
seq.push([D4,   t,       Q*0.9,   82]);  t += Q;
seq.push([Eb4,  t,       Q*0.9,   84]);  t += Q;
seq.push([F4,   t,       Q*0.9,   86]);  t += Q;
seq.push([G4,   t,       DQ*0.9,  88]);  t += DQ;
seq.push([Bb4,  t,       E_N*0.9, 92]);  t += E_N;
seq.push([Bb4,  t,       H*0.95,  95]);  t += H + Q;

// Final cadential flourish
seq.push([Bb4,  t,       S*0.85,  90]);  t += S;
seq.push([A4,   t,       S*0.85,  88]);  t += S;
seq.push([G4,   t,       S*0.85,  86]);  t += S;
seq.push([F4,   t,       S*0.85,  84]);  t += S;
seq.push([Eb4,  t,       Q*0.9,   82]);  t += Q;
seq.push([D4,   t,       Q*0.9,   80]);  t += Q;
seq.push([C4,   t,       Q*0.9,   82]);  t += Q;
seq.push([Bb3,  t,       H*0.95,  88]);  t += H;

const totalMs = t + Q;
console.log('Playing: Rhapsody in Blue (opening glissando + first theme) — George Gershwin');
console.log(`Tempo: ${BPM} BPM  |  Key: Bb  |  Duration: ${(totalMs / 1000).toFixed(1)}s\n`);

for (const [note, startMs, durationMs, velocity] of seq) {
  setTimeout(() => synth.noteOn(note, velocity), startMs);
  setTimeout(() => synth.noteOff(note), startMs + durationMs);
}

await new Promise(r => setTimeout(r, totalMs + 2500));
synth.stop();
console.log('Done.');
