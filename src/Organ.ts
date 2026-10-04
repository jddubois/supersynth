import { SupersynthError } from './errors.js';
import { noteNumber, type NoteLike } from './notes.js';
import { CHURCH_DIVISIONS, ORGAN_DEFAULTS, SWELL_TREMULANT } from './organs/defaults.js';
import { ORGANS, type OrganInstrument } from './organs/index.js';
import type { DivisionName, OrganDef, OrganPreset, StopDef } from './organs/types.js';
import { playNotes, playSequence, resolveTime, type PlayOptions, type SequenceOptions, type SequenceStep, type TimeOptions } from './scheduling.js';
import type { Synth } from './Synth.js';
import type { MidiEvent } from './types.js';

export type { DivisionName, OrganDef, OrganPreset, StopDef } from './organs/types.js';

const DIVISIONS: DivisionName[] = ['great', 'swell', 'positive', 'pedal'];

/** The organ definition behind an id or a definition. */
export function resolveOrgan(instrument: OrganInstrument | OrganDef | undefined): OrganDef {
  if (instrument === undefined) return ORGANS.burea;
  if (typeof instrument !== 'string') return instrument;
  const def = (ORGANS as Record<string, OrganDef>)[instrument];
  if (!def) throw new SupersynthError(`Unknown organ '${instrument}'. Available: ${Object.keys(ORGANS).join(', ')}`);
  return def;
}

/** Model id of a stop. */
export function stopModel(stop: StopDef): string {
  return stop.model ?? `organ/${stop.id}`;
}

/** Stop names (or ids) as one list: `('a', 'b')`, `(['a', 'b'])` and `('a', ['b'])` are the same. */
type StopList = (string | string[])[];

/** One keyboard (manual or pedalboard) of the organ. */
export class Division {
  private layers = new Map<string, number>(); // stop name -> layer index in the engine
  private pulled = new Set<string>();
  private couplers = new Set<DivisionName>();

  /** @internal */
  constructor(
    private readonly organ: Organ,
    readonly name: DivisionName,
    /** Engine channel of this division. */
    readonly channel: number,
  ) {}

  /** All stops of this division. */
  stops(): StopDef[] {
    return this.organ.definition.stops.filter((s) => s.division === this.name);
  }

  /** Names of the stops currently drawn. */
  drawn(): string[] {
    return [...this.pulled];
  }

  /** Draw exactly these stops (by name or id) and retire the others; `set()` silences the
   *  division. Takes effect on held notes too. */
  set(...stops: StopList): this {
    const want = new Set(stops.flat().map((s) => this._stop(s).name));
    for (const n of [...this.pulled]) if (!want.has(n)) this.toggle(n, false);
    for (const n of want) this.toggle(n, true);
    this.organ._changed();
    return this;
  }

  /** Draw (pull) stops, by name (`"Trumpet 8'"`) or id. Takes effect on held notes too. */
  pull(...stops: StopList): this {
    for (const s of stops.flat()) this.toggle(this._stop(s).name, true);
    this.organ._changed();
    return this;
  }

  /** Retire (push in) stops. */
  push(...stops: StopList): this {
    for (const s of stops.flat()) this.toggle(this._stop(s).name, false);
    this.organ._changed();
    return this;
  }

  /** Couple other divisions to this keyboard: playing it also sounds their drawn stops.
   *  `organ.great.couple('swell')` is the "Swell to Great" coupler. Couplers act on every
   *  note, whether it comes from the API, a MIDI keyboard or a MIDI file. */
  couple(...divisions: (DivisionName | Division)[]): this {
    this._couplers([...this.couplers, ...divisions.map((d) => (typeof d === 'string' ? d : d.name))]);
    this.organ._changed();
    return this;
  }

  /** Release couplers to this keyboard; `uncouple()` releases all of them. */
  uncouple(...divisions: (DivisionName | Division)[]): this {
    const off = new Set(divisions.map((d) => (typeof d === 'string' ? d : d.name)));
    this._couplers(divisions.length ? [...this.couplers].filter((d) => !off.has(d)) : []);
    this.organ._changed();
    return this;
  }

  /** Divisions coupled to this keyboard. */
  coupled(): DivisionName[] {
    return [...this.couplers];
  }

  noteOn(note: NoteLike, velocity = 100, options: TimeOptions = {}): this {
    this.organ.synth._native().noteOn(this.channel, noteNumber(note), velocity, this.organ._time(options));
    return this;
  }

  noteOff(note: NoteLike, options: TimeOptions = {}): this {
    this.organ.synth._native().noteOff(this.channel, noteNumber(note), this.organ._time(options));
    return this;
  }

  /** Play notes for a duration (organs are not velocity sensitive). */
  play(notes: NoteLike | NoteLike[], options: PlayOptions = {}): this {
    playNotes(this, this.organ.synth.currentTime, notes, options, 100);
    return this;
  }

  /** Play a sequence of notes, one after another (see {@link Part.sequence}). Returns its length in seconds. */
  sequence(steps: SequenceStep[], options: SequenceOptions = {}): number {
    return playSequence((n, o) => this.play(n, o), this.organ.synth.currentTime, steps, options);
  }

  /** Swell pedal, 0 (shutters closed) – 1 (open). On the swell division it moves the swell
   *  box's shutters: closed is about 9 dB quieter and much darker, never silent. On other
   *  divisions it is a plain volume control. */
  expression(value: number, options: TimeOptions = {}): this {
    this.organ.synth._native().controlChange(this.channel, 11, Math.round(Math.max(0, Math.min(1, value)) * 127), this.organ._time(options));
    return this;
  }

  /** @internal The stop called `name` (name, case-insensitive, or id). */
  _stop(name: string): StopDef {
    const def = this.stops().find((s) => s.name.toLowerCase() === name.toLowerCase() || s.id === name);
    if (!def) {
      throw new SupersynthError(`No stop '${name}' on the ${this.name}. Stops: ${this.stops().map((s) => s.name).join(', ')}`);
    }
    return def;
  }

  /** @internal Replace the couplers (one engine change, so held notes are not restruck). */
  _couplers(names: DivisionName[]): void {
    const targets = [...new Set(names)].filter((n) => n !== this.name).map((n) => this.organ.division(n));
    this.couplers = new Set(targets.map((d) => d.name));
    this.organ.synth._native().setCouplers(this.channel, targets.map((d) => d.channel));
  }

  private toggle(name: string, on: boolean): void {
    if (this.pulled.has(name) === on) return;
    const def = this._stop(name);
    const synth = this.organ.synth;
    const n = synth._native();
    const li = this.layers.get(def.name);
    if (li === undefined) {
      // load the stop's model the first time it is drawn
      this.layers.set(def.name, this.layers.size);
      n.addLayer(this.channel, { ...synth._layer({ model: stopModel(def), transpose: def.transpose, gain: def.gain ?? 0 }), enabled: true });
    } else {
      n.setLayerEnabled(this.channel, li, on);
    }
    if (on) this.pulled.add(def.name);
    else this.pulled.delete(def.name);
  }
}

export interface OrganOptions {
  /** Which organ: a built-in id (`'burea'`: Bureå Church, 40 stops; `'vcsl'`: VCSL church
   *  organ with a Renaissance chamber organ as positive) or any {@link OrganDef}.
   *  @default 'burea' */
  instrument?: OrganInstrument | OrganDef;
  /** Preset to start with: a name or a preset. @default the organ's `defaultPreset` */
  preset?: string | OrganPreset;
  /** Presets added to the organ's own (a preset of the same name replaces the built-in one). */
  presets?: Record<string, OrganPreset>;
  /** Start with the tremulant on. @default false */
  tremulant?: boolean;
  /** Wind supply: how much the pipes of a division sag together when many start at once
   *  (pressure dip and regulator recovery). 0 = perfectly steady, 1 = flexible historic
   *  winding. @default the organ's `wind` (0.5) */
  wind?: number;
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
 * tremulant, played from an {@link OrganDef} (the Bureå Church organ by default).
 *
 * ```ts
 * const organ = synth.organ({ preset: 'plenum' });
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
  readonly definition: OrganDef;
  private saved: Record<string, OrganPreset>;
  private active: string | undefined;
  private midiListener: ((e: MidiEvent) => void) | undefined;

  /** @internal */
  constructor(readonly synth: Synth, options: OrganOptions = {}) {
    const def = resolveOrgan(options.instrument);
    this.definition = def;
    this.saved = { ...options.presets };
    this.great = new Division(this, 'great', synth._reserveChannel());
    this.swell = new Division(this, 'swell', synth._reserveChannel());
    this.positive = new Division(this, 'positive', synth._reserveChannel());
    this.pedal = new Division(this, 'pedal', synth._reserveChannel());
    const layout = def.divisions ?? CHURCH_DIVISIONS;
    const n = synth._native();
    for (const d of this.divisions()) {
      n.setInstrument(d.channel, []);
      n.setParam(d.channel, 'reverbSend', def.reverbSend ?? ORGAN_DEFAULTS.reverbSend);
      n.setParam(d.channel, 'pan', layout[d.name]?.pan ?? 0);
    }
    for (const d of this.divisions()) {
      if (layout[d.name]?.swellBox) n.setParam(d.channel, 'swellBox', 1);
    }
    this.wind(options.wind ?? def.wind ?? ORGAN_DEFAULTS.wind);
    this.preset(options.preset ?? def.defaultPreset);
    if (options.tremulant) this.tremulant(true);
  }

  /** The four divisions: great, swell, positive, pedal. */
  divisions(): Division[] {
    return [this.great, this.swell, this.positive, this.pedal];
  }

  division(name: DivisionName): Division {
    const d = this.divisions().find((x) => x.name === name);
    if (!d) throw new SupersynthError(`No division '${name}' (${DIVISIONS.join(', ')})`);
    return d;
  }

  /** All stops of this organ. */
  stops(): StopDef[] {
    return this.definition.stops;
  }

  /**
   * Apply a preset: a name from {@link presets} or a preset object. Replaces every drawn stop
   * and coupler; divisions the preset leaves out fall silent.
   *
   * ```ts
   * organ.preset('plenum');
   * organ.preset({ great: ["Principal 8'", "Octave 4'"], pedal: ["Subbass 16'"], couple: { pedal: ['great'] } });
   * ```
   */
  preset(preset: string | OrganPreset): this {
    const p = typeof preset === 'string' ? this.lookup(preset) : preset;
    // check everything before changing anything
    for (const d of this.divisions()) for (const s of p[d.name] ?? []) d._stop(s);
    for (const [k, v] of Object.entries(p.couple ?? {})) for (const n of [k, ...v]) this.division(n as DivisionName);
    for (const d of this.divisions()) {
      d.set(p[d.name] ?? []);
      d._couplers(p.couple?.[d.name] ?? []);
    }
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

  /**
   * Play the organ from MIDI keyboards (after `synth.enableMidi()`): each division listens on
   * its channel, couplers included, and the swell pedal is CC 11 on a division's channel.
   * Program changes select presets.
   *
   * ```ts
   * await synth.enableMidi();
   * organ.midi({ great: 1, swell: 2, pedal: 3 }, { presets: ['flutes', 'principal-chorus', 'plenum', 'full'] });
   * ```
   */
  midi(channels: OrganMidiChannels = { great: 1, swell: 2, positive: 3, pedal: 4 }, options: OrganMidiOptions = {}): this {
    const n = this.synth._native();
    for (const [name, ch] of Object.entries(channels)) n.setMidiRoute(ch, this.division(name as DivisionName).channel);
    if (this.midiListener) this.synth.off('midi', this.midiListener);
    this.midiListener = undefined;
    if (options.presets !== false) {
      const ours = new Set(Object.values(channels));
      const names = () => (options.presets === undefined ? Object.keys(this.presets()) : options.presets) as string[];
      this.midiListener = (e: MidiEvent) => {
        if (e.type !== 'programChange' || !ours.has(e.channel)) return;
        const name = names()[e.program ?? 0];
        if (name !== undefined) this.preset(name);
      };
      this.synth.on('midi', this.midiListener);
    }
    return this;
  }

  /** Tremulant: a periodic wobble of one division's wind pressure (see {@link OrganDef.tremulant}). */
  tremulant(on = true): this {
    // all pipes of the division pulse together in loudness and (less) in pitch
    const tr = this.definition.tremulant ?? SWELL_TREMULANT;
    const n = this.synth._native();
    const ch = this.division(tr.division).channel;
    n.setParam(ch, 'tremolo', on ? tr.depth : 0);
    n.setParam(ch, 'tremoloPitch', on ? tr.pitch : 0);
    n.setParam(ch, 'tremoloRate', tr.rate);
    return this;
  }

  /** Wind flexibility, 0 (steady) – 1 (flexible winding); see {@link OrganOptions.wind}. */
  wind(amount: number): this {
    for (const d of this.divisions()) this.synth._native().setParam(d.channel, 'wind', Math.max(0, amount));
    return this;
  }

  /** Play on the great (convenience). */
  play(notes: NoteLike | NoteLike[], options: PlayOptions = {}): this {
    this.great.play(notes, options);
    return this;
  }

  noteOn(note: NoteLike, velocity = 100, options: TimeOptions = {}): this {
    this.great.noteOn(note, velocity, options);
    return this;
  }

  noteOff(note: NoteLike, options: TimeOptions = {}): this {
    this.great.noteOff(note, options);
    return this;
  }

  /** @internal */
  _time(o: TimeOptions): number | undefined {
    return resolveTime(this.synth.currentTime, o);
  }

  /** @internal Stops or couplers changed by hand. */
  _changed(): void {
    this.active = undefined;
  }

  private lookup(name: string): OrganPreset {
    const all = this.presets();
    const p = all[name];
    if (!p) throw new SupersynthError(`Unknown preset '${name}'. Available: ${Object.keys(all).join(', ')}`);
    return p;
  }
}
