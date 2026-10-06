import type { DivisionName, OrganDefinition, StopDefinition, StopFamily } from './types.js';

/** What {@link findStops} looks for; every field given must match. */
export interface StopQuery {
  division?: DivisionName | DivisionName[];
  family?: StopFamily | StopFamily[];
  /** Pitch in feet (see {@link StopDefinition.feet}): `8`, `4`, `2 + 2 / 3`, … */
  feet?: number;
}

/**
 * The stops of an organ that match a query, in the organ's order. Useful to find the same
 * registration on any organ, by family and pitch rather than by name:
 *
 * ```ts
 * import { ORGANS, findStops } from '@supersynth/core';
 * findStops(ORGANS.friesach, { division: 'great', family: 'principal', feet: 4 });  // [Octave 4']
 * findStops(ORGANS.burea, { family: ['flute', 'principal'], feet: 2 + 2 / 3 });     // [] (a mutation)
 * ```
 */
export function findStops(organ: OrganDefinition, query: StopQuery = {}): StopDefinition[] {
  const has = <T>(want: T | T[] | undefined, v: T) => want === undefined || (Array.isArray(want) ? want.includes(v) : want === v);
  return organ.stops.filter(
    (s) =>
      has(query.division, s.division) &&
      has(query.family, s.family) &&
      (query.feet === undefined || (s.feet !== undefined && Math.abs(s.feet - query.feet) < 0.01)),
  );
}
