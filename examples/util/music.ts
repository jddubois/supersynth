/**
 * Small library of public-domain musical material used by the examples.
 * Durations are in beats; `null` is a rest.
 */
import type { Playable } from '../../src/index.ts';

export type Step = [string | string[] | null, number] | [string | string[] | null, number, number];

/** "Ode to Joy" (Beethoven), the theme. */
export const ODE_TO_JOY: Step[] = [
  ['E4', 1], ['E4', 1], ['F4', 1], ['G4', 1], ['G4', 1], ['F4', 1], ['E4', 1], ['D4', 1],
  ['C4', 1], ['C4', 1], ['D4', 1], ['E4', 1], ['E4', 1.5], ['D4', 0.5], ['D4', 2],
];

/** "Greensleeves" (trad.), first phrase, in A minor. */
export const GREENSLEEVES: Step[] = [
  ['A4', 1], ['C5', 2], ['D5', 1], ['E5', 1.5], ['F5', 0.5], ['E5', 1], ['D5', 2], ['B4', 1],
  ['G4', 1.5], ['A4', 0.5], ['B4', 1], ['C5', 2], ['A4', 1], ['A4', 1.5], ['G#4', 0.5], ['A4', 1],
  ['B4', 2], ['G#4', 1], ['E4', 2],
];

/** "Amazing Grace" (trad.), first line, F major. */
export const AMAZING_GRACE: Step[] = [
  ['C4', 1], ['F4', 2], ['A4', 0.5], ['F4', 0.5], ['A4', 2], ['G4', 1], ['F4', 2], ['D4', 1], ['C4', 3],
];

/** Bach, Prelude in C major BWV 846, bars 1–4 (broken chords). */
export const BWV846: Step[] = (() => {
  const bars = [
    ['C4', 'E4', 'G4', 'C5', 'E5'],
    ['C4', 'D4', 'A4', 'D5', 'F5'],
    ['B3', 'D4', 'G4', 'D5', 'F5'],
    ['C4', 'E4', 'G4', 'C5', 'E5'],
  ];
  const out: Step[] = [];
  for (const [a, b, c, d, e] of bars) {
    for (let half = 0; half < 2; half++) {
      out.push([a!, 0.5], [b!, 0.5], [c!, 0.5], [d!, 0.5], [e!, 0.5], [c!, 0.5], [d!, 0.5], [e!, 0.5]);
    }
  }
  return out;
})();

/** "Old Hundredth" (Genevan Psalter, 1551) in four parts, G major: [soprano, alto, tenor, bass]. */
export const OLD_HUNDREDTH: Array<[string, string, string, string, number]> = [
  ['G4', 'D4', 'B3', 'G2', 2], ['G4', 'D4', 'B3', 'G2', 1], ['F#4', 'D4', 'A3', 'D3', 1],
  ['E4', 'C4', 'G3', 'C3', 1], ['D4', 'B3', 'G3', 'G2', 1], ['G4', 'D4', 'B3', 'G2', 1],
  ['A4', 'E4', 'C4', 'A2', 1], ['B4', 'D4', 'B3', 'G2', 3],
  ['B4', 'D4', 'G3', 'G2', 1], ['B4', 'D4', 'G3', 'G3', 1], ['B4', 'E4', 'G3', 'E3', 1],
  ['A4', 'F#4', 'D4', 'D3', 1], ['G4', 'E4', 'B3', 'E3', 1], ['C5', 'E4', 'C4', 'A2', 1],
  ['B4', 'G4', 'D4', 'G2', 1], ['A4', 'F#4', 'D4', 'D3', 3],
];

/** Pachelbel-style chord progression (I V vi iii IV I IV V) in D major, close voicings. */
export const CANON_CHORDS: string[][] = [
  ['D3', 'F#4', 'A4', 'D5'], ['A2', 'E4', 'A4', 'C#5'], ['B2', 'F#4', 'B4', 'D5'], ['F#2', 'F#4', 'A4', 'C#5'],
  ['G2', 'D4', 'G4', 'B4'], ['D3', 'D4', 'F#4', 'A4'], ['G2', 'D4', 'G4', 'B4'], ['A2', 'E4', 'A4', 'C#5'],
];

/** Westminster quarters (bells). */
export const WESTMINSTER: Step[] = [
  ['E4', 1], ['C4', 1], ['D4', 1], ['G3', 2], ['G3', 1], ['D4', 1], ['E4', 1], ['C4', 2],
];

/** Shift a melody by octaves so it sits inside a MIDI range. */
export function fitToRange(steps: Step[], range: [number, number]): Step[] {
  const notes = steps.flatMap(([n]) => (n === null ? [] : Array.isArray(n) ? n : [n])).map(toMidi);
  const lo = Math.min(...notes);
  const hi = Math.max(...notes);
  const centre = (range[0] + range[1]) / 2;
  let shift = Math.round((centre - (lo + hi) / 2) / 12) * 12;
  while (lo + shift < range[0] + 2 && hi + shift + 12 <= range[1]) shift += 12;
  while (hi + shift > range[1] - 2 && lo + shift - 12 >= range[0]) shift -= 12;
  const tr = (n: string) => midiToName(toMidi(n) + shift);
  return steps.map((s) => {
    const n = s[0];
    const moved = n === null ? null : Array.isArray(n) ? n.map(tr) : tr(n);
    return (s.length === 3 ? [moved, s[1], s[2]] : [moved, s[1]]) as Step;
  });
}

/** Play steps on an instrument or organ division; returns the duration in seconds. */
export function playSteps(playable: Playable, steps: Step[], opts: { at?: number; bpm?: number; velocity?: number; legato?: number } = {}): number {
  return playable.sequence(
    steps.map(([note, beats, vel]) => ({ note, beats, velocity: vel ?? opts.velocity ?? 90 })),
    { ...(opts.at !== undefined ? { at: opts.at } : {}), bpm: opts.bpm ?? 90, legato: opts.legato ?? 0.97 },
  );
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function toMidi(n: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(n)!;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1] as 'C']!;
  return 12 * (Number(m[3]) + 1) + base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
function midiToName(n: number): string {
  return `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
}
