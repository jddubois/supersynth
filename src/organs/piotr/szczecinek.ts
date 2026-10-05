import type { OrganDefinition, OrganPreset, StopDefinition } from '../types.js';

// Every pipe analysed from Piotr Grabowski's free sample set; models/organ/szczecinek/<id>.ssm.
// Manual II stands in a swell box.
const STOPS: StopDefinition[] = [
  { id: 'great-principal-16', model: 'organ/szczecinek/great-principal-16', name: "Principal 16'", division: 'great', family: 'principal', transpose: -12 },
  { id: 'great-bordun-16', model: 'organ/szczecinek/great-bordun-16', name: "Bordun 16'", division: 'great', family: 'flute', transpose: -12 },
  { id: 'great-principal-8', model: 'organ/szczecinek/great-principal-8', name: "Principal 8'", division: 'great', family: 'principal', transpose: 0 },
  { id: 'great-gambe-8', model: 'organ/szczecinek/great-gambe-8', name: "Gambe 8'", division: 'great', family: 'string', transpose: 0 },
  { id: 'great-salicional-8', model: 'organ/szczecinek/great-salicional-8', name: "Salicional 8'", division: 'great', family: 'string', transpose: 0 },
  { id: 'great-rohrflote-8', model: 'organ/szczecinek/great-rohrflote-8', name: "Röhrflöte 8'", division: 'great', family: 'flute', transpose: 0 },
  { id: 'great-flute-harmonique-8', model: 'organ/szczecinek/great-flute-harmonique-8', name: "Flûte harmonique 8'", division: 'great', family: 'flute', transpose: 0 },
  { id: 'great-octave-4', model: 'organ/szczecinek/great-octave-4', name: "Octave 4'", division: 'great', family: 'principal', transpose: 12 },
  { id: 'great-hohlflote-4', model: 'organ/szczecinek/great-hohlflote-4', name: "Hohlflöte 4'", division: 'great', family: 'flute', transpose: 12 },
  { id: 'great-piccolo-2', model: 'organ/szczecinek/great-piccolo-2', name: "Piccolo 2'", division: 'great', family: 'flute', transpose: 24 },
  { id: 'great-rauschquinte-2-2-3-u-2', model: 'organ/szczecinek/great-rauschquinte-2-2-3-u-2', name: "Rauschquinte 2 2/3' u. 2'", division: 'great', family: 'mixture', transpose: 0 },
  { id: 'great-cornett-2-4-fach', model: 'organ/szczecinek/great-cornett-2-4-fach', name: "Cornett 2-4 fach", division: 'great', family: 'mixture', transpose: 0 },
  { id: 'great-mixtur-5-fach', model: 'organ/szczecinek/great-mixtur-5-fach', name: "Mixtur 5 fach", division: 'great', family: 'mixture', transpose: 0 },
  { id: 'great-trompete-8', model: 'organ/szczecinek/great-trompete-8', name: "Trompete 8'", division: 'great', family: 'reed', transpose: 0 },

  { id: 'swell-lieblich-gedackt-16', model: 'organ/szczecinek/swell-lieblich-gedackt-16', name: "Lieblich Gedackt 16'", division: 'swell', family: 'flute', transpose: -12 },
  { id: 'swell-geigenprincipal-8', model: 'organ/szczecinek/swell-geigenprincipal-8', name: "Geigenprincipal 8'", division: 'swell', family: 'principal', transpose: 0 },
  { id: 'swell-gedackt-8', model: 'organ/szczecinek/swell-gedackt-8', name: "Gedackt 8'", division: 'swell', family: 'flute', transpose: 0 },
  { id: 'swell-konzertfloete-8', model: 'organ/szczecinek/swell-konzertfloete-8', name: "Konzertfloete 8'", division: 'swell', family: 'flute', transpose: 0 },
  { id: 'swell-gemshorn-8', model: 'organ/szczecinek/swell-gemshorn-8', name: "Gemshorn 8'", division: 'swell', family: 'principal', transpose: 0 },
  { id: 'swell-schalmey-8', model: 'organ/szczecinek/swell-schalmey-8', name: "Schalmeÿ 8'", division: 'swell', family: 'reed', transpose: 0 },
  { id: 'swell-aeoline-8', model: 'organ/szczecinek/swell-aeoline-8', name: "Aeoline 8'", division: 'swell', family: 'string', transpose: 0 },
  { id: 'swell-vox-coelestis-8', model: 'organ/szczecinek/swell-vox-coelestis-8', name: "Vox coelestis 8'", division: 'swell', family: 'string', transpose: 0 },
  { id: 'swell-fugara-4', model: 'organ/szczecinek/swell-fugara-4', name: "Fugara 4'", division: 'swell', family: 'string', transpose: 12 },
  { id: 'swell-traversfloete-4', model: 'organ/szczecinek/swell-traversfloete-4', name: "Traversfloete 4'", division: 'swell', family: 'flute', transpose: 12 },
  { id: 'swell-progressio-2-4-fach', model: 'organ/szczecinek/swell-progressio-2-4-fach', name: "Progressio 2-4 fach", division: 'swell', family: 'mixture', transpose: 0 },

  { id: 'pedal-principalbass-16', model: 'organ/szczecinek/pedal-principalbass-16', name: "Principalbass 16'", division: 'pedal', family: 'principal', transpose: -12 },
  { id: 'pedal-violon-16', model: 'organ/szczecinek/pedal-violon-16', name: "Violon 16'", division: 'pedal', family: 'string', transpose: -12 },
  { id: 'pedal-subbass-16', model: 'organ/szczecinek/pedal-subbass-16', name: "Subbass 16'", division: 'pedal', family: 'flute', transpose: -12 },
  { id: 'pedal-echobass-16', model: 'organ/szczecinek/pedal-echobass-16', name: "Echobass 16'", division: 'pedal', family: 'flute', transpose: -12 },
  { id: 'pedal-quintbass-10-2-3', model: 'organ/szczecinek/pedal-quintbass-10-2-3', name: "Quintbass 10 2/3'", division: 'pedal', family: 'mutation', transpose: -5 },
  { id: 'pedal-octavbass-8', model: 'organ/szczecinek/pedal-octavbass-8', name: "Octavbass 8'", division: 'pedal', family: 'principal', transpose: 0 },
  { id: 'pedal-violoncello-8', model: 'organ/szczecinek/pedal-violoncello-8', name: "Violoncello 8'", division: 'pedal', family: 'string', transpose: 0 },
  { id: 'pedal-bassflote-8', model: 'organ/szczecinek/pedal-bassflote-8', name: "Bassflöte 8'", division: 'pedal', family: 'flute', transpose: 0 },
  { id: 'pedal-octave-4', model: 'organ/szczecinek/pedal-octave-4', name: "Octave 4'", division: 'pedal', family: 'principal', transpose: 12 },
  { id: 'pedal-posaune-16', model: 'organ/szczecinek/pedal-posaune-16', name: "Posaune 16'", division: 'pedal', family: 'reed', transpose: -12 },
];

const PRESETS: Record<string, OrganPreset> = {
  principal: {
    description: "Principal 8' alone",
    great: ["Principal 8'"],
    pedal: ["Subbass 16'", "Octavbass 8'"],
  },
  foundations: {
    description: "The 8' stops of both manuals coupled — Voelkner's Romantic fonds",
    great: ["Principal 8'", "Gambe 8'", "Röhrflöte 8'", "Flûte harmonique 8'"],
    swell: ["Geigenprincipal 8'", "Gedackt 8'", "Konzertfloete 8'"],
    pedal: ["Subbass 16'", "Violon 16'", "Octavbass 8'", "Violoncello 8'"],
    couple: { great: ['swell'] },
  },
  'principal-chorus': {
    description: "Principals 16' 8' 4' with the Rauschquinte",
    great: ["Principal 16'", "Principal 8'", "Octave 4'", "Rauschquinte 2 2/3' u. 2'"],
    pedal: ["Principalbass 16'", "Subbass 16'", "Octavbass 8'", "Octave 4'"],
    couple: { pedal: ['great'] },
  },
  plenum: {
    description: 'Plenum: principals, Rauschquinte and Mixtur with the swell coupled',
    great: ["Principal 16'", "Bordun 16'", "Principal 8'", "Röhrflöte 8'", "Octave 4'", "Rauschquinte 2 2/3' u. 2'", 'Mixtur 5 fach'],
    swell: ["Geigenprincipal 8'", "Gedackt 8'", "Fugara 4'", 'Progressio 2-4 fach'],
    pedal: ["Principalbass 16'", "Subbass 16'", "Quintbass 10 2/3'", "Octavbass 8'", "Octave 4'"],
    couple: { great: ['swell'], pedal: ['great'] },
  },
  full: {
    description: 'Full organ with Cornett, Trompete, Schalmey and Posaune',
    great: ["Principal 16'", "Bordun 16'", "Principal 8'", "Gambe 8'", "Röhrflöte 8'", "Flûte harmonique 8'", "Octave 4'", "Hohlflöte 4'",
      "Piccolo 2'", "Rauschquinte 2 2/3' u. 2'", 'Cornett 2-4 fach', 'Mixtur 5 fach', "Trompete 8'"],
    swell: ["Lieblich Gedackt 16'", "Geigenprincipal 8'", "Gedackt 8'", "Konzertfloete 8'", "Gemshorn 8'", "Schalmeÿ 8'", "Fugara 4'",
      "Traversfloete 4'", 'Progressio 2-4 fach'],
    pedal: ["Principalbass 16'", "Violon 16'", "Subbass 16'", "Quintbass 10 2/3'", "Octavbass 8'", "Violoncello 8'", "Bassflöte 8'",
      "Octave 4'", "Posaune 16'"],
    couple: { great: ['swell'], pedal: ['great', 'swell'] },
  },
  'full-16': {
    description: "Full organ with the swell also coupled an octave down (II 16'/I) — Voelkner's romantic gravity",
    great: ["Principal 16'", "Bordun 16'", "Principal 8'", "Gambe 8'", "Röhrflöte 8'", "Flûte harmonique 8'", "Octave 4'", "Hohlflöte 4'",
      "Piccolo 2'", "Rauschquinte 2 2/3' u. 2'", 'Cornett 2-4 fach', 'Mixtur 5 fach', "Trompete 8'"],
    swell: ["Lieblich Gedackt 16'", "Geigenprincipal 8'", "Gedackt 8'", "Konzertfloete 8'", "Gemshorn 8'", "Schalmeÿ 8'", "Fugara 4'",
      "Traversfloete 4'", 'Progressio 2-4 fach'],
    pedal: ["Principalbass 16'", "Violon 16'", "Subbass 16'", "Quintbass 10 2/3'", "Octavbass 8'", "Violoncello 8'", "Bassflöte 8'",
      "Octave 4'", "Posaune 16'"],
    couple: { great: ['swell', { division: 'swell', octave: -1 }], pedal: ['great', 'swell'] },
  },
  flutes: {
    description: "Konzertflöte 8' + Traversflöte 4' on the swell",
    swell: ["Konzertfloete 8'", "Traversfloete 4'"],
    pedal: ["Subbass 16'", "Bassflöte 8'"],
  },
  'flute-8': {
    description: "Gedackt 8' — soft stopped flute",
    swell: ["Gedackt 8'"],
    pedal: ["Echobass 16'"],
  },
  'flute-solo': {
    description: "Flûte harmonique 8' solo on the great against the swell's Gedackt and Aeoline",
    great: ["Flûte harmonique 8'"],
    swell: ["Gedackt 8'", "Aeoline 8'"],
    pedal: ["Echobass 16'"],
  },
  celeste: {
    description: "Aeoline + Vox coelestis — the shimmering Romantic strings",
    swell: ["Aeoline 8'", "Vox coelestis 8'"],
    pedal: ["Echobass 16'"],
  },
  strings: {
    description: "Gambe 8' and Salicional 8' on the great with Violon and Violoncello",
    great: ["Gambe 8'", "Salicional 8'"],
    pedal: ["Violon 16'", "Violoncello 8'"],
  },
  quiet: {
    description: "Lieblich Gedackt 16' with Aeoline 8' — the softest registration",
    swell: ["Lieblich Gedackt 16'", "Aeoline 8'"],
    pedal: ["Echobass 16'"],
  },
  schalmey: {
    description: "Schalmey 8' solo on the swell against the great's Röhrflöte",
    swell: ["Gedackt 8'", "Schalmeÿ 8'"],
    great: ["Röhrflöte 8'"],
    pedal: ["Subbass 16'", "Bassflöte 8'"],
  },
  trumpet: {
    description: "Trompete 8' with Principal 8' — festive solo",
    great: ["Principal 8'", "Trompete 8'"],
    swell: ["Geigenprincipal 8'", "Gedackt 8'"],
    pedal: ["Subbass 16'", "Octavbass 8'", "Posaune 16'"],
  },
};

/** Szczecinek (P. B. Voelkner, 1908, Poland): a late-Romantic organ, 35 stops on two manuals
 *  (the second in a swell box) and pedal, from Piotr Grabowski's free sample set. */
export const SZCZECINEK_ORGAN: OrganDefinition = {
  id: 'szczecinek',
  name: 'Szczecinek',
  description: 'P. B. Voelkner (Bromberg) 1908, Szczecinek (Poland): a late-Romantic organ, 35 stops on two manuals (the second enclosed) and pedal.',
  stops: STOPS,
  presets: PRESETS,
  defaultPreset: 'foundations',
  divisions: { great: { pan: 0 }, swell: { pan: 0.15, swellBox: { closed: -4.4 } }, positive: { pan: -0.15 }, pedal: { pan: 0 } },
  tremulant: { division: 'swell', name: 'Tremulant 2 Man', depth: 0.83, pitch: 6, rate: 5 },
  wind: 0,
};
