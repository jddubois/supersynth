import type { DivisionDefinition, DivisionName, TremulantDefinition } from './types.js';

/**
 * The usual layout of a church organ seen from the nave: great in the middle, swell (in its
 * swell box) a little to the right, positive a little to the left, pedal in the middle.
 */
export const CHURCH_DIVISIONS: Record<DivisionName, DivisionDefinition> = {
  great: { pan: 0 },
  swell: { pan: 0.15, swellBox: true },
  positive: { pan: -0.15 },
  pedal: { pan: 0 },
};

/** A tremulant on the swell: all its pipes pulse together in loudness and (less) in pitch,
 *  about 6 Hz, ±2.5 dB, ±8 cents. */
export const SWELL_TREMULANT: TremulantDefinition = { division: 'swell', depth: 2.5, pitch: 8, rate: 6.2 };

/** Defaults of the optional {@link OrganDefinition} fields. */
export const ORGAN_DEFAULTS = { wind: 0.5, reverb: 'church', reverbSend: 0.07, speech: 12 } as const;
