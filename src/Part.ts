import { findInstrument, INSTRUMENTS, type InstrumentDef, type LayerDef, type PresetDef } from './catalog/index.js';
import { SupersynthError } from './errors.js';
import { noteNumber, type NoteLike } from './notes.js';
import { PARAM_DEFAULTS, toNativeParam, type InstrumentParams } from './params.js';
import { playNotes, playSequence, resolveTime, type Keyboard, type PlayOptions, type SequenceOptions, type SequenceStep, type TimeOptions } from './scheduling.js';
import type { Synth } from './Synth.js';

export interface PartOptions {
  /** Preset to start with: a name from the instrument's presets, or a preset. @default 'default' */
  preset?: string | PresetDef;
  /** Parameter tweaks on top of the preset. */
  params?: InstrumentParams;
}

/**
 * One instrument on its own channel of a {@link Synth}: play notes, apply presets
 * and tweak the sound live. Created by {@link Synth.add}.
 *
 * ```ts
 * const piano = synth.add('grand-piano', { preset: 'mellow' });
 * piano.play('C4', { velocity: 80, duration: 2 });
 * piano.play(['E4', 'G4'], { delay: 0.5 });
 * piano.set({ brightness: 1 });
 * ```
 */
export class Part implements Keyboard {
  /** The instrument definition this part plays. */
  readonly definition: InstrumentDef;
  /** @internal Engine channel (0–31). */
  readonly channel: number;
  /** Parameters currently applied on top of the defaults. */
  private applied: InstrumentParams = {};
  private active: string | undefined;
  private layers: LayerDef[] = [];
  private saved: Record<string, PresetDef> = {};

  /** @internal Use {@link Synth.add}. */
  constructor(
    readonly synth: Synth,
    instrument: string | InstrumentDef,
    options: PartOptions = {},
  ) {
    const def = typeof instrument === 'string' ? findInstrument(instrument) : instrument;
    if (!def) {
      throw new SupersynthError(`Unknown instrument '${String(instrument)}'. Available: ${INSTRUMENTS.map((d) => d.id).join(', ')}`);
    }
    this.definition = def;
    const preset = options.preset ?? 'default';
    const p = this.lookup(preset); // fail before taking a channel
    this.channel = synth._attach(this);
    synth._suggestRoom(p.reverb ?? def.reverb);
    this.apply(p, typeof preset === 'string' ? preset : undefined, options.params);
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
   * @example part.play('C4') — part.play(['C4','E4','G4'], { duration: 2, velocity: 70 })
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
   * @example part.sequence([['C4', 1], ['E4', 1], [['G4','C5'], 2]], { bpm: 96 })
   */
  sequence(steps: SequenceStep[], options: SequenceOptions = {}): number {
    return playSequence((n, o) => this.play(n, o), this.synth.currentTime, steps, options);
  }

  /** Release all held notes of this part. */
  allNotesOff(options: TimeOptions = {}): this {
    this.synth._native().allNotesOff(this.channel, this.time(options));
    return this;
  }

  // ── controllers ───────────────────────────────────────────────────────────

  /** Sustain (damper) pedal. */
  sustain(down: boolean, options: TimeOptions = {}): this {
    return this.cc(64, down ? 127 : 0, options);
  }

  /** Pitch bend in -1 … 1 (scaled by `bendRange`). */
  pitchBend(value: number, options: TimeOptions = {}): this {
    this.synth._native().pitchBend(this.channel, Math.max(-1, Math.min(1, value)), this.time(options));
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
    this.synth._native().controlChange(this.channel, controller, Math.max(0, Math.min(127, Math.round(value))), this.time(options));
    return this;
  }

  /** Play this part from a MIDI keyboard on `channel` (1–16), after `synth.enableMidi()`. Notes
   *  go straight to the engine, with no JavaScript in between. */
  midi(channel: number): this {
    if (!Number.isInteger(channel) || channel < 1 || channel > 16) throw new RangeError(`MIDI channel must be 1-16, got ${channel}`);
    this.synth._native().setMidiRoute(channel, this.channel);
    return this;
  }

  // ── sound ─────────────────────────────────────────────────────────────────

  /**
   * Change parameters (see {@link InstrumentParams}). Values are absolute, so
   * `set({ brightness: 1 })` twice is the same as once.
   */
  set(params: InstrumentParams, options: TimeOptions = {}): this {
    this.setParams(params, this.time(options));
    this.active = undefined;
    return this;
  }

  /** A parameter's current value (-1 for `reverbSend`, `spread` and `formant` left at the
   *  instrument's own value). */
  get<K extends keyof InstrumentParams>(name: K): Required<InstrumentParams>[K] {
    return (this.applied[name] ?? PARAM_DEFAULTS[name]) as Required<InstrumentParams>[K];
  }

  /** Parameter values that differ from the defaults. */
  params(): InstrumentParams {
    return { ...this.applied };
  }

  /** Reset every parameter to its default: the instrument as recorded, without preset. */
  reset(): this {
    this.clear();
    this.active = undefined;
    return this;
  }

  // ── presets ───────────────────────────────────────────────────────────────

  /**
   * Apply a preset: a name from {@link presets} or a preset object. Replaces every parameter
   * (and the layers, if the preset has its own).
   *
   * ```ts
   * piano.preset('mellow');
   * piano.preset({ params: { brightness: -2, release: 1.5 } });
   * ```
   */
  preset(preset: string | PresetDef): this {
    this.apply(this.lookup(preset), typeof preset === 'string' ? preset : undefined);
    return this;
  }

  /** The instrument's presets, and those added with {@link savePreset}, by name. */
  presets(): Record<string, PresetDef> {
    return { ...this.definition.presets, ...this.saved };
  }

  /** Store a preset under a name: by default the sound as it is now. */
  savePreset(name: string, preset: PresetDef = this.current()): this {
    this.saved[name] = preset;
    return this;
  }

  /** The sound as it is now (layers and parameters), as a preset. */
  current(): PresetDef {
    return { layers: this.layers, params: this.params() };
  }

  /** Name of the preset in use, or `undefined` once parameters were changed by hand. */
  activePreset(): string | undefined {
    return this.active;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private lookup(preset: string | PresetDef): PresetDef {
    if (typeof preset !== 'string') return preset;
    const all = this.presets();
    const p = all[preset];
    if (!p) throw new SupersynthError(`Unknown preset '${preset}' for ${this.definition.id}. Presets: ${Object.keys(all).join(', ')}`);
    return p;
  }

  private apply(p: PresetDef, name: string | undefined, extra: InstrumentParams = {}): void {
    const layers = p.layers ?? this.definition.layers;
    if (JSON.stringify(layers) !== JSON.stringify(this.layers)) {
      this.synth._setLayers(this.channel, layers);
      this.layers = layers;
    }
    this.clear();
    this.setParams({ ...this.definition.params, ...p.params, ...extra }, undefined);
    this.active = name;
  }

  /** Every parameter back to its default (and the synth's partial cap). */
  private clear(): void {
    const reset: Record<string, unknown> = {};
    for (const k of Object.keys(this.applied)) reset[k] = PARAM_DEFAULTS[k as keyof InstrumentParams];
    this.setParams(reset as InstrumentParams, undefined);
    this.applied = {};
    if (this.synth._maxPartials < 512) {
      this.synth._native().setParam(this.channel, 'maxPartials', this.synth._maxPartials);
    }
  }

  private setParams(params: InstrumentParams, time: number | undefined): void {
    const n = this.synth._native();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      const key = k as keyof InstrumentParams;
      if (!(key in PARAM_DEFAULTS)) throw new SupersynthError(`Unknown parameter '${k}'. Parameters: ${Object.keys(PARAM_DEFAULTS).join(', ')}`);
      n.setParam(this.channel, key, toNativeParam(key, v), time);
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
