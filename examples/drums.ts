/**
 * Classic 4/4 rock drum pattern — kick on 1 & 3, snare on 2 & 4, hi-hat on every 8th note.
 * Demonstrates the `noise` waveform for percussion synthesis.
 *
 * Three per-note voice overrides turn a single synth into a full drum kit:
 *   MIDI 36 (C2)  → kick drum   (low noise burst + sub sine, long body)
 *   MIDI 38 (D2)  → snare drum  (crisp noise burst, medium snap)
 *   MIDI 42 (F#2) → closed hi-hat (very short noise burst)
 *   MIDI 46 (Bb2) → open hi-hat  (longer noise decay, accents)
 *
 * Run with: node --import tsx examples/drums.ts
 */
import { Synth } from '../src/index.ts';
import type { VoiceConfig } from '../src/types.ts';

const synth = new Synth({
  sampleRate: 48000,
  masterVolume: 0.65,
  // No reverb — dry drums sit tighter in the mix
});
await synth.start();

// ── Per-drum voices ───────────────────────────────────────────────────────────

const kickVoice: VoiceConfig = {
  oscillators: [
    // Low sine gives the "thump" body; played at MIDI 36 (C2 = ~65 Hz)
    { waveform: 'sine',  harmonicRatio: 1,   amplitude: 1.0, attackTime: 0.001, decayTime: 0.18, sustainLevel: 0.0, releaseTime: 0.05 },
    // Noise transient for the beater click
    { waveform: 'noise', harmonicRatio: 1,   amplitude: 0.6, attackTime: 0.001, decayTime: 0.04, sustainLevel: 0.0, releaseTime: 0.02 },
  ],
  velocityCurve: { type: 'exponential', exponent: 1.4 },
  headroom: 1.6,
};

const snareVoice: VoiceConfig = {
  oscillators: [
    // Noise body — the snare wires and drum shell
    { waveform: 'noise', harmonicRatio: 1, amplitude: 1.0, attackTime: 0.001, decayTime: 0.12, sustainLevel: 0.0, releaseTime: 0.04 },
    // Sine "crack" from the drum head (an octave above kick)
    { waveform: 'sine',  harmonicRatio: 2, amplitude: 0.35, attackTime: 0.001, decayTime: 0.06, sustainLevel: 0.0, releaseTime: 0.03 },
  ],
  velocityCurve: { type: 'exponential', exponent: 1.3 },
  headroom: 1.35,
};

const closedHiHatVoice: VoiceConfig = {
  oscillators: [
    { waveform: 'noise', harmonicRatio: 1, amplitude: 1.0, attackTime: 0.001, decayTime: 0.04, sustainLevel: 0.0, releaseTime: 0.015 },
  ],
  velocityCurve: { type: 'exponential', exponent: 1.5 },
  headroom: 1.0,
};

const openHiHatVoice: VoiceConfig = {
  oscillators: [
    { waveform: 'noise', harmonicRatio: 1, amplitude: 1.0, attackTime: 0.001, decayTime: 0.28, sustainLevel: 0.0, releaseTime: 0.05 },
  ],
  velocityCurve: { type: 'exponential', exponent: 1.5 },
  headroom: 1.0,
};

// ── MIDI note numbers ─────────────────────────────────────────────────────────
const KICK  = 36;
const SNARE = 38;
const CHAT  = 42;  // closed hi-hat
const OHAT  = 46;  // open hi-hat

// ── Schedule helpers ──────────────────────────────────────────────────────────
function hit(note: number, voice: VoiceConfig, atMs: number, vel: number, dur = 80) {
  setTimeout(() => synth.noteOn(note, vel, { voice }), atMs);
  setTimeout(() => synth.noteOff(note),                 atMs + dur);
}

const BPM = 100;
const Q   = 60_000 / BPM;   // quarter  = 600 ms
const E_N = Q / 2;            // eighth   = 300 ms

// ── 8-bar rock groove ─────────────────────────────────────────────────────────
// The classic pattern (4/4):
//   Kick   : beats 1 and 3
//   Snare  : beats 2 and 4
//   Hi-hat : every 8th note
// Bar 7 substitutes an open hat on the "and of 4" for variety.

const BARS = 8;
const BAR_MS = Q * 4;

console.log('Playing: classic 4/4 rock beat');
console.log(`Tempo: ${BPM} BPM  |  Duration: ${(BARS * BAR_MS / 1000).toFixed(1)}s\n`);

for (let bar = 0; bar < BARS; bar++) {
  const b = bar * BAR_MS;  // bar start in ms

  // Hi-hat: every 8th note, slight velocity accent on downbeats
  for (let step = 0; step < 8; step++) {
    const isOpenBar   = bar === 6; // bar 7 (0-indexed 6): open hat on "and of 4"
    const useOpenHat  = isOpenBar && step === 7;
    const vel = step % 2 === 0 ? 88 : 68;  // accent on downbeats
    hit(CHAT, useOpenHat ? openHiHatVoice : closedHiHatVoice, b + step * E_N, vel);
  }

  // Kick: beat 1 (step 0) and beat 3 (step 4)
  hit(KICK, kickVoice, b + 0 * E_N, 100);
  hit(KICK, kickVoice, b + 4 * E_N,  95);

  // Snare: beat 2 (step 2) and beat 4 (step 6)
  hit(SNARE, snareVoice, b + 2 * E_N, 110);
  hit(SNARE, snareVoice, b + 6 * E_N, 105);

  // Extra kick on "and of 3" in bars 3, 5, 7 (common rock fill variant)
  if (bar === 2 || bar === 4 || bar === 6) {
    hit(KICK, kickVoice, b + 5 * E_N, 80);
  }
}

await new Promise(r => setTimeout(r, BARS * BAR_MS + 1500));
synth.stop();
console.log('Done.');
