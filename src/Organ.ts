import { SupersynthError } from './errors.js';
import type { NativeEngine, NativeLayer } from './engine.js';
import { noteNumber, type NoteLike } from './notes.js';
import { CHURCH_DIVISIONS, ORGAN_DEFAULTS, SWELL_TREMULANT } from './organs/defaults.js';
import { organModels } from './models.js';
import { ORGANS, type OrganId } from './organs/index.js';
import type { CouplerLike, DivisionName, OrganDefinition, OrganPreset, StopDefinition, TremulantDefinition } from './organs/types.js';
import { playNotes, playSequence, resolveTime, type Keys, type Playable, type PlayOptions, type SequenceOptions, type SequenceStep, type TimeOptions } from './scheduling.js';
import type { Synth } from './Synth.js';
import type { MidiEvent } from './types.js';
import { clamp, finite, velocity as checkVelocity } from './validate.js';

export type { CouplerLike, DivisionName, OrganDefinition, OrganPreset, StopDefinition } from './organs/types.js';

const DIVISIONS: DivisionName[] = ['great', 'swell', 'positive', 'pedal'];

/** @internal The organ definition behind an id or a definition. */
export function resolveOrgan(organ: OrganId | OrganDefinition): OrganDefinition {
  if (typeof organ !== 'string') return organ;
  const def = (ORGANS as Record<string, OrganDefinition>)[organ];
  if (!def) throw new SupersynthError(`Unknown organ '${organ}'. Organs: ${Object.keys(ORGANS).join(', ')}`);
  return def;
}

/** Model id of a stop. */
export function stopModel(stop: StopDefinition): string {
  return stop.model ?? `organ/${stop.id}`;
}

/** The stop called `name` (name, case-insensitive, or id) on a division of an organ. */
function findStop(organ: OrganDefinition, division: DivisionName, name: string): StopDefinition {
  const stops = organ.stops.filter((s) => s.division === division);
  const def = stops.find((s) => s.name.toLowerCase() === String(name).toLowerCase() || s.id === name);
  if (!def) throw new SupersynthError(`No stop '${name}' on the ${division}. Stops: ${stops.map((s) => s.name).join(', ')}`);
  return def;
}

/** Throw unless `name` is a division. */
function checkDivision(name: string): DivisionName {
  if (!DIVISIONS.includes(name as DivisionName)) throw new SupersynthError(`No division '${name}'. Divisions: ${DIVISIONS.join(', ')}`);
  return name as DivisionName;
}

const list = <T>(x: T | T[]): T[] => (Array.isArray(x) ? x : [x]);

/** A coupler as division + octave (−1, 0, 1). */
interface Coupler {
  division: DivisionName;
  octave: -1 | 0 | 1;
}

/** A checked coupler: its division exists and its octave is −1, 0 or 1. */
function coupler(c: CouplerLike): Coupler {
  if (typeof c === 'string') return { division: checkDivision(c), octave: 0 };
  if (typeof c !== 'object' || c === null) throw new SupersynthError(`A coupler is a division's name or { division, octave }, got ${String(c)}`);
  const octave = c.octave ?? 0;
  if (octave !== -1 && octave !== 0 && octave !== 1) throw new RangeError(`Coupler octave must be -1, 0 or 1, got ${String(octave)}`);
  return { division: checkDivision(c.division), octave };
}

const couplerLike = (c: Coupler): CouplerLike => (c.octave === 0 ? c.division : { division: c.division, octave: c.octave });
const sameCoupler = (a: Coupler, b: Coupler): boolean => a.division === b.division && a.octave === b.octave;

/** Engine events of one stop drawn or retired, at most: its layer and its Forte layer added and
 *  switched, and the stop action's noise (key down and up). */
const STOP_EVENTS = 6;
/** Engine events of one coupler engaged or released, at most: its action noise. */
const COUPLER_NOISE_EVENTS = 2;

/** What {@link Division.set} changes: the stops drawn and the couplers, each replaced as a whole. */
export interface DivisionSettings {
  /** Exactly these stops drawn (by name or id); `[]` silences the division. */
  stops?: string[];
  /** Exactly these couplers to this keyboard (see {@link CouplerLike}); `[]` releases every
   *  coupler. */
  couple?: CouplerLike[];
  /** `false`: the keys play only what is coupled to this keyboard, not its own stops
   *  ("unison off"). */
  unison?: boolean;
  /** The Forte (harmoniums): stops that have a forte recording play it. */
  forte?: boolean;
}

/** One keyboard (manual or pedalboard) of the organ. */
export class Division implements Playable {
  private layers = new Map<string, number>(); // stop name -> layer index in the engine
  private pulled = new Set<string>();
  private couplers: Coupler[] = [];
  private unisonOff = false;
  private nlayers = 0;
  private forteOn = false;
  private forteLayers = new Map<string, number>(); // stop name -> layer of its forte model
  /** Stops drawn in real time while their models were still loading: added and sounded as
   *  soon as they have loaded (stop name -> the time it was drawn for). */
  private waiting = new Map<string, number | undefined>();

  /** @internal */
  constructor(
    private readonly organ: Organ,
    readonly name: DivisionName,
    /** @internal Engine channel (0–31). */
    readonly channel: number,
  ) {}

  // ── notes ─────────────────────────────────────────────────────────────────

  /** Press a key. Velocity is clamped to 1–127 (organs are not velocity sensitive). */
  noteOn(note: NoteLike, velocity = 100, options: TimeOptions = {}): this {
    if (this.waiting.size) this._loaded(false);
    this.organ._engine().noteOn(this.channel, noteNumber(note), checkVelocity(velocity), this.organ._time(options));
    return this;
  }

  noteOff(note: NoteLike, options: TimeOptions = {}): this {
    this.organ._engine().noteOff(this.channel, noteNumber(note), this.organ._time(options));
    return this;
  }

  /** Play notes for a duration (organs are not velocity sensitive). */
  play(notes: NoteLike | NoteLike[], options: PlayOptions = {}): this {
    if (this.waiting.size) this._loaded(false);
    const n = this.organ._engine();
    const keys: Keys = {
      noteOn: (note, vel, t) => n.noteOn(this.channel, note, vel, t),
      noteOff: (note, t) => n.noteOff(this.channel, note, t),
      reserve: (events) => this.organ.synth._reserve(events),
    };
    playNotes(keys, this.organ.synth.currentTime, notes, options, 100);
    return this;
  }

  /** Play a sequence of notes, one after another (see {@link Instrument.sequence}). Returns its length in seconds. */
  sequence(steps: SequenceStep[], options: SequenceOptions = {}): number {
    this.organ._engine();
    return playSequence((n, o) => this.play(n, o), (n) => this.organ.synth._reserve(n), this.organ.synth.currentTime, steps, options);
  }

  /** Release every held key of this division. */
  allNotesOff(options: TimeOptions = {}): this {
    this.organ._engine().allNotesOff(this.channel, this.organ._time(options));
    return this;
  }

  /** Swell pedal, 0 (shutters closed) – 1 (open). On the swell division it moves the swell
   *  box's shutters: closed is about 9 dB quieter and much darker, never silent. On other
   *  divisions it is a plain volume control. */
  expression(value: number, options: TimeOptions = {}): this {
    const v = Math.round(clamp(value, 0, 1, 'expression value') * 127);
    this.organ._engine().controlChange(this.channel, 11, v, this.organ._time(options));
    return this;
  }

  // ── stops and couplers ────────────────────────────────────────────────────

  /** Draw (pull) a stop or several, by name (`"Trumpet 8'"`, case-insensitive) or id. Takes
   *  effect on held notes too. */
  pull(stops: string | string[], options: TimeOptions = {}): this {
    this.organ._engine();
    const names = list(stops).map((s) => this._stop(s).name);
    const t = this.organ._time(options);
    this.organ.synth._reserve(STOP_EVENTS * names.length);
    for (const n of names) this.toggle(n, true, t);
    this.organ._changed();
    return this;
  }

  /** Retire (push in) a stop or several. */
  push(stops: string | string[], options: TimeOptions = {}): this {
    this.organ._engine();
    const names = list(stops).map((s) => this._stop(s).name);
    const t = this.organ._time(options);
    this.organ.synth._reserve(STOP_EVENTS * names.length);
    for (const n of names) this.toggle(n, false, t);
    this.organ._changed();
    return this;
  }

  /** Couple another division or several to this keyboard: playing it also sounds their drawn
   *  stops. `organ.great.couple('swell')` is the "Swell to Great" coupler,
   *  `organ.great.couple({ division: 'swell', octave: 1 })` "Swell to Great 4'" and
   *  `organ.swell.couple({ division: 'swell', octave: 1 })` the swell's super octave. Couplers
   *  act on every note, whether it comes from the API, a MIDI keyboard or a MIDI file. */
  couple(couplers: CouplerLike | CouplerLike[], options: TimeOptions = {}): this {
    this.organ._engine();
    const add = list(couplers).map(coupler);
    const t = this.organ._time(options);
    this.organ.synth._reserve(this._couplerEvents(add.length));
    this._couplers([...this.couplers, ...add], t);
    this.organ._changed();
    return this;
  }

  /** Release couplers to this keyboard: a division's name releases all of its couplers
   *  (unison and octave), `{ division, octave }` just that one. */
  uncouple(couplers: CouplerLike | CouplerLike[], options: TimeOptions = {}): this {
    this.organ._engine();
    const off = list(couplers).map((o) => (typeof o === 'string' ? checkDivision(o) : coupler(o)));
    const gone = (c: Coupler) => off.some((o) => (typeof o === 'string' ? o === c.division : sameCoupler(o, c)));
    const t = this.organ._time(options);
    this.organ.synth._reserve(this._couplerEvents(0));
    this._couplers(this.couplers.filter((c) => !gone(c)), t);
    this.organ._changed();
    return this;
  }

  /** Unison on (the default) or off: with the unison off the keys play only what is coupled
   *  to this keyboard, e.g. a super octave coupler alone plays the stops an octave up. */
  unison(on: boolean, options: TimeOptions = {}): this {
    this.organ._engine();
    const t = this.organ._time(options);
    this.organ.synth._reserve(this._couplerEvents(0));
    this.unisonOff = !on;
    this._couplers(this.couplers, t);
    this.organ._changed();
    return this;
  }

  /**
   * Replace the stops drawn and/or the couplers as a whole; what is left out stays as it is.
   * Stops that stay drawn keep sounding on held notes.
   *
   * ```ts
   * organ.great.set({ stops: ["Principal 8'", "Octave 4'"] });
   * organ.great.set({ stops: [], couple: [] });   // silent, uncoupled
   * ```
   */
  set(settings: DivisionSettings, options: TimeOptions = {}): this {
    this.organ._engine();
    for (const s of settings.stops ?? []) this._stop(s);
    for (const c of settings.couple ?? []) coupler(c);
    const t = this.organ._time(options);
    this.organ.synth._reserve(this._events(settings));
    this._apply(settings, t);
    this.organ._changed();
    return this;
  }

  /** All stops of this division. */
  stops(): StopDefinition[] {
    return this.organ.definition.stops.filter((s) => s.division === this.name);
  }

  /** Names of the stops drawn (including changes scheduled for later). */
  drawn(): string[] {
    return [...this.pulled];
  }

  /** Couplers to this keyboard: unison couplers by the division's name, octave couplers as
   *  `{ division, octave }`. */
  coupled(): CouplerLike[] {
    return this.couplers.map(couplerLike);
  }

  /** The Forte on or off (harmoniums): the drawn stops that have a forte recording
   *  ({@link StopDefinition.forte}) play it. */
  forte(on: boolean, options: TimeOptions = {}): this {
    this.organ._engine();
    const t = this.organ._time(options);
    this.organ.synth._reserve(2 * this.pulled.size);
    this._forte(on, t);
    this.organ._changed();
    return this;
  }

  /** Whether the Forte is on. */
  forteIsOn(): boolean {
    return this.forteOn;
  }

  /** Whether the keys play this division's own stops (see {@link unison}). */
  unisonOn(): boolean {
    return !this.unisonOff;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** @internal The engine, unless the organ was removed. */
  _engine(): NativeEngine {
    return this.organ._engine();
  }

  /** @internal The stop called `name` (name, case-insensitive, or id). */
  _stop(name: string): StopDefinition {
    return findStop(this.organ.definition, this.name, name);
  }

  /** @internal Engine events {@link _apply} sends at most for these settings. */
  _events(settings: DivisionSettings): number {
    const stops = settings.stops ? STOP_EVENTS * (this.pulled.size + settings.stops.length) : 0;
    const forte = settings.forte !== undefined ? 2 * (this.pulled.size + (settings.stops?.length ?? 0)) : 0;
    const couplers = settings.couple || settings.unison !== undefined ? this._couplerEvents(settings.couple?.length ?? 0) : 0;
    return stops + forte + couplers;
  }

  /** Engine events of a coupler change at most: the change, and the action noise of every
   *  coupler engaged or released. */
  private _couplerEvents(added: number): number {
    return 1 + COUPLER_NOISE_EVENTS * (this.couplers.length + added);
  }

  /** @internal Apply checked settings. */
  _apply(settings: DivisionSettings, time: number | undefined): void {
    if (settings.stops) {
      const want = new Set(settings.stops.map((s) => this._stop(s).name));
      for (const n of [...this.pulled]) if (!want.has(n)) this.toggle(n, false, time);
      for (const n of want) this.toggle(n, true, time);
    }
    if (settings.forte !== undefined) this._forte(settings.forte, time);
    if (settings.unison !== undefined) this.unisonOff = !settings.unison;
    if (settings.couple || settings.unison !== undefined) this._couplers(settings.couple?.map(coupler) ?? this.couplers, time);
  }

  /** Replace the couplers (one engine change, so held notes are not restruck). */
  private _couplers(couplers: Coupler[], time: number | undefined): void {
    const keep: Coupler[] = [];
    for (const c of couplers) {
      // a division coupled to itself in unison is just its own keys
      if ((c.division === this.name && c.octave === 0) || keep.some((k) => sameCoupler(k, c))) continue;
      keep.push(c);
    }
    const targets = keep.map((c) => ({ part: this.organ.division(c.division).channel, shift: 12 * c.octave }));
    // the engine change first: it is the one that can be refused (too many couplers)
    this.organ.synth._native().setCouplers(this.channel, targets, this.unisonOff, time);
    // the coupler's action, once for each coupler engaged or released
    const noise = this.organ.definition.noises?.coupler;
    const added = keep.filter((c) => !this.couplers.some((o) => sameCoupler(o, c))).length;
    const removed = this.couplers.filter((o) => !keep.some((c) => sameCoupler(o, c))).length;
    for (let i = 0; i < added; i++) this.organ._stopNoise({ actionNoise: noise }, true, time);
    for (let i = 0; i < removed; i++) this.organ._stopNoise({ actionNoise: noise }, false, time);
    this.couplers = keep;
  }

  private _forte(on: boolean, time: number | undefined): void {
    if (on === this.forteOn) return;
    this.forteOn = on;
    const n = this.organ.synth._native();
    for (const name of this.pulled) {
      const f = this.forteLayers.get(name);
      if (f === undefined) continue;
      n.setLayerEnabled(this.channel, this.layers.get(name)!, !on, time);
      n.setLayerEnabled(this.channel, f, on, time);
    }
  }

  /** @internal Add a layer to this division's engine part; returns its index. */
  _addLayer(layer: NativeLayer): number {
    this.organ.synth._native().addLayer(this.channel, layer);
    return this.nlayers++;
  }

  /** Models of a stop: its own and its Forte model. */
  private models(def: StopDefinition): string[] {
    return def.forte ? [stopModel(def), def.forte] : [stopModel(def)];
  }

  /** @internal Add and sound the stops drawn while their models were loading, those loaded
   *  (all of them, waiting for their models, with `wait`). A stop whose model failed to load
   *  is retired and the error emitted (see {@link Organ.ready}). */
  _loaded(wait: boolean): void {
    const n = this.organ.synth._native();
    for (const [name, time] of [...this.waiting]) {
      const def = this._stop(name);
      if (!wait && this.models(def).some((m) => n.modelLoading(this.organ.synth._modelId(m)))) continue;
      this.waiting.delete(name);
      try {
        this.sound(def, true, time);
      } catch (e) {
        this.pulled.delete(name);
        if (wait) throw e;
        this.organ._error(e);
      }
    }
  }

  private toggle(name: string, on: boolean, time: number | undefined): void {
    if (this.pulled.has(name) === on) return;
    const def = this._stop(name);
    const synth = this.organ.synth;
    if (this.waiting.has(def.name)) {
      // retired before its models had loaded: it never sounded
      this.waiting.delete(def.name);
    } else if (on && !this.layers.has(def.name) && synth._realtime && !this.organ._isConstructing()) {
      // In real time, a stop whose models are still loading does not hold up the caller (a
      // key, a MIDI program change): it sounds as soon as they have loaded.
      const ids = synth._preload(this.models(def), this.organ);
      if (ids.some((id) => synth._native().modelLoading(id))) {
        this.waiting.set(def.name, time);
        synth._native().hurryModels(ids);
        synth._native().watchModels(ids, () => {
          if (!this.organ._isRemoved()) this._loaded(false);
        });
      } else {
        this.sound(def, on, time);
      }
    } else {
      this.sound(def, on, time);
    }
    this.organ._stopNoise(def, on, time);
    if (on) this.pulled.add(def.name);
    else this.pulled.delete(def.name);
  }

  /** Switch a stop's layers on or off, adding them (and loading their models, or waiting for
   *  them) the first time. */
  private sound(def: StopDefinition, on: boolean, time: number | undefined): void {
    const synth = this.organ.synth;
    const n = synth._native();
    let li = this.layers.get(def.name);
    if (li === undefined) {
      // load the stop's models the first time it is drawn (both before adding either, so a
      // missing model changes nothing); added now (silent) so that layer indices follow the
      // order of the calls, and sounded at its time
      const [keyLow, keyHigh] = def.keys ?? [0, 127];
      const layer = (model: string): NativeLayer => ({
        ...synth._layer({ model, transpose: def.transpose, gain: def.gain ?? 0, keyLow, keyHigh }, this.organ),
        speechMs: this.organ._speech,
        enabled: false,
      });
      const main = layer(stopModel(def));
      const forte = def.forte ? layer(def.forte) : undefined;
      li = this._addLayer(main);
      this.layers.set(def.name, li);
      if (forte) this.forteLayers.set(def.name, this._addLayer(forte));
    }
    const f = this.forteLayers.get(def.name);
    n.setLayerEnabled(this.channel, li, on && !(f !== undefined && this.forteOn), time);
    if (f !== undefined) n.setLayerEnabled(this.channel, f, on && this.forteOn, time);
  }
}

/** Which of an organ's noises play. */
export interface OrganNoiseSettings {
  /** The blower running. */
  blower: boolean;
  /** The empty church (its background noise). */
  ambient: boolean;
  /** Keys, stop knobs, couplers and tremulants moving. */
  action: boolean;
}

/** What {@link Organ.set} changes. */
export interface OrganSettings {
  /** The tremulants (see {@link OrganDefinition.tremulant}): `true`/`false` for all, or by a
   *  division they shake, `{ swell: true }`. */
  tremulant?: boolean | Partial<Record<DivisionName, boolean>>;
  /** The sounds of the machinery ({@link OrganDefinition.noises}): `true` for all of them, or
   *  each: the blower and the room while on, the action of the keys, stops, couplers and
   *  tremulants. Organs without noise recordings ignore it. */
  noises?: boolean | Partial<OrganNoiseSettings>;
  /** Wind supply: how much the pipes of a division sag together when many start at once
   *  (pressure dip and regulator recovery). 0 = perfectly steady, 1 = flexible historic
   *  winding. */
  wind?: number;
}

/** Which of an organ's models {@link Synth.add} loads in the background (see
 *  {@link OrganOptions.preload}). */
export type OrganPreload = 'all' | 'preset' | false;

export interface OrganOptions extends OrganSettings {
  /** Preset to start with: a name or a preset. @default the organ's `defaultPreset` */
  preset?: string | OrganPreset;
  /**
   * Model loading. The models of the preset the organ starts with are always loaded by
   * `synth.add()` (in parallel, on several cores), so that preset sounds at once.
   *
   * - `'all'`: every other stop's model (and the Forte and noise models) then loads in the
   *   background, off the JavaScript thread, so drawing stops and changing presets later is
   *   instant. `await organ.ready` waits for it. The largest organs take 250–430 MB decoded.
   * - `'preset'`: only the starting preset's models; another stop's model is loaded when the
   *   stop is first drawn (tens of milliseconds per stop on a desktop, several times that on a
   *   Raspberry Pi), and the memory grows only with the stops used.
   * - `false`: nothing in the background: every model, the preset's too, is loaded on the
   *   JavaScript thread when first needed, one after another.
   *
   * A stop drawn before its model has loaded does not hold up playing: with real-time output
   * running it sounds as soon as its model has loaded; offline, the call (and `render()`)
   * waits for that one model, so renders contain exactly what was drawn.
   *
   * @default `'all'` when the organ's models take at most a quarter of the machine's memory
   * decoded, else `'preset'`
   */
  preload?: OrganPreload;
  /** Presets added to the organ's own (a preset of the same name replaces the built-in one). */
  presets?: Record<string, OrganPreset>;
}

/** MIDI channel (1–16) of each keyboard, for {@link Organ.midi}. */
export type OrganMidiChannels = Partial<Record<DivisionName, number>>;

export interface OrganMidiOptions {
  /** Program change on any of the organ's channels selects a preset: program 0 the first of
   *  these, 1 the second, … `false` ignores program changes. @default all presets, in order */
  presets?: string[] | false;
}

/** Engine events of turning the noises on or off, at most: the noise part set up (instrument,
 *  reverb send, a key-down and a key-up layer per division), the blower and room started or
 *  stopped, and the key-noise layers switched. */
const NOISE_EVENTS = 2 + 2 * 4 + 2 + 2 * 4;

/**
 * A real church organ: four divisions with drawable stops, couplers, swell pedal and
 * tremulant, played from an {@link OrganDefinition}. Created by {@link Synth.add}.
 *
 * ```ts
 * const organ = synth.add('burea', { preset: 'plenum' });
 * organ.great.play(['C4', 'E4', 'G4'], { duration: 3 });
 * organ.pedal.play('C2', { duration: 3 });
 * organ.great.pull("Trumpet 8'");
 * organ.preset({ swell: ["Salicional 8'", "Voix céleste 8'"], pedal: ["Subbass 16'"], couple: { great: ['swell'] } });
 * ```
 */
export class Organ {
  readonly great: Division;
  readonly swell: Division;
  readonly positive: Division;
  readonly pedal: Division;
  /** The organ's definition: stops, presets, layout. */
  readonly definition: OrganDefinition;
  /** Models loading in the background (see {@link ready}); `keptAlive` once awaited. */
  private loading: { promise: Promise<void>; settled: boolean; keptAlive: boolean } | undefined;
  /** @internal Longest speech delay of a pipe (ms). */
  readonly _speech: number;
  private saved: Record<string, OrganPreset>;
  private active: string | undefined;
  private midiListener: ((e: MidiEvent) => void) | undefined;
  private removed = false;
  private constructing = false;
  private readonly trems: TremulantDefinition[];
  private tremOn: boolean[];
  private noiseState: OrganNoiseSettings = { blower: false, ambient: false, action: false };
  /** engine part of the blower, room and stop action; key-noise layers by division */
  private noise: { channel: number; keyLayers: Map<DivisionName, number[]> } | undefined;

  /** @internal Use {@link Synth.add}. */
  constructor(
    /** The synth it plays in. */
    readonly synth: Synth,
    organ: OrganId | OrganDefinition,
    options: OrganOptions = {},
  ) {
    const def = resolveOrgan(organ);
    this.definition = def;
    this.trems = def.tremulant === undefined ? [SWELL_TREMULANT] : list(def.tremulant);
    for (const tr of this.trems) {
      for (const d of list(tr.division)) checkDivision(d);
      finite(tr.depth, 'tremulant depth');
      finite(tr.pitch, 'tremulant pitch');
      finite(tr.rate, 'tremulant rate');
    }
    this.tremOn = this.trems.map(() => false);
    this._speech = finite(def.speech ?? ORGAN_DEFAULTS.speech, 'speech');
    this.saved = { ...options.presets };
    const preset = options.preset ?? def.defaultPreset;
    // fail before taking channels
    this.checkPreset(this.lookup(preset));
    const wind = finite(options.wind ?? def.wind ?? ORGAN_DEFAULTS.wind, 'wind');
    const layout = def.divisions ?? CHURCH_DIVISIONS;
    const boxes = new Map<DivisionName, { closed: number; shelf: number }>();
    for (const d of DIVISIONS) {
      const box = layout[d]?.swellBox;
      if (typeof box !== 'object' || box === null) continue;
      const closed = Math.min(0, finite(box.closed ?? -9, 'swell box closed level'));
      boxes.set(d, { closed, shelf: Math.min(0, finite(box.shelf ?? (closed * 14) / 9, 'swell box shelf')) });
    }
    const channels: number[] = [];
    try {
      for (let i = 0; i < 4; i++) channels.push(synth._attach(this));
    } catch (e) {
      synth._detach(this, channels);
      throw e;
    }
    this.great = new Division(this, 'great', channels[0]!);
    this.swell = new Division(this, 'swell', channels[1]!);
    this.positive = new Division(this, 'positive', channels[2]!);
    this.pedal = new Division(this, 'pedal', channels[3]!);
    try {
      this.preload(def, this.lookup(preset), options);
      const n = synth._native();
      synth._reserve(32);
      for (const d of this.divisions()) {
        n.setInstrument(d.channel, []);
        n.setParam(d.channel, 'reverbSend', def.reverbSend ?? ORGAN_DEFAULTS.reverbSend);
        n.setParam(d.channel, 'pan', layout[d.name]?.pan ?? 0);
        if (synth._maxPartials < 512) n.setParam(d.channel, 'maxPartials', synth._maxPartials);
      }
      for (const d of this.divisions()) {
        if (!layout[d.name]?.swellBox) continue;
        n.setParam(d.channel, 'swellBox', 1);
        const box = boxes.get(d.name);
        if (box) {
          n.setParam(d.channel, 'swellClosed', box.closed);
          n.setParam(d.channel, 'swellShelf', box.shelf);
        }
      }
      this.set({ wind, ...(options.tremulant !== undefined ? { tremulant: options.tremulant } : {}) });
      // the starting registration sounds as soon as add() returns, also in real time
      this.constructing = true;
      try {
        this.preset(preset);
      } finally {
        this.constructing = false;
      }
      if (options.noises) this.set({ noises: options.noises });
    } catch (e) {
      this.removed = true;
      synth._detach(this, this._channels());
      throw e;
    }
  }

  /**
   * Resolves once the models the organ loads in the background (see {@link OrganOptions.preload})
   * have loaded, or the organ was removed. Rejects with a {@link SupersynthError} when one fails
   * to load (drawing that stop then throws the same error); the synth also emits it as an
   * `'error'` event when it has listeners. Awaiting it is optional: loading goes on regardless
   * (and does not keep Node.js running unless awaited).
   *
   * ```ts
   * const organ = synth.add('friesach');
   * await organ.ready;          // every stop can now be drawn without loading
   * ```
   */
  get ready(): Promise<void> {
    const l = this.loading;
    if (!l) return Promise.resolve();
    if (!l.settled && !l.keptAlive) {
      // the native wait does not hold the event loop: whoever awaits this does
      l.keptAlive = true;
      const timer = setInterval(() => {}, 1 << 30);
      const done = () => clearInterval(timer);
      l.promise.then(done, done);
    }
    return l.promise;
  }

  /** The four divisions: great, swell, positive, pedal. */
  divisions(): Division[] {
    return [this.great, this.swell, this.positive, this.pedal];
  }

  division(name: DivisionName): Division {
    const d = this.divisions().find((x) => x.name === name);
    if (!d) throw new SupersynthError(`No division '${name}'. Divisions: ${DIVISIONS.join(', ')}`);
    return d;
  }

  /** All stops of this organ. */
  stops(): StopDefinition[] {
    return this.definition.stops;
  }

  /** Change the tremulants, the wind and/or the noises; what is left out stays as it is. */
  set(settings: OrganSettings, options: TimeOptions = {}): this {
    const n = this._engine();
    const t = this._time(options);
    const wind = settings.wind === undefined ? undefined : Math.max(0, finite(settings.wind, 'wind'));
    const tr = settings.tremulant;
    if (tr !== undefined && typeof tr !== 'boolean') {
      if (typeof tr !== 'object' || tr === null) throw new SupersynthError(`tremulant must be true, false or { <division>: boolean }, got ${String(tr)}`);
      for (const d of Object.keys(tr)) checkDivision(d);
    }
    const nz = settings.noises;
    if (nz !== undefined && typeof nz !== 'boolean' && (typeof nz !== 'object' || nz === null)) {
      throw new SupersynthError(`noises must be true, false or { blower, ambient, action }, got ${String(nz)}`);
    }
    this.synth._reserve(this._setEvents(settings));
    if (tr !== undefined) {
      this.trems.forEach((trem, i) => {
        const divs = list(trem.division);
        const on = typeof tr === 'boolean' ? tr : divs.some((d) => tr[d]) ? true : divs.some((d) => tr[d] === false) ? false : undefined;
        if (on === undefined) return;
        if (on !== this.tremOn[i]) this._stopNoise(trem, on, t);
        this.tremOn[i] = on;
        // all pipes on the tremulant's wind pulse together in loudness and (less) in pitch
        for (const d of divs) {
          const ch = this.division(d).channel;
          n.setParam(ch, 'tremolo', on ? trem.depth : 0, t);
          n.setParam(ch, 'tremoloPitch', on ? trem.pitch : 0, t);
          n.setParam(ch, 'tremoloRate', trem.rate, t);
        }
      });
    }
    if (wind !== undefined) {
      for (const d of this.divisions()) n.setParam(d.channel, 'wind', wind, t);
    }
    if (nz !== undefined) {
      this._noises(typeof nz === 'boolean' ? { blower: nz, ambient: nz, action: nz } : { ...this.noiseState, ...nz }, t);
    }
    return this;
  }

  /** The tremulants and whether each is on. */
  tremulants(): { definition: TremulantDefinition; on: boolean }[] {
    return this.trems.map((definition, i) => ({ definition, on: this.tremOn[i] ?? false }));
  }

  /** Which machinery noises are on (see {@link OrganSettings.noises}). */
  noisesOn(): OrganNoiseSettings {
    return { ...this.noiseState };
  }

  /** Release every held key on every division. */
  allNotesOff(options: TimeOptions = {}): this {
    for (const d of this.divisions()) d.allNotesOff(options);
    return this;
  }

  // ── presets ───────────────────────────────────────────────────────────────

  /**
   * Apply a preset: a name from {@link presets} or a preset object. Replaces every drawn stop
   * and coupler; divisions the preset leaves out fall silent.
   *
   * ```ts
   * organ.preset('plenum');
   * organ.preset({ great: ["Principal 8'", "Octave 4'"], pedal: ["Subbass 16'"], couple: { pedal: ['great'] } });
   * organ.preset('full', { at: 30 });        // a registration change during the piece
   * ```
   */
  preset(preset: string | OrganPreset, options: TimeOptions = {}): this {
    this._engine();
    const p = this.lookup(preset);
    // check everything before changing anything
    this.checkPreset(p);
    const t = this._time(options);
    const off = new Set(p.unisonOff ?? []);
    const forte = new Set(p.forte ?? []);
    const settings = (d: Division): DivisionSettings => ({ stops: p[d.name] ?? [], couple: p.couple?.[d.name] ?? [], unison: !off.has(d.name), forte: forte.has(d.name) });
    const tremulant = p.tremulant ? Object.fromEntries(DIVISIONS.map((d) => [d, p.tremulant!.includes(d)])) : undefined;
    let events = 0;
    for (const d of this.divisions()) events += d._events(settings(d));
    if (tremulant) events += this._setEvents({ tremulant });
    this.synth._reserve(events);
    for (const d of this.divisions()) d._apply(settings(d), t);
    if (tremulant) this.set({ tremulant }, options);
    this.active = typeof preset === 'string' ? preset : undefined;
    return this;
  }

  /** The organ's presets, its own and those added with {@link savePreset} or
   *  {@link OrganOptions.presets}, by name. */
  presets(): Record<string, OrganPreset> {
    return { ...this.definition.presets, ...this.saved };
  }

  /** Store a preset under a name, like the "set" button of a combination action: by default
   *  the stops and couplers drawn now. */
  savePreset(name: string, preset: OrganPreset = this.current()): this {
    this.saved[name] = preset;
    return this;
  }

  /** The stops drawn, couplers engaged and tremulants on now, as a preset. */
  current(): OrganPreset {
    const p: OrganPreset = {};
    const couple: OrganPreset['couple'] = {};
    for (const d of this.divisions()) {
      if (d.drawn().length) p[d.name] = d.drawn();
      if (d.coupled().length) couple[d.name] = d.coupled();
    }
    if (Object.keys(couple).length) p.couple = couple;
    const off = this.divisions().filter((d) => !d.unisonOn()).map((d) => d.name);
    if (off.length) p.unisonOff = off;
    const trem = [...new Set(this.trems.flatMap((tr, i) => (this.tremOn[i] ? list(tr.division) : [])))];
    if (trem.length) p.tremulant = trem;
    const forte = this.divisions().filter((d) => d.forteIsOn()).map((d) => d.name);
    if (forte.length) p.forte = forte;
    return p;
  }

  /** Name of the preset in use, or `undefined` once stops or couplers were changed by hand. */
  activePreset(): string | undefined {
    return this.active;
  }

  // ── MIDI ──────────────────────────────────────────────────────────────────

  /**
   * Play the organ from MIDI keyboards (after `synth.enableMidi()`): each division listens on
   * its channel, couplers included, and the swell pedal is CC 11 on a division's channel.
   * Program changes select presets (the names are checked now). Replaces the channels the
   * organ had. A preset that fails to apply on a program change is emitted as the synth's
   * `'error'` event when it has listeners, and otherwise ignored.
   *
   * ```ts
   * await synth.enableMidi();
   * organ.midi({ great: 1, swell: 2, pedal: 3 }, { presets: ['flutes', 'principal-chorus', 'plenum', 'full'] });
   * ```
   */
  midi(channels: OrganMidiChannels = { great: 1, swell: 2, positive: 3, pedal: 4 }, options: OrganMidiOptions = {}): this {
    this._engine();
    for (const [name, ch] of Object.entries(channels)) {
      this.division(name as DivisionName);
      if (!Number.isInteger(ch) || ch < 1 || ch > 16) throw new RangeError(`MIDI channel must be 1-16, got ${ch}`);
    }
    if (Array.isArray(options.presets)) for (const name of options.presets) this.checkPreset(this.lookup(name));
    this._detachMidi();
    for (const [name, ch] of Object.entries(channels)) this.synth._route(ch, this.division(name as DivisionName).channel);
    if (options.presets !== false) {
      const ours = new Set(Object.values(channels));
      const names = () => (options.presets === undefined ? Object.keys(this.presets()) : options.presets) as string[];
      // runs inside an event emitted for MIDI input: it must not throw
      this.midiListener = (e: MidiEvent) => {
        if (e.type !== 'programChange' || !ours.has(e.channel)) return;
        try {
          const name = names()[e.program ?? 0];
          if (name !== undefined) this.preset(name);
        } catch (err) {
          if (this.synth.listenerCount('error') > 0) this.synth.emit('error', err);
        }
      };
      this.synth.on('midi', this.midiListener);
    }
    return this;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** @internal The engine, unless this organ was removed. */
  _engine(): NativeEngine {
    if (this.removed) throw new SupersynthError(`This organ (${this.definition.id}) was removed from its synth`);
    return this.synth._native();
  }

  /** @internal */
  _time(o: TimeOptions): number | undefined {
    return resolveTime(this.synth.currentTime, o);
  }

  /** @internal */
  _isRemoved(): boolean {
    return this.removed;
  }

  /** @internal Applying the registration given to `synth.add` (its models load at once). */
  _isConstructing(): boolean {
    return this.constructing;
  }

  /** @internal A failure in the background: the synth's `'error'` event, when it has listeners. */
  _error(e: unknown): void {
    const err = e instanceof SupersynthError ? e : new SupersynthError(`The organ ${this.definition.name}: ${String((e as Error)?.message ?? e)}`);
    if (!this.removed && this.synth.listenerCount('error') > 0) this.synth.emit('error', err);
  }

  /** @internal Sound the stops drawn while their models were loading, waiting for those
   *  models (before an offline render, so that it renders what was asked). */
  _loadDrawn(): void {
    if (this.removed) return;
    for (const d of this.divisions()) d._loaded(true);
  }

  /** @internal Stops or couplers changed by hand. */
  _changed(): void {
    this.active = undefined;
  }

  /** @internal Removed from its synth: every later call that would sound throws. */
  _remove(): void {
    this.removed = true;
    this._detachMidi();
  }

  /** @internal Forget the MIDI channels and program-change listener. */
  _detachMidi(): void {
    for (const d of this.divisions()) if (d) this.synth._unroute(d.channel);
    if (this.midiListener) this.synth.off('midi', this.midiListener);
    this.midiListener = undefined;
  }

  /** @internal Engine channels the organ holds: its divisions, and its noises once on. */
  _channels(): number[] {
    return [...this.divisions().filter((d) => d).map((d) => d.channel), ...(this.noise ? [this.noise.channel] : [])];
  }

  /** @internal Play the noise of a stop (or coupler, tremulant) being drawn or retired. */
  _stopNoise(stop: { actionNoise?: [number, number] | undefined } | undefined, on: boolean, time: number | undefined): void {
    if (!this.noiseState.action || !this.noise || !this.definition.noises?.stops || !stop?.actionNoise) return;
    const note = stop.actionNoise[on ? 0 : 1];
    const n = this.synth._native();
    n.noteOn(this.noise.channel, note, 100, time);
    n.noteOff(this.noise.channel, note, time);
  }

  /** Engine events {@link set} sends at most for these settings. */
  private _setEvents(settings: OrganSettings): number {
    let events = 0;
    if (settings.tremulant !== undefined) for (const tr of this.trems) events += 2 + 3 * list(tr.division).length;
    if (settings.wind !== undefined) events += 4;
    if (settings.noises !== undefined) events += NOISE_EVENTS;
    return events;
  }

  /** Turn the machinery noises on or off. */
  private _noises(want: OrganNoiseSettings, time: number | undefined): void {
    const nz = this.definition.noises;
    const was = this.noiseState;
    if (!nz || !(want.blower || want.ambient || want.action || this.noise)) {
      this.noiseState = want;
      return;
    }
    const n = this.synth._native();
    if (!this.noise) {
      // one engine part for the blower, the room and the stop action: the blower on key 1,
      // the room on key 2, the stops on their own notes; key noise is a layer of each division.
      // Every model is loaded (for this organ) before the part is taken, so a missing model
      // leaves nothing half set up.
      const gain = finite(nz.gain ?? 0, 'noise gain');
      const layers: NativeLayer[] = [];
      const at = (model: string, key: number, note: number): NativeLayer => this.synth._layer({ model, transpose: note - key, gain, keyLow: key, keyHigh: key }, this);
      if (nz.blower) layers.push(at(nz.blower.model, 1, nz.blower.note ?? 60));
      if (nz.ambient) layers.push(at(nz.ambient.model, 2, nz.ambient.note ?? 60));
      if (nz.stops) layers.push(this.synth._layer({ model: nz.stops, gain, keyLow: 3, keyHigh: 127 }, this));
      const keys: [Division, NativeLayer[]][] = [];
      for (const d of this.divisions()) {
        const k = nz.keys?.[d.name];
        if (!k) continue;
        const kl: NativeLayer[] = [];
        if (k.down) kl.push({ ...this.synth._layer({ model: k.down, gain }, this), directOnly: true, enabled: false });
        if (k.up) kl.push({ ...this.synth._layer({ model: k.up, gain, trigger: 'release' }, this), directOnly: true, enabled: false });
        keys.push([d, kl]);
      }
      const channel = this.synth._attach(this);
      const keyLayers = new Map<DivisionName, number[]>();
      // held from now on, so that removing the organ frees it whatever happens next
      this.noise = { channel, keyLayers };
      n.setInstrument(channel, layers);
      n.setParam(channel, 'reverbSend', this.definition.reverbSend ?? ORGAN_DEFAULTS.reverbSend);
      if (this.synth._maxPartials < 512) n.setParam(channel, 'maxPartials', this.synth._maxPartials);
      for (const [d, kl] of keys) keyLayers.set(d.name, kl.map((l) => d._addLayer(l)));
    }
    this.noiseState = want;
    const ch = this.noise.channel;
    for (const [key, on, before] of [[1, want.blower, was.blower], [2, want.ambient, was.ambient]] as const) {
      if (on === before) continue;
      if (on) n.noteOn(ch, key, 100, time);
      else n.noteOff(ch, key, time);
    }
    if (want.action !== was.action) {
      for (const d of this.divisions()) for (const li of this.noise.keyLayers.get(d.name) ?? []) n.setLayerEnabled(d.channel, li, want.action, time);
    }
  }

  /** Start loading the models `options.preload` asks for: the starting preset's first. */
  private preload(def: OrganDefinition, preset: OrganPreset, options: OrganOptions): void {
    const mode = options.preload;
    if (mode !== undefined && mode !== 'all' && mode !== 'preset' && mode !== false) {
      throw new SupersynthError(`preload must be 'all', 'preset' or false, got ${String(mode)}`);
    }
    if (mode === false) return;
    const first = new Set<string>();
    for (const d of DIVISIONS) {
      for (const name of preset[d] ?? []) {
        const stop = findStop(def, d, name);
        first.add(stopModel(stop));
        if (stop.forte) first.add(stop.forte);
      }
    }
    if (options.noises && def.noises) for (const m of organModels({ stops: [], noises: def.noises })) first.add(m);
    const all = organModels(def);
    const names = (mode ?? this.synth._defaultPreload(all)) === 'all' ? [...first, ...all.filter((m) => !first.has(m))] : [...first];
    const ids = this.synth._preload(names, this);
    if (!ids.length) return;
    const promise = new Promise<void>((resolve, reject) => {
      this.synth._native().watchModels(ids, (error) => {
        if (this.loading) this.loading.settled = true;
        if (error === null) return resolve();
        const err = new SupersynthError(`The organ ${def.name}: ${error}`);
        this._error(err);
        reject(err);
      });
    });
    promise.catch(() => {}); // (awaiting it is optional: not an unhandled rejection)
    this.loading = { promise, settled: false, keptAlive: false };
  }

  private lookup(preset: string | OrganPreset): OrganPreset {
    if (typeof preset !== 'string') return preset;
    const all = this.presets();
    const p = all[preset];
    if (!p) throw new SupersynthError(`Unknown preset '${preset}'. Presets: ${Object.keys(all).join(', ')}`);
    return p;
  }

  /** Throw unless every stop, coupler and division a preset names exists. */
  private checkPreset(p: OrganPreset): void {
    for (const d of DIVISIONS) for (const s of p[d] ?? []) findStop(this.definition, d, s);
    for (const [k, v] of Object.entries(p.couple ?? {})) {
      checkDivision(k);
      for (const c of v ?? []) coupler(c);
    }
    for (const d of [...(p.unisonOff ?? []), ...(p.tremulant ?? []), ...(p.forte ?? [])]) checkDivision(d);
  }
}
