/**
 * Plays Pachelbel's Canon in D major — bass ostinato + upper string melody.
 * Tempo: 72 BPM  |  Key: D major  |  ~8 variation cycles
 *
 * The canonical bass line repeats throughout while the upper voices build melody
 * through the famous harmonic progression: D – A – Bm – F#m – G – D – G – A
 *
 * Run with: node --import tsx examples/strings.ts
 */
import { Synth } from '../src/index.ts';
import type { VoiceConfig } from '../src/types.ts';

const BPM = 72;
const Q   = 60_000 / BPM;  // quarter ≈ 833 ms
const E_N = Q / 2;
const H   = Q * 2;
const W   = Q * 4;

// Two voices: ensemble for the ground bass, lighter for the melody
const bassVoice: VoiceConfig = {
  oscillators: [
    { waveform: 'sawtooth', harmonicRatio: 1, amplitude: 0.5, detuneCents: -8, attackTime: 0.25, releaseTime: 0.4 },
    { waveform: 'sawtooth', harmonicRatio: 1, amplitude: 0.5, detuneCents:  8, attackTime: 0.25, releaseTime: 0.4 },
  ],
  velocityCurve: { type: 'linear' },
  headroom: 2.0,
};

const melodySynth = new Synth({
  sampleRate: 48000,
  masterVolume: 0.45,
  voice: {
    oscillators: [
      { waveform: 'sawtooth', harmonicRatio: 1, amplitude: 0.6, detuneCents: -5, attackTime: 0.15, releaseTime: 0.3 },
      { waveform: 'sawtooth', harmonicRatio: 1, amplitude: 0.4, detuneCents:  6, attackTime: 0.18, releaseTime: 0.3 },
    ],
    velocityCurve: { type: 'linear' },
    headroom: 1.0,
  },
  reverb: { roomSize: 0.75, damping: 0.45, wet: 0.32, dry: 0.68, preDelayMs: 18 },
});
const bassSynth = new Synth({
  sampleRate: 48000,
  masterVolume: 0.40,
  voice: bassVoice,
  reverb: { roomSize: 0.75, damping: 0.45, wet: 0.32, dry: 0.68, preDelayMs: 18 },
});

await melodySynth.start();
await bassSynth.start();

import { D3, E3, Fs3, G3, A3, B3, Cs4, D4, E4, Fs4, G4, A4, B4, Cs5, D5, E5, Fs5, G5, A5, B5 } from './util/notes.ts';

// ── Ground bass: D A B F# G D G A (each note = 1 bar of 4 beats) ─────────────
// Repeats throughout all 8 cycles
const bassPattern = [D3, A3, B3, Fs3, G3, D3, G3, A3];

const CYCLES = 8;
const CYCLE_MS = 8 * W;   // 8 bars per cycle

// Schedule bass ostinato over all cycles
for (let cycle = 0; cycle < CYCLES; cycle++) {
  for (let bar = 0; bar < 8; bar++) {
    const t = cycle * CYCLE_MS + bar * W;
    bassSynth.noteOn(bassPattern[bar]!, 72 + (cycle < 2 ? 0 : 8));
    setTimeout(() => bassSynth.noteOff(bassPattern[bar]!), t + W * 0.92);
    // Schedule noteOff slightly before next bar
    if (bar > 0) {
      // hack: use setTimeout for the note ons after the first
    }
  }
}
// Re-schedule properly with setTimeout
for (let cycle = 0; cycle < CYCLES; cycle++) {
  for (let bar = 0; bar < 8; bar++) {
    const t = cycle * CYCLE_MS + bar * W;
    const vel = 72 + (cycle >= 4 ? 10 : 0);
    setTimeout(() => bassSynth.noteOn(bassPattern[bar]!, vel), t);
    setTimeout(() => bassSynth.noteOff(bassPattern[bar]!),    t + W * 0.88);
  }
}

// ── Melody variations over the ostinato ──────────────────────────────────────
// Each cycle introduces progressively faster and higher note values.

// Cycle 1-2: whole notes (one per bar)
const melodyWhole = [D5, A4, B4, Fs4, G4, D4, G4, A4];
for (let cycle = 0; cycle < 2; cycle++) {
  for (let bar = 0; bar < 8; bar++) {
    const t = cycle * CYCLE_MS + bar * W;
    setTimeout(() => melodySynth.noteOn(melodyWhole[bar]!, 65), t);
    setTimeout(() => melodySynth.noteOff(melodyWhole[bar]!),    t + W * 0.9);
  }
}

// Cycle 3-4: half notes (two per bar)
const melodyHalf = [
  [D5, Cs5], [A4, E4], [B4, Fs4], [Fs4, Cs5],
  [G4, B4], [D4, Fs4], [G4, B4], [A4, E4],
];
for (let cycle = 2; cycle < 4; cycle++) {
  for (let bar = 0; bar < 8; bar++) {
    const t = cycle * CYCLE_MS + bar * W;
    for (let i = 0; i < 2; i++) {
      const nt = t + i * H;
      setTimeout(() => melodySynth.noteOn(melodyHalf[bar]![i]!, 70), nt);
      setTimeout(() => melodySynth.noteOff(melodyHalf[bar]![i]!),    nt + H * 0.88);
    }
  }
}

// Cycle 5-6: quarter notes (four per bar) — the famous four-note descending figure
const melodyQuarter = [
  [D5, Cs5, B4, A4], [A4, G4, Fs4, E4], [B4, A4, G4, Fs4], [Fs4, E4, D4, Cs4],
  [G4, Fs4, E4, D4], [D4, E4, Fs4, G4], [G4, Fs4, E4, D4], [A4, G4, Fs4, E4],
];
for (let cycle = 4; cycle < 6; cycle++) {
  for (let bar = 0; bar < 8; bar++) {
    const t = cycle * CYCLE_MS + bar * W;
    for (let i = 0; i < 4; i++) {
      const nt = t + i * Q;
      setTimeout(() => melodySynth.noteOn(melodyQuarter[bar]![i]!, 75), nt);
      setTimeout(() => melodySynth.noteOff(melodyQuarter[bar]![i]!),    nt + Q * 0.85);
    }
  }
}

// Cycle 7-8: eighth notes (8 per bar) — flowing semiquavers
const melodyEighth = [
  [D5, E5, Fs5, E5, D5, Cs5, B4, A4], [A4, B4, Cs5, B4, A4, G4, Fs4, E4],
  [B4, Cs5, D5, Cs5, B4, A4, G4, Fs4], [Fs4, G4, A4, G4, Fs4, E4, D4, Cs4],
  [G4, A4, B4, A4, G4, Fs4, E4, D4], [D4, E4, Fs4, G4, A4, B4, Cs5, D5],
  [G4, A4, B4, A4, G4, Fs4, E4, Fs4], [A4, B4, Cs5, B4, A4, G4, Fs4, E4],
];
for (let cycle = 6; cycle < 8; cycle++) {
  for (let bar = 0; bar < 8; bar++) {
    const t = cycle * CYCLE_MS + bar * W;
    for (let i = 0; i < 8; i++) {
      const nt = t + i * E_N;
      setTimeout(() => melodySynth.noteOn(melodyEighth[bar]![i]!, 78 + (cycle === 7 ? 6 : 0)), nt);
      setTimeout(() => melodySynth.noteOff(melodyEighth[bar]![i]!),                               nt + E_N * 0.82);
    }
  }
}

const totalMs = CYCLES * CYCLE_MS;
console.log('Playing: Canon in D — Johann Pachelbel');
console.log(`Tempo: ${BPM} BPM  |  Key: D major  |  ${CYCLES} variation cycles  |  Duration: ${(totalMs / 1000).toFixed(1)}s\n`);

await new Promise(r => setTimeout(r, totalMs + 4000));
melodySynth.stop();
bassSynth.stop();
console.log('Done.');
