// Brass
import { type InstrumentDef, one } from './types.js';

/** Trumpet. */
export const TRUMPET: InstrumentDef = {
  id: 'trumpet',
  name: 'Trumpet',
  family: 'brass',
  description: 'B♭ trumpet.',
  layers: one('trumpet'),
  range: [52, 84],
  reverb: 'hall',
  presets: {
    legato: { description: 'Slurred melody: notes connect without re-attacking', params: { legato: true, glide: 0.05 } },
    default: { description: 'Open' },
    muted: { description: 'Straight mute', layers: one('trumpet-muted') },
    vibrato: { description: 'Lyrical vibrato', params: { vibrato: 10, vibratoRate: 5.5 } },
  },
};

/** French Horn. */
export const FRENCH_HORN: InstrumentDef = {
  id: 'french-horn',
  name: 'French Horn',
  family: 'brass',
  description: 'Horn in F.',
  layers: one('french-horn'),
  range: [34, 77],
  reverb: 'hall',
  aliases: ['horn'],
  presets: {
    legato: { description: 'Slurred melody: notes connect without re-attacking', params: { legato: true, glide: 0.05 } }, default: { description: 'As recorded' }, distant: { description: 'Distant, at the back of the hall', params: { reverbSend: 0.45, brightness: -1 } } },
};

/** Trombone. */
export const TROMBONE: InstrumentDef = {
  id: 'trombone',
  name: 'Trombone',
  family: 'brass',
  description: 'Tenor trombone.',
  layers: one('trombone'),
  range: [28, 72],
  reverb: 'hall',
  presets: {
    legato: { description: 'Slurred melody: notes connect without re-attacking', params: { legato: true, glide: 0.05 } }, default: { description: 'As recorded' } },
};

/** Tuba. */
export const TUBA: InstrumentDef = {
  id: 'tuba',
  name: 'Tuba',
  family: 'brass',
  description: 'Tuba.',
  layers: one('tuba'),
  range: [22, 60],
  reverb: 'hall',
  presets: {
    legato: { description: 'Slurred melody: notes connect without re-attacking', params: { legato: true, glide: 0.05 } }, default: { description: 'As recorded' } },
};

/** Brass Section. */
export const BRASS: InstrumentDef = {
  id: 'brass',
  name: 'Brass Section',
  family: 'brass',
  description: 'Tuba, trombone, horn and trumpet split across the keyboard.',
  layers: [
    { model: 'tuba', keyHigh: 45 },
    { model: 'trombone', keyLow: 40, keyHigh: 60 },
    { model: 'french-horn', keyLow: 48, keyHigh: 70, gain: -2 },
    { model: 'trumpet', keyLow: 58 },
  ],
  range: [22, 84],
  reverb: 'hall',
  aliases: ['brass-section'],
  presets: { default: { description: 'As recorded' } },
};
