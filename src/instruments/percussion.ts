import type { InstrumentConfig, VoiceConfig } from '../types.js';
import { Synth } from '../Synth.js';

const hiHatVoice: VoiceConfig = {
  oscillators: [
    { waveform: 'noise', harmonicRatio: 1, amplitude: 1.0, attackTime: 0.001, decayTime: 0.08, sustainLevel: 0.0, releaseTime: 0.02 },
  ],
  velocityCurve: { type: 'exponential', exponent: 1.5 },
  headroom: 1.0,
};

const marimbaVoice: VoiceConfig = {
  oscillators: [
    { waveform: 'sine', harmonicRatio: 1.0,  amplitude: 1.0,  attackTime: 0.001, decayTime: 0.6,  sustainLevel: 0.0, releaseTime: 0.05 },
    { waveform: 'sine', harmonicRatio: 3.93, amplitude: 0.35, attackTime: 0.001, decayTime: 0.12, sustainLevel: 0.0, releaseTime: 0.05 },
    { waveform: 'sine', harmonicRatio: 9.76, amplitude: 0.10, attackTime: 0.001, decayTime: 0.04, sustainLevel: 0.0, releaseTime: 0.05 },
  ],
  velocityCurve: { type: 'exponential', exponent: 1.5 },
  headroom: 1.5,
};

/** Hi-hat: short burst of white noise with fast exponential decay. */
export class HiHat extends Synth {
  constructor(config: InstrumentConfig = {}) { super({ ...config, voice: hiHatVoice }); }
}

/**
 * Marimba: three sine partials at the characteristic inharmonic ratios of a struck wooden bar
 * (modes 1 : 3.93 : 9.76). Higher modes decay faster.
 */
export class Marimba extends Synth {
  constructor(config: InstrumentConfig = {}) { super({ ...config, voice: marimbaVoice }); }
}
