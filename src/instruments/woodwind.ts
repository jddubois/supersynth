import type { InstrumentConfig, VoiceConfig } from '../types.js';
import { Synth } from '../Synth.js';

const fluteVoice: VoiceConfig = {
  oscillators: [
    { waveform: 'flute', harmonicRatio: 1, amplitude: 1.0, attackTime: 0.04, releaseTime: 0.10, chiffIntensity: 0.12, chiffDuration: 0.05 },
  ],
  velocityCurve: { type: 'linear' },
  headroom: 1.0,
};

const clarinetVoice: VoiceConfig = {
  oscillators: [
    { waveform: 'pulse', pulseWidth: 0.2, harmonicRatio: 1, amplitude: 1.0, attackTime: 0.04, releaseTime: 0.08, chiffIntensity: 0.15, chiffDuration: 0.04 },
  ],
  velocityCurve: { type: 'linear' },
  headroom: 1.0,
};

const saxophoneVoice: VoiceConfig = {
  oscillators: [
    { waveform: 'pulse', pulseWidth: 0.35, harmonicRatio: 1, amplitude: 1.0, attackTime: 0.04, releaseTime: 0.12, chiffIntensity: 0.3, chiffDuration: 0.05 },
  ],
  velocityCurve: { type: 'linear' },
  headroom: 1.0,
};

const oboeVoice: VoiceConfig = {
  oscillators: [
    { waveform: 'pulse', pulseWidth: 0.25, harmonicRatio: 1, amplitude: 1.0, attackTime: 0.025, releaseTime: 0.08, chiffIntensity: 0.25, chiffDuration: 0.03 },
  ],
  velocityCurve: { type: 'linear' },
  headroom: 1.0,
};

/** Flute: 6-harmonic additive synthesis with gentle breath transient. */
export class Flute extends Synth {
  constructor(config: InstrumentConfig = {}) { super({ ...config, voice: fluteVoice }); }
}

/** Clarinet: narrow-pulse wave at 20% duty cycle with reed-breath transient. */
export class Clarinet extends Synth {
  constructor(config: InstrumentConfig = {}) { super({ ...config, voice: clarinetVoice }); }
}

/** Saxophone: pulse wave at 35% duty cycle, strong chiff models the reed breath attack. */
export class Saxophone extends Synth {
  constructor(config: InstrumentConfig = {}) { super({ ...config, voice: saxophoneVoice }); }
}

/** Oboe: narrow pulse wave at 25% duty cycle with prominent chiff. */
export class Oboe extends Synth {
  constructor(config: InstrumentConfig = {}) { super({ ...config, voice: oboeVoice }); }
}
