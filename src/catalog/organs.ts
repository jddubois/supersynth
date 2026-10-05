// Organs (single-sound models; see `supersynth/organs` for the full church organs)
import { type InstrumentDefinition, one } from './types.js';

/** Pipe Organ (full). */
export const PIPE_ORGAN: InstrumentDefinition = {
  id: 'pipe-organ',
  name: 'Pipe Organ (full)',
  family: 'organ',
  description: 'A church organ with a full registration, recorded in its building.',
  // the full-organ and pedal models are filed an octave below the pitch they sound (see vcsl.ts)
  layers: [{ model: 'pipe-organ', transpose: -12 }],
  range: [36, 96],
  reverb: 'church',
  presets: {
    default: { description: 'Full swell' },
    soft: { description: 'Soft flutes', layers: one('pipe-organ-soft') },
    'with-pedal': {
      description: 'Manual plus 16\' pedal below C3',
      layers: [{ model: 'pipe-organ', transpose: -12, keyLow: 48 }, { model: 'pipe-organ-pedal', transpose: -24, keyHigh: 47 }],
    },
    cathedral: { description: 'In a vast cathedral', parameters: { reverbSend: 0.3 }, reverb: 'cathedral' },
  },
};

/** Renaissance Chamber Organ. */
export const CHAMBER_ORGAN: InstrumentDefinition = {
  id: 'chamber-organ',
  name: 'Renaissance Chamber Organ',
  family: 'organ',
  description: "A small Renaissance-style positive organ: sweet wooden flutes.",
  layers: one('renaissance-organ-8'),
  range: [36, 89],
  reverb: 'chamber',
  presets: {
    default: { description: "8' flute" },
    '4ft': { description: "4' flute alone", layers: one('renaissance-organ-4') },
    '8-4': { description: "8' + 4'", layers: [{ model: 'renaissance-organ-8' }, { model: 'renaissance-organ-4', gain: -2 }] },
    full: { description: 'Full organ', layers: one('renaissance-organ-full') },
  },
};
