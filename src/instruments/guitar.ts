import type { InstrumentConfig, VoiceConfig } from '../types.js';
import { Synth } from '../Synth.js';

const guitarVoice: VoiceConfig = {
  oscillators: [
    { waveform: 'plucked', harmonicRatio: 1, amplitude: 1.0, attackTime: 0.001, releaseTime: 0.3 },
  ],
  velocityCurve: { type: 'exponential', exponent: 1.5 },
  headroom: 1.0,
};

const electricGuitarVoice: VoiceConfig = {
  oscillators: [
    { waveform: 'electric', harmonicRatio: 1, amplitude: 1.0, attackTime: 0.001, releaseTime: 0.5 },
  ],
  velocityCurve: { type: 'exponential', exponent: 1.3 },
  headroom: 1.0,
};

const bassGuitarVoice: VoiceConfig = {
  oscillators: [
    { waveform: 'plucked', harmonicRatio: 1, amplitude: 1.0, attackTime: 0.001, releaseTime: 0.2 },
  ],
  velocityCurve: { type: 'exponential', exponent: 1.3 },
  headroom: 1.0,
};

const harpVoice: VoiceConfig = {
  oscillators: [
    { waveform: 'plucked', harmonicRatio: 1, amplitude: 1.0, attackTime: 0.001, releaseTime: 0.8 },
  ],
  velocityCurve: { type: 'exponential', exponent: 1.2 },
  headroom: 1.0,
};

const harpsichordVoice: VoiceConfig = {
  oscillators: [
    { waveform: 'struck', harmonicRatio: 1, amplitude: 1.0, attackTime: 0.001, releaseTime: 0.05 },
  ],
  velocityCurve: { type: 'fixed', amplitude: 0.85 },
  headroom: 1.0,
};

/** Acoustic guitar: Karplus-Strong plucked string. */
export class Guitar extends Synth {
  constructor(config: InstrumentConfig = {}) { super({ ...config, voice: guitarVoice }); }
}

/** Electric guitar: Karplus-Strong with bridge-position excitation and tanh soft-clip feedback. */
export class ElectricGuitar extends Synth {
  constructor(config: InstrumentConfig = {}) { super({ ...config, voice: electricGuitarVoice }); }
}

/** Bass guitar: Karplus-Strong plucked string tuned for the lower register. */
export class BassGuitar extends Synth {
  constructor(config: InstrumentConfig = {}) { super({ ...config, voice: bassGuitarVoice }); }
}

/** Harp: Karplus-Strong plucked string with long ring-out for overlapping arpeggios. */
export class Harp extends Synth {
  constructor(config: InstrumentConfig = {}) { super({ ...config, voice: harpVoice }); }
}

/** Harpsichord: Karplus-Strong struck string, velocity-insensitive, instant mute on release. */
export class Harpsichord extends Synth {
  constructor(config: InstrumentConfig = {}) { super({ ...config, voice: harpsichordVoice }); }
}
