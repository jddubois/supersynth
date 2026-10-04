/**
 * Organ configurations: import one to play it, or copy and change it.
 *
 * ```ts
 * import { BUREA_ORGAN } from 'supersynth/organs';
 * synth.add(BUREA_ORGAN, { preset: 'plenum' });
 * ```
 */
import { BUREA_ORGAN } from './burea.js';
import { VCSL_ORGAN } from './vcsl.js';
import type { OrganDefinition } from './types.js';

export { BUREA_ORGAN } from './burea.js';
export { VCSL_ORGAN } from './vcsl.js';
export { CHURCH_DIVISIONS, SWELL_TREMULANT, ORGAN_DEFAULTS } from './defaults.js';
export type { DivisionDefinition, DivisionName, OrganDefinition, OrganPreset, StopDefinition, StopFamily, TremulantDefinition } from './types.js';

/** The built-in organs by id (`synth.add('vcsl')`). */
export const ORGANS = { burea: BUREA_ORGAN, vcsl: VCSL_ORGAN } as const satisfies Record<string, OrganDefinition>;
/** Id of a built-in organ. */
export type OrganId = keyof typeof ORGANS;
