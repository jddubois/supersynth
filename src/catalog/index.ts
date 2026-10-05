/**
 * Instrument configurations. Every instrument is a plain {@link InstrumentDefinition}: import one
 * to play it, or copy and change it.
 *
 * ```ts
 * import { GRAND_PIANO } from '@supersynth/core/instruments';
 * synth.add({ ...GRAND_PIANO, id: 'my-piano', parameters: { brightness: -1 } });
 * ```
 */
import { GRAND_PIANO, UPRIGHT_PIANO, HARPSICHORD } from './keyboards.js';
import { PIPE_ORGAN, CHAMBER_ORGAN } from './organs.js';
import { HARP, VIOLIN_PIZZICATO, CELLO_PIZZICATO, CONTRABASS_PIZZICATO, VIOLIN, VIOLINS, VIOLAS, CELLOS, CONTRABASS, STRINGS } from './strings.js';
import { FLUTE, OBOE, CLARINET, BASSOON, TENOR_SAX } from './woodwinds.js';
import { TRUMPET, FRENCH_HORN, TROMBONE, TUBA, BRASS } from './brass.js';
import { MARIMBA, VIBRAPHONE, XYLOPHONE, GLOCKENSPIEL, TUBULAR_BELLS } from './percussion.js';
import type { InstrumentDefinition } from './types.js';

export * from './keyboards.js';
export * from './organs.js';
export * from './strings.js';
export * from './woodwinds.js';
export * from './brass.js';
export * from './percussion.js';
export type { InstrumentDefinition, InstrumentFamily, LayerDefinition, InstrumentPreset } from './types.js';

/** Every built-in instrument, by id (`synth.add('grand-piano')`). */
export const INSTRUMENTS = {
  'grand-piano': GRAND_PIANO,
  'upright-piano': UPRIGHT_PIANO,
  'harpsichord': HARPSICHORD,
  'pipe-organ': PIPE_ORGAN,
  'chamber-organ': CHAMBER_ORGAN,
  'harp': HARP,
  'violin-pizzicato': VIOLIN_PIZZICATO,
  'cello-pizzicato': CELLO_PIZZICATO,
  'contrabass-pizzicato': CONTRABASS_PIZZICATO,
  'violin': VIOLIN,
  'violins': VIOLINS,
  'violas': VIOLAS,
  'cellos': CELLOS,
  'contrabass': CONTRABASS,
  'strings': STRINGS,
  'flute': FLUTE,
  'oboe': OBOE,
  'clarinet': CLARINET,
  'bassoon': BASSOON,
  'tenor-sax': TENOR_SAX,
  'trumpet': TRUMPET,
  'french-horn': FRENCH_HORN,
  'trombone': TROMBONE,
  'tuba': TUBA,
  'brass': BRASS,
  'marimba': MARIMBA,
  'vibraphone': VIBRAPHONE,
  'xylophone': XYLOPHONE,
  'glockenspiel': GLOCKENSPIEL,
  'tubular-bells': TUBULAR_BELLS,
} satisfies Record<string, InstrumentDefinition>;

/** Id of a built-in instrument. */
export type InstrumentId = keyof typeof INSTRUMENTS;
