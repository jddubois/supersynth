import type { InstrumentConfig, VoiceConfig } from '../types.js';
import { Synth } from '../Synth.js';

const stringsVoice: VoiceConfig = {
  oscillators: [
    { waveform: 'sawtooth', harmonicRatio: 1, amplitude: 0.5, detuneCents: -12, attackTime: 0.3, releaseTime: 0.4 },
    { waveform: 'sawtooth', harmonicRatio: 1, amplitude: 0.5, detuneCents:  -4, attackTime: 0.3, releaseTime: 0.4 },
    { waveform: 'sawtooth', harmonicRatio: 1, amplitude: 0.5, detuneCents:   4, attackTime: 0.3, releaseTime: 0.4 },
    { waveform: 'sawtooth', harmonicRatio: 1, amplitude: 0.5, detuneCents:  12, attackTime: 0.3, releaseTime: 0.4 },
  ],
  velocityCurve: { type: 'linear' },
  headroom: 2.0,
};

const violinVoice: VoiceConfig = {
  oscillators: [
    { waveform: 'sawtooth', harmonicRatio: 1, amplitude: 0.8, detuneCents: -5, attackTime: 0.06, releaseTime: 0.12 },
    { waveform: 'sawtooth', harmonicRatio: 1, amplitude: 0.2, detuneCents:  7, attackTime: 0.08, releaseTime: 0.12 },
  ],
  velocityCurve: { type: 'linear' },
  headroom: 1.0,
};

const celloVoice: VoiceConfig = {
  oscillators: [
    { waveform: 'sawtooth', harmonicRatio: 1, amplitude: 0.85, attackTime: 0.10, releaseTime: 0.20 },
    { waveform: 'sawtooth', harmonicRatio: 1, amplitude: 0.15, detuneCents: 6, attackTime: 0.12, releaseTime: 0.20 },
  ],
  velocityCurve: { type: 'linear' },
  headroom: 1.0,
};

/** Strings ensemble: 4 detuned sawtooth oscillators with slow attack, rich ensemble sound. */
export class Strings extends Synth {
  constructor(config: InstrumentConfig = {}) { super({ ...config, voice: stringsVoice }); }
}

/** Solo violin: two slightly detuned sawtooth oscillators with expressive bow attack. */
export class Violin extends Synth {
  constructor(config: InstrumentConfig = {}) { super({ ...config, voice: violinVoice }); }
}

/** Solo cello: warm sawtooth with slower attack and fuller release. */
export class Cello extends Synth {
  constructor(config: InstrumentConfig = {}) { super({ ...config, voice: celloVoice }); }
}
