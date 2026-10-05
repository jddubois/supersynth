// Woodwinds
import { type InstrumentDefinition, one } from './types.js';

/** Flute. */
export const FLUTE: InstrumentDefinition = {
  id: 'flute',
  name: 'Flute',
  family: 'woodwind',
  description: 'Concert flute, straight tone.',
  layers: one('flute'),
  range: [59, 98],
  reverb: 'hall',
  presets: {
    legato: { description: 'Slurred melody: notes connect without re-attacking', parameters: { legato: true, glide: 0.05 } },
    default: { description: 'Straight tone' },
    vibrato: { description: 'With natural flute vibrato', layers: one('flute-vibrato') },
    breathy: { description: 'More air in the tone', parameters: { noise: 6, brightness: -0.5 } },
    piccolo: { description: 'Piccolo (flute below its range)', layers: [{ model: 'piccolo', keyLow: 74 }, { model: 'flute', keyHigh: 73 }] },
  },
};

/** Oboe. */
export const OBOE: InstrumentDefinition = {
  id: 'oboe',
  name: 'Oboe',
  family: 'woodwind',
  description: 'Oboe.',
  layers: one('oboe'),
  range: [58, 91],
  reverb: 'hall',
  presets: {
    legato: { description: 'Slurred melody: notes connect without re-attacking', parameters: { legato: true, glide: 0.05 } }, default: { description: 'No adjustments' }, vibrato: { description: 'Light vibrato', parameters: { vibrato: 8, vibratoRate: 5.2 } } },
};

/** Clarinet. */
export const CLARINET: InstrumentDefinition = {
  id: 'clarinet',
  name: 'Clarinet',
  family: 'woodwind',
  description: 'B♭ clarinet.',
  layers: one('clarinet'),
  range: [50, 91],
  reverb: 'hall',
  presets: {
    legato: { description: 'Slurred melody: notes connect without re-attacking', parameters: { legato: true, glide: 0.05 } }, default: { description: 'No adjustments' }, dark: { description: 'Dark, covered tone', parameters: { brightness: -1.5, evenHarmonics: -3 } } },
};

/** Bassoon. */
export const BASSOON: InstrumentDefinition = {
  id: 'bassoon',
  name: 'Bassoon',
  family: 'woodwind',
  description: 'Bassoon.',
  layers: one('bassoon'),
  range: [34, 75],
  reverb: 'hall',
  presets: {
    legato: { description: 'Slurred melody: notes connect without re-attacking', parameters: { legato: true, glide: 0.05 } }, default: { description: 'No adjustments' } },
};

/** Tenor Saxophone. */
export const TENOR_SAX: InstrumentDefinition = {
  id: 'tenor-sax',
  name: 'Tenor Saxophone',
  family: 'woodwind',
  description: 'Tenor saxophone, straight tone.',
  layers: one('tenor-sax'),
  range: [44, 88],
  reverb: 'room',
  presets: {
    legato: { description: 'Slurred melody: notes connect without re-attacking', parameters: { legato: true, glide: 0.05 } },
    default: { description: 'Straight tone' },
    jazz: { description: 'Jazz ballad: breathy with vibrato', parameters: { noise: 4, vibrato: 14, vibratoRate: 5.0, vibratoDelay: 0.35 } },
    bright: { description: 'Edgy rock tone', parameters: { brightness: 1.5, drive: 2 } },
  },
};
