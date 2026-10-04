import { CHURCH_DIVISIONS } from '../defaults.js';
import type { OrganDefinition, OrganPreset, StopDefinition } from '../types.js';

// Every pipe analysed from Piotr Grabowski's free sample set; models/organ/strassburg/<id>.ssm.
// Hauptwerk (manual I) is the great, Positiv (manual II) the positive. The organ stands about a
// quarter-tone above A440.
const STOPS: StopDefinition[] = [
  { id: 'great-prinzipal-8', model: 'organ/strassburg/great-prinzipal-8', name: "Prinzipal 8'", division: 'great', family: 'principal', transpose: 0 },
  { id: 'great-gedeckt-8', model: 'organ/strassburg/great-gedeckt-8', name: "Gedeckt 8'", division: 'great', family: 'flute', transpose: 0 },
  { id: 'great-gemshorn-8', model: 'organ/strassburg/great-gemshorn-8', name: "Gemshorn 8'", division: 'great', family: 'principal', transpose: 0 },
  { id: 'great-oktav-4', model: 'organ/strassburg/great-oktav-4', name: "Oktav 4'", division: 'great', family: 'principal', transpose: 12 },
  { id: 'great-flote-4', model: 'organ/strassburg/great-flote-4', name: "Flöte 4'", division: 'great', family: 'flute', transpose: 12 },
  { id: 'great-quint-2-2-3', model: 'organ/strassburg/great-quint-2-2-3', name: "Quint 2 2/3'", division: 'great', family: 'mutation', transpose: 19 },
  { id: 'great-oktav-2', model: 'organ/strassburg/great-oktav-2', name: "Oktav 2'", division: 'great', family: 'principal', transpose: 24 },
  { id: 'great-oktav-1', model: 'organ/strassburg/great-oktav-1', name: "Oktav 1'", division: 'great', family: 'principal', transpose: 36 },
  { id: 'great-mixtur-1-1-3', model: 'organ/strassburg/great-mixtur-1-1-3', name: "Mixtur 1 1/3'", division: 'great', family: 'mixture', transpose: 0 },

  { id: 'positive-gedackt-8', model: 'organ/strassburg/positive-gedackt-8', name: "Gedackt 8'", division: 'positive', family: 'flute', transpose: 0 },
  { id: 'positive-prinzipal-4', model: 'organ/strassburg/positive-prinzipal-4', name: "Prinzipal 4'", division: 'positive', family: 'principal', transpose: 12 },
  { id: 'positive-flote-4', model: 'organ/strassburg/positive-flote-4', name: "Flöte 4'", division: 'positive', family: 'flute', transpose: 12 },
  { id: 'positive-oktav-2', model: 'organ/strassburg/positive-oktav-2', name: "Oktav 2'", division: 'positive', family: 'principal', transpose: 24 },
  { id: 'positive-mixtur-1', model: 'organ/strassburg/positive-mixtur-1', name: "Mixtur 1'", division: 'positive', family: 'mixture', transpose: 0 },

  { id: 'pedal-kontrabass-16', model: 'organ/strassburg/pedal-kontrabass-16', name: "Kontrabaß 16'", division: 'pedal', family: 'string', transpose: -12 },
  { id: 'pedal-subbass-16', model: 'organ/strassburg/pedal-subbass-16', name: "Subbaß 16'", division: 'pedal', family: 'flute', transpose: -12 },
  { id: 'pedal-oktavbass-8', model: 'organ/strassburg/pedal-oktavbass-8', name: "Oktavbaß 8'", division: 'pedal', family: 'principal', transpose: 0 },
  { id: 'pedal-gedacktbass-8', model: 'organ/strassburg/pedal-gedacktbass-8', name: "Gedacktbaß 8'", division: 'pedal', family: 'flute', transpose: 0 },
  { id: 'pedal-oktave-4', model: 'organ/strassburg/pedal-oktave-4', name: "Oktave 4'", division: 'pedal', family: 'principal', transpose: 12 },
  { id: 'pedal-posaun-16', model: 'organ/strassburg/pedal-posaun-16', name: "Posaun 16'", division: 'pedal', family: 'reed', transpose: -12 },
];

const PRESETS: Record<string, OrganPreset> = {
  principal: {
    description: "Prinzipal 8' alone",
    great: ["Prinzipal 8'"],
    pedal: ["Subbaß 16'", "Oktavbaß 8'"],
  },
  'principal-chorus': {
    description: "Principal chorus 8' 4' 2'",
    great: ["Prinzipal 8'", "Oktav 4'", "Oktav 2'"],
    pedal: ["Subbaß 16'", "Oktavbaß 8'", "Oktave 4'"],
  },
  plenum: {
    description: 'Organo pleno for the Baroque repertoire: principals, Quint and Mixtur, the Positiv coupled',
    great: ["Prinzipal 8'", "Gedeckt 8'", "Oktav 4'", "Quint 2 2/3'", "Oktav 2'", "Oktav 1'", "Mixtur 1 1/3'"],
    positive: ["Gedackt 8'", "Prinzipal 4'", "Oktav 2'", "Mixtur 1'"],
    pedal: ["Kontrabaß 16'", "Subbaß 16'", "Oktavbaß 8'", "Oktave 4'", "Posaun 16'"],
    couple: { great: ['positive'] },
  },
  full: {
    description: 'Every stop, the Positiv coupled',
    great: ["Prinzipal 8'", "Gedeckt 8'", "Gemshorn 8'", "Oktav 4'", "Flöte 4'", "Quint 2 2/3'", "Oktav 2'", "Oktav 1'", "Mixtur 1 1/3'"],
    positive: ["Gedackt 8'", "Prinzipal 4'", "Flöte 4'", "Oktav 2'", "Mixtur 1'"],
    pedal: ["Kontrabaß 16'", "Subbaß 16'", "Oktavbaß 8'", "Gedacktbaß 8'", "Oktave 4'", "Posaun 16'"],
    couple: { great: ['positive'], pedal: ['great'] },
  },
  flutes: {
    description: "Gedeckt 8' + Flöte 4' on the Hauptwerk",
    great: ["Gedeckt 8'", "Flöte 4'"],
    pedal: ["Subbaß 16'", "Gedacktbaß 8'"],
  },
  'flute-8': {
    description: "Gedackt 8' — the Positiv's soft stopped flute",
    positive: ["Gedackt 8'"],
    pedal: ["Subbaß 16'"],
  },
  'positive-chorus': {
    description: "The Positiv's small chorus: Gedackt 8', Prinzipal 4', Oktav 2'",
    positive: ["Gedackt 8'", "Prinzipal 4'", "Oktav 2'"],
    pedal: ["Subbaß 16'", "Gedacktbaß 8'"],
  },
  gemshorn: {
    description: "Gemshorn 8' with Flöte 4' — the gentle colour of the Hauptwerk",
    great: ["Gemshorn 8'", "Flöte 4'"],
    pedal: ["Subbaß 16'"],
  },
  'cornet-decompose': {
    description: "Gedeckt 8', Flöte 4' and Quint 2 2/3' — a gapped solo against the Positiv Gedackt",
    great: ["Gedeckt 8'", "Flöte 4'", "Quint 2 2/3'"],
    positive: ["Gedackt 8'"],
    pedal: ["Subbaß 16'", "Gedacktbaß 8'"],
  },
};

/** Strassburg (Cyriach Werner, 1743, Carinthia, Austria): a Baroque organ, 20 stops on Hauptwerk,
 *  Positiv and pedal, from Piotr Grabowski's free sample set. */
export const STRASSBURG_ORGAN: OrganDefinition = {
  id: 'strassburg',
  name: 'Strassburg',
  description: 'Cyriach Werner 1743, Strassburg (Carinthia, Austria): a Baroque organ, 20 stops on Hauptwerk, Positiv and pedal.',
  stops: STOPS,
  presets: PRESETS,
  defaultPreset: 'principal-chorus',
  divisions: CHURCH_DIVISIONS,
};
