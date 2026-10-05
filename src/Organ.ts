import { SupersynthError } from './errors.js';
import type { NativeEngine } from './native.js';
import { noteNumber, type NoteLike } from './notes.js';
import { CHURCH_DIVISIONS, ORGAN_DEFAULTS, SWELL_TREMULANT } from './organs/defaults.js';
import { ORGANS, type OrganId } from './organs/index.js';
import type { DivisionName, OrganDefinition, OrganPreset, StopDefinition } from './organs/types.js';
import { playNotes, playSequence, resolveTime, type Keys, type Playable, type PlayOptions, type SequenceOptions, type SequenceStep, type TimeOptions } from './scheduling.js';
import type { Synth } from './Synth.js';
import type { MidiEvent } from './types.js';
import { clamp, finite, velocity as checkVelocity } from './validate.js';

export type { DivisionName, OrganDefinition, OrganPreset, StopDefinition } from './organs/types.js';

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

/** What {@link Division.set} changes: the stops drawn and the couplers, each replaced as a whole. */
export interface DivisionSettings {
  /** Exactly these stops drawn (by name or id); `[]` silences the division. */
  stops?: string[];
  /** Exactly these divisions coupled to this keyboard; `[]` releases every coupler. */
  couple?: DivisionName[];
}

/** One keyboard (manual or pedalboard) of the organ. */
export class Division implements Playable {
  private layers = new Map<string, number>(); // stop name -> layer index in the engine
  private pulled = new Set<string>();
  private couplers = new Set<DivisionName>();

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
    this.organ._engine().noteOn(this.channel, noteNumber(note), checkVelocity(velocity), this.organ._time(options));
    return this;
  }

  noteOff(note: NoteLike, options: TimeOptions = {}): this {
    this.organ._engine().noteOff(this.channel, noteNumber(note), this.organ._time(options));
    return this;
  }

  /** Play notes for a duration (organs are not velocity sensitive). */
  play(notes: NoteLike | NoteLike[], options: PlayOptions = {}): this {
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
    this.organ.synth._reserve(2 * names.length);
    for (const n of names) this.toggle(n, true, t);
    this.organ._changed();
    return this;
  }

  /** Retire (push in) a stop or several. */
  push(stops: string | string[], options: TimeOptions = {}): this {
    this.organ._engine();
    const names = list(stops).map((s) => this._stop(s).name);
    const t = this.organ._time(options);
    this.organ.synth._reserve(names.length);
    for (const n of names) this.toggle(n, false, t);
    this.organ._changed();
    return this;
  }

  /** Couple another division or several to this keyboard: playing it also sounds their drawn
   *  stops. `organ.great.couple('swell')` is the "Swell to Great" coupler. Couplers act on
   *  every note, whether it comes from the API, a MIDI keyboard or a MIDI file. */
  couple(divisions: DivisionName | DivisionName[], options: TimeOptions = {}): this {
    this.organ._engine();
    this._couplers([...this.couplers, ...list(divisions)], this.organ._time(options));
    this.organ._changed();
    return this;
  }

  /** Release couplers to this keyboard. */
  uncouple(divisions: DivisionName | DivisionName[], options: TimeOptions = {}): this {
    this.organ._engine();
    const off = new Set(list(divisions));
    this._couplers([...this.couplers].filter((d) => !off.has(d)), this.organ._time(options));
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
    for (const d of settings.couple ?? []) checkDivision(d);
    const t = this.organ._time(options);
    this.organ.synth._reserve(2 * (this.pulled.size + (settings.stops?.length ?? 0)) + 1);
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

  /** Divisions coupled to this keyboard. */
  coupled(): DivisionName[] {
    return [...this.couplers];
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

  /** @internal Apply checked settings. */
  _apply(settings: DivisionSettings, time: number | undefined): void {
    if (settings.stops) {
      const want = new Set(settings.stops.map((s) => this._stop(s).name));
      for (const n of [...this.pulled]) if (!want.has(n)) this.toggle(n, false, time);
      for (const n of want) this.toggle(n, true, time);
    }
    if (settings.couple) this._couplers(settings.couple, time);
  }

  /** Replace the couplers (one engine change, so held notes are not restruck). */
  private _couplers(names: DivisionName[], time: number | undefined): void {
    const targets = [...new Set(names)].filter((n) => n !== this.name).map((n) => this.organ.division(n));
    this.organ.synth._native().setCouplers(this.channel, targets.map((d) => d.channel), time);
    this.couplers = new Set(targets.map((d) => d.name));
  }

  private toggle(name: string, on: boolean, time: number | undefined): void {
    if (this.pulled.has(name) === on) return;
    const def = this._stop(name);
    const synth = this.organ.synth;
    const n = synth._native();
    let li = this.layers.get(def.name);
    if (li === undefined) {
      // load the stop's model the first time it is drawn; added now (silent) so that layer
      // indices follow the order of the calls, and sounded at its time
      li = this.layers.size;
      n.addLayer(this.channel, { ...synth._layer({ model: stopModel(def), transpose: def.transpose, gain: def.gain ?? 0 }, this.organ), enabled: false });
      this.layers.set(def.name, li);
    }
    n.setLayerEnabled(this.channel, li, on, time);
    if (on) this.pulled.add(def.name);
    else this.pulled.delete(def.name);
  }
}

/** What {@link Organ.set} changes. */
export interface OrganSettings {
  /** The tremulant (see {@link OrganDefinition.tremulant}). */
  tremulant?: boolean;
  /** Wind supply: how much the pipes of a division sag together when many start at once
   *  (pressure dip and regulator recovery). 0 = perfectly steady, 1 = flexible historic
   *  winding. */
  wind?: number;
}

export interface OrganOptions extends OrganSettings {
  /** Preset to start with: a name or a preset. @default the organ's `defaultPreset` */
  preset?: string | OrganPreset;
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
  private saved: Record<string, OrganPreset>;
  private active: string | undefined;
  private midiListener: ((e: MidiEvent) => void) | undefined;
  private removed = false;

  /** @internal Use {@link Synth.add}. */
  constructor(
    /** The synth it plays in. */
    readonly synth: Synth,
    organ: OrganId | OrganDefinition,
    options: OrganOptions = {},
  ) {
    const def = resolveOrgan(organ);
    this.definition = def;
    this.saved = { ...options.presets };
    const preset = options.preset ?? def.defaultPreset;
    // fail before taking channels
    this.checkPreset(this.lookup(preset));
    const wind = finite(options.wind ?? def.wind ?? ORGAN_DEFAULTS.wind, 'wind');
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
      const layout = def.divisions ?? CHURCH_DIVISIONS;
      const n = synth._native();
      synth._reserve(32);
      for (const d of this.divisions()) {
        n.setInstrument(d.channel, []);
        n.setParam(d.channel, 'reverbSend', def.reverbSend ?? ORGAN_DEFAULTS.reverbSend);
        n.setParam(d.channel, 'pan', layout[d.name]?.pan ?? 0);
        if (synth._maxPartials < 512) n.setParam(d.channel, 'maxPartials', synth._maxPartials);
      }
      for (const d of this.divisions()) {
        if (layout[d.name]?.swellBox) n.setParam(d.channel, 'swellBox', 1);
      }
      this.set({ wind, ...(options.tremulant ? { tremulant: true } : {}) });
      this.preset(preset);
    } catch (e) {
      this.removed = true;
      synth._detach(this, channels);
      throw e;
    }
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

  /** Change the tremulant and/or the wind; what is left out stays as it is. */
  set(settings: OrganSettings, options: TimeOptions = {}): this {
    const n = this._engine();
    const t = this._time(options);
    const wind = settings.wind === undefined ? undefined : Math.max(0, finite(settings.wind, 'wind'));
    this.synth._reserve(7);
    if (settings.tremulant !== undefined) {
      // all pipes of the division pulse together in loudness and (less) in pitch
      const tr = this.definition.tremulant ?? SWELL_TREMULANT;
      const ch = this.division(tr.division).channel;
      n.setParam(ch, 'tremolo', settings.tremulant ? tr.depth : 0, t);
      n.setParam(ch, 'tremoloPitch', settings.tremulant ? tr.pitch : 0, t);
      n.setParam(ch, 'tremoloRate', tr.rate, t);
    }
    if (wind !== undefined) {
      for (const d of this.divisions()) n.setParam(d.channel, 'wind', wind, t);
    }
    return this;
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
    let events = 4;
    for (const d of this.divisions()) events += 2 * (d.drawn().length + (p[d.name]?.length ?? 0));
    this.synth._reserve(events);
    for (const d of this.divisions()) d._apply({ stops: p[d.name] ?? [], couple: p.couple?.[d.name] ?? [] }, t);
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

  /** The stops drawn and couplers engaged now, as a preset. */
  current(): OrganPreset {
    const p: OrganPreset = {};
    const couple: OrganPreset['couple'] = {};
    for (const d of this.divisions()) {
      if (d.drawn().length) p[d.name] = d.drawn();
      if (d.coupled().length) couple[d.name] = d.coupled();
    }
    if (Object.keys(couple).length) p.couple = couple;
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

  private lookup(preset: string | OrganPreset): OrganPreset {
    if (typeof preset !== 'string') return preset;
    const all = this.presets();
    const p = all[preset];
    if (!p) throw new SupersynthError(`Unknown preset '${preset}'. Presets: ${Object.keys(all).join(', ')}`);
    return p;
  }

  /** Throw unless every stop and division a preset names exists. */
  private checkPreset(p: OrganPreset): void {
    for (const d of DIVISIONS) for (const s of p[d] ?? []) findStop(this.definition, d, s);
    for (const [k, v] of Object.entries(p.couple ?? {})) for (const n of [k, ...(v ?? [])]) checkDivision(n);
  }
}
