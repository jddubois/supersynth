import { CHURCH_DIVISIONS } from '../defaults.js';
import type { OrganDefinition, OrganPreset, StopDefinition } from '../types.js';

// Every pipe analysed from Piotr Grabowski's free sample set; models/organ/cracow/<id>.ssm.
// Grand-Orgue (manual I) is the great, Positif (manual II) the positive, the enclosed Récit
// (manual III) the swell.
const STOPS: StopDefinition[] = [
  { id: 'great-bourdon-16', model: 'organ/cracow/great-bourdon-16', name: "Bourdon 16'", division: 'great', family: 'flute', transpose: -12 },
  { id: 'great-montre-8', model: 'organ/cracow/great-montre-8', name: "Montre 8'", division: 'great', family: 'principal', transpose: 0 },
  { id: 'great-flute-harmonique-8', model: 'organ/cracow/great-flute-harmonique-8', name: "Flûte Harmonique 8'", division: 'great', family: 'flute', transpose: 0 },
  { id: 'great-bourdon-8', model: 'organ/cracow/great-bourdon-8', name: "Bourdon 8'", division: 'great', family: 'flute', transpose: 0 },
  { id: 'great-viole-de-gambe-8', model: 'organ/cracow/great-viole-de-gambe-8', name: "Viole de Gambe 8'", division: 'great', family: 'string', transpose: 0 },
  { id: 'great-prestant-4', model: 'organ/cracow/great-prestant-4', name: "Prestant 4'", division: 'great', family: 'principal', transpose: 12 },
  { id: 'great-flute-douce-4', model: 'organ/cracow/great-flute-douce-4', name: "Flûte douce 4'", division: 'great', family: 'flute', transpose: 12 },
  { id: 'great-doublette-2', model: 'organ/cracow/great-doublette-2', name: "Doublette 2'", division: 'great', family: 'principal', transpose: 24 },
  { id: 'great-cornet-5x', model: 'organ/cracow/great-cornet-5x', name: "Cornet 5x", division: 'great', family: 'mixture', transpose: 0 },
  { id: 'great-plein-jeu-5x', model: 'organ/cracow/great-plein-jeu-5x', name: "Plein Jeu 5x", division: 'great', family: 'mixture', transpose: 0 },
  { id: 'great-trompette-8', model: 'organ/cracow/great-trompette-8', name: "Trompette 8'", division: 'great', family: 'reed', transpose: 0 },
  { id: 'great-clairon-4', model: 'organ/cracow/great-clairon-4', name: "Clairon 4'", division: 'great', family: 'reed', transpose: 12 },

  { id: 'swell-flute-traversiere-8', model: 'organ/cracow/swell-flute-traversiere-8', name: "Flûte Traversière 8'", division: 'swell', family: 'flute', transpose: 0 },
  { id: 'swell-bourdon-8', model: 'organ/cracow/swell-bourdon-8', name: "Bourdon 8'", division: 'swell', family: 'flute', transpose: 0 },
  { id: 'swell-aeoline-8', model: 'organ/cracow/swell-aeoline-8', name: "Aeoline 8'", division: 'swell', family: 'string', transpose: 0 },
  { id: 'swell-voix-celeste-8', model: 'organ/cracow/swell-voix-celeste-8', name: "Voix Céleste 8'", division: 'swell', family: 'string', transpose: 0 },
  { id: 'swell-flute-octaviante-4', model: 'organ/cracow/swell-flute-octaviante-4', name: "Flûte Octaviante 4'", division: 'swell', family: 'flute', transpose: 12 },
  { id: 'swell-fugara-4', model: 'organ/cracow/swell-fugara-4', name: "Fugara 4'", division: 'swell', family: 'string', transpose: 12 },
  { id: 'swell-doublette-2', model: 'organ/cracow/swell-doublette-2', name: "Doublette 2'", division: 'swell', family: 'principal', transpose: 24 },
  { id: 'swell-harmonia-aethera-4x', model: 'organ/cracow/swell-harmonia-aethera-4x', name: "Harmonia Aethera 4x", division: 'swell', family: 'mixture', transpose: 0 },
  { id: 'swell-basson-16', model: 'organ/cracow/swell-basson-16', name: "Basson 16'", division: 'swell', family: 'reed', transpose: -12 },
  { id: 'swell-trompette-harmonique-8', model: 'organ/cracow/swell-trompette-harmonique-8', name: "Trompette Harmonique 8'", division: 'swell', family: 'reed', transpose: 0 },
  { id: 'swell-hautbois-8', model: 'organ/cracow/swell-hautbois-8', name: "Hautbois 8'", division: 'swell', family: 'reed', transpose: 0 },
  { id: 'swell-clairon-4', model: 'organ/cracow/swell-clairon-4', name: "Clairon 4'", division: 'swell', family: 'reed', transpose: 12 },

  { id: 'positive-cor-de-nuit-8', model: 'organ/cracow/positive-cor-de-nuit-8', name: "Cor de Nuit 8'", division: 'positive', family: 'flute', transpose: 0 },
  { id: 'positive-salicional-8', model: 'organ/cracow/positive-salicional-8', name: "Salicional 8'", division: 'positive', family: 'string', transpose: 0 },
  { id: 'positive-unda-maris-8', model: 'organ/cracow/positive-unda-maris-8', name: "Unda Maris 8'", division: 'positive', family: 'string', transpose: 0 },
  { id: 'positive-clarinette-8', model: 'organ/cracow/positive-clarinette-8', name: "Clarinette 8'", division: 'positive', family: 'reed', transpose: 0 },
  { id: 'positive-prestant-4', model: 'organ/cracow/positive-prestant-4', name: "Prestant 4'", division: 'positive', family: 'principal', transpose: 12 },
  { id: 'positive-dolce-4', model: 'organ/cracow/positive-dolce-4', name: "Dolce 4'", division: 'positive', family: 'string', transpose: 12 },
  { id: 'positive-nazard-2-2-3', model: 'organ/cracow/positive-nazard-2-2-3', name: "Nazard 2 2/3'", division: 'positive', family: 'mutation', transpose: 19 },
  { id: 'positive-octavin-2', model: 'organ/cracow/positive-octavin-2', name: "Octavin 2'", division: 'positive', family: 'flute', transpose: 24 },
  { id: 'positive-tierce-1-3-5', model: 'organ/cracow/positive-tierce-1-3-5', name: "Tierce 1 3/5'", division: 'positive', family: 'mutation', transpose: 28 },
  { id: 'positive-cromorne-8', model: 'organ/cracow/positive-cromorne-8', name: "Cromorne 8'", division: 'positive', family: 'reed', transpose: 0 },

{ id: 'pedal-contrebasse-16', model: 'organ/cracow/pedal-contrebasse-16', name: "Contrebasse 16'", division: 'pedal', family: 'string', transpose: -12 },
  { id: 'pedal-soubasse-16', model: 'organ/cracow/pedal-soubasse-16', name: "Soubasse 16'", division: 'pedal', family: 'flute', transpose: -12 },
  { id: 'pedal-octave-8', model: 'organ/cracow/pedal-octave-8', name: "Octave 8'", division: 'pedal', family: 'principal', transpose: 0 },
  { id: 'pedal-violoncelle-8', model: 'organ/cracow/pedal-violoncelle-8', name: "Violoncelle 8'", division: 'pedal', family: 'string', transpose: 0 },
  { id: 'pedal-flute-4', model: 'organ/cracow/pedal-flute-4', name: "Flûte 4'", division: 'pedal', family: 'flute', transpose: 12 },
  { id: 'pedal-bombarde-16', model: 'organ/cracow/pedal-bombarde-16', name: "Bombarde 16'", division: 'pedal', family: 'reed', transpose: -12 },
];

const PRESETS: Record<string, OrganPreset> = {
  principal: {
    description: "Montre 8' alone",
    great: ["Montre 8'"],
    pedal: ["Soubasse 16'", "Octave 8'"],
  },
  fonds: {
    description: "Fonds de 8': the 8' foundations of all three manuals coupled",
    great: ["Montre 8'", "Flûte Harmonique 8'", "Bourdon 8'", "Viole de Gambe 8'"],
    positive: ["Cor de Nuit 8'", "Salicional 8'"],
    swell: ["Flûte Traversière 8'", "Bourdon 8'", "Aeoline 8'"],
    pedal: ["Contrebasse 16'", "Soubasse 16'", "Octave 8'", "Violoncelle 8'"],
    couple: { great: ['swell', 'positive'], pedal: ['great'] },
  },

  'plein-jeu': {
    description: 'Plein jeu: principals and Plein Jeu with the positive and récit coupled',
    great: ["Bourdon 16'", "Montre 8'", "Bourdon 8'", "Prestant 4'", "Doublette 2'", 'Plein Jeu 5x'],
    positive: ["Cor de Nuit 8'", "Prestant 4'", "Octavin 2'"],
    swell: ["Bourdon 8'", "Fugara 4'", "Doublette 2'", 'Harmonia Aethera 4x'],
    pedal: ["Contrebasse 16'", "Soubasse 16'", "Octave 8'", "Flûte 4'"],
    couple: { great: ['swell', 'positive'], pedal: ['great'] },
  },
  'grand-choeur': {
    description: 'Grand chœur: full organ with the French reeds, Cornet and Bombarde',
    great: ["Bourdon 16'", "Montre 8'", "Flûte Harmonique 8'", "Bourdon 8'", "Prestant 4'", "Flûte douce 4'", "Doublette 2'",
      'Cornet 5x', 'Plein Jeu 5x', "Trompette 8'", "Clairon 4'"],
    positive: ["Cor de Nuit 8'", "Prestant 4'", "Nazard 2 2/3'", "Octavin 2'", "Tierce 1 3/5'", "Cromorne 8'"],
    swell: ["Flûte Traversière 8'", "Bourdon 8'", "Flûte Octaviante 4'", "Doublette 2'", 'Harmonia Aethera 4x',
      "Basson 16'", "Trompette Harmonique 8'", "Hautbois 8'", "Clairon 4'"],
    pedal: ["Contrebasse 16'", "Soubasse 16'", "Octave 8'", "Violoncelle 8'", "Flûte 4'", "Bombarde 16'"],
    couple: { great: ['swell', 'positive'], positive: ['swell'], pedal: ['great', 'swell'] },
  },
  'flute-harmonique': {
    description: "Flûte Harmonique 8' solo on the great against the positive's Cor de Nuit",
    great: ["Flûte Harmonique 8'"],
    positive: ["Cor de Nuit 8'"],
    pedal: ["Soubasse 16'"],
  },
  flutes: {
    description: "Flûte Traversière 8' + Flûte Octaviante 4' on the récit",
    swell: ["Flûte Traversière 8'", "Flûte Octaviante 4'"],
    pedal: ["Soubasse 16'", "Flûte 4'"],
  },
  cornet: {
    description: 'Cornet 5x solo on the great against the récit foundations',
    great: ["Bourdon 8'", 'Cornet 5x'],
    swell: ["Bourdon 8'", "Aeoline 8'"],
    pedal: ["Soubasse 16'"],
  },
  'jeu-de-tierce': {
    description: "Jeu de tierce on the positive: Cor de Nuit 8', Dolce 4', Nazard, Octavin and Tierce",
    positive: ["Cor de Nuit 8'", "Dolce 4'", "Nazard 2 2/3'", "Octavin 2'", "Tierce 1 3/5'"],
    great: ["Bourdon 8'"],
    pedal: ["Soubasse 16'"],
  },
  celeste: {
    description: "Aeoline + Voix Céleste — the récit's undulating strings",
    swell: ["Aeoline 8'", "Voix Céleste 8'"],
    pedal: ["Soubasse 16'"],
  },

  hautbois: {
    description: "Hautbois 8' solo on the récit against the great's Bourdon",
    swell: ["Bourdon 8'", "Hautbois 8'"],
    great: ["Bourdon 8'"],
    pedal: ["Soubasse 16'", "Violoncelle 8'"],
  },
  clarinette: {
    description: "Clarinette 8' solo on the positive against the récit strings",
    positive: ["Cor de Nuit 8'", "Clarinette 8'"],
    swell: ["Bourdon 8'", "Aeoline 8'"],
    pedal: ["Soubasse 16'"],
  },
  trompette: {
    description: "Trompette Harmonique 8' solo on the récit with the great's foundations",
    swell: ["Flûte Traversière 8'", "Trompette Harmonique 8'"],
    great: ["Montre 8'", "Bourdon 8'"],
    pedal: ["Soubasse 16'", "Octave 8'", "Bombarde 16'"],
  },
};

/** Cracow, St. John Cantius (Jacek Siedlar, 2004, Poland): a French-symphonic organ, 40 stops on
 *  Grand-Orgue, Positif, an enclosed Récit and pedal, from Piotr Grabowski's free sample set. */
export const CRACOW_ORGAN: OrganDefinition = {
  id: 'cracow',
  name: 'Cracow, St. John Cantius',
  description: 'Jacek Siedlar 2004, St. John Cantius, Cracow (Poland): a French-symphonic organ, 40 stops on three manuals (the Récit enclosed) and pedal.',
  stops: STOPS,
  presets: PRESETS,
  defaultPreset: 'fonds',
  divisions: CHURCH_DIVISIONS,
  tremulant: { division: 'swell', depth: 0.83, pitch: 6.0, rate: 5.0 },
};
