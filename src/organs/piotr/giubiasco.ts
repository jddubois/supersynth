import type { OrganDefinition, OrganPreset, StopDefinition } from '../types.js';

// Every pipe analysed from Piotr Grabowski's free sample set; models/organ/giubiasco/<id>.ssm.
// Grande organo (manual II) is the great, Positivo tergale (manual I) the positive.
const STOPS: StopDefinition[] = [
  { id: 'great-principale-8', model: 'organ/giubiasco/great-principale-8', name: "Principale 8'", division: 'great', family: 'principal', transpose: 0, actionNoise: [11, 12] },
  { id: 'great-viola-da-gamba-8', model: 'organ/giubiasco/great-viola-da-gamba-8', name: "Viola da Gamba 8'", division: 'great', family: 'string', transpose: 0, actionNoise: [17, 18] },
  { id: 'great-flauto-a-camino-8', model: 'organ/giubiasco/great-flauto-a-camino-8', name: "Flauto a camino 8'", division: 'great', family: 'flute', transpose: 0, actionNoise: [5, 6] },
  { id: 'great-voce-umana-8', model: 'organ/giubiasco/great-voce-umana-8', name: "Voce umana 8'", division: 'great', family: 'string', transpose: 0, keys: [55, 93], actionNoise: [21, 22] },
  { id: 'great-ottava-4', model: 'organ/giubiasco/great-ottava-4', name: "Ottava 4'", division: 'great', family: 'principal', transpose: 12, actionNoise: [9, 10] },
  { id: 'great-flauto-conico-4', model: 'organ/giubiasco/great-flauto-conico-4', name: "Flauto conico 4'", division: 'great', family: 'flute', transpose: 12, actionNoise: [7, 8] },
  { id: 'great-quintadecima-2', model: 'organ/giubiasco/great-quintadecima-2', name: "Quintadecima 2'", division: 'great', family: 'principal', transpose: 24, actionNoise: [13, 14] },
  { id: 'great-cornetto-2-2-3', model: 'organ/giubiasco/great-cornetto-2-2-3', name: "Cornetto 2 2/3'", division: 'great', family: 'mixture', transpose: 0, actionNoise: [3, 4] },
  { id: 'great-ripieno-4-file', model: 'organ/giubiasco/great-ripieno-4-file', name: "Ripieno 4 file", division: 'great', family: 'mixture', transpose: 0, actionNoise: [15, 16] },
  { id: 'great-violoncello-8', model: 'organ/giubiasco/great-violoncello-8', name: "Violoncello 8'", division: 'great', family: 'string', transpose: 0, actionNoise: [19, 20] },

  { id: 'positive-bordone-8', model: 'organ/giubiasco/positive-bordone-8', name: "Bordone 8'", division: 'positive', family: 'flute', transpose: 0, actionNoise: [31, 32] },
  { id: 'positive-flauto-4', model: 'organ/giubiasco/positive-flauto-4', name: "Flauto 4'", division: 'positive', family: 'flute', transpose: 12, actionNoise: [35, 36] },
  { id: 'positive-quinta-2-2-3', model: 'organ/giubiasco/positive-quinta-2-2-3', name: "Quinta 2 2/3'", division: 'positive', family: 'mutation', transpose: 19, actionNoise: [41, 42] },
  { id: 'positive-principale-2', model: 'organ/giubiasco/positive-principale-2', name: "Principale 2'", division: 'positive', family: 'principal', transpose: 24, actionNoise: [39, 40] },
  { id: 'positive-terza-1-3-5', model: 'organ/giubiasco/positive-terza-1-3-5', name: "Terza 1 3/5'", division: 'positive', family: 'mutation', transpose: 28, actionNoise: [45, 46] },
  { id: 'positive-larigot-1-1-3', model: 'organ/giubiasco/positive-larigot-1-1-3', name: "Larigot 1 1/3'", division: 'positive', family: 'mutation', transpose: 31, actionNoise: [37, 38] },
  { id: 'positive-cimbalo-2-file', model: 'organ/giubiasco/positive-cimbalo-2-file', name: "Cimbalo 2 file", division: 'positive', family: 'mixture', transpose: 0, actionNoise: [33, 34] },
  { id: 'positive-regale-8', model: 'organ/giubiasco/positive-regale-8', name: "Regale 8'", division: 'positive', family: 'reed', transpose: 0, actionNoise: [43, 44] },

  { id: 'pedal-subbasso-16', model: 'organ/giubiasco/pedal-subbasso-16', name: "Subbasso 16'", division: 'pedal', family: 'flute', transpose: -12, actionNoise: [29, 30] },
  { id: 'pedal-flauto-8', model: 'organ/giubiasco/pedal-flauto-8', name: "Flauto 8'", division: 'pedal', family: 'flute', transpose: 0, actionNoise: [25, 26] },
  { id: 'pedal-ottava-4', model: 'organ/giubiasco/pedal-ottava-4', name: "Ottava 4'", division: 'pedal', family: 'principal', transpose: 12, actionNoise: [27, 28] },
  { id: 'pedal-contro-fagotto-16', model: 'organ/giubiasco/pedal-contro-fagotto-16', name: "Contro Fagotto 16'", division: 'pedal', family: 'reed', transpose: -12, actionNoise: [23, 24] },
];

const PRESETS: Record<string, OrganPreset> = {
  principale: {
    description: "Principale 8' alone",
    great: ["Principale 8'"],
    pedal: ["Subbasso 16'", "Flauto 8'"],
  },
  ripieno: {
    description: "Ripieno: Principale 8', Ottava 4', Quintadecima 2' and the Ripieno",
    great: ["Principale 8'", "Ottava 4'", "Quintadecima 2'", 'Ripieno 4 file'],
    pedal: ["Subbasso 16'", "Flauto 8'", "Ottava 4'"],
    couple: { pedal: ['great'] },
  },
  pleno: {
    description: 'Organo pleno: Ripieno on the great, Cimbalo on the positive, both coupled',
    great: ["Principale 8'", "Flauto a camino 8'", "Ottava 4'", "Quintadecima 2'", 'Ripieno 4 file'],
    positive: ["Bordone 8'", "Flauto 4'", "Principale 2'", "Larigot 1 1/3'", 'Cimbalo 2 file'],
    pedal: ["Subbasso 16'", "Flauto 8'", "Ottava 4'", "Contro Fagotto 16'"],
    couple: { great: ['positive'], pedal: ['great'] },
  },
  full: {
    description: 'Full organ with Cornetto, Regale and Contro Fagotto',
    great: ["Principale 8'", "Flauto a camino 8'", "Ottava 4'", "Flauto conico 4'", "Quintadecima 2'", "Cornetto 2 2/3'", 'Ripieno 4 file'],
    positive: ["Bordone 8'", "Flauto 4'", "Quinta 2 2/3'", "Principale 2'", "Terza 1 3/5'", "Larigot 1 1/3'", 'Cimbalo 2 file', "Regale 8'"],
    pedal: ["Subbasso 16'", "Flauto 8'", "Ottava 4'", "Contro Fagotto 16'"],
    couple: { great: ['positive'], pedal: ['great', 'positive'] },
  },
  'voce-umana': {
    description: "Voce umana with the Principale 8' — the Italian beating principal",
    great: ["Principale 8'", "Voce umana 8'"],
    pedal: ["Subbasso 16'"],
  },
  strings: {
    description: "Viola da Gamba 8' and Violoncello 8' with the Flauto a camino",
    great: ["Viola da Gamba 8'", "Violoncello 8'", "Flauto a camino 8'"],
    pedal: ["Subbasso 16'", "Flauto 8'"],
  },
  flutes: {
    description: "Flauto a camino 8' + Flauto conico 4' on the great",
    great: ["Flauto a camino 8'", "Flauto conico 4'"],
    pedal: ["Subbasso 16'", "Flauto 8'"],
  },
  'flute-8': {
    description: "Bordone 8' — soft stopped flute",
    positive: ["Bordone 8'"],
    pedal: ["Subbasso 16'"],
  },
  cornetto: {
    description: "Cornetto solo on the great (Flauto a camino 8', Flauto conico 4') against the positive's Bordone",
    great: ["Flauto a camino 8'", "Flauto conico 4'", "Cornetto 2 2/3'"],
    positive: ["Bordone 8'"],
    pedal: ["Subbasso 16'"],
  },
  terza: {
    description: "Positive flutes with Quinta and Terza (8' 4' 2 2/3' 2' 1 3/5')",
    positive: ["Bordone 8'", "Flauto 4'", "Quinta 2 2/3'", "Principale 2'", "Terza 1 3/5'"],
    great: ["Flauto a camino 8'"],
    pedal: ["Subbasso 16'"],
  },
  regale: {
    description: "Regale 8' solo on the positive against the great's flutes",
    positive: ["Bordone 8'", "Regale 8'"],
    great: ["Flauto a camino 8'"],
    pedal: ["Subbasso 16'", "Flauto 8'"],
  },
};

/** Giubiasco (Mascioni, 2008, Switzerland): an organ in the Italian style, 22 stops on Grande
 *  organo, Positivo tergale and pedal, from Piotr Grabowski's free sample set. */
export const GIUBIASCO_ORGAN: OrganDefinition = {
  id: 'giubiasco',
  name: 'Giubiasco',
  description: 'Mascioni 2008, Giubiasco (Switzerland): 22 stops in the Italian style on Grande organo, Positivo tergale and pedal with Ripieno, Voce umana and Cornetto.',
  stops: STOPS,
  presets: PRESETS,
  defaultPreset: 'ripieno',
  divisions: { great: { pan: 0 }, swell: { pan: 0.15 }, positive: { pan: -0.15 }, pedal: { pan: 0 } },
  tremulant: { division: 'positive', name: 'Tremulant 1 Man', depth: 1.91, pitch: 3.5, rate: 5.07, actionNoise: [47, 48] },
  wind: 0,
  noises: { keys: { pedal: { down: 'organ/giubiasco/noise-keys-pedal-down', up: 'organ/giubiasco/noise-keys-pedal-up' }, positive: { down: 'organ/giubiasco/noise-keys-positive-down', up: 'organ/giubiasco/noise-keys-positive-up' }, great: { down: 'organ/giubiasco/noise-keys-great-down', up: 'organ/giubiasco/noise-keys-great-up' } }, stops: 'organ/giubiasco/noise-stops', blower: { model: 'organ/giubiasco/noise-blower' }, ambient: { model: 'organ/giubiasco/noise-ambient' }, coupler: [49, 50] },
};
