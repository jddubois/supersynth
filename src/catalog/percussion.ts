// Mallets and bells
import { type InstrumentDefinition, one } from './types.js';

/** Marimba. */
export const MARIMBA: InstrumentDefinition = {
  id: 'marimba',
  name: 'Marimba',
  family: 'percussion',
  description: 'Rosewood marimba.',
  layers: one('marimba'),
  range: [45, 96],
  reverb: 'hall',
  presets: { default: { description: 'As recorded' }, soft: { description: 'Yarn mallets', parameters: { brightness: -2, noise: -6 } } },
};

/** Vibraphone. */
export const VIBRAPHONE: InstrumentDefinition = {
  id: 'vibraphone',
  name: 'Vibraphone',
  family: 'percussion',
  description: 'Vibraphone with hard mallets; note-off engages the damper pedal behaviour.',
  layers: one('vibraphone'),
  range: [53, 89],
  reverb: 'hall',
  presets: {
    default: { description: 'As recorded' },
    'let-ring': { description: 'Pedal down: notes ring', parameters: { release: 8 } },
    motor: { description: 'Motor on: the classic vibraphone pulse', parameters: { tremolo: 4, tremoloRate: 5.5, release: 4 } },
  },
};

/** Xylophone. */
export const XYLOPHONE: InstrumentDefinition = {
  id: 'xylophone',
  name: 'Xylophone',
  family: 'percussion',
  description: 'Xylophone.',
  layers: one('xylophone'),
  range: [60, 108],
  reverb: 'hall',
  presets: { default: { description: 'As recorded' } },
};

/** Glockenspiel. */
export const GLOCKENSPIEL: InstrumentDefinition = {
  id: 'glockenspiel',
  name: 'Glockenspiel',
  family: 'percussion',
  description: 'Glockenspiel.',
  layers: one('glockenspiel'),
  range: [72, 108],
  reverb: 'hall',
  presets: { default: { description: 'As recorded' } },
};

/** Tubular Bells. */
export const TUBULAR_BELLS: InstrumentDefinition = {
  id: 'tubular-bells',
  name: 'Tubular Bells',
  family: 'percussion',
  description: 'Orchestral chimes.',
  layers: one('tubular-bells'),
  range: [60, 77],
  reverb: 'church',
  presets: { default: { description: 'As recorded' } },
};
