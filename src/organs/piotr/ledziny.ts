import type { OrganDef, Registration, StopDef } from '../types.js';

// Every pipe analysed from Piotr Grabowski's free sample set; models/organ/ledziny/<id>.ssm.
const STOPS: StopDef[] = [
  { id: 'great-principal-8', model: 'organ/ledziny/great-principal-8', name: "Principal 8'", division: 'great', family: 'principal', transpose: 0 },
  { id: 'great-salicet-8', model: 'organ/ledziny/great-salicet-8', name: "Salicet 8'", division: 'great', family: 'string', transpose: 0 },
  { id: 'great-portunal-flote-8', model: 'organ/ledziny/great-portunal-flote-8', name: "Portunal-Flöte 8'", division: 'great', family: 'flute', transpose: 0 },
  { id: 'great-flaut-major-8', model: 'organ/ledziny/great-flaut-major-8', name: "Flaut major 8'", division: 'great', family: 'flute', transpose: 0 },
  { id: 'great-principal-4', model: 'organ/ledziny/great-principal-4', name: "Principal 4'", division: 'great', family: 'principal', transpose: 12 },
  { id: 'great-flauto-traverse-4', model: 'organ/ledziny/great-flauto-traverse-4', name: "Flauto traverse 4'", division: 'great', family: 'flute', transpose: 12 },
  { id: 'great-quinte-2-2-3-octave-2', model: 'organ/ledziny/great-quinte-2-2-3-octave-2', name: "Quinte 2 2/3' Octave 2'", division: 'great', family: 'mixture', transpose: 0 },
  { id: 'great-mixtur-2-fach', model: 'organ/ledziny/great-mixtur-2-fach', name: 'Mixtur 2 fach', division: 'great', family: 'mixture', transpose: 0 },

  { id: 'pedal-subbass-16', model: 'organ/ledziny/pedal-subbass-16', name: "Subbaß 16'", division: 'pedal', family: 'flute', transpose: -12 },
  { id: 'pedal-principal-bass-8', model: 'organ/ledziny/pedal-principal-bass-8', name: "Principal baß 8'", division: 'pedal', family: 'principal', transpose: 0 },
  { id: 'pedal-violon-cello-8', model: 'organ/ledziny/pedal-violon-cello-8', name: "Violon Cello 8'", division: 'pedal', family: 'string', transpose: 0 },
];

const REGISTRATIONS: Record<string, Registration> = {
  principal: {
    description: "Principal 8' alone",
    great: ["Principal 8'"],
    pedal: ["Subbaß 16'", "Principal baß 8'"],
  },
  foundations: {
    description: "All the 8' stops — the warm Romantic foundation",
    great: ["Principal 8'", "Salicet 8'", "Portunal-Flöte 8'", "Flaut major 8'"],
    pedal: ["Subbaß 16'", "Principal baß 8'", "Violon Cello 8'"],
  },
  'principal-chorus': {
    description: "Principals 8' 4' with Quinte and Octave",
    great: ["Principal 8'", "Principal 4'", "Quinte 2 2/3' Octave 2'"],
    pedal: ["Subbaß 16'", "Principal baß 8'"],
    couplers: ['great>pedal'],
  },
  full: {
    description: 'Full organ: principals, flutes, Quinte, Octave and Mixtur',
    great: ["Principal 8'", "Flaut major 8'", "Portunal-Flöte 8'", "Principal 4'", "Flauto traverse 4'", "Quinte 2 2/3' Octave 2'", 'Mixtur 2 fach'],
    pedal: ["Subbaß 16'", "Principal baß 8'", "Violon Cello 8'"],
    couplers: ['great>pedal'],
  },
  flutes: {
    description: "Flaut major 8' + Flauto traverse 4'",
    great: ["Flaut major 8'", "Flauto traverse 4'"],
    pedal: ["Subbaß 16'"],
  },
  'flute-8': {
    description: "Portunal-Flöte 8' — soft, for quiet accompaniment",
    great: ["Portunal-Flöte 8'"],
    pedal: ["Subbaß 16'"],
  },
  strings: {
    description: "Salicet 8' with Violon Cello in the pedal",
    great: ["Salicet 8'"],
    pedal: ["Subbaß 16'", "Violon Cello 8'"],
  },
};

/** Lędziny, St. Clement (Carl Volkmann, 1888, Poland): a one-manual Romantic organ with pedal,
 *  from Piotr Grabowski's free sample set. */
export const LEDZINY_ORGAN: OrganDef = {
  id: 'ledziny',
  name: 'Lędziny, St. Clement',
  description: 'Carl Volkmann 1888, St. Clement, Lędziny (Poland): a one-manual Romantic organ, 11 stops on manual and pedal.',
  stops: STOPS,
  registrations: REGISTRATIONS,
  defaultRegistration: 'foundations',
  divisions: { great: { pan: 0 }, swell: { pan: 0 }, positive: { pan: 0 }, pedal: { pan: 0 } },
};
