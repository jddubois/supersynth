import type { OrganDefinition, OrganPreset, StopDefinition } from '../types.js';

// Every reed analysed from Piotr Grabowski's free sample set; models/organ/harmonium/<id>.ssm.
// A harmonium's registers are divided between bass (to b) and treble (from c'): Diapason |
// Melodia, Viola | Flöte, Dulcet | Flöte; each has a Forte (forte mute open) recorded on its
// own. The whole instrument speaks through its expression box.
const STOPS: StopDefinition[] = [
  { id: 'great-diapason-8', model: 'organ/harmonium/great-diapason-8', name: "Diapason 8'", division: 'great', family: 'reed', transpose: 0 },
  { id: 'great-melodia-8', model: 'organ/harmonium/great-melodia-8', name: "Melodia 8'", division: 'great', family: 'reed', transpose: 0 },
  { id: 'great-diapason-8-forte', model: 'organ/harmonium/great-diapason-8-forte', name: "Diapason 8' Forte", division: 'great', family: 'reed', transpose: 0 },
  { id: 'great-melodia-8-forte', model: 'organ/harmonium/great-melodia-8-forte', name: "Melodia 8' Forte", division: 'great', family: 'reed', transpose: 0 },
  { id: 'great-viola-4', model: 'organ/harmonium/great-viola-4', name: "Viola 4'", division: 'great', family: 'reed', transpose: 12 },
  { id: 'great-flote-4', model: 'organ/harmonium/great-flote-4', name: "Flöte 4'", division: 'great', family: 'reed', transpose: 12 },
  { id: 'great-viola-4-forte', model: 'organ/harmonium/great-viola-4-forte', name: "Viola 4' Forte", division: 'great', family: 'reed', transpose: 12 },
  { id: 'great-flote-4-forte', model: 'organ/harmonium/great-flote-4-forte', name: "Flöte 4' Forte", division: 'great', family: 'reed', transpose: 12 },

  { id: 'swell-dulcet-8', model: 'organ/harmonium/swell-dulcet-8', name: "Dulcet 8'", division: 'swell', family: 'reed', transpose: 0 },
  { id: 'swell-flote-8', model: 'organ/harmonium/swell-flote-8', name: "Flöte 8'", division: 'swell', family: 'reed', transpose: 0 },
  { id: 'swell-dulcet-8-forte', model: 'organ/harmonium/swell-dulcet-8-forte', name: "Dulcet 8' Forte", division: 'swell', family: 'reed', transpose: 0 },
  { id: 'swell-flote-8-forte', model: 'organ/harmonium/swell-flote-8-forte', name: "Flöte 8' Forte", division: 'swell', family: 'reed', transpose: 0 },
  { id: 'swell-vox-jubilante-8', model: 'organ/harmonium/swell-vox-jubilante-8', name: "Vox Jubilante 8'", division: 'swell', family: 'reed', transpose: 0 },
  { id: 'swell-vox-jubilante-8-forte', model: 'organ/harmonium/swell-vox-jubilante-8-forte', name: "Vox Jubilante 8' Forte", division: 'swell', family: 'reed', transpose: 0 },

  { id: 'pedal-diapason-16', model: 'organ/harmonium/pedal-diapason-16', name: "Diapason 16'", division: 'pedal', family: 'reed', transpose: -12 },
  { id: 'pedal-diapason-16-forte', model: 'organ/harmonium/pedal-diapason-16-forte', name: "Diapason 16' Forte", division: 'pedal', family: 'reed', transpose: -12 },
];

const PRESETS: Record<string, OrganPreset> = {
  diapason: {
    description: "Diapason + Melodia 8' — the full 8' voice of manual I",
    great: ["Diapason 8'", "Melodia 8'"],
    pedal: ["Diapason 16'"],
  },
  soft: {
    description: "Dulcet + Flöte 8' — the soft 8' of manual II",
    swell: ["Dulcet 8'", "Flöte 8'"],
    pedal: ["Diapason 16'"],
  },
  celeste: {
    description: "Flöte 8' with Vox Jubilante — the beating treble celeste",
    swell: ["Dulcet 8'", "Flöte 8'", "Vox Jubilante 8'"],
    pedal: ["Diapason 16'"],
  },
  '8-4': {
    description: "Manual I at 8' and 4'",
    great: ["Diapason 8'", "Melodia 8'", "Viola 4'", "Flöte 4'"],
    pedal: ["Diapason 16'"],
  },
  solo: {
    description: "Melodia 8' Forte melody (treble) against the soft manual II",
    great: ["Melodia 8' Forte"],
    swell: ["Dulcet 8'", "Flöte 8'"],
    pedal: ["Diapason 16'"],
  },
  full: {
    description: 'Every register, manual II coupled',
    great: ["Diapason 8'", "Melodia 8'", "Viola 4'", "Flöte 4'"],
    swell: ["Dulcet 8'", "Flöte 8'", "Vox Jubilante 8'"],
    pedal: ["Diapason 16'"],
    couple: { great: ['swell'], pedal: ['great'] },
  },
  forte: {
    description: 'Every register with the forte mutes open',
    great: ["Diapason 8' Forte", "Melodia 8' Forte", "Viola 4' Forte", "Flöte 4' Forte"],
    swell: ["Dulcet 8' Forte", "Flöte 8' Forte", "Vox Jubilante 8' Forte"],
    pedal: ["Diapason 16' Forte"],
    couple: { great: ['swell'], pedal: ['great'] },
  },
};

/** Harmonium Emil Müller (about 1920, Diocesan Music School, Gliwice, Poland): a two-manual
 *  harmonium with pedal, from Piotr Grabowski's free sample set. */
export const HARMONIUM_ORGAN: OrganDefinition = {
  id: 'harmonium',
  name: 'Harmonium Emil Müller',
  description: 'Emil Müller, about 1920, Diocesan Music School, Gliwice (Poland): a two-manual harmonium with pedal; 5 registers, divided into bass and treble, each also with its forte.',
  stops: STOPS,
  presets: PRESETS,
  defaultPreset: 'diapason',
  divisions: { great: { pan: 0, swellBox: true }, swell: { pan: 0, swellBox: true }, positive: { pan: 0 }, pedal: { pan: 0, swellBox: true } },
  tremulant: { division: 'swell', depth: 1.5, pitch: 5, rate: 4.3 },
  reverb: 'room',
};
