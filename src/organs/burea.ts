import { CHURCH_DIVISIONS, SWELL_TREMULANT } from './defaults.js';
import type { OrganDefinition, OrganPreset, StopDefinition } from './types.js';

// Every pipe of every stop analysed from Lars Palo's GrandOrgue sample set (CC BY-SA 2.5 SE);
// models/organ/<id>.ssm. The Bureå organ has 33 stops; the 7 "extra" stops come from the
// sample set's extended version and are placed where they fit.
const STOPS: StopDefinition[] = [
  { id: 'great-principal-8', name: "Principal 8'", division: 'great', family: 'principal', transpose: 0 },
  { id: 'great-gedackt-8', name: "Gedackt 8'", division: 'great', family: 'flute', transpose: 0 },
  { id: 'extra-hohlflute-8', name: "Hohlflöte 8'", division: 'great', family: 'flute', transpose: 0 },
  { id: 'great-octave-4', name: "Octave 4'", division: 'great', family: 'principal', transpose: 12 },
  { id: 'great-rohrflute-4', name: "Rohrflöte 4'", division: 'great', family: 'flute', transpose: 12 },
  { id: 'great-octave-2', name: "Octave 2'", division: 'great', family: 'principal', transpose: 24 },
  { id: 'great-sesquialtera', name: 'Sesquialtera II', division: 'great', family: 'mixture', transpose: 0 },
  { id: 'great-mixture', name: 'Mixture V', division: 'great', family: 'mixture', transpose: 0 },
  { id: 'great-trumpet-8', name: "Trumpet 8'", division: 'great', family: 'reed', transpose: 0 },

  { id: 'swell-rohrflute-8', name: "Rohrflöte 8'", division: 'swell', family: 'flute', transpose: 0 },
  { id: 'swell-salicional-8', name: "Salicional 8'", division: 'swell', family: 'string', transpose: 0 },
  { id: 'extra-voix-celeste-8', name: "Voix céleste 8'", division: 'swell', family: 'string', transpose: 0 },
  { id: 'swell-principal-4', name: "Principal 4'", division: 'swell', family: 'principal', transpose: 12 },
  { id: 'swell-hohlflute-4', name: "Hohlflöte 4'", division: 'swell', family: 'flute', transpose: 12 },
  { id: 'extra-gemshorn-4', name: "Gemshorn 4'", division: 'swell', family: 'principal', transpose: 12 },
  { id: 'swell-waldflute-2', name: "Waldflöte 2'", division: 'swell', family: 'flute', transpose: 24 },
  { id: 'swell-tierce-1-3-5', name: "Terz 1 3/5'", division: 'swell', family: 'mutation', transpose: 28 },
  { id: 'swell-nasard-1-1-3', name: "Nasat 1 1/3'", division: 'swell', family: 'mutation', transpose: 31 },
  { id: 'swell-septime-1-1-7', name: "Septime 1 1/7'", division: 'swell', family: 'mutation', transpose: 34 },
  { id: 'swell-scharf', name: 'Scharf III', division: 'swell', family: 'mixture', transpose: 0 },
  { id: 'swell-schalmei-8', name: "Schalmei 8'", division: 'swell', family: 'reed', transpose: 0 },

  { id: 'positive-gedackt-8', name: "Gedackt 8'", division: 'positive', family: 'flute', transpose: 0 },
  { id: 'extra-quintadena-8', name: "Quintadena 8'", division: 'positive', family: 'flute', transpose: 0 },
  { id: 'positive-koppelflute-4', name: "Koppelflöte 4'", division: 'positive', family: 'flute', transpose: 12 },
  { id: 'positive-quint-2-2-3', name: "Rohrquinte 2 2/3'", division: 'positive', family: 'mutation', transpose: 19 },
  { id: 'positive-principal-2', name: "Principal 2'", division: 'positive', family: 'principal', transpose: 24 },
  { id: 'extra-flautino-2', name: "Flötlein 2'", division: 'positive', family: 'flute', transpose: 24 },
  { id: 'positive-octave-1', name: "Octave 1'", division: 'positive', family: 'principal', transpose: 36 },
  { id: 'extra-sifflote-1', name: "Sifflöte 1'", division: 'positive', family: 'flute', transpose: 36 },
  { id: 'positive-cymbel', name: 'Cymbel II', division: 'positive', family: 'mixture', transpose: 0 },
  { id: 'positive-krummhorn-8', name: "Krummhorn 8'", division: 'positive', family: 'reed', transpose: 0 },

  { id: 'pedal-subbass-16', name: "Subbass 16'", division: 'pedal', family: 'flute', transpose: -12 },
  { id: 'extra-violone-16', name: "Violon 16'", division: 'pedal', family: 'string', transpose: -12 },
  { id: 'pedal-principal-8', name: "Principal 8'", division: 'pedal', family: 'principal', transpose: 0 },
  { id: 'pedal-gedackt-8', name: "Gedackt 8'", division: 'pedal', family: 'flute', transpose: 0 },
  { id: 'pedal-octave-4', name: "Octave 4'", division: 'pedal', family: 'principal', transpose: 12 },
  { id: 'pedal-nachthorn-2', name: "Nachthorn 2'", division: 'pedal', family: 'flute', transpose: 24 },
  { id: 'pedal-rauschpfeife', name: 'Rauschpfeife IV', division: 'pedal', family: 'mixture', transpose: 0 },
  { id: 'pedal-bassoon-16', name: "Fagott 16'", division: 'pedal', family: 'reed', transpose: -12 },
  { id: 'pedal-trumpet-4', name: "Trumpet 4'", division: 'pedal', family: 'reed', transpose: 12 },
];

const PRESETS: Record<string, OrganPreset> = {
  principal: {
    description: "Principal 8' alone — the foundation tone of the organ",
    great: ["Principal 8'"],
    pedal: ["Subbass 16'", "Principal 8'"],
  },
  'principal-chorus': {
    description: "Principal chorus 8' 4' 2' (Baroque plenum without mixture)",
    great: ["Principal 8'", "Octave 4'", "Octave 2'"],
    pedal: ["Subbass 16'", "Principal 8'", "Octave 4'"],
    couple: { pedal: ['great'] },
  },
  plenum: {
    description: 'Organo pleno for Bach preludes and fugues: principals and mixtures',
    great: ["Principal 8'", "Octave 4'", "Octave 2'", 'Mixture V'],
    positive: ["Gedackt 8'", "Koppelflöte 4'", "Principal 2'", 'Cymbel II'],
    pedal: ["Subbass 16'", "Principal 8'", "Octave 4'", 'Rauschpfeife IV', "Fagott 16'"],
    couple: { pedal: ['great'] },
  },
  full: {
    description: 'Full organ with reeds and all manuals coupled',
    great: ["Principal 8'", "Gedackt 8'", "Octave 4'", "Octave 2'", 'Mixture V', 'Sesquialtera II', "Trumpet 8'"],
    swell: ["Rohrflöte 8'", "Principal 4'", "Waldflöte 2'", 'Scharf III', "Schalmei 8'"],
    positive: ["Gedackt 8'", "Koppelflöte 4'", "Principal 2'", 'Cymbel II', "Krummhorn 8'"],
    pedal: ["Subbass 16'", "Violon 16'", "Principal 8'", "Octave 4'", 'Rauschpfeife IV', "Fagott 16'", "Trumpet 4'"],
    couple: { great: ['swell', 'positive'], pedal: ['great'] },
  },
  flutes: {
    description: "Flutes 8' + 4' — gentle, for chorale preludes",
    great: ["Gedackt 8'", "Rohrflöte 4'"],
    pedal: ["Subbass 16'", "Gedackt 8'"],
  },
  'flute-8': {
    description: "Gedackt 8' — soft stopped flute",
    positive: ["Gedackt 8'"],
    pedal: ["Subbass 16'"],
  },
  cornet: {
    description: 'Cornet (8\' 4\' 2 2/3\' 2\' 1 3/5\') — solo voice for ornamented melodies',
    great: ["Gedackt 8'", "Rohrflöte 4'", 'Sesquialtera II'],
    swell: ["Rohrflöte 8'", "Hohlflöte 4'", "Waldflöte 2'", "Terz 1 3/5'"],
    pedal: ["Subbass 16'", "Gedackt 8'"],
  },
  trumpet: {
    description: "Trumpet 8' with Principal — festive solo",
    great: ["Principal 8'", "Trumpet 8'"],
    pedal: ["Subbass 16'", "Principal 8'", "Fagott 16'"],
  },
  krummhorn: {
    description: "Krummhorn 8' — nasal Renaissance reed solo",
    positive: ["Gedackt 8'", "Krummhorn 8'"],
    pedal: ["Subbass 16'", "Gedackt 8'"],
  },
  celeste: {
    description: "Salicional + Voix céleste — shimmering strings for romantic music",
    swell: ["Salicional 8'", "Voix céleste 8'"],
    pedal: ["Subbass 16'"],
  },
  'quiet-strings': {
    description: "Salicional 8' alone",
    swell: ["Salicional 8'"],
    pedal: ["Subbass 16'"],
  },
  'sesquialtera-solo': {
    description: 'Sesquialtera solo with flutes — the classic Dutch/Scandinavian chorale cantus',
    great: ["Gedackt 8'", "Rohrflöte 4'", 'Sesquialtera II'],
    pedal: ["Subbass 16'", "Gedackt 8'"],
  },
};

/** The Bureå Church organ (Nils Hammarberg, 1967, Sweden): 40 stops on great, swell, positive
 *  and pedal, every pipe analysed from Lars Palo's recordings (CC BY-SA 2.5 SE). */
export const BUREA_ORGAN: OrganDefinition = {
  id: 'burea',
  name: 'Bureå Church organ',
  description: 'Nils Hammarberg 1967, Bureå Church (Sweden): 40 stops on three manuals and pedal, every pipe recorded in the church.',
  stops: STOPS,
  presets: PRESETS,
  defaultPreset: 'principal-chorus',
  divisions: CHURCH_DIVISIONS,
  tremulant: SWELL_TREMULANT,
};
