import { CHURCH_DIVISIONS } from '../defaults.js';
import type { OrganDef, Registration, StopDef } from '../types.js';

// Every pipe analysed from Piotr Grabowski's free sample set; models/organ/giubiasco/<id>.ssm.
// Grande organo (manual II) is the great, Positivo tergale (manual I) the positive.
const STOPS: StopDef[] = [
  { id: 'great-principale-8', model: 'organ/giubiasco/great-principale-8', name: "Principale 8'", division: 'great', family: 'principal', transpose: 0 },
  { id: 'great-viola-da-gamba-8', model: 'organ/giubiasco/great-viola-da-gamba-8', name: "Viola da Gamba 8'", division: 'great', family: 'string', transpose: 0 },
  { id: 'great-flauto-a-camino-8', model: 'organ/giubiasco/great-flauto-a-camino-8', name: "Flauto a camino 8'", division: 'great', family: 'flute', transpose: 0 },
  { id: 'great-voce-umana-8', model: 'organ/giubiasco/great-voce-umana-8', name: "Voce umana 8'", division: 'great', family: 'string', transpose: 0 },
  { id: 'great-ottava-4', model: 'organ/giubiasco/great-ottava-4', name: "Ottava 4'", division: 'great', family: 'principal', transpose: 12 },
  { id: 'great-flauto-conico-4', model: 'organ/giubiasco/great-flauto-conico-4', name: "Flauto conico 4'", division: 'great', family: 'flute', transpose: 12 },
  { id: 'great-quintadecima-2', model: 'organ/giubiasco/great-quintadecima-2', name: "Quintadecima 2'", division: 'great', family: 'principal', transpose: 24 },
  { id: 'great-cornetto-2-2-3', model: 'organ/giubiasco/great-cornetto-2-2-3', name: "Cornetto 2 2/3'", division: 'great', family: 'mixture', transpose: 0 },
  { id: 'great-ripieno-4-file', model: 'organ/giubiasco/great-ripieno-4-file', name: "Ripieno 4 file", division: 'great', family: 'mixture', transpose: 0 },
  { id: 'great-violoncello-8', model: 'organ/giubiasco/great-violoncello-8', name: "Violoncello 8'", division: 'great', family: 'string', transpose: 0 },

  { id: 'positive-bordone-8', model: 'organ/giubiasco/positive-bordone-8', name: "Bordone 8'", division: 'positive', family: 'flute', transpose: 0 },
  { id: 'positive-flauto-4', model: 'organ/giubiasco/positive-flauto-4', name: "Flauto 4'", division: 'positive', family: 'flute', transpose: 12 },
  { id: 'positive-quinta-2-2-3', model: 'organ/giubiasco/positive-quinta-2-2-3', name: "Quinta 2 2/3'", division: 'positive', family: 'mutation', transpose: 19 },
  { id: 'positive-principale-2', model: 'organ/giubiasco/positive-principale-2', name: "Principale 2'", division: 'positive', family: 'principal', transpose: 24 },
  { id: 'positive-terza-1-3-5', model: 'organ/giubiasco/positive-terza-1-3-5', name: "Terza 1 3/5'", division: 'positive', family: 'mutation', transpose: 28 },
  { id: 'positive-larigot-1-1-3', model: 'organ/giubiasco/positive-larigot-1-1-3', name: "Larigot 1 1/3'", division: 'positive', family: 'mutation', transpose: 31 },
  { id: 'positive-cimbalo-2-file', model: 'organ/giubiasco/positive-cimbalo-2-file', name: "Cimbalo 2 file", division: 'positive', family: 'mixture', transpose: 0 },
  { id: 'positive-regale-8', model: 'organ/giubiasco/positive-regale-8', name: "Regale 8'", division: 'positive', family: 'reed', transpose: 0 },

  { id: 'pedal-subbasso-16', model: 'organ/giubiasco/pedal-subbasso-16', name: "Subbasso 16'", division: 'pedal', family: 'flute', transpose: -12 },
  { id: 'pedal-flauto-8', model: 'organ/giubiasco/pedal-flauto-8', name: "Flauto 8'", division: 'pedal', family: 'flute', transpose: 0 },
  { id: 'pedal-ottava-4', model: 'organ/giubiasco/pedal-ottava-4', name: "Ottava 4'", division: 'pedal', family: 'principal', transpose: 12 },
  { id: 'pedal-contro-fagotto-16', model: 'organ/giubiasco/pedal-contro-fagotto-16', name: "Contro Fagotto 16'", division: 'pedal', family: 'reed', transpose: -12 },
];

const REGISTRATIONS: Record<string, Registration> = {
  principale: {
    description: "Principale 8' alone",
    great: ["Principale 8'"],
    pedal: ["Subbasso 16'", "Flauto 8'"],
  },
  ripieno: {
    description: "Ripieno: Principale 8', Ottava 4', Quintadecima 2' and the Ripieno",
    great: ["Principale 8'", "Ottava 4'", "Quintadecima 2'", 'Ripieno 4 file'],
    pedal: ["Subbasso 16'", "Flauto 8'", "Ottava 4'"],
    couplers: ['great>pedal'],
  },
  pleno: {
    description: 'Organo pleno: Ripieno on the great, Cimbalo on the positive, both coupled',
    great: ["Principale 8'", "Flauto a camino 8'", "Ottava 4'", "Quintadecima 2'", 'Ripieno 4 file'],
    positive: ["Bordone 8'", "Flauto 4'", "Principale 2'", "Larigot 1 1/3'", 'Cimbalo 2 file'],
    pedal: ["Subbasso 16'", "Flauto 8'", "Ottava 4'", "Contro Fagotto 16'"],
    couplers: ['positive>great', 'great>pedal'],
  },
  full: {
    description: 'Full organ with Cornetto, Regale and Contro Fagotto',
    great: ["Principale 8'", "Flauto a camino 8'", "Ottava 4'", "Flauto conico 4'", "Quintadecima 2'", "Cornetto 2 2/3'", 'Ripieno 4 file'],
    positive: ["Bordone 8'", "Flauto 4'", "Quinta 2 2/3'", "Principale 2'", "Terza 1 3/5'", "Larigot 1 1/3'", 'Cimbalo 2 file', "Regale 8'"],
    pedal: ["Subbasso 16'", "Flauto 8'", "Ottava 4'", "Contro Fagotto 16'"],
    couplers: ['positive>great', 'great>pedal', 'positive>pedal'],
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
export const GIUBIASCO_ORGAN: OrganDef = {
  id: 'giubiasco',
  name: 'Giubiasco',
  description: 'Mascioni 2008, Giubiasco (Switzerland): 22 stops in the Italian style on Grande organo, Positivo tergale and pedal with Ripieno, Voce umana and Cornetto.',
  stops: STOPS,
  registrations: REGISTRATIONS,
  defaultRegistration: 'ripieno',
  divisions: CHURCH_DIVISIONS,
  tremulant: { division: 'positive', depth: 1.91, pitch: 3.5, rate: 5.07 },
};
