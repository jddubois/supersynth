import { findStops, ORGANS, type StopDefinition } from '../../src/organs/index.js';

/** The footage a knob is engraved with: "Octave 4'" 4, "Nasat 1 1/3'" 1.333. */
const engraved = (name: string) => {
  const m = name.match(/(\d+)(?:\s+(\d+)\/(\d+))?\s*'/);
  return m ? Number(m[1]) + (m[2] ? Number(m[2]) / Number(m[3]) : 0) : undefined;
};
/** Knobs whose engraving is not the pitch their pipes sound. */
const ENGRAVED_OTHERWISE = new Set(['azzio/positive-nazardo-3']);

describe('stop footage', () => {
  const all = Object.entries(ORGANS).flatMap(([organ, def]) => def.stops.map((s) => [organ, s] as [string, StopDefinition]));

  test('every stop but the mixtures has its pitch in feet, a harmonic of 32\'', () => {
    for (const [organ, s] of all) {
      if (s.family === 'mixture') expect([organ, s.id, s.feet]).toEqual([organ, s.id, undefined]);
      else {
        expect([organ, s.id, typeof s.feet]).toEqual([organ, s.id, 'number']);
        const h = 32 / s.feet!;
        expect([organ, s.id, Math.abs(h - Math.round(h)) < 1e-9]).toEqual([organ, s.id, true]);
      }
    }
  });

  test('the footage is what the knob says', () => {
    for (const [organ, s] of all) {
      const e = engraved(s.name);
      if (s.feet === undefined || e === undefined || ENGRAVED_OTHERWISE.has(`${organ}/${s.id}`)) continue;
      expect([organ, s.name, s.feet]).toEqual([organ, s.name, expect.closeTo(e, 2)]);
    }
  });

  test('the footage is the pitch the stop plays (organs whose transpose is from 8\')', () => {
    for (const [organ, def] of Object.entries(ORGANS)) {
      if (organ === 'vcsl') continue; // (its models are transposed from their own recorded pitch)
      const stops = def.stops.filter((s) => s.feet !== undefined);
      // the organ's own pitch (e.g. a semitone below A440) shifts every stop alike
      const offsets = stops.map((s) => s.transpose - 12 * Math.log2(8 / s.feet!)).sort((a, b) => a - b);
      const shift = offsets[Math.floor(offsets.length / 2)]!;
      for (const s of stops) {
        const off = s.transpose - 12 * Math.log2(8 / s.feet!) - shift;
        // (equal-tempered transposition of a just interval: a septime is 0.31 semitone off)
        expect([organ, s.id, Math.abs(off) < 0.6]).toEqual([organ, s.id, true]);
      }
    }
  });

  test('findStops finds stops by division, family and pitch', () => {
    expect(findStops(ORGANS.burea, { division: 'great', family: 'principal', feet: 4 }).map((s) => s.name)).toEqual(["Octave 4'"]);
    expect(findStops(ORGANS.burea, { family: 'mutation', feet: 2 + 2 / 3 }).map((s) => s.name)).toEqual(["Rohrquinte 2 2/3'"]);
    expect(findStops(ORGANS.burea, { division: ['swell', 'positive'], family: ['flute', 'principal'], feet: 2 }).map((s) => s.name)).toEqual([
      "Waldflöte 2'",
      "Principal 2'",
      "Flötlein 2'",
    ]);
    expect(findStops(ORGANS.azzio, { feet: 8 / 3 }).map((s) => s.name)).toEqual(["Nazardo 3'"]);
    expect(findStops(ORGANS.burea, { family: 'mixture' })).toHaveLength(5);
    expect(findStops(ORGANS.burea)).toHaveLength(ORGANS.burea.stops.length);
  });
});
