import type { InstrumentDef, LayerDef, PresetDef } from './catalog.js';
import { noteNumber, type NoteLike } from './notes.js';
import { toNativeParam, type InstrumentParams } from './params.js';
import type { Synth } from './Synth.js';

/** Timing options shared by note methods. Times are in seconds on the synth clock. */
export interface TimeOptions {
  /** Absolute time (seconds, `synth.currentTime` clock). */
  at?: number;
  /** Seconds from now. */
  delay?: number;
}

export interface PlayOptions extends TimeOptions {
  /** 1–127. @default 90 */
  velocity?: number;
  /** Seconds the key is held. @default 1 */
  duration?: number;
}

/** Defaults of every parameter (used when switching presets). */
export const PARAM_DEFAULTS: Required<Omit<InstrumentParams, 'leslie' | 'mono' | 'legato'>> & { leslie: 'off'; mono: false; legato: false } = {
  volume: 0, pan: 0, reverbSend: -1, spread: -1, brightness: 0, evenHarmonics: 0, noise: 0, formant: -1,
  inharmonicity: 1, maxPartials: 512, attack: 1, decay: 1, release: 1, vibrato: 0, vibratoRate: 5.5,
  vibratoDelay: 0.3, naturalVibrato: 1, humanize: 0, transpose: 0, tune: 0, bendRange: 2, modDepth: 25,
  velocitySensitivity: 1, mono: false, legato: false, glide: 0.06, tremolo: 0, tremoloPitch: 0, tremoloRate: 6, gain: 0, jitter: 1, shimmer: 1, eqLowGain: 0, eqLowFreq: 200, eqMidGain: 0, eqMidFreq: 1000,
  eqMidQ: 0.7, eqHighGain: 0, eqHighFreq: 5000, lowCut: 0, highCut: 0, chorus: 0, chorusRate: 0.6,
  chorusDepth: 3, drive: 1, driveTone: 6000, driveLevel: 0.8, leslie: 'off',
};

/**
 * One instrument on its own channel of a {@link Synth}: play notes, apply presets
 * and tweak the sound live.
 *
 * ```ts
 * const piano = synth.add('grand-piano', { preset: 'mellow' });
 * piano.play('C4', { velocity: 80, duration: 2 });
 * piano.play(['E4', 'G4'], { delay: 0.5 });
 * piano.set({ brightness: 1 });
 * ```
 */
export class Part {
  /** Parameters currently applied on top of the defaults. */
  private applied: InstrumentParams = {};
  private _preset = 'default';
  private layers: LayerDef[] = [];

  /** @internal */
  constructor(
    readonly synth: Synth,
    /** Engine channel (MIDI channel = index + 1 when MIDI routing is on). */
    readonly index: number,
    /** The instrument definition this part plays. */
    readonly instrument: InstrumentDef,
  ) {}

  /** Name of the active preset. */
  get preset(): string {
    return this._preset;
  }

  /** Names of the presets available for this instrument. */
  get presets(): string[] {
    return Object.keys(this.instrument.presets);
  }

  /** Current parameter values that differ from the defaults. */
  get params(): Readonly<InstrumentParams> {
    return { ...this.applied };
  }

  // ── notes ─────────────────────────────────────────────────────────────────

  /** Press a key. */
  noteOn(note: NoteLike, velocity = 90, options: TimeOptions = {}): this {
    this.synth._native().noteOn(this.index, noteNumber(note), clampVel(velocity), this.time(options));
    return this;
  }

  /** Release a key. */
  noteOff(note: NoteLike, options: TimeOptions = {}): this {
    this.synth._native().noteOff(this.index, noteNumber(note), this.time(options));
    return this;
  }

  /**
   * Play one note or several together for a duration.
   *
   * @example part.play('C4') — part.play(['C4','E4','G4'], { duration: 2, velocity: 70 })
   */
  play(notes: NoteLike | NoteLike[], options: PlayOptions = {}): this {
    const list = Array.isArray(notes) ? notes : [notes];
    const vel = clampVel(options.velocity ?? 90);
    const dur = Math.max(0, options.duration ?? 1);
    const t = this.time(options);
    const start = t ?? this.synth.currentTime;
    const n = this.synth._native();
    for (const note of list) {
      const m = noteNumber(note);
      n.noteOn(this.index, m, vel, t);
      n.noteOff(this.index, m, start + dur);
    }
    return this;
  }

  /**
   * Play a sequence of notes, one after another.
   * Each step is `[note(s), beats]` or `{ note, beats, velocity }`; `null` notes are rests.
   *
   * @example part.sequence([['C4', 1], ['E4', 1], [['G4','C5'], 2]], { bpm: 96 })
   */
  sequence(
    steps: Array<[NoteLike | NoteLike[] | null, number] | { note: NoteLike | NoteLike[] | null; beats: number; velocity?: number }>,
    options: TimeOptions & { bpm?: number; velocity?: number; legato?: number } = {},
  ): number {
    const beat = 60 / (options.bpm ?? 120);
    const legato = options.legato ?? 0.95;
    let t = this.time(options) ?? this.synth.currentTime;
    const start = t;
    for (const s of steps) {
      const [note, beats, vel] = Array.isArray(s) ? [s[0], s[1], undefined] : [s.note, s.beats, s.velocity];
      if (note !== null) {
        this.play(note, { at: t, duration: beats * beat * legato, velocity: vel ?? options.velocity ?? 90 });
      }
      t += beats * beat;
    }
    return t - start;
  }

  /** Sustain (damper) pedal. */
  sustain(down: boolean, options: TimeOptions = {}): this {
    return this.cc(64, down ? 127 : 0, options);
  }

  /** Pitch bend in -1 … 1 (scaled by `bendRange`). */
  pitchBend(value: number, options: TimeOptions = {}): this {
    this.synth._native().pitchBend(this.index, Math.max(-1, Math.min(1, value)), this.time(options));
    return this;
  }

  /** Modulation wheel 0–1 (adds vibrato of `modDepth` cents). */
  modWheel(value: number, options: TimeOptions = {}): this {
    return this.cc(1, Math.round(Math.max(0, Math.min(1, value)) * 127), options);
  }

  /** Expression / swell 0–1 (CC 11): smooth crescendo and diminuendo for held notes. */
  expression(value: number, options: TimeOptions = {}): this {
    return this.cc(11, Math.round(Math.max(0, Math.min(1, value)) * 127), options);
  }

  /** Send a MIDI control change to this part. */
  cc(controller: number, value: number, options: TimeOptions = {}): this {
    this.synth._native().controlChange(this.index, controller, Math.max(0, Math.min(127, Math.round(value))), this.time(options));
    return this;
  }

  /** Release all held notes of this part. */
  allNotesOff(options: TimeOptions = {}): this {
    this.synth._native().allNotesOff(this.index, this.time(options));
    return this;
  }

  // ── sound ─────────────────────────────────────────────────────────────────

  /**
   * Change parameters (see {@link InstrumentParams}). Values are absolute, so
   * `set({ brightness: 1 })` twice is the same as once.
   */
  set(params: InstrumentParams, options: TimeOptions = {}): this {
    const n = this.synth._native();
    const t = this.time(options);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      const key = k as keyof InstrumentParams;
      if (!(key in PARAM_DEFAULTS)) throw new RangeError(`Unknown parameter '${k}'`);
      n.setParam(this.index, key, toNativeParam(key, v), t);
      (this.applied as Record<string, unknown>)[key] = v;
    }
    return this;
  }

  /** Get a parameter's current value. */
  get<K extends keyof InstrumentParams>(name: K): InstrumentParams[K] {
    return (this.applied[name] ?? PARAM_DEFAULTS[name]) as InstrumentParams[K];
  }

  /** Reset all parameters to the instrument's defaults (as recorded). */
  reset(): this {
    const reset: Record<string, unknown> = {};
    for (const k of Object.keys(this.applied)) reset[k] = (PARAM_DEFAULTS as Record<string, unknown>)[k];
    this.applied = {};
    this.set(reset as InstrumentParams);
    this.applied = {};
    if (this.synth._maxPartials < 512) {
      this.synth._native().setParam(this.index, 'maxPartials', this.synth._maxPartials);
    }
    return this;
  }

  /** Switch to a named preset (see {@link presets}). */
  usePreset(name: string, extra: InstrumentParams = {}): this {
    const p: PresetDef | undefined = this.instrument.presets[name];
    if (!p) throw new RangeError(`Unknown preset '${name}' for ${this.instrument.id}. Presets: ${this.presets.join(', ')}`);
    const layers = p.layers ?? this.instrument.layers;
    if (!sameLayers(layers, this.layers)) {
      this.synth._setLayers(this.index, layers);
      this.layers = layers;
    }
    this.reset();
    this.set({ ...this.instrument.params, ...p.params, ...extra });
    this._preset = name;
    return this;
  }

  private time(o: TimeOptions): number | undefined {
    if (o.at !== undefined) return o.at;
    if (o.delay !== undefined) return this.synth.currentTime + o.delay;
    return undefined;
  }
}

function clampVel(v: number): number {
  return Math.max(1, Math.min(127, Math.round(v)));
}

function sameLayers(a: LayerDef[], b: LayerDef[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
