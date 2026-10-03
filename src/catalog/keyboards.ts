// Keyboards
import { type InstrumentDef, ROOMS } from './types.js';

/** Concert Grand Piano. */
export const GRAND_PIANO: InstrumentDef = {
  id: 'grand-piano',
  name: 'Concert Grand Piano',
  family: 'keyboard',
  description: 'Steinway model B, three dynamic layers, with real hammer attacks, string stiffness, damper and sympathetic resonances.',
  layers: [{ model: 'grand-piano' }, { model: 'grand-piano-release', trigger: 'release' }],
  range: [21, 108],
  reverb: 'hall',
  aliases: ['piano', 'grand', 'steinway'],
  presets: {
    default: { description: 'As recorded' },
    bright: { description: 'Harder hammers, pop/rock piano', params: { brightness: 1.2, eqHighGain: 2, eqHighFreq: 5000 } },
    mellow: { description: 'Soft hammers, warm and dark', params: { brightness: -1.6, noise: -3 } },
    felt: { description: 'Felt-muffled "una corda" intimate piano', params: { brightness: -4, noise: -8, attack: 1.4, velocitySensitivity: 0.75, reverbSend: 0.12 } },
    concert: { description: 'Concert hall perspective', params: { reverbSend: 0.28, spread: 0.45 }, reverb: 'concert-hall' },
    studio: { description: 'Close studio miking', params: { reverbSend: 0.05, spread: 0.5 }, reverb: 'studio' },
    'honky-tonk': {
      description: 'Detuned saloon piano (two mistuned strings)',
      layers: [
        { model: 'grand-piano', detune: -11, gain: -3, pan: -0.15 }, { model: 'grand-piano', detune: 9, gain: -3, pan: 0.15 },
        { model: 'grand-piano-release', trigger: 'release' },
      ],
      params: { brightness: 0.6, reverbSend: 0.08 },
      reverb: 'room',
    },
    'long-sustain': { description: 'Longer ringing notes', params: { decay: 1.6, release: 1.5 } },
  },
};

/** Upright Piano. */
export const UPRIGHT_PIANO: InstrumentDef = {
  id: 'upright-piano',
  name: 'Upright Piano',
  family: 'keyboard',
  description: 'Yamaha upright: intimate, a little brighter and boxier than the grand.',
  layers: [{ model: 'upright-piano' }, { model: 'upright-piano-release', trigger: 'release' }],
  range: [21, 108],
  reverb: 'room',
  aliases: ['upright'],
  presets: {
    default: { description: 'As recorded' },
    vintage: { description: 'Older instrument: duller, slightly out of tune', params: { brightness: -1.2, humanize: 5 } },
    'honky-tonk': {
      description: 'Bar-room detuned upright',
      layers: [
        { model: 'upright-piano', detune: -12, gain: -3 }, { model: 'upright-piano', detune: 10, gain: -3 },
        { model: 'upright-piano-release', trigger: 'release' },
      ],
      params: { brightness: 0.8 },
    },
    dry: ROOMS.dry,
  },
};

/** Harpsichord. */
export const HARPSICHORD: InstrumentDef = {
  id: 'harpsichord',
  name: 'Harpsichord',
  family: 'keyboard',
  description: 'French double-manual harpsichord, plucked attack transients from the real instrument.',
  layers: [{ model: 'harpsichord' }, { model: 'harpsichord-release', trigger: 'release' }],
  range: [29, 89],
  reverb: 'chamber',
  presets: {
    default: { description: "Single 8' choir" },
    '8-4': {
      description: "8' + 4' (brilliant, octave coupled)",
      layers: [
        { model: 'harpsichord' }, { model: 'harpsichord', transpose: 12, gain: -5 },
        { model: 'harpsichord-release', trigger: 'release' },
      ],
    },
    lute: { description: 'Buff/lute stop: muted, short and soft', params: { brightness: -3, decay: 0.45, noise: -4 } },
    flemish: {
      description: 'Flemish harpsichord (8\')',
      layers: [{ model: 'harpsichord-flemish' }, { model: 'harpsichord-flemish-release', trigger: 'release' }],
    },
    hall: ROOMS.hall,
  },
};
