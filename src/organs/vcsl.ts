import { CHURCH_DIVISIONS, SWELL_TREMULANT } from './defaults.js';
import type { OrganDef, OrganPreset, StopDef } from './types.js';

/**
 * The VCSL church organ (Simon Dalzell / Ivy Audio, via the Versilian Community Sample
 * Library, CC0): a church instrument recorded in stereo with its room — a full chorus and a
 * flute stop on the manual, loud and soft pedal — with a Renaissance chamber organ
 * (separate 8' and 4' ranks) as the positive.
 */
const STOPS: StopDef[] = [
  { id: 'full', model: 'pipe-organ', name: 'Full Organ', division: 'great', family: 'mixture', transpose: 0, gain: 0 },
  { id: 'flutes', model: 'pipe-organ-soft', name: 'Flutes', division: 'great', family: 'flute', transpose: 0, gain: -7.8 },
  { id: 'swell-full', model: 'pipe-organ', name: 'Full Organ', division: 'swell', family: 'mixture', transpose: 0, gain: 0 },
  { id: 'swell-flutes', model: 'pipe-organ-soft', name: 'Flutes', division: 'swell', family: 'flute', transpose: 0, gain: -7.8 },
  { id: 'chamber-8', model: 'renaissance-organ-8', name: "Gedackt 8'", division: 'positive', family: 'flute', transpose: 0, gain: -15.4 },
  { id: 'chamber-4', model: 'renaissance-organ-4', name: "Principal 4'", division: 'positive', family: 'principal', transpose: 0, gain: -14.5 },
  { id: 'chamber-full', model: 'renaissance-organ-full', name: 'Chorus', division: 'positive', family: 'mixture', transpose: 0, gain: -8.7 },
  { id: 'pedal-loud', model: 'pipe-organ-pedal', name: "Pedal 16' + 8'", division: 'pedal', family: 'principal', transpose: 0, gain: 0 },
  { id: 'pedal-soft', model: 'pipe-organ-pedal-soft', name: "Soft Bass 16'", division: 'pedal', family: 'flute', transpose: 0, gain: -12.8 },
];

const PRESETS: Record<string, OrganPreset> = {
  full: {
    description: 'Full organ: the full chorus with loud pedal',
    great: ['Full Organ'],
    pedal: ["Pedal 16' + 8'"],
  },
  flutes: {
    description: 'Soft flutes with soft pedal — gentle, for chorale preludes',
    great: ['Flutes'],
    pedal: ["Soft Bass 16'"],
  },
  chamber: {
    description: "Chamber organ 8' + 4' — bright Renaissance consort sound",
    positive: ["Gedackt 8'", "Principal 4'"],
    pedal: ["Soft Bass 16'"],
  },
  'chamber-8': {
    description: "Chamber organ Gedackt 8' alone",
    positive: ["Gedackt 8'"],
    pedal: ["Soft Bass 16'"],
  },
  dialogue: {
    description: 'Full organ on the great against flutes on the swell (play the two manuals in alternation)',
    great: ['Full Organ'],
    swell: ['Flutes'],
    pedal: ["Pedal 16' + 8'"],
  },
};

/** The VCSL church organ (Simon Dalzell / Ivy Audio, CC0) with a Renaissance chamber organ as
 *  positive. Its stops are recorded registrations rather than single ranks, recorded every
 *  third semitone (the notes between are morphed from their neighbours). */
export const VCSL_ORGAN: OrganDef = {
  id: 'vcsl',
  name: 'VCSL church organ',
  description: 'A church organ recorded in stereo with its room (full chorus, flutes, loud and soft pedal), with a Renaissance chamber organ as positive.',
  stops: STOPS,
  presets: PRESETS,
  defaultPreset: 'full',
  divisions: CHURCH_DIVISIONS,
  tremulant: SWELL_TREMULANT,
};
