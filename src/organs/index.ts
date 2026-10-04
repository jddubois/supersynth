/**
 * Organ configurations: import one to play it, or copy and change it.
 *
 * ```ts
 * import { BUREA_ORGAN } from 'supersynth/organs';
 * synth.organ({ instrument: BUREA_ORGAN, preset: 'plenum' });
 * ```
 */
import { BUREA_ORGAN } from './burea.js';
import { VCSL_ORGAN } from './vcsl.js';
import type { OrganDef } from './types.js';

export { BUREA_ORGAN } from './burea.js';
export { VCSL_ORGAN } from './vcsl.js';
export { CHURCH_DIVISIONS, SWELL_TREMULANT, ORGAN_DEFAULTS } from './defaults.js';
export type { DivisionDef, DivisionName, OrganDef, OrganPreset, StopDef, StopFamily, TremulantDef } from './types.js';

/** The built-in organs by id (`synth.organ({ instrument: 'vcsl' })`). */
export const ORGANS = { burea: BUREA_ORGAN, vcsl: VCSL_ORGAN } as const satisfies Record<string, OrganDef>;
export type OrganInstrument = keyof typeof ORGANS;
