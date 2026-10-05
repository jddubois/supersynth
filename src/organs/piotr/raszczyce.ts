import type { OrganDefinition, OrganPreset, StopDefinition } from '../types.js';

// Every pipe analysed from Piotr Grabowski's free sample set; models/organ/raszczyce/<id>.ssm.
// Hoofdwerk (manual II) is the great, Rugwerk (manual I) the positive.
const STOPS: StopDefinition[] = [
  { id: 'great-prestant-8', model: 'organ/raszczyce/great-prestant-8', name: "Prestant 8'", division: 'great', family: 'principal', transpose: 0, actionNoise: [11, 12] },
  { id: 'great-roerfluit-8', model: 'organ/raszczyce/great-roerfluit-8', name: "Roerfluit 8'", division: 'great', family: 'flute', transpose: 0, actionNoise: [13, 14] },
  { id: 'great-octaaf-4', model: 'organ/raszczyce/great-octaaf-4', name: "Octaaf 4'", division: 'great', family: 'principal', transpose: 12, actionNoise: [9, 10] },
  { id: 'great-gedekt-fluit-4', model: 'organ/raszczyce/great-gedekt-fluit-4', name: "Gedekt fluit 4'", division: 'great', family: 'flute', transpose: 12, actionNoise: [3, 4] },
  { id: 'great-nasard-2-2-3', model: 'organ/raszczyce/great-nasard-2-2-3', name: "Nasard 2 2/3'", division: 'great', family: 'mutation', transpose: 19, actionNoise: [7, 8] },
  { id: 'great-woudfluit-2', model: 'organ/raszczyce/great-woudfluit-2', name: "Woudfluit 2'", division: 'great', family: 'flute', transpose: 24, actionNoise: [19, 20] },
  { id: 'great-sesquialter-ii', model: 'organ/raszczyce/great-sesquialter-ii', name: "Sesquialter II", division: 'great', family: 'mixture', transpose: 0, actionNoise: [15, 16] },
  { id: 'great-mixtuur-iv', model: 'organ/raszczyce/great-mixtuur-iv', name: "Mixtuur IV", division: 'great', family: 'mixture', transpose: 0, actionNoise: [5, 6] },
  { id: 'great-trompet-8', model: 'organ/raszczyce/great-trompet-8', name: "Trompet 8'", division: 'great', family: 'reed', transpose: 0, actionNoise: [17, 18] },

  { id: 'positive-holpijp-8', model: 'organ/raszczyce/positive-holpijp-8', name: "Holpijp 8'", division: 'positive', family: 'flute', transpose: 0, actionNoise: [33, 34] },
  { id: 'positive-prestant-4', model: 'organ/raszczyce/positive-prestant-4', name: "Prestant 4'", division: 'positive', family: 'principal', transpose: 12, actionNoise: [39, 40] },
  { id: 'positive-roerfluit-4', model: 'organ/raszczyce/positive-roerfluit-4', name: "Roerfluit 4'", division: 'positive', family: 'flute', transpose: 12, actionNoise: [41, 42] },
  { id: 'positive-octaaf-2', model: 'organ/raszczyce/positive-octaaf-2', name: "Octaaf 2'", division: 'positive', family: 'principal', transpose: 24, actionNoise: [37, 38] },
  { id: 'positive-scherp-iv', model: 'organ/raszczyce/positive-scherp-iv', name: "Scherp IV", division: 'positive', family: 'mixture', transpose: 0, actionNoise: [43, 44] },
  { id: 'positive-cymbel-iii', model: 'organ/raszczyce/positive-cymbel-iii', name: "Cymbel III", division: 'positive', family: 'mixture', transpose: 0, actionNoise: [31, 32] },
  { id: 'positive-kromhoorn-8', model: 'organ/raszczyce/positive-kromhoorn-8', name: "Kromhoorn 8'", division: 'positive', family: 'reed', transpose: 0, actionNoise: [35, 36] },

  { id: 'pedal-subbas-16', model: 'organ/raszczyce/pedal-subbas-16', name: "Subbas 16'", division: 'pedal', family: 'flute', transpose: -12, actionNoise: [29, 30] },
  { id: 'pedal-prestant-8', model: 'organ/raszczyce/pedal-prestant-8', name: "Prestant 8'", division: 'pedal', family: 'principal', transpose: 0, actionNoise: [27, 28] },
  { id: 'pedal-gedekt-8', model: 'organ/raszczyce/pedal-gedekt-8', name: "Gedekt 8'", division: 'pedal', family: 'flute', transpose: 0, actionNoise: [23, 24] },
  { id: 'pedal-octaaf-4', model: 'organ/raszczyce/pedal-octaaf-4', name: "Octaaf 4'", division: 'pedal', family: 'principal', transpose: 12, actionNoise: [25, 26] },
  { id: 'pedal-fagot-16', model: 'organ/raszczyce/pedal-fagot-16', name: "Fagot 16'", division: 'pedal', family: 'reed', transpose: -12, actionNoise: [21, 22] },
];

const PRESETS: Record<string, OrganPreset> = {
  prestant: {
    description: "Prestant 8' alone",
    great: ["Prestant 8'"],
    pedal: ["Subbas 16'", "Prestant 8'"],
  },
  'principal-chorus': {
    description: "Principal chorus 8' 4' on the Hoofdwerk, 4' 2' on the Rugwerk",
    great: ["Prestant 8'", "Octaaf 4'"],
    pedal: ["Subbas 16'", "Prestant 8'", "Octaaf 4'"],
    couple: { pedal: ['great'] },
  },
  plenum: {
    description: 'Organo pleno: Hoofdwerk Mixtuur, Rugwerk Scherp, both coupled',
    great: ["Prestant 8'", "Roerfluit 8'", "Octaaf 4'", 'Mixtuur IV'],
    positive: ["Holpijp 8'", "Prestant 4'", "Octaaf 2'", 'Scherp IV'],
    pedal: ["Subbas 16'", "Prestant 8'", "Octaaf 4'", "Fagot 16'"],
    couple: { great: ['positive'], pedal: ['great'] },
  },
  full: {
    description: 'Full organ with Trompet, Kromhoorn, Cymbel and Fagot',
    great: ["Prestant 8'", "Roerfluit 8'", "Octaaf 4'", "Gedekt fluit 4'", "Nasard 2 2/3'", "Woudfluit 2'", 'Sesquialter II', 'Mixtuur IV', "Trompet 8'"],
    positive: ["Holpijp 8'", "Prestant 4'", "Roerfluit 4'", "Octaaf 2'", 'Scherp IV', 'Cymbel III', "Kromhoorn 8'"],
    pedal: ["Subbas 16'", "Prestant 8'", "Gedekt 8'", "Octaaf 4'", "Fagot 16'"],
    couple: { great: ['positive'], pedal: ['great'] },
  },
  flutes: {
    description: "Roerfluit 8' + Gedekt fluit 4' on the Hoofdwerk",
    great: ["Roerfluit 8'", "Gedekt fluit 4'"],
    pedal: ["Subbas 16'", "Gedekt 8'"],
  },
  'flute-8': {
    description: "Holpijp 8' — the Rugwerk's soft flute",
    positive: ["Holpijp 8'"],
    pedal: ["Subbas 16'"],
  },
  cornet: {
    description: "Sesquialter with flutes (8' 4' 2 2/3' 2' 1 3/5') against the Rugwerk",
    great: ["Roerfluit 8'", "Gedekt fluit 4'", "Woudfluit 2'", 'Sesquialter II'],
    positive: ["Holpijp 8'", "Roerfluit 4'"],
    pedal: ["Subbas 16'", "Gedekt 8'"],
  },
  nasard: {
    description: "Roerfluit 8', Gedekt fluit 4' and Nasard 2 2/3'",
    great: ["Roerfluit 8'", "Gedekt fluit 4'", "Nasard 2 2/3'"],
    positive: ["Holpijp 8'"],
    pedal: ["Subbas 16'"],
  },
  kromhoorn: {
    description: "Kromhoorn 8' solo on the Rugwerk against the Hoofdwerk flutes",
    positive: ["Holpijp 8'", "Kromhoorn 8'"],
    great: ["Roerfluit 8'"],
    pedal: ["Subbas 16'", "Gedekt 8'"],
  },
  trumpet: {
    description: "Trompet 8' with Prestant 8' — festive solo",
    great: ["Prestant 8'", "Trompet 8'"],
    positive: ["Holpijp 8'", "Roerfluit 4'"],
    pedal: ["Subbas 16'", "Prestant 8'", "Fagot 16'"],
  },
};

/** Raszczyce (Vermeulen, Alkmaar, 1965, Poland): a Dutch neo-Baroque organ, Hoofdwerk, Rugwerk and
 *  pedal, 21 stops, from Piotr Grabowski's free sample set. */
export const RASZCZYCE_ORGAN: OrganDefinition = {
  id: 'raszczyce',
  name: 'Raszczyce',
  description: 'Vermeulen (Alkmaar) 1965, Raszczyce (Poland): a Dutch neo-Baroque organ, 21 stops on Hoofdwerk, Rugwerk and pedal.',
  stops: STOPS,
  presets: PRESETS,
  defaultPreset: 'principal-chorus',
  divisions: { great: { pan: 0 }, swell: { pan: 0.15 }, positive: { pan: -0.15 }, pedal: { pan: 0 } },
  tremulant: [],
  wind: 0,
  noises: { keys: { pedal: { down: 'organ/raszczyce/noise-keys-pedal-down', up: 'organ/raszczyce/noise-keys-pedal-up' }, positive: { down: 'organ/raszczyce/noise-keys-positive-down', up: 'organ/raszczyce/noise-keys-positive-up' }, great: { down: 'organ/raszczyce/noise-keys-great-down', up: 'organ/raszczyce/noise-keys-great-up' } }, stops: 'organ/raszczyce/noise-stops', blower: { model: 'organ/raszczyce/noise-blower' }, ambient: { model: 'organ/raszczyce/noise-ambient' }, coupler: [45, 46] },
};
