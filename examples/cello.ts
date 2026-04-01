/**
 * Plays the Prelude from Bach's Cello Suite No. 1 in G major (BWV 1007).
 * Tempo: 72 BPM  |  Key: G major  |  ~16 bars of arpeggiated chords
 *
 * Each bar is a single chord played as 8 continuous sixteenth notes in a looping
 * ascending-descending figure — the hallmark of this famous prelude.
 *
 * Run with: node --import tsx examples/cello.ts
 */
import { Cello } from '../src/index.ts';

const synth = new Cello({
  sampleRate: 48000,
  masterVolume: 0.6,
  reverb: { roomSize: 0.65, damping: 0.5, wet: 0.22, dry: 0.78, preDelayMs: 14 },
});
await synth.start();

const BPM  = 72;
const Q    = 60_000 / BPM;  // quarter ≈ 833 ms
const S    = Q / 4;           // sixteenth ≈ 208 ms
const DUR  = S * 0.93;        // note duration (slight legato gap)

import { D2, E2, G2, A2, B2, C3, D3, E3, F3, Fs3, G3, A3, B3, C4, D4, E4, F4, Fs4, G4, A4, B4, C5, D5, E5 } from './util/notes.ts';

// ── Bar helper: schedule 8 sixteenth notes at offset ─────────────────────────
const allNotes: [number, number, number, number][] = [];
let t = 0;

function bar(pattern: number[], vel = 82) {
  for (const note of pattern) {
    allNotes.push([note, t, DUR, vel]);
    t += S;
  }
}

// ── Bach Cello Suite No. 1 Prelude — first 16 bars ───────────────────────────
// Each bar = 8 sixteenth notes (one chord, ascending-descending arpeggio figure)

bar([G2, D3, G3, B3, D4, G4, B3, G3]);               // Bar 1:  G major
bar([G2, D3, A3, D4, Fs4, A3, D4, Fs4]);              // Bar 2:  D major / G dom7
bar([G2, D3, G3, C4, E4, G4, E4, C4]);                // Bar 3:  C major (G over C)
bar([G2, D3, Fs3, C4, D4, A3, C4, Fs3]);              // Bar 4:  D7
bar([B2, D3, G3, B3, D4, G4, D4, B3]);                // Bar 5:  G major (B bass)
bar([E2, C3, E3, G3, C4, E4, C4, G3], 78);            // Bar 6:  C major (E bass) — softer
bar([A2, C3, E3, A3, C4, E4, C4, A3], 78);            // Bar 7:  A minor
bar([D2, D3, Fs3, C4, D4, A3, Fs3, D3]);              // Bar 8:  D major
bar([G2, B2, G3, B3, D4, G4, B3, G3]);                // Bar 9:  G major
bar([E2, B2, E3, G3, B3, E4, G3, E3], 78);            // Bar 10: E minor
bar([A2, E3, A3, C4, E4, A4, E4, C4], 78);            // Bar 11: A minor
bar([D2, Fs3, A3, D4, Fs4, A3, Fs3, D3]);             // Bar 12: D major
bar([G2, G3, B3, D4, G4, B3, G3, D3]);                // Bar 13: G major (high)
bar([G2, Fs3, A3, D4, Fs4, A3, Fs3, D3]);             // Bar 14: G/D — Gsus4 feel
bar([G2, E3, G3, C4, E4, G4, E4, C4]);                // Bar 15: G over C
bar([G2, D3, G3, B3, D4, G4, D3, G2], 90);            // Bar 16: G major final — louder

const totalMs = t + Q;

console.log('Playing: Cello Suite No. 1 in G major, Prelude (BWV 1007) — J. S. Bach');
console.log(`Tempo: ${BPM} BPM  |  Key: G major  |  Duration: ${(totalMs / 1000).toFixed(1)}s\n`);

for (const [note, startMs, durationMs, velocity] of allNotes) {
  setTimeout(() => synth.noteOn(note, velocity), startMs);
  setTimeout(() => synth.noteOff(note), startMs + durationMs);
}

await new Promise(r => setTimeout(r, totalMs + 2500));
synth.stop();
console.log('Done.');
