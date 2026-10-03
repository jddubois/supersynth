import { SupersynthError } from './errors.js';
import { noteNumber, type NoteLike } from './notes.js';
import { CHURCH_DIVISIONS, ORGAN_DEFAULTS, SWELL_TREMULANT } from './organs/defaults.js';
import { BUREA_ORGAN, ORGANS, type OrganInstrument } from './organs/index.js';
import type { DivisionName, OrganDef, StopDef } from './organs/types.js';
import { playNotes, playSequence, resolveTime, type PlayOptions, type SequenceOptions, type SequenceStep, type TimeOptions } from './scheduling.js';
import type { Synth } from './Synth.js';

export type { DivisionName, OrganDef, Registration, StopDef } from './organs/types.js';

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

/** One keyboard (manual or pedalboard) of the organ. */
export class Division {
  private stopIndex = new Map<string, number>(); // stop name -> layer index in the engine
  private pulled = new Set<string>();
  private couplersTo = new Set<Division>();

  /** @internal */
  constructor(
    private readonly organ: Organ,
    readonly name: DivisionName,
    /** Engine channel of this division. */
    readonly channel: number,
  ) {}

  /** All stops of this division. */
  get stops(): StopDef[] {
    return this.organ.definition.stops.filter((s) => s.division === this.name);
  }

  /** Names of the stops currently drawn. */
  get drawn(): string[] {
    return [...this.pulled];
  }

  /** Draw (pull) a stop. Takes effect on held notes too. */
  pull(...names: string[]): this {
    for (const name of names) this.setStop(name, true);
    return this;
  }

  /** Retire (push in) a stop. */
  push(...names: string[]): this {
    for (const name of names) this.setStop(name, false);
    return this;
  }

  /** Retire all stops. */
  clear(): this {
    for (const n of [...this.pulled]) this.setStop(n, false);
    return this;
  }

  private setStop(name: string, on: boolean): void {
    const def = this.stops.find((s) => s.name.toLowerCase() === name.toLowerCase() || s.id === name);
    if (!def) {
      throw new SupersynthError(`No stop '${name}' on the ${this.name}. Stops: ${this.stops.map((s) => s.name).join(', ')}`);
    }
    const synth = this.organ.synth;
    const n = synth._native();
    let li = this.stopIndex.get(def.name);
    if (li === undefined) {
      if (!on) return;
      // load the stop's model the first time it is drawn
      li = this.stopIndex.size;
      n.addLayer(this.channel, { ...synth._layer({ model: stopModel(def), transpose: def.transpose, gain: def.gain ?? 0 }), enabled: on });
      this.stopIndex.set(def.name, li);
    } else {
      n.setLayerEnabled(this.channel, li, on);
    }
    if (on) this.pulled.add(def.name);
    else this.pulled.delete(def.name);
  }

  /** @internal */
  _couple(to: Division, on: boolean): void {
    if (on) this.couplersTo.add(to);
    else this.couplersTo.delete(to);
  }

  /** @internal */
  get _coupledTo(): Division[] {
    return [...this.couplersTo];
  }

  noteOn(note: NoteLike, velocity = 100, options: TimeOptions = {}): this {
    const m = noteNumber(note);
    const t = this.organ._time(options);
    for (const d of this.targets()) this.organ.synth._native().noteOn(d.channel, m, velocity, t);
    return this;
  }

  noteOff(note: NoteLike, options: TimeOptions = {}): this {
    const m = noteNumber(note);
    const t = this.organ._time(options);
    for (const d of this.targets()) this.organ.synth._native().noteOff(d.channel, m, t);
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

  private targets(): Division[] {
    const out = new Set<Division>([this]);
    for (const d of this.couplersTo) out.add(d);
    return [...out];
  }
}

export interface OrganOptions {
  /** Which organ: a built-in id (`'burea'`: Bureå Church, 40 stops; `'vcsl'`: VCSL church
   *  organ with a Renaissance chamber organ as positive) or any {@link OrganDef}.
   *  @default 'burea' */
  instrument?: OrganInstrument | OrganDef;
  /** Registration to start with. @default the organ's `defaultRegistration` */
  registration?: string;
  /** Start with the tremulant on. @default false */
  tremulant?: boolean;
  /** Wind supply: how much the pipes of a division sag together when many start at once
   *  (pressure dip and regulator recovery). 0 = perfectly steady, 1 = flexible historic
   *  winding. @default the organ's `wind` (0.5) */
  wind?: number;
}

/**
 * A real church organ: four divisions with drawable stops, couplers, swell pedal and
 * tremulant, played from an {@link OrganDef} (the Bureå Church organ by default).
 *
 * ```ts
 * const organ = synth.organ({ registration: 'plenum' });
 * organ.great.play(['C4', 'E4', 'G4'], { duration: 3 });
 * organ.pedal.play('C2', { duration: 3 });
 * organ.great.pull("Trumpet 8'");
 * ```
 */
export class Organ {
  readonly great: Division;
  readonly swell: Division;
  readonly positive: Division;
  readonly pedal: Division;
  private _registration = '';
  /** The organ's definition: stops, registrations, layout. */
  readonly definition: OrganDef;

  /** @internal */
  constructor(readonly synth: Synth, options: OrganOptions = {}) {
    const def = resolveOrgan(options.instrument);
    this.definition = def;
    this.great = new Division(this, 'great', synth._reserveChannel());
    this.swell = new Division(this, 'swell', synth._reserveChannel());
    this.positive = new Division(this, 'positive', synth._reserveChannel());
    this.pedal = new Division(this, 'pedal', synth._reserveChannel());
    const layout = def.divisions ?? CHURCH_DIVISIONS;
    const n = synth._native();
    for (const d of this.divisions) {
      n.setInstrument(d.channel, []);
      n.setParam(d.channel, 'reverbSend', def.reverbSend ?? ORGAN_DEFAULTS.reverbSend);
      n.setParam(d.channel, 'pan', layout[d.name]?.pan ?? 0);
    }
    for (const d of this.divisions) {
      if (layout[d.name]?.swellBox) n.setParam(d.channel, 'swellBox', 1);
    }
    this.setWind(options.wind ?? def.wind ?? ORGAN_DEFAULTS.wind);
    this.useRegistration(options.registration ?? def.defaultRegistration);
    if (options.tremulant) this.tremulant(true);
  }

  /** Id of the organ (`'burea'`, `'vcsl'`, or a custom definition's id). */
  get instrument(): string {
    return this.definition.id;
  }

  get divisions(): Division[] {
    return [this.great, this.swell, this.positive, this.pedal];
  }

  /** Name of the last registration applied. */
  get registration(): string {
    return this._registration;
  }

  /** Registrations of the Bureå organ. @deprecated use `organ.registrations` or `BUREA_ORGAN` */
  static get registrations(): Record<string, string> {
    return describe(BUREA_ORGAN.registrations);
  }

  /** All stops of the Bureå organ. @deprecated use `BUREA_ORGAN.stops` */
  static get stops(): StopDef[] {
    return BUREA_ORGAN.stops;
  }

  /** All stops of this organ. */
  get stops(): StopDef[] {
    return this.definition.stops;
  }

  /** Named registrations of this organ, with their descriptions. */
  get registrations(): Record<string, string> {
    return describe(this.definition.registrations);
  }

  /** Apply a named registration (replaces all drawn stops and couplers). */
  useRegistration(name: string): this {
    const regs = this.definition.registrations;
    const r = regs[name];
    if (!r) throw new SupersynthError(`Unknown registration '${name}'. Available: ${Object.keys(regs).join(', ')}`);
    for (const d of this.divisions) {
      d.clear();
      for (const o of this.divisions) d._couple(o, false);
      const stops = r[d.name];
      if (stops) d.pull(...stops);
    }
    for (const c of r.couplers ?? []) this.couple(c, true);
    this._registration = name;
    return this;
  }

  /** Wind flexibility, 0 (steady) – 1 (flexible winding); see {@link OrganOptions.wind}. */
  setWind(amount: number): this {
    for (const d of this.divisions) this.synth._native().setParam(d.channel, 'wind', Math.max(0, amount));
    return this;
  }

  /** Engage or release a coupler, e.g. `organ.couple('swell>great')`. */
  couple(spec: string, on = true): this {
    const [from, to] = spec.split('>').map((s) => s.trim()) as [DivisionName, DivisionName];
    const src = this.division(to); // playing on `to` also sounds `from`
    const dst = this.division(from);
    src._couple(dst, on);
    return this;
  }

  /** Tremulant: a periodic wobble of one division's wind pressure (see {@link OrganDef.tremulant}). */
  tremulant(on: boolean): this {
    // all pipes of the division pulse together in loudness and (less) in pitch
    const tr = this.definition.tremulant ?? SWELL_TREMULANT;
    const n = this.synth._native();
    const ch = this.division(tr.division).channel;
    n.setParam(ch, 'tremolo', on ? tr.depth : 0);
    n.setParam(ch, 'tremoloPitch', on ? tr.pitch : 0);
    n.setParam(ch, 'tremoloRate', tr.rate);
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

  division(name: DivisionName): Division {
    const d = this.divisions.find((x) => x.name === name);
    if (!d) throw new SupersynthError(`No division '${name}' (${DIVISIONS.join(', ')})`);
    return d;
  }

  /** @internal */
  _time(o: TimeOptions): number | undefined {
    return resolveTime(this.synth.currentTime, o);
  }
}

function describe(regs: OrganDef['registrations']): Record<string, string> {
  return Object.fromEntries(Object.entries(regs).map(([k, r]) => [k, r.description]));
}
