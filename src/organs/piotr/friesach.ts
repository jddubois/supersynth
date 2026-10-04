import { CHURCH_DIVISIONS } from '../defaults.js';
import type { OrganDefinition, OrganPreset, StopDefinition } from '../types.js';

// Every pipe analysed from Piotr Grabowski's free sample set; models/organ/friesach/<id>.ssm.
// Hauptwerk (manual I) is the great, the Schwellwerk (manual II, enclosed) the swell, the
// French-style Solowerk (manual III) the positive. The Posaune 32' is the sample set's own
// extension; the Cornet à pavillon sounds from g.
const STOPS: StopDefinition[] = [
  { id: 'great-praestant-16', model: 'organ/friesach/great-praestant-16', name: "Praestant 16'", division: 'great', family: 'principal', transpose: -12 },
  { id: 'great-principal-8', model: 'organ/friesach/great-principal-8', name: "Principal 8'", division: 'great', family: 'principal', transpose: 0 },
  { id: 'great-holzflote-8', model: 'organ/friesach/great-holzflote-8', name: "Holzflöte 8'", division: 'great', family: 'flute', transpose: 0 },
  { id: 'great-rohrflote-8', model: 'organ/friesach/great-rohrflote-8', name: "Röhrflöte 8'", division: 'great', family: 'flute', transpose: 0 },
  { id: 'great-gambe-8', model: 'organ/friesach/great-gambe-8', name: "Gambe 8'", division: 'great', family: 'string', transpose: 0 },
  { id: 'great-octave-4', model: 'organ/friesach/great-octave-4', name: "Octave 4'", division: 'great', family: 'principal', transpose: 12 },
  { id: 'great-spitzflote-4', model: 'organ/friesach/great-spitzflote-4', name: "Spitzflöte 4'", division: 'great', family: 'flute', transpose: 12 },
  { id: 'great-quinte-2-2-3', model: 'organ/friesach/great-quinte-2-2-3', name: "Quinte 2 2/3'", division: 'great', family: 'mutation', transpose: 19 },
  { id: 'great-octave-2', model: 'organ/friesach/great-octave-2', name: "Octave 2'", division: 'great', family: 'principal', transpose: 24 },
  { id: 'great-mixtur-major-4-5f-2-2-3', model: 'organ/friesach/great-mixtur-major-4-5f-2-2-3', name: "Mixtur major 4-5f. 2 2/3'", division: 'great', family: 'mixture', transpose: 0 },
  { id: 'great-mixtur-minor-4f-1-1-3', model: 'organ/friesach/great-mixtur-minor-4f-1-1-3', name: "Mixtur minor 4f. 1 1/3'", division: 'great', family: 'mixture', transpose: 0 },
  { id: 'great-trompete-16', model: 'organ/friesach/great-trompete-16', name: "Trompete 16'", division: 'great', family: 'reed', transpose: -12 },
  { id: 'great-trompete-8', model: 'organ/friesach/great-trompete-8', name: "Trompete 8'", division: 'great', family: 'reed', transpose: 0 },

  { id: 'swell-bourdon-16', model: 'organ/friesach/swell-bourdon-16', name: "Bourdon 16'", division: 'swell', family: 'flute', transpose: -12 },
  { id: 'swell-principal-8', model: 'organ/friesach/swell-principal-8', name: "Principal 8'", division: 'swell', family: 'principal', transpose: 0 },
  { id: 'swell-nachthorn-gedackt-8', model: 'organ/friesach/swell-nachthorn-gedackt-8', name: "Nachthorn Gedackt 8'", division: 'swell', family: 'flute', transpose: 0 },
  { id: 'swell-corno-dolce-8', model: 'organ/friesach/swell-corno-dolce-8', name: "Corno dolce 8'", division: 'swell', family: 'flute', transpose: 0 },
  { id: 'swell-viola-8', model: 'organ/friesach/swell-viola-8', name: "Viola 8'", division: 'swell', family: 'string', transpose: 0 },
  { id: 'swell-vox-celeste-8', model: 'organ/friesach/swell-vox-celeste-8', name: "Vox celeste 8'", division: 'swell', family: 'string', transpose: 0 },
  { id: 'swell-geigenprincipal-4', model: 'organ/friesach/swell-geigenprincipal-4', name: "Geigenprincipal 4'", division: 'swell', family: 'principal', transpose: 12 },
  { id: 'swell-querflote-4', model: 'organ/friesach/swell-querflote-4', name: "Querflöte 4'", division: 'swell', family: 'flute', transpose: 12 },
  { id: 'swell-nazard-2-2-3', model: 'organ/friesach/swell-nazard-2-2-3', name: "Nazard 2 2/3'", division: 'swell', family: 'mutation', transpose: 19 },
  { id: 'swell-flageolett-2', model: 'organ/friesach/swell-flageolett-2', name: "Flageolett 2'", division: 'swell', family: 'flute', transpose: 24 },
  { id: 'swell-tierce-1-3-5', model: 'organ/friesach/swell-tierce-1-3-5', name: "Tierce 1 3/5'", division: 'swell', family: 'mutation', transpose: 28 },
  { id: 'swell-larigot-1-1-3', model: 'organ/friesach/swell-larigot-1-1-3', name: "Larigot 1 1/3'", division: 'swell', family: 'mutation', transpose: 31 },
  { id: 'swell-plein-jeu-4-5f-2', model: 'organ/friesach/swell-plein-jeu-4-5f-2', name: "Plein Jeu 4-5f. 2'", division: 'swell', family: 'mixture', transpose: 0 },
  { id: 'swell-scharff-4f-1', model: 'organ/friesach/swell-scharff-4f-1', name: "Scharff 4f. 1'", division: 'swell', family: 'mixture', transpose: 0 },
  { id: 'swell-trompete-harmonique-8', model: 'organ/friesach/swell-trompete-harmonique-8', name: "Trompete harmonique 8'", division: 'swell', family: 'reed', transpose: 0 },
  { id: 'swell-hautbois-8', model: 'organ/friesach/swell-hautbois-8', name: "Hautbois 8'", division: 'swell', family: 'reed', transpose: 0 },
  { id: 'swell-clairon-4', model: 'organ/friesach/swell-clairon-4', name: "Clairon 4'", division: 'swell', family: 'reed', transpose: 12 },

  { id: 'positive-jubalflote-8', model: 'organ/friesach/positive-jubalflote-8', name: "Jubalflöte 8'", division: 'positive', family: 'flute', transpose: 0 },
  { id: 'positive-trichterflote-4', model: 'organ/friesach/positive-trichterflote-4', name: "Trichterflöte 4'", division: 'positive', family: 'flute', transpose: 12 },
  { id: 'positive-cornet-a-pavillon-8', model: 'organ/friesach/positive-cornet-a-pavillon-8', name: "Cornet à pavillon 8'", division: 'positive', family: 'mixture', transpose: 0 },
  { id: 'positive-trompete-en-chamade-8', model: 'organ/friesach/positive-trompete-en-chamade-8', name: "Trompete en chamade 8'", division: 'positive', family: 'reed', transpose: 0 },
  { id: 'positive-englischhorn-8', model: 'organ/friesach/positive-englischhorn-8', name: "Englischhorn 8'", division: 'positive', family: 'reed', transpose: 0 },

  { id: 'pedal-untersatz-32', model: 'organ/friesach/pedal-untersatz-32', name: "Untersatz 32'", division: 'pedal', family: 'flute', transpose: -24 },
  { id: 'pedal-contrabass-16', model: 'organ/friesach/pedal-contrabass-16', name: "Contrabaß 16'", division: 'pedal', family: 'principal', transpose: -12 },
  { id: 'pedal-subbass-16', model: 'organ/friesach/pedal-subbass-16', name: "Subbaß 16'", division: 'pedal', family: 'flute', transpose: -12 },
  { id: 'pedal-octavbass-8', model: 'organ/friesach/pedal-octavbass-8', name: "Octavbaß 8'", division: 'pedal', family: 'principal', transpose: 0 },
  { id: 'pedal-gedackt-8', model: 'organ/friesach/pedal-gedackt-8', name: "Gedackt 8'", division: 'pedal', family: 'flute', transpose: 0 },
  { id: 'pedal-choralbass-4', model: 'organ/friesach/pedal-choralbass-4', name: "Choralbaß 4'", division: 'pedal', family: 'principal', transpose: 12 },
  { id: 'pedal-posaune-32', model: 'organ/friesach/pedal-posaune-32', name: "Posaune 32'", division: 'pedal', family: 'reed', transpose: -24 },
  { id: 'pedal-posaune-16', model: 'organ/friesach/pedal-posaune-16', name: "Posaune 16'", division: 'pedal', family: 'reed', transpose: -12 },
  { id: 'pedal-trompete-8', model: 'organ/friesach/pedal-trompete-8', name: "Trompete 8'", division: 'pedal', family: 'reed', transpose: 0 },
];

const PRESETS: Record<string, OrganPreset> = {
  principal: {
    description: "Principal 8' alone",
    great: ["Principal 8'"],
    pedal: ["Subbaß 16'", "Octavbaß 8'"],
  },
  'principal-chorus': {
    description: "Principal chorus 16' 8' 4' 2' on the Hauptwerk",
    great: ["Praestant 16'", "Principal 8'", "Octave 4'", "Octave 2'"],
    pedal: ["Contrabaß 16'", "Subbaß 16'", "Octavbaß 8'", "Choralbaß 4'"],
    couple: { pedal: ['great'] },
  },
  plenum: {
    description: 'Organo pleno for Bach: Hauptwerk with both Mixturen, the Schwellwerk plenum coupled',
    great: ["Praestant 16'", "Principal 8'", "Röhrflöte 8'", "Octave 4'", "Quinte 2 2/3'", "Octave 2'", "Mixtur major 4-5f. 2 2/3'", "Mixtur minor 4f. 1 1/3'"],
    swell: ["Principal 8'", "Nachthorn Gedackt 8'", "Geigenprincipal 4'", "Flageolett 2'", "Plein Jeu 4-5f. 2'", "Scharff 4f. 1'"],
    pedal: ["Contrabaß 16'", "Subbaß 16'", "Octavbaß 8'", "Choralbaß 4'", "Posaune 16'"],
    couple: { great: ['swell'], pedal: ['great'] },
  },
  'grand-choeur': {
    description: 'Grand chœur: reeds and mixtures of all manuals coupled (French Romantic tutti)',
    great: ["Praestant 16'", "Principal 8'", "Holzflöte 8'", "Octave 4'", "Octave 2'", "Mixtur major 4-5f. 2 2/3'", "Trompete 16'", "Trompete 8'"],
    swell: ["Bourdon 16'", "Principal 8'", "Nachthorn Gedackt 8'", "Geigenprincipal 4'", "Plein Jeu 4-5f. 2'", "Trompete harmonique 8'", "Hautbois 8'", "Clairon 4'"],
    positive: ["Jubalflöte 8'", "Trichterflöte 4'", "Trompete en chamade 8'"],
    pedal: ["Untersatz 32'", "Contrabaß 16'", "Subbaß 16'", "Octavbaß 8'", "Choralbaß 4'", "Posaune 32'", "Posaune 16'", "Trompete 8'"],
    couple: { great: ['swell', 'positive'], pedal: ['great', 'swell'] },
  },
  fonds: {
    description: "Fonds de 8': the 8' foundations of Hauptwerk and Schwellwerk coupled (Franck, Widor)",
    great: ["Principal 8'", "Holzflöte 8'", "Röhrflöte 8'", "Gambe 8'"],
    swell: ["Principal 8'", "Nachthorn Gedackt 8'", "Corno dolce 8'", "Viola 8'"],
    pedal: ["Subbaß 16'", "Octavbaß 8'", "Gedackt 8'"],
    couple: { great: ['swell'], pedal: ['great'] },
  },
  flutes: {
    description: "Nachthorn Gedackt 8' + Querflöte 4' on the Schwellwerk",
    swell: ["Nachthorn Gedackt 8'", "Querflöte 4'"],
    pedal: ["Subbaß 16'", "Gedackt 8'"],
  },
  'flute-8': {
    description: "Nachthorn Gedackt 8' — soft stopped flute",
    swell: ["Nachthorn Gedackt 8'"],
    pedal: ["Subbaß 16'"],
  },
  'flute-harmonique': {
    description: "Jubalflöte 8' + Trichterflöte 4' — the Solowerk's big flutes, accompanied by the Schwellwerk",
    positive: ["Jubalflöte 8'", "Trichterflöte 4'"],
    swell: ["Nachthorn Gedackt 8'", "Viola 8'"],
    pedal: ["Subbaß 16'", "Gedackt 8'"],
  },
  celeste: {
    description: "Viola + Vox celeste 8' (from c) — the swell strings for Romantic music",
    swell: ["Viola 8'", "Vox celeste 8'"],
    pedal: ["Subbaß 16'"],
  },
  'cornet-decompose': {
    description: "Cornet décomposé on the Schwellwerk (8' 4' 2 2/3' 2' 1 3/5') against the Hauptwerk flutes",
    swell: ["Nachthorn Gedackt 8'", "Querflöte 4'", "Nazard 2 2/3'", "Flageolett 2'", "Tierce 1 3/5'"],
    great: ["Holzflöte 8'"],
    pedal: ["Subbaß 16'", "Gedackt 8'"],
  },
  cornet: {
    description: 'Cornet à pavillon solo (from g) against the Schwellwerk',
    positive: ["Cornet à pavillon 8'"],
    swell: ["Nachthorn Gedackt 8'", "Corno dolce 8'"],
    pedal: ["Subbaß 16'", "Gedackt 8'"],
  },
  hautbois: {
    description: "Hautbois 8' solo with Bourdon and Gedackt, against the Hauptwerk Holzflöte",
    swell: ["Nachthorn Gedackt 8'", "Hautbois 8'"],
    great: ["Holzflöte 8'"],
    pedal: ["Subbaß 16'", "Gedackt 8'"],
  },
  englischhorn: {
    description: "Englischhorn 8' solo on the Solowerk against the Schwellwerk",
    positive: ["Englischhorn 8'"],
    swell: ["Nachthorn Gedackt 8'", "Viola 8'"],
    pedal: ["Subbaß 16'"],
  },
  chamade: {
    description: "Trompete en chamade 8' — the horizontal trumpet in fanfare against the full Hauptwerk",
    positive: ["Trompete en chamade 8'"],
    great: ["Principal 8'", "Octave 4'", "Octave 2'", "Mixtur major 4-5f. 2 2/3'"],
    pedal: ["Contrabaß 16'", "Subbaß 16'", "Octavbaß 8'", "Posaune 16'"],
    couple: { pedal: ['great'] },
  },
};

/** Friesach, St. Bartholomäus (Eisenbarth, 2000, Carinthia, Austria): 44 stops on Hauptwerk,
 *  Schwellwerk, a French-style Solowerk and pedal (Untersatz 32'), from Piotr Grabowski's free
 *  sample set. */
export const FRIESACH_ORGAN: OrganDefinition = {
  id: 'friesach',
  name: 'Friesach, St. Bartholomäus',
  description: "Eisenbarth 2000, St. Bartholomäus, Friesach (Austria): 44 stops on three manuals (Hauptwerk, Schwellwerk, a French Solowerk with Trompete en chamade) and pedal with Untersatz 32'.",
  stops: STOPS,
  presets: PRESETS,
  defaultPreset: 'principal-chorus',
  divisions: CHURCH_DIVISIONS,
  tremulant: { division: 'swell', depth: 0.51, pitch: 3.6, rate: 4.0 },
  reverb: 'cathedral',
};
