/**
 * Piotr Grabowski's free organ sample sets (piotrgrabowski.pl): every stop analysed pipe by pipe
 * from the sample set as it plays — its own pitch and temperament, its borrowed and extended
 * ranks, each pipe's level and release, the room it was recorded in.
 */
import type { OrganDefinition } from '../types.js';
import { AZZIO_ORGAN } from './azzio.js';
import { DLUGA_KOSCIELNA_ORGAN } from './dluga-koscielna.js';
import { FRIESACH_ORGAN } from './friesach.js';
import { GIUBIASCO_ORGAN } from './giubiasco.js';
import { GREEN_POSITIV_ORGAN } from './green-positiv.js';
import { HARMONIUM_ORGAN } from './harmonium.js';
import { LEDZINY_ORGAN } from './ledziny.js';
import { LIPINY_ORGAN } from './lipiny.js';
import { MELCER_ORGAN } from './melcer.js';
import { RASZCZYCE_ORGAN } from './raszczyce.js';
import { SAINT_JEAN_DE_LUZ_ORGAN } from './saint-jean-de-luz.js';
import { SKRZATUSZ_ORGAN } from './skrzatusz.js';
import { STRASSBURG_ORGAN } from './strassburg.js';
import { SZCZECINEK_ORGAN } from './szczecinek.js';

export { AZZIO_ORGAN, DLUGA_KOSCIELNA_ORGAN, FRIESACH_ORGAN, GIUBIASCO_ORGAN, GREEN_POSITIV_ORGAN, HARMONIUM_ORGAN, LEDZINY_ORGAN, LIPINY_ORGAN, MELCER_ORGAN, RASZCZYCE_ORGAN, SAINT_JEAN_DE_LUZ_ORGAN, SKRZATUSZ_ORGAN, STRASSBURG_ORGAN, SZCZECINEK_ORGAN };

/** Piotr Grabowski's organs by id. */
export const PIOTR_ORGANS = {
  azzio: AZZIO_ORGAN,
  'dluga-koscielna': DLUGA_KOSCIELNA_ORGAN,
  friesach: FRIESACH_ORGAN,
  giubiasco: GIUBIASCO_ORGAN,
  'green-positiv': GREEN_POSITIV_ORGAN,
  harmonium: HARMONIUM_ORGAN,
  ledziny: LEDZINY_ORGAN,
  lipiny: LIPINY_ORGAN,
  melcer: MELCER_ORGAN,
  raszczyce: RASZCZYCE_ORGAN,
  'saint-jean-de-luz': SAINT_JEAN_DE_LUZ_ORGAN,
  skrzatusz: SKRZATUSZ_ORGAN,
  strassburg: STRASSBURG_ORGAN,
  szczecinek: SZCZECINEK_ORGAN,
} as const satisfies Record<string, OrganDefinition>;
