import type { OrganDefinition, OrganPreset, StopDefinition } from '../types.js';

// Every pipe analysed from Piotr Grabowski's free sample set; models/organ/azzio/<id>.ssm.
// The organ stands about 80 cents below A440 (a ≈ 420 Hz): every key sounds its own pipe at
// that pitch.
const STOPS: StopDefinition[] = [
  { id: 'great-principale-8', model: 'organ/azzio/great-principale-8', name: "Principale 8'", division: 'great', family: 'principal', transpose: -1, keys: [36, 85], actionNoise: [7, 8] },
  { id: 'great-flauto-camino-8', model: 'organ/azzio/great-flauto-camino-8', name: "Flauto camino 8'", division: 'great', family: 'flute', transpose: -1, keys: [36, 85], actionNoise: [3, 4] },
  { id: 'great-ottava-4', model: 'organ/azzio/great-ottava-4', name: "Ottava 4'", division: 'great', family: 'principal', transpose: 11, keys: [36, 85], actionNoise: [5, 6] },
  { id: 'great-sesquialtera-2-2-3', model: 'organ/azzio/great-sesquialtera-2-2-3', name: "Sesquialtera 2 2/3'", division: 'great', family: 'mixture', transpose: -1, keys: [36, 85], actionNoise: [11, 12] },
  { id: 'great-sesquialtera-ii', model: 'organ/azzio/great-sesquialtera-ii', name: 'Sesquialtera II', division: 'great', family: 'mixture', transpose: -1, actionNoise: [13, 14] },
  { id: 'great-ripieno-3-4-file', model: 'organ/azzio/great-ripieno-3-4-file', name: 'Ripieno 3-4 file', division: 'great', family: 'mixture', transpose: -1, keys: [36, 85], actionNoise: [9, 10] },

  { id: 'positive-bordone-8', model: 'organ/azzio/positive-bordone-8', name: "Bordone 8'", division: 'positive', family: 'flute', transpose: -1, actionNoise: [19, 20] },
  { id: 'positive-flauto-conico-4', model: 'organ/azzio/positive-flauto-conico-4', name: "Flauto conico 4'", division: 'positive', family: 'flute', transpose: 11, actionNoise: [21, 22] },
  { id: 'positive-nazardo-3', model: 'organ/azzio/positive-nazardo-3', name: "Nazardo 3'", division: 'positive', family: 'mutation', transpose: 18, actionNoise: [23, 24] },
  { id: 'positive-quintadecima-2', model: 'organ/azzio/positive-quintadecima-2', name: "Quintadecima 2'", division: 'positive', family: 'principal', transpose: 23, actionNoise: [25, 26] },

  { id: 'pedal-subbasso-16', model: 'organ/azzio/pedal-subbasso-16', name: "Subbasso 16'", division: 'pedal', family: 'flute', transpose: -13, actionNoise: [15, 16] },
  { id: 'pedal-trombone-16', model: 'organ/azzio/pedal-trombone-16', name: "Trombone 16'", division: 'pedal', family: 'reed', transpose: -13, actionNoise: [17, 18] },
];

const PRESETS: Record<string, OrganPreset> = {
  principale: {
    description: "Principale 8' alone",
    great: ["Principale 8'"],
    pedal: ["Subbasso 16'"],
  },
  ripieno: {
    description: "Ripieno: Principale 8', Ottava 4' and the Ripieno",
    great: ["Principale 8'", "Ottava 4'", 'Ripieno 3-4 file'],
    pedal: ["Subbasso 16'"],
    couple: { pedal: ['great'] },
  },
  full: {
    description: 'Full organ with both manuals coupled and the Trombone',
    great: ["Principale 8'", "Flauto camino 8'", "Ottava 4'", 'Sesquialtera II', 'Ripieno 3-4 file'],
    positive: ["Bordone 8'", "Flauto conico 4'", "Quintadecima 2'"],
    pedal: ["Subbasso 16'", "Trombone 16'"],
    couple: { great: ['positive'], pedal: ['great'] },
  },
  flutes: {
    description: "Flauto camino 8' on the great, Bordone 8' + Flauto conico 4' on the positive",
    great: ["Flauto camino 8'"],
    positive: ["Bordone 8'", "Flauto conico 4'"],
    pedal: ["Subbasso 16'"],
  },
  'flute-8': {
    description: "Bordone 8' — soft stopped flute",
    positive: ["Bordone 8'"],
    pedal: ["Subbasso 16'"],
  },
  cornetto: {
    description: "Cornet from the positive's flutes and mutations (8' 4' 2 2/3' 2')",
    positive: ["Bordone 8'", "Flauto conico 4'", "Nazardo 3'", "Quintadecima 2'"],
    great: ["Flauto camino 8'"],
    pedal: ["Subbasso 16'"],
  },
  sesquialtera: {
    description: 'Sesquialtera solo on the great against the Bordone on the positive',
    great: ["Principale 8'", 'Sesquialtera II'],
    positive: ["Bordone 8'"],
    pedal: ["Subbasso 16'"],
  },
};

/** Azzio (Mascioni, 2016, Italy): two manuals and pedal, 11 stops (the Sesquialtera with its
 *  first rank alone or both), from Piotr Grabowski's free sample set. */
export const AZZIO_ORGAN: OrganDefinition = {
  id: 'azzio',
  name: 'Azzio',
  description: 'Mascioni 2016, Azzio (Italy): 11 stops on two manuals and pedal in the Italian style, at a ≈ 420 Hz.',
  stops: STOPS,
  presets: PRESETS,
  defaultPreset: 'ripieno',
  divisions: { great: { pan: 0 }, swell: { pan: 0.15 }, positive: { pan: -0.15 }, pedal: { pan: 0 } },
  tremulant: { division: ['great', 'positive'], name: 'Tremulant 1 Man', depth: 0.77, pitch: 3.4, rate: 3.94, actionNoise: [27, 28] },
  wind: 0,
  noises: { keys: { great: { up: 'organ/azzio/noise-keys-great-up', down: 'organ/azzio/noise-keys-great-down' }, pedal: { down: 'organ/azzio/noise-keys-pedal-down', up: 'organ/azzio/noise-keys-pedal-up' }, positive: { up: 'organ/azzio/noise-keys-positive-up', down: 'organ/azzio/noise-keys-positive-down' } }, stops: 'organ/azzio/noise-stops', blower: { model: 'organ/azzio/noise-blower' }, ambient: { model: 'organ/azzio/noise-ambient' }, coupler: [31, 32] },
};
