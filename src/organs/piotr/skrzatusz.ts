import type { OrganDefinition, OrganPreset, StopDefinition } from '../types.js';

// Every pipe analysed from Piotr Grabowski's free sample set; models/organ/skrzatusz/<id>.ssm.
// Manual I is the great, manual II (not enclosed) the positive. The Cornett sounds from c' up.
const STOPS: StopDefinition[] = [
  { id: 'great-bordun-16', model: 'organ/skrzatusz/great-bordun-16', name: "Bordun 16'", division: 'great', family: 'flute', transpose: -12 },
  { id: 'great-principal-8', model: 'organ/skrzatusz/great-principal-8', name: "Principal 8'", division: 'great', family: 'principal', transpose: 0 },
  { id: 'great-fugara-8', model: 'organ/skrzatusz/great-fugara-8', name: "Fugara 8'", division: 'great', family: 'string', transpose: 0 },
  { id: 'great-flute-harmonique-8', model: 'organ/skrzatusz/great-flute-harmonique-8', name: "Flûte harmonique 8'", division: 'great', family: 'flute', transpose: 0 },
  { id: 'great-octave-4', model: 'organ/skrzatusz/great-octave-4', name: "Octave 4'", division: 'great', family: 'principal', transpose: 12 },
  { id: 'great-quinte-2-2-3', model: 'organ/skrzatusz/great-quinte-2-2-3', name: "Quinte 2 2/3'", division: 'great', family: 'mutation', transpose: 19 },
  { id: 'great-octave-2', model: 'organ/skrzatusz/great-octave-2', name: "Octave 2'", division: 'great', family: 'principal', transpose: 24 },
  { id: 'great-cornett-4f', model: 'organ/skrzatusz/great-cornett-4f', name: 'Cornett 4f', division: 'great', family: 'mixture', transpose: 0, keys: [60, 89] },
  { id: 'great-mixtur-3f', model: 'organ/skrzatusz/great-mixtur-3f', name: 'Mixtur 3f', division: 'great', family: 'mixture', transpose: 0 },

  { id: 'positive-geigenprincipal-8', model: 'organ/skrzatusz/positive-geigenprincipal-8', name: "Geigenprincipal 8'", division: 'positive', family: 'principal', transpose: 0 },
  { id: 'positive-gedact-8', model: 'organ/skrzatusz/positive-gedact-8', name: "Gedact 8'", division: 'positive', family: 'flute', transpose: 0 },
  { id: 'positive-viola-di-gamba-8', model: 'organ/skrzatusz/positive-viola-di-gamba-8', name: "Viola di Gamba 8'", division: 'positive', family: 'string', transpose: 0 },
  { id: 'positive-praestant-4', model: 'organ/skrzatusz/positive-praestant-4', name: "Praestant 4'", division: 'positive', family: 'principal', transpose: 12 },
  { id: 'positive-flauto-dolce-4', model: 'organ/skrzatusz/positive-flauto-dolce-4', name: "Flauto dolce 4'", division: 'positive', family: 'flute', transpose: 12 },

  { id: 'pedal-violon-16', model: 'organ/skrzatusz/pedal-violon-16', name: "Violon 16'", division: 'pedal', family: 'string', transpose: -12 },
  { id: 'pedal-subbass-16', model: 'organ/skrzatusz/pedal-subbass-16', name: "Subbass 16'", division: 'pedal', family: 'flute', transpose: -12 },
  { id: 'pedal-octavbass-8', model: 'organ/skrzatusz/pedal-octavbass-8', name: "Octavbass 8'", division: 'pedal', family: 'principal', transpose: 0 },
  { id: 'pedal-bassflote-8', model: 'organ/skrzatusz/pedal-bassflote-8', name: "Bassflöte 8'", division: 'pedal', family: 'flute', transpose: 0 },
  { id: 'pedal-posaune-16', model: 'organ/skrzatusz/pedal-posaune-16', name: "Posaune 16'", division: 'pedal', family: 'reed', transpose: -12 },
];

const PRESETS: Record<string, OrganPreset> = {
  principal: {
    description: "Principal 8' alone",
    great: ["Principal 8'"],
    pedal: ["Subbass 16'", "Octavbass 8'"],
  },
  'principal-chorus': {
    description: "Principal chorus 8' 4' 2'",
    great: ["Principal 8'", "Octave 4'", "Octave 2'"],
    pedal: ["Subbass 16'", "Octavbass 8'"],
    couple: { pedal: ['great'] },
  },
  plenum: {
    description: 'Plenum: principals, Quinte and Mixtur on Bordun 16\'',
    great: ["Bordun 16'", "Principal 8'", "Octave 4'", "Quinte 2 2/3'", "Octave 2'", 'Mixtur 3f'],
    pedal: ["Violon 16'", "Subbass 16'", "Octavbass 8'"],
    couple: { pedal: ['great'] },
  },
  full: {
    description: 'Full organ with Cornett and Posaune',
    great: ["Bordun 16'", "Principal 8'", "Fugara 8'", "Flûte harmonique 8'", "Octave 4'", "Quinte 2 2/3'", "Octave 2'", 'Cornett 4f', 'Mixtur 3f'],
    positive: ["Geigenprincipal 8'", "Gedact 8'", "Viola di Gamba 8'", "Praestant 4'", "Flauto dolce 4'"],
    pedal: ["Violon 16'", "Subbass 16'", "Octavbass 8'", "Bassflöte 8'", "Posaune 16'"],
    couple: { pedal: ['great', 'positive'] },
  },
  foundations: {
    description: "The 8' stops of the great — Sauer's Romantic fonds",
    great: ["Principal 8'", "Fugara 8'", "Flûte harmonique 8'"],
    pedal: ["Subbass 16'", "Octavbass 8'", "Bassflöte 8'"],
  },
  flutes: {
    description: "Gedact 8' + Flauto dolce 4' on the positive",
    positive: ["Gedact 8'", "Flauto dolce 4'"],
    pedal: ["Subbass 16'"],
  },
  'flute-8': {
    description: "Gedact 8' — soft stopped flute",
    positive: ["Gedact 8'"],
    pedal: ["Subbass 16'"],
  },
  'flute-solo': {
    description: "Flûte harmonique 8' solo on the great, accompanied by the Gedact on the positive",
    great: ["Flûte harmonique 8'"],
    positive: ["Gedact 8'"],
    pedal: ["Subbass 16'"],
  },
  strings: {
    description: "Viola di Gamba 8' with Gedact — the Romantic string sound",
    positive: ["Gedact 8'", "Viola di Gamba 8'"],
    pedal: ["Subbass 16'", "Bassflöte 8'"],
  },
  cornet: {
    description: 'Cornett solo (from middle C) on the great against the positive',
    great: ["Bordun 16'", "Flûte harmonique 8'", 'Cornett 4f'],
    positive: ["Gedact 8'", "Flauto dolce 4'"],
    pedal: ["Subbass 16'", "Bassflöte 8'"],
  },
};

/** Skrzatusz sanctuary (Wilhelm Sauer, 1876, Poland): two manuals and pedal, 19 stops, from
 *  Piotr Grabowski's free sample set. */
export const SKRZATUSZ_ORGAN: OrganDefinition = {
  id: 'skrzatusz',
  name: 'Skrzatusz sanctuary',
  description: 'Wilhelm Sauer 1876, sanctuary of Skrzatusz (Poland): 19 stops on two manuals and pedal.',
  stops: STOPS,
  presets: PRESETS,
  defaultPreset: 'principal-chorus',
  divisions: { great: { pan: 0 }, swell: { pan: 0.15 }, positive: { pan: -0.15 }, pedal: { pan: 0 } },
  tremulant: { division: 'positive', name: 'Tremulant 2 Man', depth: 0.98, pitch: 7.2, rate: 5.18 },
  wind: 0,
};
