import type { InstrumentConfig, VoiceConfig } from '../types.js';
import { Synth } from '../Synth.js';

const voice: VoiceConfig = {
  oscillators: [
    { waveform: 'struck', harmonicRatio: 1, amplitude: 1.0, detuneCents: -1.5, attackTime: 0.001, releaseTime: 2.0 },
    { waveform: 'struck', harmonicRatio: 1, amplitude: 0.9, detuneCents:  0.0, attackTime: 0.001, releaseTime: 2.0 },
    { waveform: 'struck', harmonicRatio: 1, amplitude: 0.8, detuneCents:  1.5, attackTime: 0.001, releaseTime: 2.0 },
  ],
  velocityCurve: { type: 'exponential', exponent: 1.5 },
  headroom: 2.8,
};

/**
 * Piano: three slightly detuned Karplus-Strong struck strings per note.
 * The beating between detuned delay lines produces the natural piano chorus/shimmer effect.
 */
export class Piano extends Synth {
  constructor(config: InstrumentConfig = {}) {
    super({ ...config, voice });
  }
}
