import type { InstrumentConfig, VoiceConfig } from '../types.js';
import { Synth } from '../Synth.js';

const synthLeadVoice: VoiceConfig = {
  oscillators: [
    { waveform: 'sawtooth', harmonicRatio: 1, amplitude: 0.55, detuneCents: -7, attackTime: 0.005, releaseTime: 0.08 },
    { waveform: 'sawtooth', harmonicRatio: 1, amplitude: 0.55, detuneCents:  7, attackTime: 0.005, releaseTime: 0.08 },
    { waveform: 'square',   harmonicRatio: 2, amplitude: 0.20,                  attackTime: 0.005, releaseTime: 0.08 },
  ],
  velocityCurve: { type: 'linear' },
  headroom: 1.3,
};

/** Synth lead: two detuned sawtooth oscillators with a sub-octave square for body. Classic 80s polysynth sound. */
export class SynthLead extends Synth {
  constructor(config: InstrumentConfig = {}) { super({ ...config, voice: synthLeadVoice }); }
}
