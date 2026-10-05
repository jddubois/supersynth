import type { OrganDefinition, OrganPreset, StopDefinition } from '../types.js';

// Every pipe analysed from Piotr Grabowski's free sample set; models/organ/melcer/<id>.ssm.
// The Brustwerk (manual II) stands in a swell box: it is the swell here.
const STOPS: StopDefinition[] = [
  { id: 'great-nachthorn-8', model: 'organ/melcer/great-nachthorn-8', name: "Nachthorn 8'", division: 'great', family: 'flute', transpose: 0 },
  { id: 'great-prinzipal-4', model: 'organ/melcer/great-prinzipal-4', name: "Prinzipal 4'", division: 'great', family: 'principal', transpose: 12 },
  { id: 'great-nasard-2-2-3', model: 'organ/melcer/great-nasard-2-2-3', name: "Nasard 2 2/3'", division: 'great', family: 'mutation', transpose: 19 },
  { id: 'great-oktave-2', model: 'organ/melcer/great-oktave-2', name: "Oktave 2'", division: 'great', family: 'principal', transpose: 24 },
  { id: 'great-mixtur-1-1-3-4f', model: 'organ/melcer/great-mixtur-1-1-3-4f', name: "Mixtur 1 1/3' 4f", division: 'great', family: 'mixture', transpose: 0 },
  { id: 'great-trompete-8', model: 'organ/melcer/great-trompete-8', name: "Trompete 8'", division: 'great', family: 'reed', transpose: 0 },

  { id: 'swell-gedackt-8', model: 'organ/melcer/swell-gedackt-8', name: "Gedackt 8'", division: 'swell', family: 'flute', transpose: 0 },
  { id: 'swell-quintaton-8', model: 'organ/melcer/swell-quintaton-8', name: "Quintatön 8'", division: 'swell', family: 'flute', transpose: 0 },
  { id: 'swell-rohrflote-4', model: 'organ/melcer/swell-rohrflote-4', name: "Rohrflöte 4'", division: 'swell', family: 'flute', transpose: 12 },
  { id: 'swell-prinzipal-2', model: 'organ/melcer/swell-prinzipal-2', name: "Prinzipal 2'", division: 'swell', family: 'principal', transpose: 24 },
  { id: 'swell-quinte-1-1-3', model: 'organ/melcer/swell-quinte-1-1-3', name: "Quinte 1 1/3'", division: 'swell', family: 'mutation', transpose: 31 },
  { id: 'swell-sifflote-1', model: 'organ/melcer/swell-sifflote-1', name: "Sifflöte 1'", division: 'swell', family: 'flute', transpose: 36 },
  { id: 'swell-krumhorn-8', model: 'organ/melcer/swell-krumhorn-8', name: "Krumhorn 8'", division: 'swell', family: 'reed', transpose: 0 },

  { id: 'pedal-subbass-16', model: 'organ/melcer/pedal-subbass-16', name: "Subbass 16'", division: 'pedal', family: 'flute', transpose: -12 },
  { id: 'pedal-gedacktbass-8', model: 'organ/melcer/pedal-gedacktbass-8', name: "Gedacktbass 8'", division: 'pedal', family: 'flute', transpose: 0 },
  { id: 'pedal-choralbas-4', model: 'organ/melcer/pedal-choralbas-4', name: "Choralbas 4'", division: 'pedal', family: 'principal', transpose: 12 },
  { id: 'pedal-oktave-2', model: 'organ/melcer/pedal-oktave-2', name: "Oktave 2'", division: 'pedal', family: 'principal', transpose: 24 },
  { id: 'pedal-trompete-8', model: 'organ/melcer/pedal-trompete-8', name: "Trompete 8'", division: 'pedal', family: 'reed', transpose: 0 },
];

const PRESETS: Record<string, OrganPreset> = {
  'principal-chorus': {
    description: "Nachthorn 8' with the principals 4' + 2'",
    great: ["Nachthorn 8'", "Prinzipal 4'", "Oktave 2'"],
    pedal: ["Subbass 16'", "Gedacktbass 8'", "Choralbas 4'"],
  },
  plenum: {
    description: 'Organo pleno: the Hauptwerk chorus with Mixtur, the Brustwerk coupled',
    great: ["Nachthorn 8'", "Prinzipal 4'", "Oktave 2'", "Mixtur 1 1/3' 4f"],
    swell: ["Gedackt 8'", "Rohrflöte 4'", "Prinzipal 2'", "Quinte 1 1/3'"],
    pedal: ["Subbass 16'", "Gedacktbass 8'", "Choralbas 4'", "Oktave 2'"],
    couple: { great: ['swell'], pedal: ['great'] },
  },
  full: {
    description: 'Full organ with the Trompeten and Krumhorn',
    great: ["Nachthorn 8'", "Prinzipal 4'", "Nasard 2 2/3'", "Oktave 2'", "Mixtur 1 1/3' 4f", "Trompete 8'"],
    swell: ["Gedackt 8'", "Quintatön 8'", "Rohrflöte 4'", "Prinzipal 2'", "Quinte 1 1/3'", "Sifflöte 1'", "Krumhorn 8'"],
    pedal: ["Subbass 16'", "Gedacktbass 8'", "Choralbas 4'", "Oktave 2'", "Trompete 8'"],
    couple: { great: ['swell'], pedal: ['great', 'swell'] },
  },
  flutes: {
    description: "Gedackt 8' + Rohrflöte 4' on the Brustwerk",
    swell: ["Gedackt 8'", "Rohrflöte 4'"],
    pedal: ["Subbass 16'"],
  },
  'flute-8': {
    description: "Gedackt 8' — soft stopped flute",
    swell: ["Gedackt 8'"],
    pedal: ["Subbass 16'"],
  },
  nasard: {
    description: "Nachthorn 8', Prinzipal 4' and Nasard 2 2/3' — a solo voice against the Gedackt",
    great: ["Nachthorn 8'", "Prinzipal 4'", "Nasard 2 2/3'"],
    swell: ["Gedackt 8'"],
    pedal: ["Subbass 16'", "Gedacktbass 8'"],
  },
  sifflote: {
    description: "Gedackt 8' + Sifflöte 1' — the gapped Baroque registration",
    swell: ["Gedackt 8'", "Sifflöte 1'"],
    great: ["Nachthorn 8'"],
    pedal: ["Subbass 16'"],
  },
  krumhorn: {
    description: "Krumhorn 8' solo on the Brustwerk against the Nachthorn",
    swell: ["Gedackt 8'", "Krumhorn 8'"],
    great: ["Nachthorn 8'"],
    pedal: ["Subbass 16'", "Gedacktbass 8'"],
  },
  trumpet: {
    description: "Trompete 8' with Prinzipal 4' — festive solo",
    great: ["Nachthorn 8'", "Prinzipal 4'", "Trompete 8'"],
    swell: ["Gedackt 8'", "Rohrflöte 4'"],
    pedal: ["Subbass 16'", "Gedacktbass 8'", "Trompete 8'"],
  },
};

/** Melcer Chamber Music Hall (Walcker, 1993, Warsaw): a neo-Baroque concert organ, Hauptwerk and
 *  enclosed Brustwerk with pedal, from Piotr Grabowski's free sample set. */
export const MELCER_ORGAN: OrganDefinition = {
  id: 'melcer',
  name: 'Melcer Chamber Music Hall',
  description: 'Walcker 1993, Melcer Chamber Music Hall, Warsaw (Poland): 18 stops on two manuals (the Brustwerk enclosed) and pedal, in a concert hall.',
  stops: STOPS,
  presets: PRESETS,
  defaultPreset: 'principal-chorus',
  divisions: { great: { pan: 0 }, swell: { pan: 0, swellBox: { closed: -8 } }, positive: { pan: 0 }, pedal: { pan: 0 } },
  tremulant: { division: 'swell', name: 'Tremulant 2 Man', depth: 1.97, pitch: 8.2, rate: 3.75 },
  wind: 0,
  reverb: 'concert-hall',
};
