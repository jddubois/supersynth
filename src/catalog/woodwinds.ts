// Woodwinds
import { type InstrumentDef, one } from './types.js';

/** Flute. */
export const FLUTE: InstrumentDef = {
  id: 'flute',
  name: 'Flute',
  family: 'woodwind',
  description: 'Concert flute, straight tone.',
  layers: one('flute'),
  range: [59, 98],
  reverb: 'hall',
  presets: {
    legato: { description: 'Slurred melody: notes connect without re-attacking', params: { legato: true, glide: 0.05 } },
    default: { description: 'Straight tone' },
    vibrato: { description: 'With natural flute vibrato', layers: one('flute-vibrato') },
    breathy: { description: 'More air in the tone', params: { noise: 6, brightness: -0.5 } },
    piccolo: { description: 'Piccolo', layers: one('piccolo') },
  },
};

/** Oboe. */
export const OBOE: InstrumentDef = {
  id: 'oboe',
  name: 'Oboe',
  family: 'woodwind',
  description: 'Oboe.',
  layers: one('oboe'),
  range: [58, 91],
  reverb: 'hall',
  presets: {
    legato: { description: 'Slurred melody: notes connect without re-attacking', params: { legato: true, glide: 0.05 } }, default: { description: 'As recorded' }, vibrato: { description: 'Light vibrato', params: { vibrato: 8, vibratoRate: 5.2 } } },
};

/** Clarinet. */
export const CLARINET: InstrumentDef = {
  id: 'clarinet',
  name: 'Clarinet',
  family: 'woodwind',
  description: 'B♭ clarinet.',
  layers: one('clarinet'),
  range: [50, 91],
  reverb: 'hall',
  presets: {
    legato: { description: 'Slurred melody: notes connect without re-attacking', params: { legato: true, glide: 0.05 } }, default: { description: 'As recorded' }, dark: { description: 'Dark, covered tone', params: { brightness: -1.5, evenHarmonics: -3 } } },
};

/** Bassoon. */
export const BASSOON: InstrumentDef = {
  id: 'bassoon',
  name: 'Bassoon',
  family: 'woodwind',
  description: 'Bassoon.',
  layers: one('bassoon'),
  range: [34, 75],
  reverb: 'hall',
  presets: {
    legato: { description: 'Slurred melody: notes connect without re-attacking', params: { legato: true, glide: 0.05 } }, default: { description: 'As recorded' } },
};

/** Tenor Saxophone. */
export const TENOR_SAX: InstrumentDef = {
  id: 'tenor-sax',
  name: 'Tenor Saxophone',
  family: 'woodwind',
  description: 'Tenor saxophone, straight tone.',
  layers: one('tenor-sax'),
  range: [44, 88],
  reverb: 'room',
  aliases: ['sax', 'saxophone'],
  presets: {
    legato: { description: 'Slurred melody: notes connect without re-attacking', params: { legato: true, glide: 0.05 } },
    default: { description: 'Straight tone' },
    jazz: { description: 'Jazz ballad: breathy with vibrato', params: { noise: 4, vibrato: 14, vibratoRate: 5.0, vibratoDelay: 0.35 } },
    bright: { description: 'Edgy rock tone', params: { brightness: 1.5, drive: 2 } },
  },
};
