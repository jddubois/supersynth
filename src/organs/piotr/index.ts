/**
 * Piotr Grabowski's free organ sample sets (piotrgrabowski.pl): every stop analysed pipe by pipe
 * from the sample set as it plays — its own pitch and temperament, its borrowed and extended
 * ranks, each pipe's level and release, the room it was recorded in.
 */
import type { OrganDef } from '../types.js';
import { AZZIO_ORGAN } from './azzio.js';
import { DLUGA_KOSCIELNA_ORGAN } from './dluga-koscielna.js';
import { GREEN_POSITIV_ORGAN } from './green-positiv.js';
import { LEDZINY_ORGAN } from './ledziny.js';
import { LIPINY_ORGAN } from './lipiny.js';
import { MELCER_ORGAN } from './melcer.js';
import { RASZCZYCE_ORGAN } from './raszczyce.js';
import { SKRZATUSZ_ORGAN } from './skrzatusz.js';
import { STRASSBURG_ORGAN } from './strassburg.js';
import { SZCZECINEK_ORGAN } from './szczecinek.js';

export { AZZIO_ORGAN, DLUGA_KOSCIELNA_ORGAN, GREEN_POSITIV_ORGAN, LEDZINY_ORGAN, LIPINY_ORGAN, MELCER_ORGAN, RASZCZYCE_ORGAN, SKRZATUSZ_ORGAN, STRASSBURG_ORGAN, SZCZECINEK_ORGAN };

/** Piotr Grabowski's organs by id. */
export const PIOTR_ORGANS = {
  azzio: AZZIO_ORGAN,
  'dluga-koscielna': DLUGA_KOSCIELNA_ORGAN,
  'green-positiv': GREEN_POSITIV_ORGAN,
  ledziny: LEDZINY_ORGAN,
  lipiny: LIPINY_ORGAN,
  melcer: MELCER_ORGAN,
  raszczyce: RASZCZYCE_ORGAN,
  skrzatusz: SKRZATUSZ_ORGAN,
  strassburg: STRASSBURG_ORGAN,
  szczecinek: SZCZECINEK_ORGAN,
} as const satisfies Record<string, OrganDef>;
