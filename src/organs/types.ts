import type { ReverbPreset } from '../params.js';

/** The keyboards of a church organ: three manuals and the pedalboard. */
export type DivisionName = 'great' | 'swell' | 'positive' | 'pedal';

/** Tonal family of a stop. */
export type StopFamily = 'principal' | 'flute' | 'string' | 'reed' | 'mutation' | 'mixture';

/** One stop (rank of pipes) of an organ. */
export interface StopDef {
  /** Stop id, unique within the organ. The model is `organ/<id>` unless {@link model} is set. */
  id: string;
  /** Model id when it is not `organ/<id>` (file `models/<model>.ssm`). */
  model?: string;
  /** Stop name as engraved on the stop knob, e.g. "Principal 8'". */
  name: string;
  division: DivisionName;
  family: StopFamily;
  /** Semitones between the key pressed and the sounding pitch of the stop's model zones. */
  transpose: number;
  /** Level of the stop (dB) when its recordings were normalised separately. @default 0 */
  gain?: number;
}

/**
 * A preset (an organist's registration): the stops drawn on each division, by name
 * (`"Principal 8'"`) or id, and the couplers. Divisions left out are silent.
 *
 * ```ts
 * const solo: OrganPreset = {
 *   description: 'Trumpet solo on the great, flutes on the swell to accompany',
 *   great: ["Principal 8'", "Trumpet 8'"],
 *   swell: ["Rohrflöte 8'", "Hohlflöte 4'"],
 *   pedal: ["Subbass 16'"],
 *   couple: { pedal: ['swell'] },
 * };
 * ```
 */
export interface OrganPreset {
  description?: string;
  great?: string[];
  swell?: string[];
  positive?: string[];
  pedal?: string[];
  /** Couplers, by the keyboard that is played: `{ great: ['swell'] }` is the "Swell to Great"
   *  coupler (playing the great also sounds the swell's stops), `{ pedal: ['great'] }` is
   *  "Great to Pedal". */
  couple?: Partial<Record<DivisionName, DivisionName[]>>;
}

/** Placement and mechanics of one division. */
export interface DivisionDef {
  /** Position of the division's pipes in the stereo image, -1 (left) … 1 (right). @default 0 */
  pan?: number;
  /** The division stands in a swell box: its expression pedal moves shutters (treble damped
   *  more than bass; the closed box is quieter, never silent). @default false */
  swellBox?: boolean;
}

/** The tremulant: a periodic wobble of one division's wind pressure. */
export interface TremulantDef {
  /** Division whose wind the tremulant shakes. */
  division: DivisionName;
  /** Loudness swing (± dB). */
  depth: number;
  /** Pitch swing (± cents). */
  pitch: number;
  /** Rate (Hz). */
  rate: number;
}

/**
 * A complete organ as configuration: its stops, named presets, the layout of its
 * divisions and its wind. Pass one to `synth.addOrgan()` to play it; the built-in
 * organs ({@link BUREA_ORGAN}, {@link VCSL_ORGAN}) are plain `OrganDef`s that can be copied and
 * changed:
 *
 * ```ts
 * import { BUREA_ORGAN, type OrganDef } from 'supersynth/organs';
 * const mine: OrganDef = {
 *   ...BUREA_ORGAN,
 *   presets: { ...BUREA_ORGAN.presets, bright: { description: 'Flutes 8 + 2', great: ["Gedackt 8'", "Octave 2'"] } },
 * };
 * synth.addOrgan(mine, { preset: 'bright' });
 * ```
 *
 * To add presets without a new definition, pass them to the organ instead:
 *
 * ```ts
 * synth.addOrgan('burea', { presets: { bright: { great: ["Gedackt 8'", "Octave 2'"] } }, preset: 'bright' });
 * ```
 */
export interface OrganDef {
  /** Short id, e.g. `'burea'`. */
  id: string;
  /** Display name. */
  name: string;
  description: string;
  stops: StopDef[];
  presets: Record<string, OrganPreset>;
  /** Preset applied when the organ is created without one. */
  defaultPreset: string;
  /** Per-division placement and mechanics. @default {@link CHURCH_DIVISIONS} */
  divisions?: Partial<Record<DivisionName, DivisionDef>>;
  /** The tremulant, if the organ has one. @default {@link SWELL_TREMULANT} */
  tremulant?: TremulantDef;
  /** Wind flexibility, 0 (steady) – 1 (flexible historic winding). @default 0.5 */
  wind?: number;
  /** Room the synth uses for the organ when its reverb is automatic. @default 'church' */
  reverb?: ReverbPreset;
  /** Send of every division into the artificial reverb. Pipes recorded in their church carry
   *  its acoustic (and key-up plays each pipe's recorded release), so the reverb only adds
   *  width. @default 0.07 */
  reverbSend?: number;
}
