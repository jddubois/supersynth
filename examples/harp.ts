/**
 * Plays "Somewhere Over the Rainbow" from The Wizard of Oz (1939) on harp.
 * Music by Harold Arlen, lyrics by E.Y. Harburg.
 * Tempo: 72 BPM  |  Key: Eb major
 *
 * Run with: node --import tsx examples/harp.ts
 */
import { Harp } from '../src/index.ts';

const synth = new Harp({
  sampleRate: 48000,
  masterVolume: 0.65,
  // Warm hall reverb — the harp needs space for sustained arpeggios
  reverb: { roomSize: 0.78, damping: 0.42, wet: 0.38, dry: 0.62, preDelayMs: 20 },
});
await synth.start();

const BPM = 72;
const Q   = 60_000 / BPM;  // quarter ≈ 833 ms
const E_N = Q / 2;
const DQ  = Q * 1.5;
const H   = Q * 2;
const DH  = Q * 3;
const W   = Q * 4;

import { Bb1, C2, Eb2, F2, Bb2, C3, D3, Eb3, F3, G3, Ab3, Bb3, C4, D4, Eb4, F4, G4, Ab4, Bb4, C5, D5, Eb5, F5, G5, Bb5 } from './util/notes.ts';

// ── Sequence: [note, startMs, durationMs, velocity] ──────────────────────────
const seq: [number, number, number, number][] = [];
let t = 0;

function n(note: number, dur: number, vel = 80) {
  seq.push([note, t, dur * 0.95, vel]);
  t += dur;
}
function arp(notes: number[], stepMs: number, vel = 68) {
  // Arpeggiated chord — notes ring into each other (harp sustain)
  for (const note of notes) {
    seq.push([note, t, stepMs * notes.length * 0.9 + 400, vel]);
    t += stepMs;
  }
}

// ── Opening: octave leap motif and melody ─────────────────────────────────────
// "Some- (Eb4) where (Eb5)"
n(Eb4, Q, 75);   // "Some"
n(Eb5, DH, 90);  // "where" — famous octave leap

// "o- (Bb4) ver (Bb4) the (Ab4) rain (G4) bow (Eb5, long)"
n(Bb4, Q,  84);
n(Bb4, Q,  84);
n(Ab4, Q,  82);
n(G4,  Q,  80);
n(Eb5, DH, 88);

// "way (G4) up (F4) high (Eb5, long)"
n(G4,  Q,  80);
n(F4,  Q,  78);
n(Eb5, W,  85);

// ── "There's a land that I heard of once in a lullaby" ────────────────────────
n(Bb4, Q,  80);
n(Bb4, Q,  80);
n(Ab4, Q,  78);
n(G4,  Q,  76);
n(F4,  Q,  76);
n(Eb4, Q,  78);
n(F4,  Q,  80);
n(G4,  Q,  82);
n(Ab4, DH, 84);
n(G4,  Q,  80);
n(F4,  DH, 78);

// Interlude: arpeggiated Eb major chord
arp([Eb3, G3, Bb3, Eb4, G4, Bb4], Q / 3, 65);
t += Q;

// ── "Some- (Eb4) where (Eb5) over the rainbow, skies are blue" ───────────────
n(Eb4, Q,  75);
n(Eb5, DH, 92);
n(Bb4, Q,  86);
n(Bb4, Q,  86);
n(Ab4, Q,  84);
n(G4,  Q,  82);
n(F5,  DH, 90);

// "and the dreams that you dare to dream really do come true"
n(Bb4, Q,  82);
n(Bb4, Q,  82);
n(C5,  Q,  84);
n(Bb4, Q,  82);
n(Ab4, Q,  80);
n(G4,  Q,  78);
n(F4,  Q,  76);
n(Eb4, Q,  78);
n(F4,  Q,  80);
n(G4,  Q,  82);
n(Eb5, W,  88);

// ── Bridge: "Someday I'll wish upon a star" ───────────────────────────────────
arp([Bb1, F2, Bb2, D3, F3], Q / 4, 60);
n(Bb4, Q,  80);
n(Bb4, E_N, 80);
n(C5,  E_N, 82);
n(Bb4, Q,  80);
n(G4,  Q,  78);
n(Eb5, H,  85);
n(D5,  Q,  83);
n(C5,  Q,  80);

n(F4,  Q,  78);
n(F4,  E_N, 78);
n(G4,  E_N, 80);
n(Ab4, Q,  81);
n(F4,  Q,  78);
n(Bb4, H,  85);
n(Ab4, Q,  82);
n(G4,  Q,  80);

n(Eb4, Q,  78);
n(Eb4, E_N, 78);
n(F4,  E_N, 80);
n(G4,  Q,  82);
n(Eb4, Q,  80);
n(Ab4, H,  88);
n(G4,  Q,  85);
n(F4,  Q,  82);

n(G4,  Q,  82);
n(Ab4, Q,  84);
n(Bb4, Q,  86);
n(C5,  Q,  88);
n(Eb5, W,  92);

// ── Final verse + close: "Somewhere over the rainbow…" ───────────────────────
n(Eb4, Q,  75);
n(Eb5, DH, 92);
n(Bb4, Q,  86);
n(Ab4, Q,  84);
n(G4,  Q,  82);
n(Eb5, W,  90);
n(Bb4, Q,  85);
n(Ab4, Q,  83);
n(G4,  Q,  81);
n(F4,  Q,  79);
n(Eb4, W + H, 85);

// Closing harp glissando (ascending Eb major)
arp([Eb3, F3, G3, Ab3, Bb3, C4, D4, Eb4, F4, G4, Ab4, Bb4, C5, D5, Eb5], Q / 8, 60);

const totalMs = t + Q * 2;
console.log('Playing: Somewhere Over the Rainbow — Harold Arlen / The Wizard of Oz');
console.log(`Tempo: ${BPM} BPM  |  Key: Eb major  |  Duration: ${(totalMs / 1000).toFixed(1)}s\n`);

for (const [note, startMs, durationMs, velocity] of seq) {
  setTimeout(() => synth.noteOn(note, velocity), startMs);
  setTimeout(() => synth.noteOff(note), startMs + durationMs);
}

await new Promise(r => setTimeout(r, totalMs + 4000));
synth.stop();
console.log('Done.');
