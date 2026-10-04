import type { OrganDefinition, OrganPreset, StopDefinition } from '../types.js';

// Every pipe analysed from Piotr Grabowski's free sample set; models/organ/green-positiv/<id>.ssm.
// Three ranks of pipes; Pryncypał 4' (Flet kryty 4' in the bass, the 2' an octave down) and
// Kwinta 1 1/3' (the 2' retuned) are borrowed, as in the sample set. The positive stands at
// Baroque pitch, a semitone below A440: every key sounds its own pipe at that pitch.
const STOPS: StopDefinition[] = [
  { id: 'great-flet-kryty-8', model: 'organ/green-positiv/great-flet-kryty-8', name: "Flet kryty 8'", division: 'great', family: 'flute', transpose: -1 },
  { id: 'great-flet-kryty-4', model: 'organ/green-positiv/great-flet-kryty-4', name: "Flet kryty 4'", division: 'great', family: 'flute', transpose: 11 },
  { id: 'great-pryncypal-4', model: 'organ/green-positiv/great-pryncypal-4', name: "Pryncypał 4'", division: 'great', family: 'principal', transpose: 11 },
  { id: 'great-pryncypal-2', model: 'organ/green-positiv/great-pryncypal-2', name: "Pryncypał 2'", division: 'great', family: 'principal', transpose: 23 },
  { id: 'great-kwinta-1-1-3', model: 'organ/green-positiv/great-kwinta-1-1-3', name: "Kwinta 1 1/3'", division: 'great', family: 'mutation', transpose: 30 },
];

const PRESETS: Record<string, OrganPreset> = {
  'flute-8': {
    description: "Flet kryty 8' alone — the soft stopped flute for continuo",
    great: ["Flet kryty 8'"],
  },
  continuo: {
    description: "Flet kryty 8' + 4' — continuo for a choir or an ensemble",
    great: ["Flet kryty 8'", "Flet kryty 4'"],
  },
  'flute-2': {
    description: "Flet kryty 8' with Pryncypał 2' — bright solo or continuo for a larger ensemble",
    great: ["Flet kryty 8'", "Pryncypał 2'"],
  },
  principal: {
    description: "Flet kryty 8' with the principals 4' + 2'",
    great: ["Flet kryty 8'", "Pryncypał 4'", "Pryncypał 2'"],
  },
  plenum: {
    description: 'The small plenum: 8\' 4\' 2\' 1 1/3\'',
    great: ["Flet kryty 8'", "Pryncypał 4'", "Pryncypał 2'", "Kwinta 1 1/3'"],
  },
  full: {
    description: 'Every stop drawn',
    great: ["Flet kryty 8'", "Flet kryty 4'", "Pryncypał 4'", "Pryncypał 2'", "Kwinta 1 1/3'"],
  },
};

/** Green Positiv (Stanisław Pielczyk, 2008, Katowice): a one-manual continuo positive with three
 *  ranks of pipes at Baroque pitch, from Piotr Grabowski's free sample set. */
export const GREEN_POSITIV_ORGAN: OrganDefinition = {
  id: 'green-positiv',
  name: 'Green Positiv',
  description: 'Stanisław Pielczyk 2008, Katowice (Poland): a continuo positive, one manual, 5 stops from 3 ranks, at Baroque pitch (a semitone below A440).',
  stops: STOPS,
  presets: PRESETS,
  defaultPreset: 'continuo',
  divisions: { great: { pan: 0 }, swell: { pan: 0 }, positive: { pan: 0 }, pedal: { pan: 0 } },
  reverb: 'chamber',
};
