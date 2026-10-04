// Strings
import { type InstrumentDef, ROOMS, one } from './types.js';

/** Concert Harp. */
export const HARP: InstrumentDef = {
  id: 'harp',
  name: 'Concert Harp',
  family: 'strings',
  description: 'Pedal harp with real pluck transients; notes ring until they decay.',
  layers: one('harp'),
  range: [24, 103],
  reverb: 'hall',
  presets: {
    default: { description: 'As recorded' },
    warm: { description: 'Plucked closer to the middle of the string', params: { brightness: -1.5 } },
    'pres-de-la-table': { description: 'Plucked near the soundboard: metallic, guitar-like', params: { brightness: 2.5, decay: 0.6 } },
    hall: ROOMS.hall,
  },
};

/** Violin Pizzicato. */
export const VIOLIN_PIZZICATO: InstrumentDef = {
  id: 'violin-pizzicato',
  name: 'Violin Pizzicato',
  family: 'strings',
  description: 'Plucked solo violin.',
  layers: one('violin-pizzicato'),
  range: [55, 100],
  reverb: 'hall',
  presets: { default: { description: 'As recorded' }, dry: ROOMS.dry },
};

/** Cello Section Pizzicato. */
export const CELLO_PIZZICATO: InstrumentDef = {
  id: 'cello-pizzicato',
  name: 'Cello Section Pizzicato',
  family: 'strings',
  description: 'Plucked cello section.',
  layers: one('cello-pizzicato'),
  range: [36, 76],
  reverb: 'hall',
  presets: { default: { description: 'As recorded' }, dry: ROOMS.dry },
};

/** Contrabass Pizzicato. */
export const CONTRABASS_PIZZICATO: InstrumentDef = {
  id: 'contrabass-pizzicato',
  name: 'Contrabass Pizzicato',
  family: 'strings',
  description: 'Plucked double bass — also a lovely jazz walking bass.',
  layers: one('contrabass-pizzicato'),
  range: [28, 67],
  reverb: 'hall',
  presets: { default: { description: 'As recorded' }, jazz: { description: 'Dry jazz-club bass', params: { reverbSend: 0.05, brightness: 0.5 }, reverb: 'room' } },
};

/** Solo Violin. */
export const VIOLIN: InstrumentDef = {
  id: 'violin',
  name: 'Solo Violin',
  family: 'strings',
  description: 'Solo violin with natural vibrato.',
  layers: one('violin'),
  range: [55, 103],
  reverb: 'hall',
  presets: {
    legato: { description: 'Slurred melody: notes connect without re-attacking', params: { legato: true, glide: 0.05 } },
    default: { description: 'As recorded' },
    'senza-vibrato': { description: 'Straight tone, no vibrato (baroque style)', params: { naturalVibrato: 0.15 } },
    expressive: { description: 'Wider romantic vibrato', params: { naturalVibrato: 1.4, vibrato: 6, vibratoDelay: 0.25 } },
    intimate: { description: 'Close and dry', params: { reverbSend: 0.06, noise: 2 } },
  },
};

/** Violin Section. */
export const VIOLINS: InstrumentDef = {
  id: 'violins',
  name: 'Violin Section',
  family: 'strings',
  description: 'Orchestral first violins.',
  layers: one('violins'),
  range: [55, 100],
  reverb: 'hall',
  presets: {
    legato: { description: 'Slurred melody: notes connect without re-attacking', params: { legato: true, glide: 0.05 } },
    default: { description: 'As recorded' },
    lush: { description: 'Bigger, wider section', params: { chorus: 0.25, chorusDepth: 4, spread: 0.85, humanize: 3 } },
    soft: { description: 'Gentle, slow bow attack', params: { attack: 2.2, brightness: -1 } },
  },
};

/** Viola Section. */
export const VIOLAS: InstrumentDef = {
  id: 'violas',
  name: 'Viola Section',
  family: 'strings',
  description: 'Orchestral violas.',
  layers: one('violas'),
  range: [48, 91],
  reverb: 'hall',
  presets: {
    legato: { description: 'Slurred melody: notes connect without re-attacking', params: { legato: true, glide: 0.05 } }, default: { description: 'As recorded' }, soft: { description: 'Slow bow attack', params: { attack: 2.2, brightness: -1 } } },
};

/** Cello Section. */
export const CELLOS: InstrumentDef = {
  id: 'cellos',
  name: 'Cello Section',
  family: 'strings',
  description: 'Orchestral cellos with vibrato.',
  layers: one('cellos'),
  range: [36, 76],
  reverb: 'hall',
  presets: {
    legato: { description: 'Slurred melody: notes connect without re-attacking', params: { legato: true, glide: 0.05 } }, default: { description: 'As recorded' }, soft: { description: 'Slow bow attack', params: { attack: 2.0, brightness: -1 } } },
};

/** Contrabass. */
export const CONTRABASS: InstrumentDef = {
  id: 'contrabass',
  name: 'Contrabass',
  family: 'strings',
  description: 'Double bass, bowed.',
  layers: one('contrabass'),
  range: [28, 67],
  reverb: 'hall',
  presets: {
    legato: { description: 'Slurred melody: notes connect without re-attacking', params: { legato: true, glide: 0.05 } }, default: { description: 'As recorded' } },
};

/** String Orchestra. */
export const STRINGS: InstrumentDef = {
  id: 'strings',
  name: 'String Orchestra',
  family: 'strings',
  description: 'Full string section split across the keyboard: basses, cellos, violas and violins.',
  layers: [
    { model: 'contrabass', keyHigh: 47, gain: -2 },
    { model: 'cellos', keyLow: 36, keyHigh: 62 },
    { model: 'violas', keyLow: 55, keyHigh: 72, gain: -2 },
    { model: 'violins', keyLow: 60 },
  ],
  range: [28, 100],
  reverb: 'hall',
  presets: {
    default: { description: 'Divisi across the keyboard' },
    octaves: {
      description: 'Violins doubled by cellos an octave below (classic film voicing)',
      layers: [{ model: 'violins', keyLow: 55 }, { model: 'cellos', transpose: -12, gain: -3 }],
    },
    lush: { description: 'Wider and softer', params: { chorus: 0.2, attack: 1.6, spread: 0.9 } },
  },
};
