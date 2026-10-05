import { INSTRUMENTS, type InstrumentDefinition, type InstrumentId, type LayerDefinition, type InstrumentPreset } from './catalog/index.js';
import { SupersynthError } from './errors.js';
import type { NativeEngine } from './native.js';
import { noteNumber, type NoteLike } from './notes.js';
import { defaultParameter, PARAMETER_DEFAULTS, PARAMETER_NAMES, toNativeParameter, type InstrumentParameters } from './parameters.js';
import { playNotes, playSequence, resolveTime, type Keys, type Playable, type PlayOptions, type SequenceOptions, type SequenceStep, type TimeOptions } from './scheduling.js';
import type { Synth } from './Synth.js';
import { clamp, integer, velocity as checkVelocity } from './validate.js';

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
  private removed = false;

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
    // fail before taking a channel
    const p = this.lookup(preset);
    checkParameters({ ...def.parameters, ...p.parameters, ...options.parameters });
    this.channel = synth._attach(this);
    try {
      this.apply(p, typeof preset === 'string' ? preset : undefined, options.parameters ?? {}, undefined);
    } catch (e) {
      this.removed = true;
      synth._detach(this, [this.channel]);
      throw e;
    }
    synth._suggestRoom(p.reverb ?? def.reverb, this);
  }

  // ── notes ─────────────────────────────────────────────────────────────────

  /** Press a key. */
  noteOn(note: NoteLike, velocity = 90, options: TimeOptions = {}): this {
    this._engine().noteOn(this.channel, noteNumber(note), checkVelocity(velocity), this.time(options));
    return this;
  }

  /** Release a key. */
  noteOff(note: NoteLike, options: TimeOptions = {}): this {
    this._engine().noteOff(this.channel, noteNumber(note), this.time(options));
    return this;
  }

  /**
   * Play one note or several together for a duration.
   *
   * @example piano.play('C4') — piano.play(['C4','E4','G4'], { duration: 2, velocity: 70 })
   */
  play(notes: NoteLike | NoteLike[], options: PlayOptions = {}): this {
    playNotes(this.keys(), this.synth.currentTime, notes, options, checkVelocity(options.velocity ?? 90));
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
    this._engine();
    return playSequence((n, o) => this.play(n, o), (n) => this.synth._reserve(n), this.synth.currentTime, steps, options);
  }

  /** Release every held note. */
  allNotesOff(options: TimeOptions = {}): this {
    this._engine().allNotesOff(this.channel, this.time(options));
    return this;
  }

  // ── controllers ───────────────────────────────────────────────────────────

  /** Sustain (damper) pedal. */
  sustain(down: boolean, options: TimeOptions = {}): this {
    return this.controlChange(64, down ? 127 : 0, options);
  }

  /** Pitch bend in -1 … 1 (scaled by `bendRange`). */
  pitchBend(value: number, options: TimeOptions = {}): this {
    this._engine().pitchBend(this.channel, clamp(value, -1, 1, 'pitchBend value'), this.time(options));
    return this;
  }

  /** Modulation wheel 0–1 (adds vibrato of `modDepth` cents). */
  modulation(value: number, options: TimeOptions = {}): this {
    return this.controlChange(1, Math.round(clamp(value, 0, 1, 'modulation value') * 127), options);
  }

  /** Expression / swell 0–1 (CC 11): smooth crescendo and diminuendo for held notes. */
  expression(value: number, options: TimeOptions = {}): this {
    return this.controlChange(11, Math.round(clamp(value, 0, 1, 'expression value') * 127), options);
  }

  /** Send a MIDI control change: controller 0–127, value 0–127. */
  controlChange(controller: number, value: number, options: TimeOptions = {}): this {
    const cc = integer(controller, 0, 127, 'controller');
    this._engine().controlChange(this.channel, cc, Math.round(clamp(value, 0, 127, 'control change value')), this.time(options));
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
    this._engine();
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
    this._engine();
    checkParameters(parameters);
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
   * as recorded. While the synth's room is automatic and this instrument chose it, the room
   * follows the preset's.
   *
   * ```ts
   * piano.preset('mellow');
   * piano.preset({ parameters: { brightness: -2, release: 1.5 } }, { at: 8 });
   * ```
   */
  preset(preset: string | InstrumentPreset, options: TimeOptions = {}): this {
    this._engine();
    const p = this.lookup(preset);
    checkParameters({ ...this.definition.parameters, ...p.parameters });
    const t = this.time(options);
    this.apply(p, typeof preset === 'string' ? preset : undefined, {}, t);
    this.synth._suggestRoom(p.reverb ?? this.definition.reverb, this, t);
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

  /** @internal Removed from its synth: every later call that would sound throws. */
  _remove(): void {
    this.removed = true;
  }

  /** @internal The engine, unless this instrument was removed. */
  _engine(): NativeEngine {
    if (this.removed) throw new SupersynthError(`This ${this.definition.id} was removed from its synth`);
    return this.synth._native();
  }

  private time(o: TimeOptions): number | undefined {
    return resolveTime(this.synth.currentTime, o);
  }

  private keys(): Keys {
    const n = this._engine();
    return {
      noteOn: (note, vel, t) => n.noteOn(this.channel, note, vel, t),
      noteOff: (note, t) => n.noteOff(this.channel, note, t),
      reserve: (events) => this.synth._reserve(events),
    };
  }

  private lookup(preset: string | InstrumentPreset): InstrumentPreset {
    if (typeof preset !== 'string') return preset;
    const all = this.presets();
    const p = all[preset];
    if (!p) throw new SupersynthError(`Unknown preset '${preset}' for ${this.definition.id}. Presets: ${Object.keys(all).join(', ')}`);
    return p;
  }

  /** Apply a checked preset. */
  private apply(p: InstrumentPreset, name: string | undefined, extra: InstrumentParameters, time: number | undefined): void {
    const layers = p.layers ?? this.definition.layers;
    const parameters = { ...this.definition.parameters, ...p.parameters, ...extra };
    this.synth._reserve(2 + Object.keys(this.applied).length + Object.keys(parameters).length);
    if (JSON.stringify(layers) !== JSON.stringify(this.layers)) {
      const unused = (a: LayerDefinition[], b: LayerDefinition[]) => a.map((l) => l.model).filter((m) => !b.some((l) => l.model === m));
      try {
        this.synth._setLayers(this.channel, layers, this, time);
      } catch (e) {
        this.synth._release(this, unused(layers, this.layers));
        throw e;
      }
      this.synth._release(this, unused(this.layers, layers));
      this.layers = layers;
    }
    // every parameter back to its default (and the synth's partial cap), then the preset's
    const reset: Record<string, unknown> = {};
    for (const k of Object.keys(this.applied)) reset[k] = defaultParameter(k as keyof InstrumentParameters);
    this.setParameters(reset as InstrumentParameters, time);
    this.applied = {};
    if (this.synth._maxPartials < 512) this.synth._native().setParam(this.channel, 'maxPartials', this.synth._maxPartials, time);
    this.setParameters(parameters, time);
    this.active = name;
  }

  /** Send checked parameters. */
  private setParameters(parameters: InstrumentParameters, time: number | undefined): void {
    const n = this.synth._native();
    for (const [k, v] of Object.entries(parameters)) {
      if (v === undefined) continue;
      const key = k as keyof InstrumentParameters;
      n.setParam(this.channel, key, toNativeParameter(key, v), time);
      (this.applied as Record<string, unknown>)[key] = v;
    }
  }
}

/** Throw unless every parameter is known and has a valid value. */
function checkParameters(parameters: InstrumentParameters): void {
  for (const [k, v] of Object.entries(parameters)) {
    if (v === undefined) continue;
    if (!PARAMETER_NAMES.has(k)) throw new SupersynthError(`Unknown parameter '${k}'. Parameters: ${[...PARAMETER_NAMES].join(', ')}`);
    toNativeParameter(k as keyof InstrumentParameters, v);
  }
}
