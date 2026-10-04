/**
 * Organ configurations: import one to play it, or copy and change it.
 *
 * ```ts
 * import { BUREA_ORGAN } from 'supersynth/organs';
 * synth.organ({ instrument: BUREA_ORGAN, registration: 'plenum' });
 * ```
 */
import { BUREA_ORGAN } from './burea.js';
import { VCSL_ORGAN } from './vcsl.js';
import { PIOTR_ORGANS } from './piotr/index.js';
import type { OrganDef } from './types.js';

export { BUREA_ORGAN } from './burea.js';
export { VCSL_ORGAN } from './vcsl.js';
export * from './piotr/index.js';
export { CHURCH_DIVISIONS, SWELL_TREMULANT, ORGAN_DEFAULTS } from './defaults.js';
export type { DivisionDef, DivisionName, OrganDef, Registration, StopDef, StopFamily, TremulantDef } from './types.js';

/** The built-in organs by id (`synth.organ({ instrument: 'vcsl' })`). */
export const ORGANS = { burea: BUREA_ORGAN, vcsl: VCSL_ORGAN, ...PIOTR_ORGANS } as const satisfies Record<string, OrganDef>;
export type OrganInstrument = keyof typeof ORGANS;

/** All stops of the Bureå organ. @deprecated use `BUREA_ORGAN.stops` */
export const BUREA_STOPS = BUREA_ORGAN.stops;
/** Registrations of the Bureå organ. @deprecated use `BUREA_ORGAN.registrations` */
export const REGISTRATIONS = BUREA_ORGAN.registrations;
/** All stops of the VCSL organ. @deprecated use `VCSL_ORGAN.stops` */
export const VCSL_STOPS = VCSL_ORGAN.stops;
/** Registrations of the VCSL organ. @deprecated use `VCSL_ORGAN.registrations` */
export const VCSL_REGISTRATIONS = VCSL_ORGAN.registrations;
