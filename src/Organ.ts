import { SupersynthError } from './errors.js';
import { noteNumber, type NoteLike } from './notes.js';
import type { PlayOptions, TimeOptions } from './Part.js';
import type { Synth } from './Synth.js';

export type DivisionName = 'great' | 'swell' | 'positive' | 'pedal';

export interface StopDef {
  /** Stop id (Bureå: model models/organ/<id>.ssm). */
  id: string;
  /** Model id when it is not `organ/<id>` (e.g. a VCSL organ model). */
  model?: string;
  /** Stop name as engraved on the stop knob, e.g. "Principal 8'". */
  name: string;
  division: DivisionName;
  family: 'principal' | 'flute' | 'string' | 'reed' | 'mutation' | 'mixture';
  /** Semitones between the key pressed and the sounding pitch of the stop's model zones. */
  transpose: number;
  /** Level of the stop (dB) when its recordings were normalised separately. */
  gain?: number;
}

/**
 * The Bureå Church organ (Nils Hammarberg, 1967; sampled by Lars Palo, CC BY-SA 2.5 SE):
 * every pipe of every stop analysed into spectral models.
 */
export const BUREA_STOPS: StopDef[] = [
  { id: 'great-principal-8', name: "Principal 8'", division: 'great', family: 'principal', transpose: 0 },
  { id: 'great-gedackt-8', name: "Gedackt 8'", division: 'great', family: 'flute', transpose: 0 },
  { id: 'extra-hohlflute-8', name: "Hohlflöte 8'", division: 'great', family: 'flute', transpose: 0 },
  { id: 'great-octave-4', name: "Octave 4'", division: 'great', family: 'principal', transpose: 12 },
  { id: 'great-rohrflute-4', name: "Rohrflöte 4'", division: 'great', family: 'flute', transpose: 12 },
  { id: 'great-octave-2', name: "Octave 2'", division: 'great', family: 'principal', transpose: 24 },
  { id: 'great-sesquialtera', name: 'Sesquialtera II', division: 'great', family: 'mixture', transpose: 0 },
  { id: 'great-mixture', name: 'Mixture V', division: 'great', family: 'mixture', transpose: 0 },
  { id: 'great-trumpet-8', name: "Trumpet 8'", division: 'great', family: 'reed', transpose: 0 },

  { id: 'swell-rohrflute-8', name: "Rohrflöte 8'", division: 'swell', family: 'flute', transpose: 0 },
  { id: 'swell-salicional-8', name: "Salicional 8'", division: 'swell', family: 'string', transpose: 0 },
  { id: 'extra-voix-celeste-8', name: "Voix céleste 8'", division: 'swell', family: 'string', transpose: 0 },
  { id: 'swell-principal-4', name: "Principal 4'", division: 'swell', family: 'principal', transpose: 12 },
  { id: 'swell-hohlflute-4', name: "Hohlflöte 4'", division: 'swell', family: 'flute', transpose: 12 },
  { id: 'extra-gemshorn-4', name: "Gemshorn 4'", division: 'swell', family: 'principal', transpose: 12 },
  { id: 'swell-waldflute-2', name: "Waldflöte 2'", division: 'swell', family: 'flute', transpose: 24 },
  { id: 'swell-tierce-1-3-5', name: "Terz 1 3/5'", division: 'swell', family: 'mutation', transpose: 28 },
  { id: 'swell-nasard-1-1-3', name: "Nasat 1 1/3'", division: 'swell', family: 'mutation', transpose: 31 },
  { id: 'swell-septime-1-1-7', name: "Septime 1 1/7'", division: 'swell', family: 'mutation', transpose: 34 },
  { id: 'swell-scharf', name: 'Scharf III', division: 'swell', family: 'mixture', transpose: 0 },
  { id: 'swell-schalmei-8', name: "Schalmei 8'", division: 'swell', family: 'reed', transpose: 0 },

  { id: 'positive-gedackt-8', name: "Gedackt 8'", division: 'positive', family: 'flute', transpose: 0 },
  { id: 'extra-quintadena-8', name: "Quintadena 8'", division: 'positive', family: 'flute', transpose: 0 },
  { id: 'positive-koppelflute-4', name: "Koppelflöte 4'", division: 'positive', family: 'flute', transpose: 12 },
  { id: 'positive-quint-2-2-3', name: "Rohrquinte 2 2/3'", division: 'positive', family: 'mutation', transpose: 19 },
  { id: 'positive-principal-2', name: "Principal 2'", division: 'positive', family: 'principal', transpose: 24 },
  { id: 'extra-flautino-2', name: "Flötlein 2'", division: 'positive', family: 'flute', transpose: 24 },
  { id: 'positive-octave-1', name: "Octave 1'", division: 'positive', family: 'principal', transpose: 36 },
  { id: 'extra-sifflote-1', name: "Sifflöte 1'", division: 'positive', family: 'flute', transpose: 36 },
  { id: 'positive-cymbel', name: 'Cymbel II', division: 'positive', family: 'mixture', transpose: 0 },
  { id: 'positive-krummhorn-8', name: "Krummhorn 8'", division: 'positive', family: 'reed', transpose: 0 },

  { id: 'pedal-subbass-16', name: "Subbass 16'", division: 'pedal', family: 'flute', transpose: -12 },
  { id: 'extra-violone-16', name: "Violon 16'", division: 'pedal', family: 'string', transpose: -12 },
  { id: 'pedal-principal-8', name: "Principal 8'", division: 'pedal', family: 'principal', transpose: 0 },
  { id: 'pedal-gedackt-8', name: "Gedackt 8'", division: 'pedal', family: 'flute', transpose: 0 },
  { id: 'pedal-octave-4', name: "Octave 4'", division: 'pedal', family: 'principal', transpose: 12 },
  { id: 'pedal-nachthorn-2', name: "Nachthorn 2'", division: 'pedal', family: 'flute', transpose: 24 },
  { id: 'pedal-rauschpfeife', name: 'Rauschpfeife IV', division: 'pedal', family: 'mixture', transpose: 0 },
  { id: 'pedal-bassoon-16', name: "Fagott 16'", division: 'pedal', family: 'reed', transpose: -12 },
  { id: 'pedal-trumpet-4', name: "Trumpet 4'", division: 'pedal', family: 'reed', transpose: 12 },
];

/**
 * The VCSL church organ (Simon Dalzell / Ivy Audio, via the Versilian Community Sample
 * Library, CC0): a church instrument recorded in stereo with its room — a full chorus and a
 * flute registration on the manual, loud and soft pedal — with a Renaissance chamber organ
 * (separate 8' and 4' ranks) as the positive.
 */
export const VCSL_STOPS: StopDef[] = [
  { id: 'full', model: 'pipe-organ', name: 'Full Organ', division: 'great', family: 'mixture', transpose: 0, gain: 0 },
  { id: 'flutes', model: 'pipe-organ-soft', name: 'Flutes', division: 'great', family: 'flute', transpose: 0, gain: -7.8 },
  { id: 'swell-full', model: 'pipe-organ', name: 'Full Organ', division: 'swell', family: 'mixture', transpose: 0, gain: 0 },
  { id: 'swell-flutes', model: 'pipe-organ-soft', name: 'Flutes', division: 'swell', family: 'flute', transpose: 0, gain: -7.8 },
  { id: 'chamber-8', model: 'renaissance-organ-8', name: "Gedackt 8'", division: 'positive', family: 'flute', transpose: 0, gain: -15.4 },
  { id: 'chamber-4', model: 'renaissance-organ-4', name: "Principal 4'", division: 'positive', family: 'principal', transpose: 0, gain: -14.5 },
  { id: 'chamber-full', model: 'renaissance-organ-full', name: 'Chorus', division: 'positive', family: 'mixture', transpose: 0, gain: -8.7 },
  { id: 'pedal-loud', model: 'pipe-organ-pedal', name: "Pedal 16' + 8'", division: 'pedal', family: 'principal', transpose: 0, gain: 0 },
  { id: 'pedal-soft', model: 'pipe-organ-pedal-soft', name: "Soft Bass 16'", division: 'pedal', family: 'flute', transpose: 0, gain: -12.8 },
];

/** A registration: stops per division plus couplers. */
export interface Registration {
  description: string;
  great?: string[];
  swell?: string[];
  positive?: string[];
  pedal?: string[];
  /** Couplers as `'swell>great'`, `'great>pedal'` etc. */
  couplers?: string[];
}

export const REGISTRATIONS: Record<string, Registration> = {
  principal: {
    description: "Principal 8' alone — the foundation tone of the organ",
    great: ["Principal 8'"],
    pedal: ["Subbass 16'", "Principal 8'"],
  },
  'principal-chorus': {
    description: "Principal chorus 8' 4' 2' (Baroque plenum without mixture)",
    great: ["Principal 8'", "Octave 4'", "Octave 2'"],
    pedal: ["Subbass 16'", "Principal 8'", "Octave 4'"],
    couplers: ['great>pedal'],
  },
  plenum: {
    description: 'Organo pleno for Bach preludes and fugues: principals and mixtures',
    great: ["Principal 8'", "Octave 4'", "Octave 2'", 'Mixture V'],
    positive: ["Gedackt 8'", "Koppelflöte 4'", "Principal 2'", 'Cymbel II'],
    pedal: ["Subbass 16'", "Principal 8'", "Octave 4'", 'Rauschpfeife IV', "Fagott 16'"],
    couplers: ['great>pedal'],
  },
  full: {
    description: 'Full organ with reeds and all manuals coupled',
    great: ["Principal 8'", "Gedackt 8'", "Octave 4'", "Octave 2'", 'Mixture V', 'Sesquialtera II', "Trumpet 8'"],
    swell: ["Rohrflöte 8'", "Principal 4'", "Waldflöte 2'", 'Scharf III', "Schalmei 8'"],
    positive: ["Gedackt 8'", "Koppelflöte 4'", "Principal 2'", 'Cymbel II', "Krummhorn 8'"],
    pedal: ["Subbass 16'", "Violon 16'", "Principal 8'", "Octave 4'", 'Rauschpfeife IV', "Fagott 16'", "Trumpet 4'"],
    couplers: ['swell>great', 'positive>great', 'great>pedal'],
  },
  flutes: {
    description: "Flutes 8' + 4' — gentle, for chorale preludes",
    great: ["Gedackt 8'", "Rohrflöte 4'"],
    pedal: ["Subbass 16'", "Gedackt 8'"],
  },
  'flute-8': {
    description: "Gedackt 8' — soft stopped flute",
    positive: ["Gedackt 8'"],
    pedal: ["Subbass 16'"],
  },
  cornet: {
    description: 'Cornet (8\' 4\' 2 2/3\' 2\' 1 3/5\') — solo voice for ornamented melodies',
    great: ["Gedackt 8'", "Rohrflöte 4'", 'Sesquialtera II'],
    swell: ["Rohrflöte 8'", "Hohlflöte 4'", "Waldflöte 2'", "Terz 1 3/5'"],
    pedal: ["Subbass 16'", "Gedackt 8'"],
  },
  trumpet: {
    description: "Trumpet 8' with Principal — festive solo",
    great: ["Principal 8'", "Trumpet 8'"],
    pedal: ["Subbass 16'", "Principal 8'", "Fagott 16'"],
  },
  krummhorn: {
    description: "Krummhorn 8' — nasal Renaissance reed solo",
    positive: ["Gedackt 8'", "Krummhorn 8'"],
    pedal: ["Subbass 16'", "Gedackt 8'"],
  },
  celeste: {
    description: "Salicional + Voix céleste — shimmering strings for romantic music",
    swell: ["Salicional 8'", "Voix céleste 8'"],
    pedal: ["Subbass 16'"],
  },
  'quiet-strings': {
    description: "Salicional 8' alone",
    swell: ["Salicional 8'"],
    pedal: ["Subbass 16'"],
  },
  'sesquialtera-solo': {
    description: 'Sesquialtera solo with flutes — the classic Dutch/Scandinavian chorale cantus',
    great: ["Gedackt 8'", "Rohrflöte 4'", 'Sesquialtera II'],
    pedal: ["Subbass 16'", "Gedackt 8'"],
  },
};

export const VCSL_REGISTRATIONS: Record<string, Registration> = {
  full: {
    description: 'Full organ: the full chorus with loud pedal',
    great: ['Full Organ'],
    pedal: ["Pedal 16' + 8'"],
  },
  flutes: {
    description: 'Soft flutes with soft pedal — gentle, for chorale preludes',
    great: ['Flutes'],
    pedal: ["Soft Bass 16'"],
  },
  chamber: {
    description: "Chamber organ 8' + 4' — bright Renaissance consort sound",
    positive: ["Gedackt 8'", "Principal 4'"],
    pedal: ["Soft Bass 16'"],
  },
  'chamber-8': {
    description: "Chamber organ Gedackt 8' alone",
    positive: ["Gedackt 8'"],
    pedal: ["Soft Bass 16'"],
  },
  dialogue: {
    description: 'Full organ on the great against flutes on the swell (play the two manuals in alternation)',
    great: ['Full Organ'],
    swell: ['Flutes'],
    pedal: ["Pedal 16' + 8'"],
  },
};

/** The organs available through `synth.organ({ instrument })`. */
export const ORGANS = {
  burea: { stops: BUREA_STOPS, registrations: REGISTRATIONS, defaultRegistration: 'principal-chorus' },
  vcsl: { stops: VCSL_STOPS, registrations: VCSL_REGISTRATIONS, defaultRegistration: 'full' },
} as const;
export type OrganInstrument = keyof typeof ORGANS;

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
    return this.organ.stopDefs.filter((s) => s.division === this.name);
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
      n.addLayer(this.channel, { ...synth._layer({ model: def.model ?? `organ/${def.id}`, transpose: def.transpose, gain: def.gain ?? 0 }), enabled: on });
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
    const list = Array.isArray(notes) ? notes : [notes];
    const t = this.organ._time(options);
    const start = t ?? this.organ.synth.currentTime;
    const dur = options.duration ?? 1;
    for (const note of list) {
      this.noteOn(note, 100, t !== undefined ? { at: t } : {});
      this.noteOff(note, { at: start + dur });
    }
    return this;
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
  /** Which organ: `'burea'` (Bureå Church, 40 stops) or `'vcsl'` (VCSL church organ with a
   *  Renaissance chamber organ as positive). @default 'burea' */
  instrument?: OrganInstrument;
  /** Registration to start with. @default 'principal-chorus' (Bureå), 'full' (VCSL) */
  registration?: string;
  /** Tremulant on the swell. @default false */
  tremulant?: boolean;
  /** Wind supply: how much the pipes of a division sag together when many start at once
   *  (pressure dip and regulator recovery). 0 = perfectly steady, 1 = flexible historic
   *  winding. @default 0.5 */
  wind?: number;
}

/**
 * A real church organ: four divisions with drawable stops, couplers, swell pedal and
 * tremulant. Every pipe was analysed from the Bureå Church organ (Sweden).
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
  /** Which organ this is. */
  readonly instrument: OrganInstrument;

  /** @internal */
  constructor(readonly synth: Synth, options: OrganOptions = {}) {
    const inst = options.instrument ?? 'burea';
    if (!(inst in ORGANS)) {
      throw new SupersynthError(`Unknown organ '${inst}'. Available: ${Object.keys(ORGANS).join(', ')}`);
    }
    this.instrument = inst;
    this.great = new Division(this, 'great', synth._reserveChannel());
    this.swell = new Division(this, 'swell', synth._reserveChannel());
    this.positive = new Division(this, 'positive', synth._reserveChannel());
    this.pedal = new Division(this, 'pedal', synth._reserveChannel());
    for (const d of this.divisions) {
      synth._native().setInstrument(d.channel, []);
      // pipes are recorded in the church, and key-up plays each pipe's recorded release with
      // the church's own reverberation: the artificial reverb only adds width
      synth._native().setParam(d.channel, 'reverbSend', 0.07);
      synth._native().setParam(d.channel, 'pan', d.name === 'pedal' ? 0 : d.name === 'swell' ? 0.15 : d.name === 'positive' ? -0.15 : 0);
    }
    // the swell division stands in a swell box: its pedal moves shutters (treble is damped
    // far more than bass, and the closed box is quieter, never silent)
    synth._native().setParam(this.swell.channel, 'swellBox', 1);
    this.setWind(options.wind ?? 0.5);
    this.useRegistration(options.registration ?? ORGANS[inst].defaultRegistration);
    if (options.tremulant) this.tremulant(true);
  }

  get divisions(): Division[] {
    return [this.great, this.swell, this.positive, this.pedal];
  }

  /** Name of the last registration applied. */
  get registration(): string {
    return this._registration;
  }

  /** Named registrations. */
  static get registrations(): Record<string, string> {
    return Object.fromEntries(Object.entries(REGISTRATIONS).map(([k, r]) => [k, r.description]));
  }

  /** All stops of the (Bureå) organ. */
  static get stops(): StopDef[] {
    return BUREA_STOPS;
  }

  /** @internal Stops of this organ. */
  get stopDefs(): StopDef[] {
    return ORGANS[this.instrument].stops;
  }

  /** Named registrations of this organ. */
  get registrations(): Record<string, string> {
    return Object.fromEntries(Object.entries(ORGANS[this.instrument].registrations).map(([k, r]) => [k, r.description]));
  }

  /** Apply a named registration (replaces all drawn stops and couplers). */
  useRegistration(name: string): this {
    const regs: Record<string, Registration> = ORGANS[this.instrument].registrations;
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

  /** Tremulant (wind-pressure wobble) on the swell division. */
  tremulant(on: boolean): this {
    // the tremulant modulates the swell's wind pressure: all pipes pulse together in
    // loudness and (less) in pitch — about 6 Hz, ±2.5 dB, ±8 cents
    const n = this.synth._native();
    n.setParam(this.swell.channel, 'tremolo', on ? 2.5 : 0);
    n.setParam(this.swell.channel, 'tremoloPitch', on ? 8 : 0);
    n.setParam(this.swell.channel, 'tremoloRate', 6.2);
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
    if (!d) throw new SupersynthError(`No division '${name}' (great, swell, positive, pedal)`);
    return d;
  }

  /** @internal */
  _time(o: TimeOptions): number | undefined {
    if (o.at !== undefined) return o.at;
    if (o.delay !== undefined) return this.synth.currentTime + o.delay;
    return undefined;
  }
}
