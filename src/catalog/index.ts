/**
 * Instrument configurations. Every instrument is a plain {@link InstrumentDef}: import one
 * to play it, or copy and change it.
 *
 * ```ts
 * import { GRAND_PIANO } from 'supersynth/instruments';
 * synth.add({ ...GRAND_PIANO, id: 'my-piano', params: { brightness: -1 } });
 * ```
 */
import { GRAND_PIANO, UPRIGHT_PIANO, HARPSICHORD } from './keyboards.js';
import { PIPE_ORGAN, CHAMBER_ORGAN } from './organs.js';
import { HARP, VIOLIN_PIZZICATO, CELLO_PIZZICATO, CONTRABASS_PIZZICATO, VIOLIN, VIOLINS, VIOLAS, CELLOS, CONTRABASS, STRINGS } from './strings.js';
import { FLUTE, OBOE, CLARINET, BASSOON, TENOR_SAX } from './woodwinds.js';
import { TRUMPET, FRENCH_HORN, TROMBONE, TUBA, BRASS } from './brass.js';
import { MARIMBA, VIBRAPHONE, XYLOPHONE, GLOCKENSPIEL, TUBULAR_BELLS } from './percussion.js';
import type { InstrumentDef } from './types.js';

export * from './keyboards.js';
export * from './organs.js';
export * from './strings.js';
export * from './woodwinds.js';
export * from './brass.js';
export * from './percussion.js';
export type { InstrumentDef, InstrumentFamily, LayerDef, PresetDef } from './types.js';

/** Every built-in instrument. */
export const INSTRUMENTS: InstrumentDef[] = [
  GRAND_PIANO,
  UPRIGHT_PIANO,
  HARPSICHORD,
  PIPE_ORGAN,
  CHAMBER_ORGAN,
  HARP,
  VIOLIN_PIZZICATO,
  CELLO_PIZZICATO,
  CONTRABASS_PIZZICATO,
  VIOLIN,
  VIOLINS,
  VIOLAS,
  CELLOS,
  CONTRABASS,
  STRINGS,
  FLUTE,
  OBOE,
  CLARINET,
  BASSOON,
  TENOR_SAX,
  TRUMPET,
  FRENCH_HORN,
  TROMBONE,
  TUBA,
  BRASS,
  MARIMBA,
  VIBRAPHONE,
  XYLOPHONE,
  GLOCKENSPIEL,
  TUBULAR_BELLS,
];

const BY_ID = new Map<string, InstrumentDef>();
for (const d of INSTRUMENTS) {
  BY_ID.set(d.id, d);
  for (const a of d.aliases ?? []) BY_ID.set(a, d);
}

/** Look up an instrument by id or alias. */
export function findInstrument(id: string): InstrumentDef | undefined {
  return BY_ID.get(id.toLowerCase());
}

/** All instrument ids (and aliases with `withAliases`). */
export function instrumentIds(withAliases = false): string[] {
  return withAliases ? [...BY_ID.keys()] : INSTRUMENTS.map((d) => d.id);
}
