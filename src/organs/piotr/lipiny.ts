import { CHURCH_DIVISIONS } from '../defaults.js';
import type { OrganDefinition, OrganPreset, StopDefinition } from '../types.js';

// Every pipe analysed from Piotr Grabowski's free sample set; models/organ/lipiny/<id>.ssm.
// Manual I is the great, manual II (not enclosed) the positive.
const STOPS: StopDefinition[] = [
  { id: 'great-bordun-16', model: 'organ/lipiny/great-bordun-16', name: "Bordun 16'", division: 'great', family: 'flute', transpose: -12 },
  { id: 'great-principal-8', model: 'organ/lipiny/great-principal-8', name: "Principal 8'", division: 'great', family: 'principal', transpose: 0 },
  { id: 'great-viola-di-gamba-8', model: 'organ/lipiny/great-viola-di-gamba-8', name: "Viola di Gamba 8'", division: 'great', family: 'string', transpose: 0 },
  { id: 'great-gemshorn-8', model: 'organ/lipiny/great-gemshorn-8', name: "Gemshorn 8'", division: 'great', family: 'principal', transpose: 0 },
  { id: 'great-doppelrohrflote-8', model: 'organ/lipiny/great-doppelrohrflote-8', name: "Doppelröhrflöte 8'", division: 'great', family: 'flute', transpose: 0 },
  { id: 'great-octave-4', model: 'organ/lipiny/great-octave-4', name: "Octave 4'", division: 'great', family: 'principal', transpose: 12 },
  { id: 'great-doppelrohrflote-4', model: 'organ/lipiny/great-doppelrohrflote-4', name: "Doppelröhrflöte 4'", division: 'great', family: 'flute', transpose: 12 },
  { id: 'great-quinte-2-2-3', model: 'organ/lipiny/great-quinte-2-2-3', name: "Quinte 2 2/3'", division: 'great', family: 'mutation', transpose: 19 },
  { id: 'great-octave-2', model: 'organ/lipiny/great-octave-2', name: "Octave 2'", division: 'great', family: 'principal', transpose: 24 },
  { id: 'great-cornett-3-fach', model: 'organ/lipiny/great-cornett-3-fach', name: "Cornett 3 Fach", division: 'great', family: 'mixture', transpose: 0 },
  { id: 'great-mixtur-4-fach', model: 'organ/lipiny/great-mixtur-4-fach', name: "Mixtur 4 Fach", division: 'great', family: 'mixture', transpose: 0 },
  { id: 'great-trompete-8', model: 'organ/lipiny/great-trompete-8', name: "Trompete 8'", division: 'great', family: 'reed', transpose: 0 },

  { id: 'positive-geigenprincipal-8', model: 'organ/lipiny/positive-geigenprincipal-8', name: "Geigenprincipal 8'", division: 'positive', family: 'principal', transpose: 0 },
  { id: 'positive-salicet-8', model: 'organ/lipiny/positive-salicet-8', name: "Salicet 8'", division: 'positive', family: 'string', transpose: 0 },
  { id: 'positive-flaut-major-8', model: 'organ/lipiny/positive-flaut-major-8', name: "Flaut Major 8'", division: 'positive', family: 'flute', transpose: 0 },
  { id: 'positive-portunal-flaut-8', model: 'organ/lipiny/positive-portunal-flaut-8', name: "Portunal Flaut 8'", division: 'positive', family: 'flute', transpose: 0 },
  { id: 'positive-viol-principal-4', model: 'organ/lipiny/positive-viol-principal-4', name: "Viol-Principal 4'", division: 'positive', family: 'principal', transpose: 12 },
  { id: 'positive-portunal-flaut-4', model: 'organ/lipiny/positive-portunal-flaut-4', name: "Portunal Flaut 4'", division: 'positive', family: 'flute', transpose: 12 },

  { id: 'pedal-principalbass-16', model: 'organ/lipiny/pedal-principalbass-16', name: "Principalbaß 16'", division: 'pedal', family: 'principal', transpose: -12 },
  { id: 'pedal-violonbass-16', model: 'organ/lipiny/pedal-violonbass-16', name: "Violonbaß 16'", division: 'pedal', family: 'string', transpose: -12 },
  { id: 'pedal-subbass-16', model: 'organ/lipiny/pedal-subbass-16', name: "Subbaß 16'", division: 'pedal', family: 'flute', transpose: -12 },
  { id: 'pedal-octavbass-8', model: 'organ/lipiny/pedal-octavbass-8', name: "Octavbaß 8'", division: 'pedal', family: 'principal', transpose: 0 },
  { id: 'pedal-flautbass-8', model: 'organ/lipiny/pedal-flautbass-8', name: "Flautbaß 8'", division: 'pedal', family: 'flute', transpose: 0 },
  { id: 'pedal-octave-4', model: 'organ/lipiny/pedal-octave-4', name: "Octave 4'", division: 'pedal', family: 'principal', transpose: 12 },
  { id: 'pedal-posaune-16', model: 'organ/lipiny/pedal-posaune-16', name: "Posaune 16'", division: 'pedal', family: 'reed', transpose: -12 },
];

const PRESETS: Record<string, OrganPreset> = {
  principal: {
    description: "Principal 8' alone",
    great: ["Principal 8'"],
    pedal: ["Subbaß 16'", "Octavbaß 8'"],
  },
  foundations: {
    description: "The 8' stops of both manuals coupled — the Romantic fonds",
    great: ["Principal 8'", "Viola di Gamba 8'", "Gemshorn 8'", "Doppelröhrflöte 8'"],
    positive: ["Geigenprincipal 8'", "Salicet 8'", "Flaut Major 8'"],
    pedal: ["Subbaß 16'", "Violonbaß 16'", "Octavbaß 8'", "Flautbaß 8'"],
    couple: { great: ['positive'] },
  },
  'principal-chorus': {
    description: "Principal chorus 8' 4' 2'",
    great: ["Principal 8'", "Octave 4'", "Octave 2'"],
    pedal: ["Principalbaß 16'", "Subbaß 16'", "Octavbaß 8'"],
    couple: { pedal: ['great'] },
  },
  plenum: {
    description: 'Plenum: principals, Quinte and Mixtur on Bordun 16\'',
    great: ["Bordun 16'", "Principal 8'", "Doppelröhrflöte 8'", "Octave 4'", "Quinte 2 2/3'", "Octave 2'", 'Mixtur 4 Fach'],
    positive: ["Geigenprincipal 8'", "Viol-Principal 4'"],
    pedal: ["Principalbaß 16'", "Subbaß 16'", "Octavbaß 8'", "Octave 4'"],
    couple: { great: ['positive'], pedal: ['great'] },
  },
  full: {
    description: 'Full organ with Cornett, Trompete and Posaune',
    great: ["Bordun 16'", "Principal 8'", "Viola di Gamba 8'", "Gemshorn 8'", "Doppelröhrflöte 8'", "Octave 4'", "Doppelröhrflöte 4'",
      "Quinte 2 2/3'", "Octave 2'", 'Cornett 3 Fach', 'Mixtur 4 Fach', "Trompete 8'"],
    positive: ["Geigenprincipal 8'", "Salicet 8'", "Flaut Major 8'", "Portunal Flaut 8'", "Viol-Principal 4'", "Portunal Flaut 4'"],
    pedal: ["Principalbaß 16'", "Violonbaß 16'", "Subbaß 16'", "Octavbaß 8'", "Flautbaß 8'", "Octave 4'", "Posaune 16'"],
    couple: { great: ['positive'], pedal: ['great', 'positive'] },
  },
  flutes: {
    description: "Doppelröhrflöte 8' + 4' on the great",
    great: ["Doppelröhrflöte 8'", "Doppelröhrflöte 4'"],
    pedal: ["Subbaß 16'", "Flautbaß 8'"],
  },
  'flute-8': {
    description: "Portunal Flaut 8' — soft flute on the positive",
    positive: ["Portunal Flaut 8'"],
    pedal: ["Subbaß 16'"],
  },
  'soft-flutes': {
    description: "Portunal Flaut 8' + 4' on the positive",
    positive: ["Portunal Flaut 8'", "Portunal Flaut 4'"],
    pedal: ["Subbaß 16'"],
  },
  strings: {
    description: "Salicet 8' with Flaut Major — the soft strings of the positive",
    positive: ["Salicet 8'", "Flaut Major 8'"],
    pedal: ["Subbaß 16'", "Violonbaß 16'"],
  },
  cornet: {
    description: 'Cornett solo on the great against the positive',
    great: ["Bordun 16'", "Doppelröhrflöte 8'", 'Cornett 3 Fach'],
    positive: ["Flaut Major 8'"],
    pedal: ["Subbaß 16'", "Flautbaß 8'"],
  },
  trumpet: {
    description: "Trompete 8' with Principal 8' — festive solo",
    great: ["Principal 8'", "Trompete 8'"],
    positive: ["Geigenprincipal 8'", "Flaut Major 8'"],
    pedal: ["Subbaß 16'", "Octavbaß 8'", "Posaune 16'"],
  },
};

/** Lipiny (Adolf Volkmann, 1898, Świętochłowice, Poland): a Romantic organ, 25 stops on two
 *  manuals and pedal, from Piotr Grabowski's free sample set. */
export const LIPINY_ORGAN: OrganDefinition = {
  id: 'lipiny',
  name: 'Lipiny',
  description: 'Adolf Volkmann 1898, Lipiny, Świętochłowice (Poland): a Romantic organ, 25 stops on two manuals and pedal.',
  stops: STOPS,
  presets: PRESETS,
  defaultPreset: 'foundations',
  divisions: CHURCH_DIVISIONS,
};
