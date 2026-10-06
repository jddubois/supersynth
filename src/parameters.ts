import { SupersynthError } from './errors.js';

/**
 * Tweakable instrument parameters. Every parameter can be changed at any time,
 * including while notes are sounding (changes are smoothed).
 *
 * All are relative to the model as analysed: the defaults change nothing. Values outside
 * {@link PARAMETER_RANGES} throw.
 */
export interface InstrumentParameters {
  // ── level & placement ──────────────────────────────────────────────────
  /** Instrument volume in dB. @default 0 */
  volume?: number;
  /** Stereo position, -1 (left) … 1 (right). @default 0 */
  pan?: number;
  /** Reverb send, 0–1. Default: the instrument's recommended amount. */
  reverbSend?: number;
  /** Stereo spread of the partials, 0 (point source) … 1 (wide). Default per instrument. */
  spread?: number;

  // ── timbre ─────────────────────────────────────────────────────────────
  /** Spectral tilt in dB per octave above the fundamental. +2 = brighter, -3 = darker. @default 0 */
  brightness?: number;
  /** Extra gain on even harmonics in dB (−6 hollow/clarinet-like … +6 full). @default 0 */
  evenHarmonics?: number;
  /** Breath/bow/hammer/wind noise level in dB. @default 0 */
  noise?: number;
  /** Formant preservation when playing between recorded notes, 0–1. Default per instrument. */
  formant?: number;
  /** String stiffness (inharmonicity) scale; 0 = perfectly harmonic, 2 = twice as stretched. @default 1 */
  inharmonicity?: number;
  /** Maximum number of partials per note (lower = cheaper, darker; see also `SynthOptions.quality`). @default 512 */
  maxPartials?: number;
  /** Sympathetic string resonance, 0–4 (pianos and harpsichords): the strings whose dampers
   *  are off (keys held, sustain pedal down) ring along with what is played. 0 = off.
   *  Default per instrument (1 where the instrument has dampers). */
  resonance?: number;

  // ── envelope ───────────────────────────────────────────────────────────
  /** Attack time scale: 2 = twice as slow to speak, 0.5 = snappier. @default 1 */
  attack?: number;
  /** Decay/sustain-evolution time scale for decaying instruments (piano, harp, mallets). @default 1 */
  decay?: number;
  /** Release time scale after note-off. @default 1 */
  release?: number;

  // ── pitch & expression ─────────────────────────────────────────────────
  /** Added vibrato depth in cents. @default 0 */
  vibrato?: number;
  /** Vibrato rate in Hz. @default 5.5 */
  vibratoRate?: number;
  /** Seconds before added vibrato fades in. @default 0.3 */
  vibratoDelay?: number;
  /** How much of the recorded pitch movement (natural vibrato, glides) to keep, 0–2. @default 1 */
  naturalVibrato?: number;
  /** Random per-note detune in ± cents (ensemble/human feel). @default 0 */
  humanize?: number;
  /** Transpose in semitones. @default 0 */
  transpose?: number;
  /** Fine tuning in cents. @default 0 */
  tune?: number;
  /** Pitch-bend range in semitones. @default 2 */
  bendRange?: number;
  /** Mod-wheel vibrato depth in cents. @default 25 */
  modDepth?: number;
  /** Velocity sensitivity 0–1 (0 = every note plays at full dynamic). @default 1 */
  velocitySensitivity?: number;
  /** Monophonic (each new note releases the previous). @default false */
  mono?: boolean;
  /** Legato: overlapping notes glide into each other without a new attack (implies mono),
   *  like a slur on a wind or bowed instrument. @default false */
  legato?: boolean;
  /** Legato glide time constant in seconds. @default 0.06 */
  glide?: number;
  /** Synchronous amplitude tremolo depth in dB (organ tremulant, vibraphone motor). @default 0 */
  tremolo?: number;
  /** Synchronous pitch wobble of the tremolo, cents. @default 0 */
  tremoloPitch?: number;
  /** Tremolo rate, Hz. @default 6 */
  tremoloRate?: number;
  /** Overall gain of the voices in dB (before the part volume). @default 0 */
  gain?: number;
  /** Independent micro-fluctuation of each partial, as analysed (0 = all partials in lockstep, 2 = double). @default 1 */
  jitter?: number;
  /** Fast amplitude/phase fluctuation of each partial around its line, as analysed — bow noise and
   *  vibrato through the room spread energy around every harmonic (0 = clean lines). @default 1 */
  shimmer?: number;

  // ── effects ────────────────────────────────────────────────────────────
  eqLowGain?: number;
  eqLowFreq?: number;
  eqMidGain?: number;
  eqMidFreq?: number;
  eqMidQ?: number;
  eqHighGain?: number;
  eqHighFreq?: number;
  /** High-pass cutoff in Hz (0 = off). */
  lowCut?: number;
  /** Low-pass cutoff in Hz (0 = off). */
  highCut?: number;
  /** Chorus/ensemble mix 0–1 (0 = off). */
  chorus?: number;
  chorusRate?: number;
  chorusDepth?: number;
  /** Tube drive 1–20 (1 = off). */
  drive?: number;
  driveTone?: number;
  driveLevel?: number;
  /** Rotary speaker: 'off' | 'stop' | 'slow' | 'fast'. */
  leslie?: 'off' | 'stop' | 'slow' | 'fast';
}

/** Native parameter value for a public parameter (booleans and enums mapped to numbers). */
export function toNativeParameter(name: keyof InstrumentParameters, value: unknown): number {
  if (name === 'mono' || name === 'legato') return value ? 1 : 0;
  if (name === 'leslie') {
    const m: Record<string, number> = { off: 0, stop: 1, slow: 2, fast: 3 };
    const v = m[String(value)];
    if (v === undefined) throw new SupersynthError(`leslie must be off|stop|slow|fast, got ${String(value)}`);
    return v;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SupersynthError(`Parameter '${String(name)}' must be a finite number, got ${String(value)}`);
  }
  return value;
}

/** The range of each numeric parameter (inclusive): a value outside it throws. */
export const PARAMETER_RANGES: Readonly<Record<Exclude<keyof InstrumentParameters, 'mono' | 'legato' | 'leslie'>, readonly [number, number]>> = {
  volume: [-120, 24], pan: [-1, 1], reverbSend: [0, 1], spread: [0, 1],
  brightness: [-24, 24], evenHarmonics: [-60, 24], noise: [-120, 40], formant: [0, 1], inharmonicity: [0, 10], maxPartials: [1, 512],
  resonance: [0, 4],
  attack: [0.05, 20], decay: [0.05, 20], release: [0.01, 20],
  vibrato: [0, 1200], vibratoRate: [0, 40], vibratoDelay: [0, 60], naturalVibrato: [0, 2], humanize: [0, 100],
  transpose: [-96, 96], tune: [-1200, 1200], bendRange: [-48, 48], modDepth: [-1200, 1200], velocitySensitivity: [0, 1],
  glide: [0, 10], tremolo: [0, 24], tremoloPitch: [0, 200], tremoloRate: [0, 40], gain: [-120, 48], jitter: [0, 10], shimmer: [0, 10],
  eqLowGain: [-24, 24], eqLowFreq: [10, 100000], eqMidGain: [-24, 24], eqMidFreq: [10, 100000], eqMidQ: [0.1, 10],
  eqHighGain: [-24, 24], eqHighFreq: [10, 100000], lowCut: [0, 100000], highCut: [0, 100000],
  chorus: [0, 1], chorusRate: [0, 20], chorusDepth: [0, 50], drive: [1, 20], driveTone: [0, 100000], driveLevel: [0, 4],
};

/** @internal Throw unless `value` is a valid value of parameter `name` (known to exist). */
export function checkParameter(name: keyof InstrumentParameters, value: unknown): void {
  if ((name === 'mono' || name === 'legato') && typeof value !== 'boolean') {
    throw new SupersynthError(`Parameter '${name}' must be true or false, got ${String(value)}`);
  }
  const native = toNativeParameter(name, value);
  const range = (PARAMETER_RANGES as Record<string, readonly [number, number] | undefined>)[name];
  if (range && (native < range[0] || native > range[1])) {
    throw new SupersynthError(`Parameter '${name}' must be ${range[0]} … ${range[1]}, got ${native}`);
  }
}

/** Parameters whose default is the instrument's own value. */
type PerInstrument = 'reverbSend' | 'spread' | 'formant' | 'resonance';

/** Default of every parameter: the model unchanged. (`reverbSend`, `spread`, `formant` and
 *  `resonance` default to each instrument's own value, so they are not listed.) */
export const PARAMETER_DEFAULTS: Readonly<Required<Omit<InstrumentParameters, PerInstrument>>> = {
  volume: 0, pan: 0, brightness: 0, evenHarmonics: 0, noise: 0,
  inharmonicity: 1, maxPartials: 512, attack: 1, decay: 1, release: 1, vibrato: 0, vibratoRate: 5.5,
  vibratoDelay: 0.3, naturalVibrato: 1, humanize: 0, transpose: 0, tune: 0, bendRange: 2, modDepth: 25,
  velocitySensitivity: 1, mono: false, legato: false, glide: 0.06, tremolo: 0, tremoloPitch: 0, tremoloRate: 6,
  gain: 0, jitter: 1, shimmer: 1, eqLowGain: 0, eqLowFreq: 200, eqMidGain: 0, eqMidFreq: 1000, eqMidQ: 0.7,
  eqHighGain: 0, eqHighFreq: 5000, lowCut: 0, highCut: 0, chorus: 0, chorusRate: 0.6, chorusDepth: 3,
  drive: 1, driveTone: 6000, driveLevel: 0.8, leslie: 'off',
};

/** @internal Every parameter name. */
export const PARAMETER_NAMES: ReadonlySet<string> = new Set([...Object.keys(PARAMETER_DEFAULTS), 'reverbSend', 'spread', 'formant', 'resonance']);

/** @internal The value that restores a parameter's default (the engine reads -1 as "the
 *  instrument's own value"). */
export function defaultParameter(name: keyof InstrumentParameters): unknown {
  return (PARAMETER_DEFAULTS as InstrumentParameters)[name] ?? -1;
}

/** Reverb presets (algorithmic FDN reverb). */
export type ReverbPreset = 'room' | 'studio' | 'chamber' | 'hall' | 'concert-hall' | 'church' | 'cathedral' | 'plate';

/** @internal Every reverb preset. */
export const REVERB_PRESETS: readonly string[] = ['room', 'studio', 'chamber', 'hall', 'concert-hall', 'church', 'cathedral', 'plate'] satisfies ReverbPreset[];

/** Fine reverb control; any field overrides the preset. */
export interface ReverbOptions {
  preset?: ReverbPreset;
  /** Mid-frequency RT60 in seconds. */
  decay?: number;
  /** Bass decay multiplier (0.5–2). */
  lowDecay?: number;
  /** Treble decay multiplier (0.1–1). */
  highDecay?: number;
  /** Room size 0–1. */
  size?: number;
  /** Pre-delay in ms. */
  predelay?: number;
  diffusion?: number;
  /** Early reflections level 0–1. */
  early?: number;
  /** Stereo width 0–1. */
  width?: number;
  lowCut?: number;
  highCut?: number;
  /** Tail modulation 0–1. */
  modulation?: number;
  /** Reverb return level in dB. @default 0 */
  level?: number;
}

export const REVERB_FIELDS: Record<Exclude<keyof ReverbOptions, 'preset'>, string> = {
  decay: 'reverbDecay',
  lowDecay: 'reverbLowDecay',
  highDecay: 'reverbHighDecay',
  size: 'reverbSize',
  predelay: 'reverbPredelay',
  diffusion: 'reverbDiffusion',
  early: 'reverbEarly',
  width: 'reverbWidth',
  lowCut: 'reverbLowCut',
  highCut: 'reverbHighCut',
  modulation: 'reverbModulation',
  level: 'reverbLevel',
};
