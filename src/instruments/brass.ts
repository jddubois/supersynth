import type { InstrumentConfig, VoiceConfig } from '../types.js';
import { Synth } from '../Synth.js';

const trumpetVoice: VoiceConfig = {
  oscillators: [
    { waveform: 'trumpet', harmonicRatio: 1, amplitude: 1.0, attackTime: 0.04, releaseTime: 0.15, chiffIntensity: 0.12, chiffDuration: 0.03 },
  ],
  velocityCurve: { type: 'exponential', exponent: 1.2 },
  headroom: 1.0,
};

const frenchHornVoice: VoiceConfig = {
  oscillators: [
    { waveform: 'trumpet', harmonicRatio: 1, amplitude: 1.0, attackTime: 0.10, releaseTime: 0.25 },
  ],
  velocityCurve: { type: 'exponential', exponent: 1.3 },
  headroom: 1.0,
};

const tromboneVoice: VoiceConfig = {
  oscillators: [
    { waveform: 'sawtooth', harmonicRatio: 1, amplitude: 0.85, attackTime: 0.06, releaseTime: 0.18 },
    { waveform: 'sawtooth', harmonicRatio: 2, amplitude: 0.25, attackTime: 0.07, releaseTime: 0.18 },
  ],
  velocityCurve: { type: 'linear' },
  headroom: 1.1,
};

/** Solo trumpet: 16-harmonic additive synthesis with sharp attack and chiff transient. */
export class Trumpet extends Synth {
  constructor(config: InstrumentConfig = {}) { super({ ...config, voice: trumpetVoice }); }
}

/** French horn: mellow trumpet-like tone with slower attack and longer release. */
export class FrenchHorn extends Synth {
  constructor(config: InstrumentConfig = {}) { super({ ...config, voice: frenchHornVoice }); }
}

/** Trombone: sawtooth-based brass with a full-bodied tone. */
export class Trombone extends Synth {
  constructor(config: InstrumentConfig = {}) { super({ ...config, voice: tromboneVoice }); }
}
