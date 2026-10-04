import { INSTRUMENTS, type InstrumentDefinition, type InstrumentId, type LayerDefinition, type InstrumentPreset } from './catalog/index.js';
import { SupersynthError } from './errors.js';
import { noteNumber, type NoteLike } from './notes.js';
import { defaultParameter, PARAMETER_DEFAULTS, PARAMETER_NAMES, toNativeParameter, type InstrumentParameters } from './parameters.js';
import { playNotes, playSequence, resolveTime, type Playable, type PlayOptions, type SequenceOptions, type SequenceStep, type TimeOptions } from './scheduling.js';
import type { Synth } from './Synth.js';

export interface InstrumentOptions {
  /** Preset to start with: a name from the instrument's presets, or a preset. @default 'default' */
  preset?: string | InstrumentPreset;
  /** Parameter tweaks on top of the preset. */
  parameters?: InstrumentParameters;
}

/**
 * An instrument playing in a {@link Synth}, on its own channel: play notes, apply presets and
 * change the sound live. Created by {@link Synth.add}.
 *
 * ```ts
 * const piano = synth.add('grand-piano', { preset: 'mellow' });
 * piano.play('C4', { velocity: 80, duration: 2 });
 * piano.play(['E4', 'G4'], { delay: 0.5 });
 * piano.set({ brightness: 1 });
 * ```
 */
export class Instrument implements Playable {
  /** The definition this instrument plays (`range`, `presets`, …). */
  readonly definition: InstrumentDefinition;
  /** @internal Engine channel (0–31). */
  readonly channel: number;
  /** Parameters currently applied on top of the defaults. */
  private applied: InstrumentParameters = {};
  private active: string | undefined;
  private layers: LayerDefinition[] = [];
  private saved: Record<string, InstrumentPreset> = {};

  /** @internal Use {@link Synth.add}. */
  constructor(
    /** The synth it plays in. */
    readonly synth: Synth,
    instrument: InstrumentId | InstrumentDefinition,
    options: InstrumentOptions = {},
  ) {
    const def = typeof instrument === 'string' ? (INSTRUMENTS as Record<string, InstrumentDefinition>)[instrument] : instrument;
    if (!def) {
      throw new SupersynthError(`Unknown instrument '${String(instrument)}'. Instruments: ${Object.keys(INSTRUMENTS).join(', ')}`);
    }
    this.definition = def;
    const preset = options.preset ?? 'default';
    const p = this.lookup(preset); // fail before taking a channel
    this.channel = synth._attach(this);
    synth._suggestRoom(p.reverb ?? def.reverb);
    this.apply(p, typeof preset === 'string' ? preset : undefined, options.parameters ?? {}, undefined);
  }

  // ── notes ─────────────────────────────────────────────────────────────────

  /** Press a key. */
  noteOn(note: NoteLike, velocity = 90, options: TimeOptions = {}): this {
    this.synth._native().noteOn(this.channel, noteNumber(note), clampVel(velocity), this.time(options));
    return this;
  }

  /** Release a key. */
  noteOff(note: NoteLike, options: TimeOptions = {}): this {
    this.synth._native().noteOff(this.channel, noteNumber(note), this.time(options));
    return this;
  }

  /**
   * Play one note or several together for a duration.
   *
   * @example piano.play('C4') — piano.play(['C4','E4','G4'], { duration: 2, velocity: 70 })
   */
  play(notes: NoteLike | NoteLike[], options: PlayOptions = {}): this {
    playNotes(this, this.synth.currentTime, notes, options, clampVel(options.velocity ?? 90));
    return this;
  }

  /**
   * Play a sequence of notes, one after another.
   * Each step is `[note(s), beats]` or `{ note, beats, velocity }`; `null` notes are rests.
   * Returns the sequence's length in seconds.
   *
   * @example violin.sequence([['C4', 1], ['E4', 1], [['G4','C5'], 2]], { tempo: 96 })
   */
  sequence(steps: SequenceStep[], options: SequenceOptions = {}): number {
    return playSequence((n, o) => this.play(n, o), this.synth.currentTime, steps, options);
  }

  /** Release every held note. */
  allNotesOff(options: TimeOptions = {}): this {
    this.synth._native().allNotesOff(this.channel, this.time(options));
    return this;
  }

  // ── controllers ───────────────────────────────────────────────────────────

  /** Sustain (damper) pedal. */
  sustain(down: boolean, options: TimeOptions = {}): this {
    return this.controlChange(64, down ? 127 : 0, options);
  }

  /** Pitch bend in -1 … 1 (scaled by `bendRange`). */
  pitchBend(value: number, options: TimeOptions = {}): this {
    this.synth._native().pitchBend(this.channel, Math.max(-1, Math.min(1, value)), this.time(options));
    return this;
  }

  /** Modulation wheel 0–1 (adds vibrato of `modDepth` cents). */
  modulation(value: number, options: TimeOptions = {}): this {
    return this.controlChange(1, Math.round(Math.max(0, Math.min(1, value)) * 127), options);
  }

  /** Expression / swell 0–1 (CC 11): smooth crescendo and diminuendo for held notes. */
  expression(value: number, options: TimeOptions = {}): this {
    return this.controlChange(11, Math.round(Math.max(0, Math.min(1, value)) * 127), options);
  }

  /** Send a MIDI control change. */
  controlChange(controller: number, value: number, options: TimeOptions = {}): this {
    this.synth._native().controlChange(this.channel, controller, Math.max(0, Math.min(127, Math.round(value))), this.time(options));
    return this;
  }

  /**
   * Play this instrument from a MIDI keyboard (after `synth.enableMidi()`): from `channel`
   * (1–16), or from every channel when it is left out. Replaces the channels it had; a channel
   * another instrument or organ had is taken over. Notes go straight to the engine.
   */
  midi(channel?: number): this {
    if (channel !== undefined && (!Number.isInteger(channel) || channel < 1 || channel > 16)) {
      throw new RangeError(`MIDI channel must be 1-16, got ${channel}`);
    }
    this.synth._unroute(this.channel);
    for (let ch = 1; ch <= 16; ch++) if (channel === undefined || ch === channel) this.synth._route(ch, this.channel);
    return this;
  }

  // ── sound ─────────────────────────────────────────────────────────────────

  /**
   * Change parameters (see {@link InstrumentParameters}); the others stay as they are. Values are
   * absolute, so `set({ brightness: 1 })` twice is the same as once.
   */
  set(parameters: InstrumentParameters, options: TimeOptions = {}): this {
    this.setParameters(parameters, this.time(options));
    this.active = undefined;
    return this;
  }

  /** A parameter's current value (`undefined` for `reverbSend`, `spread` and `formant` left at
   *  the instrument's own value). */
  get<K extends keyof InstrumentParameters>(name: K): InstrumentParameters[K] {
    return this.applied[name] ?? (PARAMETER_DEFAULTS as InstrumentParameters)[name];
  }

  /** The parameters that differ from the defaults. */
  parameters(): InstrumentParameters {
    return { ...this.applied };
  }

  // ── presets ───────────────────────────────────────────────────────────────

  /**
   * Apply a preset: a name from {@link presets} or a preset object. Replaces every parameter
   * (and the layers, if the preset has its own); `preset('default')` returns to the instrument
   * as recorded.
   *
   * ```ts
   * piano.preset('mellow');
   * piano.preset({ parameters: { brightness: -2, release: 1.5 } }, { at: 8 });
   * ```
   */
  preset(preset: string | InstrumentPreset, options: TimeOptions = {}): this {
    this.apply(this.lookup(preset), typeof preset === 'string' ? preset : undefined, {}, this.time(options));
    return this;
  }

  /** The instrument's presets, and those added with {@link savePreset}, by name. */
  presets(): Record<string, InstrumentPreset> {
    return { ...this.definition.presets, ...this.saved };
  }

  /** Store a preset under a name: by default the sound as it is now. */
  savePreset(name: string, preset: InstrumentPreset = this.current()): this {
    this.saved[name] = preset;
    return this;
  }

  /** The sound as it is now (layers and parameters), as a preset. */
  current(): InstrumentPreset {
    return { layers: this.layers, parameters: this.parameters() };
  }

  /** Name of the preset in use, or `undefined` once parameters were changed by hand. */
  activePreset(): string | undefined {
    return this.active;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private lookup(preset: string | InstrumentPreset): InstrumentPreset {
    if (typeof preset !== 'string') return preset;
    const all = this.presets();
    const p = all[preset];
    if (!p) throw new SupersynthError(`Unknown preset '${preset}' for ${this.definition.id}. Presets: ${Object.keys(all).join(', ')}`);
    return p;
  }

  private apply(p: InstrumentPreset, name: string | undefined, extra: InstrumentParameters, time: number | undefined): void {
    const layers = p.layers ?? this.definition.layers;
    if (JSON.stringify(layers) !== JSON.stringify(this.layers)) {
      this.synth._setLayers(this.channel, layers, time);
      this.layers = layers;
    }
    // every parameter back to its default (and the synth's partial cap), then the preset's
    const reset: Record<string, unknown> = {};
    for (const k of Object.keys(this.applied)) reset[k] = defaultParameter(k as keyof InstrumentParameters);
    this.setParameters(reset as InstrumentParameters, time);
    this.applied = {};
    if (this.synth._maxPartials < 512) this.synth._native().setParam(this.channel, 'maxPartials', this.synth._maxPartials, time);
    this.setParameters({ ...this.definition.parameters, ...p.parameters, ...extra }, time);
    this.active = name;
  }

  private setParameters(parameters: InstrumentParameters, time: number | undefined): void {
    const n = this.synth._native();
    for (const [k, v] of Object.entries(parameters)) {
      if (v === undefined) continue;
      const key = k as keyof InstrumentParameters;
      if (!PARAMETER_NAMES.has(key)) throw new SupersynthError(`Unknown parameter '${k}'. Parameters: ${[...PARAMETER_NAMES].join(', ')}`);
      n.setParam(this.channel, key, toNativeParameter(key, v), time);
      (this.applied as Record<string, unknown>)[key] = v;
    }
  }

  private time(o: TimeOptions): number | undefined {
    return resolveTime(this.synth.currentTime, o);
  }
}

function clampVel(v: number): number {
  return Math.max(1, Math.min(127, Math.round(v)));
}
