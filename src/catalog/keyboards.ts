// Keyboards
import { type InstrumentDefinition, ROOMS } from './types.js';

/** Concert Grand Piano. */
export const GRAND_PIANO: InstrumentDefinition = {
  id: 'grand-piano',
  name: 'Concert Grand Piano',
  family: 'keyboard',
  description: 'Steinway model B, three dynamic layers: recorded hammer attacks, string stiffness, the resonances in each recording, and a damper release.',
  layers: [{ model: 'grand-piano' }, { model: 'grand-piano-release', trigger: 'release' }],
  range: [21, 108],
  reverb: 'hall',
  presets: {
    default: { description: 'No adjustments' },
    bright: { description: 'Harder hammers, pop/rock piano', parameters: { brightness: 1.2, eqHighGain: 2, eqHighFreq: 5000 } },
    mellow: { description: 'Soft hammers, warm and dark', parameters: { brightness: -1.6, noise: -3 } },
    felt: { description: 'Felt-muffled "una corda" intimate piano', parameters: { brightness: -4, noise: -8, attack: 1.4, velocitySensitivity: 0.75, reverbSend: 0.12 } },
    concert: { description: 'Concert hall perspective', parameters: { reverbSend: 0.28, spread: 0.45 }, reverb: 'concert-hall' },
    studio: { description: 'Close studio miking', parameters: { reverbSend: 0.05, spread: 0.5 }, reverb: 'studio' },
    'honky-tonk': {
      description: 'Detuned saloon piano (two mistuned strings)',
      layers: [
        { model: 'grand-piano', detune: -11, gain: -3, pan: -0.15 }, { model: 'grand-piano', detune: 9, gain: -3, pan: 0.15 },
        { model: 'grand-piano-release', trigger: 'release' },
      ],
      parameters: { brightness: 0.6, reverbSend: 0.08 },
      reverb: 'room',
    },
    'long-sustain': { description: 'Longer ringing notes', parameters: { decay: 1.6, release: 1.5 } },
  },
};

/** Upright Piano. */
export const UPRIGHT_PIANO: InstrumentDefinition = {
  id: 'upright-piano',
  name: 'Upright Piano',
  family: 'keyboard',
  description: 'Yamaha upright: intimate, a little brighter and boxier than the grand.',
  layers: [{ model: 'upright-piano' }, { model: 'upright-piano-release', trigger: 'release' }],
  range: [26, 101],
  reverb: 'room',
  presets: {
    default: { description: 'No adjustments' },
    vintage: { description: 'Older instrument: duller, slightly out of tune', parameters: { brightness: -1.2, humanize: 5 } },
    'honky-tonk': {
      description: 'Bar-room detuned upright',
      layers: [
        { model: 'upright-piano', detune: -12, gain: -3 }, { model: 'upright-piano', detune: 10, gain: -3 },
        { model: 'upright-piano-release', trigger: 'release' },
      ],
      parameters: { brightness: 0.8 },
    },
    dry: ROOMS.dry,
  },
};

/** Harpsichord. */
export const HARPSICHORD: InstrumentDefinition = {
  id: 'harpsichord',
  name: 'Harpsichord',
  family: 'keyboard',
  description: 'French double-manual harpsichord, with the recorded pluck of each note.',
  layers: [{ model: 'harpsichord' }, { model: 'harpsichord-release', trigger: 'release' }],
  range: [29, 89],
  reverb: 'chamber',
  presets: {
    default: { description: "Single 8' choir" },
    '8-4': {
      description: "8' + 4' (brilliant, octave coupled)",
      layers: [
        { model: 'harpsichord' }, { model: 'harpsichord', transpose: 12, gain: -5, keyHigh: 77 },
        { model: 'harpsichord-release', trigger: 'release' },
      ],
    },
    lute: { description: 'Buff/lute stop: muted, short and soft', parameters: { brightness: -3, decay: 0.45, noise: -4 } },
    flemish: {
      description: 'Flemish harpsichord (8\')',
      layers: [{ model: 'harpsichord-flemish' }, { model: 'harpsichord-flemish-release', trigger: 'release' }],
    },
    hall: ROOMS.hall,
  },
};
