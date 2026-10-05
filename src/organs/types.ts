import type { ReverbPreset } from '../parameters.js';

/** The keyboards of a church organ: three manuals and the pedalboard. */
export type DivisionName = 'great' | 'swell' | 'positive' | 'pedal';

/** Tonal family of a stop. */
export type StopFamily = 'principal' | 'flute' | 'string' | 'reed' | 'mutation' | 'mixture';

/** One stop (rank of pipes) of an organ. */
export interface StopDefinition {
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
  /** Keys (MIDI notes) the stop has pipes for, e.g. a treble-only Cornet `[60, 96]`; other
   *  keys are silent. @default every key */
  keys?: [low: number, high: number];
  /** Notes of this stop's drawing and retiring noises in the organ's action-noise model
   *  ({@link OrganNoises.stops}). */
  actionNoise?: [on: number, off: number];
  /** Model of the stop with its division's Forte on (a harmonium's forte mute open): the
   *  division's {@link DivisionSettings.forte} switch plays it instead of {@link model}. */
  forte?: string;
}

/**
 * A coupler, named by the keyboard it couples in: `'swell'` (unison, "Swell to Great 8'"),
 * or `{ division: 'swell', octave: 1 }` ("Swell to Great 4'": an octave up) and `octave: -1`
 * ("16'": an octave down). A division coupled to itself an octave away is a super or sub
 * octave coupler ("Swell Octave").
 */
export type CouplerLike = DivisionName | { division: DivisionName; octave?: -1 | 0 | 1 };

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
   *  "Great to Pedal", `{ swell: [{ division: 'swell', octave: 1 }] }` the swell's super
   *  octave (see {@link CouplerLike}). */
  couple?: Partial<Record<DivisionName, CouplerLike[]>>;
  /** Keyboards whose unison is off: their keys play only what is coupled to them (an octave
   *  coupler alone sounds the stops an octave away). */
  unisonOff?: DivisionName[];
  /** Tremulants on, by a division they shake; left out, the tremulants stay as they are. */
  tremulant?: DivisionName[];
  /** Divisions with their Forte on (harmoniums: see {@link StopDefinition.forte}). */
  forte?: DivisionName[];
}

/** Placement and mechanics of one division. */
export interface DivisionDefinition {
  /** Position of the division's pipes in the stereo image, -1 (left) … 1 (right). @default 0 */
  pan?: number;
  /** The division stands in a swell box: its expression pedal moves shutters (treble damped
   *  more than bass; the closed box is quieter, never silent). `true` is a box of usual
   *  thickness; an object sets how much it closes. @default false */
  swellBox?: boolean | SwellBoxDefinition;
}

/** How much a closed swell box takes away. */
export interface SwellBoxDefinition {
  /** Level with the shutters closed (dB, broadband). @default -9 */
  closed?: number;
  /** Extra treble damping above about 700 Hz with the shutters closed (dB): a box that
   *  closes less damps the treble less. @default 14/9 of {@link closed} (−14 dB for −9 dB) */
  shelf?: number;
}

/** A tremulant: a periodic wobble of the wind pressure of one division (or several on the
 *  same wind). */
export interface TremulantDefinition {
  /** Division (or divisions) whose wind the tremulant shakes. */
  division: DivisionName | DivisionName[];
  /** Name on the stop knob, e.g. "Tremulant HW". */
  name?: string;
  /** Loudness swing (± dB). */
  depth: number;
  /** Pitch swing (± cents). */
  pitch: number;
  /** Rate (Hz). */
  rate: number;
  /** Notes of its switching-on and -off noises in the organ's action-noise model. */
  actionNoise?: [on: number, off: number];
}

/**
 * A complete organ as configuration: its stops, named presets, the layout of its
 * divisions and its wind. Pass one to `synth.add()` to play it; the built-in
 * organs ({@link BUREA_ORGAN}, {@link VCSL_ORGAN}) are plain `OrganDefinition`s that can be copied and
 * changed:
 *
 * ```ts
 * import { BUREA_ORGAN, type OrganDefinition } from 'supersynth/organs';
 * const mine: OrganDefinition = {
 *   ...BUREA_ORGAN,
 *   presets: { ...BUREA_ORGAN.presets, bright: { description: 'Flutes 8 + 2', great: ["Gedackt 8'", "Octave 2'"] } },
 * };
 * synth.add(mine, { preset: 'bright' });
 * ```
 *
 * To add presets without a new definition, pass them to the organ instead:
 *
 * ```ts
 * synth.add('burea', { presets: { bright: { great: ["Gedackt 8'", "Octave 2'"] } }, preset: 'bright' });
 * ```
 */
export interface OrganDefinition {
  /** Short id, e.g. `'burea'`. */
  id: string;
  /** Display name. */
  name: string;
  description: string;
  stops: StopDefinition[];
  presets: Record<string, OrganPreset>;
  /** Preset applied when the organ is created without one. */
  defaultPreset: string;
  /** Per-division placement and mechanics. @default {@link CHURCH_DIVISIONS} */
  divisions?: Partial<Record<DivisionName, DivisionDefinition>>;
  /** The tremulant, or one per division that has its own, if the organ has any.
   *  @default {@link SWELL_TREMULANT} */
  tremulant?: TremulantDefinition | TremulantDefinition[];
  /** Wind flexibility, 0 (steady) – 1 (flexible historic winding). @default 0.5 */
  wind?: number;
  /** Longest delay (ms) between a key going down and a pipe speaking, different for every
   *  pipe and every note. Pipes of different ranks never start in the same instant; started
   *  together, unison stops would sum louder and brighter than they do. @default 10 */
  speech?: number;
  /** Action, blower and room noises recorded with the organ. */
  noises?: OrganNoises;
  /** Room the synth uses for the organ when its reverb is automatic. @default 'church' */
  reverb?: ReverbPreset;
  /** Send of every division into the artificial reverb. Pipes recorded in their church carry
   *  its acoustic (and key-up plays each pipe's recorded release), so the reverb only adds
   *  width. @default 0.07 */
  reverbSend?: number;
}

/**
 * The sounds of the organ's machinery, recorded with its pipes: models of the key action
 * (one per keyboard, a zone per key), the stop action and the blower and room. Off by default;
 * `synth.add(organ, { noises: true })` or `organ.set({ noises: true })` turns them on.
 */
export interface OrganNoises {
  /** Key action per keyboard: the key going down and coming up (models with a zone per key). */
  keys?: Partial<Record<DivisionName, { down?: string; up?: string }>>;
  /** Stop action: model whose zones are the stops' drawing and retiring noises (see
   *  {@link StopDefinition.actionNoise}), and those of the couplers and tremulants. */
  stops?: string;
  /** Notes of a coupler being engaged and released, in the stop-action model. */
  coupler?: [on: number, off: number];
  /** The blower running (a sustained model), its starting and its stopping. */
  blower?: { model: string; note?: number };
  /** The empty church: its background noise while the organ is on. */
  ambient?: { model: string; note?: number };
  /** Level of all the noises (dB). @default 0 */
  gain?: number;
}
