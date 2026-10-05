import { SupersynthError } from './errors.js';
import { noteNumber, type NoteLike } from './notes.js';
import { CHURCH_DIVISIONS, ORGAN_DEFAULTS, SWELL_TREMULANT } from './organs/defaults.js';
import { ORGANS, type OrganId } from './organs/index.js';
import type { CouplerLike, DivisionName, OrganDefinition, OrganPreset, StopDefinition, TremulantDefinition } from './organs/types.js';
import { playNotes, playSequence, resolveTime, type Playable, type PlayOptions, type SequenceOptions, type SequenceStep, type TimeOptions } from './scheduling.js';
import type { NativeLayer } from './native.js';
import type { Synth } from './Synth.js';
import type { MidiEvent } from './types.js';

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

const list = <T>(x: T | T[]): T[] => (Array.isArray(x) ? x : [x]);

/** A coupler as division + octave (−1, 0, 1). */
interface Coupler {
  division: DivisionName;
  octave: -1 | 0 | 1;
}

function coupler(c: CouplerLike): Coupler {
  if (typeof c === 'string') return { division: c, octave: 0 };
  const octave = c.octave ?? 0;
  if (octave !== -1 && octave !== 0 && octave !== 1) throw new RangeError(`Coupler octave must be -1, 0 or 1, got ${String(octave)}`);
  return { division: c.division, octave };
}

const couplerLike = (c: Coupler): CouplerLike => (c.octave === 0 ? c.division : { division: c.division, octave: c.octave });
const sameCoupler = (a: Coupler, b: Coupler): boolean => a.division === b.division && a.octave === b.octave;

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

  /** @internal */
  constructor(
    private readonly organ: Organ,
    readonly name: DivisionName,
    /** @internal Engine channel (0–31). */
    readonly channel: number,
  ) {}

  // ── notes ─────────────────────────────────────────────────────────────────

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

  /** Play a sequence of notes, one after another (see {@link Instrument.sequence}). Returns its length in seconds. */
  sequence(steps: SequenceStep[], options: SequenceOptions = {}): number {
    return playSequence((n, o) => this.play(n, o), this.organ.synth.currentTime, steps, options);
  }

  /** Release every held key of this division. */
  allNotesOff(options: TimeOptions = {}): this {
    this.organ.synth._native().allNotesOff(this.channel, this.organ._time(options));
    return this;
  }

  /** Swell pedal, 0 (shutters closed) – 1 (open). On the swell division it moves the swell
   *  box's shutters: closed is about 9 dB quieter and much darker, never silent. On other
   *  divisions it is a plain volume control. */
  expression(value: number, options: TimeOptions = {}): this {
    this.organ.synth._native().controlChange(this.channel, 11, Math.round(Math.max(0, Math.min(1, value)) * 127), this.organ._time(options));
    return this;
  }

  // ── stops and couplers ────────────────────────────────────────────────────

  /** Draw (pull) a stop or several, by name (`"Trumpet 8'"`, case-insensitive) or id. Takes
   *  effect on held notes too. */
  pull(stops: string | string[], options: TimeOptions = {}): this {
    const names = list(stops).map((s) => this._stop(s).name);
    const t = this.organ._time(options);
    for (const n of names) this.toggle(n, true, t);
    this.organ._changed();
    return this;
  }

  /** Retire (push in) a stop or several. */
  push(stops: string | string[], options: TimeOptions = {}): this {
    const names = list(stops).map((s) => this._stop(s).name);
    const t = this.organ._time(options);
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
    const add = list(couplers).map(coupler);
    for (const c of add) this.organ.division(c.division);
    this._couplers([...this.couplers, ...add], this.organ._time(options));
    this.organ._changed();
    return this;
  }

  /** Release couplers to this keyboard: a division's name releases all of its couplers
   *  (unison and octave), `{ division, octave }` just that one. */
  uncouple(couplers: CouplerLike | CouplerLike[], options: TimeOptions = {}): this {
    const off = list(couplers);
    const gone = (c: Coupler) => off.some((o) => (typeof o === 'string' ? o === c.division : sameCoupler(coupler(o), c)));
    this._couplers(this.couplers.filter((c) => !gone(c)), this.organ._time(options));
    this.organ._changed();
    return this;
  }

  /** Unison on (the default) or off: with the unison off the keys play only what is coupled
   *  to this keyboard, e.g. a super octave coupler alone plays the stops an octave up. */
  unison(on: boolean, options: TimeOptions = {}): this {
    this.unisonOff = !on;
    this._couplers(this.couplers, this.organ._time(options));
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
    for (const s of settings.stops ?? []) this._stop(s);
    for (const c of settings.couple ?? []) this.organ.division(coupler(c).division);
    this._apply(settings, this.organ._time(options));
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
    this._forte(on, this.organ._time(options));
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

  /** @internal The stop called `name` (name, case-insensitive, or id). */
  _stop(name: string): StopDefinition {
    const def = this.stops().find((s) => s.name.toLowerCase() === name.toLowerCase() || s.id === name);
    if (!def) {
      throw new SupersynthError(`No stop '${name}' on the ${this.name}. Stops: ${this.stops().map((s) => s.name).join(', ')}`);
    }
    return def;
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
    this.couplers = keep;
    const targets = keep.map((c) => ({ part: this.organ.division(c.division).channel, shift: 12 * c.octave }));
    this.organ.synth._native().setCouplers(this.channel, targets, this.unisonOff, time);
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

  private toggle(name: string, on: boolean, time: number | undefined): void {
    if (this.pulled.has(name) === on) return;
    const def = this._stop(name);
    const synth = this.organ.synth;
    const n = synth._native();
    let li = this.layers.get(def.name);
    if (li === undefined) {
      // load the stop's model the first time it is drawn; added now (silent) so that layer
      // indices follow the order of the calls, and sounded at its time
      const [keyLow, keyHigh] = def.keys ?? [0, 127];
      const layer = (model: string): NativeLayer => ({
        ...synth._layer({ model, transpose: def.transpose, gain: def.gain ?? 0, keyLow, keyHigh }),
        speechMs: this.organ.definition.speech ?? ORGAN_DEFAULTS.speech,
        enabled: false,
      });
      li = this._addLayer(layer(stopModel(def)));
      this.layers.set(def.name, li);
      if (def.forte) this.forteLayers.set(def.name, this._addLayer(layer(def.forte)));
    }
    const f = this.forteLayers.get(def.name);
    n.setLayerEnabled(this.channel, li, on && !(f !== undefined && this.forteOn), time);
    if (f !== undefined) n.setLayerEnabled(this.channel, f, on && this.forteOn, time);
    this.organ._stopNoise(def, on, time);
    if (on) this.pulled.add(def.name);
    else this.pulled.delete(def.name);
  }
}

/** What {@link Organ.set} changes. */
export interface OrganSettings {
  /** The tremulants (see {@link OrganDefinition.tremulant}): `true`/`false` for all, or by a
   *  division they shake, `{ swell: true }`. */
  tremulant?: boolean | Partial<Record<DivisionName, boolean>>;
  /** The sounds of the machinery ({@link OrganDefinition.noises}): blower and room while on,
   *  key and stop action. Organs without noise recordings ignore it. */
  noises?: boolean;
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
  private readonly trems: TremulantDefinition[];
  private tremOn: boolean[];
  private noisesOn_ = false;
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
    this.tremOn = this.trems.map(() => false);
    this.saved = { ...options.presets };
    const preset = options.preset ?? def.defaultPreset;
    this.lookup(preset); // fail before taking channels
    this.great = new Division(this, 'great', synth._attach(this));
    this.swell = new Division(this, 'swell', synth._attach(this));
    this.positive = new Division(this, 'positive', synth._attach(this));
    this.pedal = new Division(this, 'pedal', synth._attach(this));
    const layout = def.divisions ?? CHURCH_DIVISIONS;
    const n = synth._native();
    for (const d of this.divisions()) {
      n.setInstrument(d.channel, []);
      n.setParam(d.channel, 'reverbSend', def.reverbSend ?? ORGAN_DEFAULTS.reverbSend);
      n.setParam(d.channel, 'pan', layout[d.name]?.pan ?? 0);
      if (synth._maxPartials < 512) n.setParam(d.channel, 'maxPartials', synth._maxPartials);
    }
    for (const d of this.divisions()) {
      const box = layout[d.name]?.swellBox;
      if (!box) continue;
      n.setParam(d.channel, 'swellBox', 1);
      if (typeof box === 'object') {
        const closed = Math.min(0, box.closed ?? -9);
        n.setParam(d.channel, 'swellClosed', closed);
        n.setParam(d.channel, 'swellShelf', Math.min(0, box.shelf ?? (closed * 14) / 9));
      }
    }
    this.set({ wind: options.wind ?? def.wind ?? ORGAN_DEFAULTS.wind, ...(options.tremulant !== undefined ? { tremulant: options.tremulant } : {}) });
    this.preset(preset);
    if (options.noises) this.set({ noises: true });
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
    const n = this.synth._native();
    const t = this._time(options);
    const tr = settings.tremulant;
    if (tr !== undefined) {
      if (typeof tr === 'object') for (const d of Object.keys(tr)) this.division(d as DivisionName);
      this.trems.forEach((trem, i) => {
        const divs = list(trem.division);
        const on = typeof tr === 'boolean' ? tr : divs.some((d) => tr[d]) ? true : divs.some((d) => tr[d] === false) ? false : undefined;
        if (on === undefined) return;
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
    if (settings.wind !== undefined) {
      for (const d of this.divisions()) n.setParam(d.channel, 'wind', Math.max(0, settings.wind), t);
    }
    if (settings.noises !== undefined && settings.noises !== this.noisesOn_) this.noises(settings.noises, t);
    return this;
  }

  /** The tremulants and whether each is on. */
  tremulants(): { definition: TremulantDefinition; on: boolean }[] {
    return this.trems.map((definition, i) => ({ definition, on: this.tremOn[i] ?? false }));
  }

  /** Whether the machinery noises are on (see {@link OrganSettings.noises}). */
  noisesOn(): boolean {
    return this.noisesOn_;
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
    const p = this.lookup(preset);
    // check everything before changing anything
    for (const d of this.divisions()) for (const s of p[d.name] ?? []) d._stop(s);
    for (const [k, v] of Object.entries(p.couple ?? {})) for (const c of [k, ...v]) this.division(typeof c === 'string' ? (c as DivisionName) : c.division);
    for (const d of [...(p.unisonOff ?? []), ...(p.tremulant ?? []), ...(p.forte ?? [])]) this.division(d);
    const t = this._time(options);
    const off = new Set(p.unisonOff ?? []);
    const forte = new Set(p.forte ?? []);
    for (const d of this.divisions()) {
      d._apply({ stops: p[d.name] ?? [], couple: p.couple?.[d.name] ?? [], unison: !off.has(d.name), forte: forte.has(d.name) }, t);
    }
    if (p.tremulant) {
      const on = new Set(p.tremulant);
      this.set({ tremulant: Object.fromEntries(DIVISIONS.map((d) => [d, on.has(d)])) }, options);
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
   * Program changes select presets. Replaces the channels the organ had.
   *
   * ```ts
   * await synth.enableMidi();
   * organ.midi({ great: 1, swell: 2, pedal: 3 }, { presets: ['flutes', 'principal-chorus', 'plenum', 'full'] });
   * ```
   */
  midi(channels: OrganMidiChannels = { great: 1, swell: 2, positive: 3, pedal: 4 }, options: OrganMidiOptions = {}): this {
    for (const [name, ch] of Object.entries(channels)) {
      this.division(name as DivisionName);
      if (!Number.isInteger(ch) || ch < 1 || ch > 16) throw new RangeError(`MIDI channel must be 1-16, got ${ch}`);
    }
    this._detachMidi();
    for (const [name, ch] of Object.entries(channels)) this.synth._route(ch, this.division(name as DivisionName).channel);
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

  // ── internals ─────────────────────────────────────────────────────────────

  /** @internal */
  _time(o: TimeOptions): number | undefined {
    return resolveTime(this.synth.currentTime, o);
  }

  /** @internal Stops or couplers changed by hand. */
  _changed(): void {
    this.active = undefined;
  }

  /** @internal Forget the MIDI channels and program-change listener. */
  _detachMidi(): void {
    for (const d of this.divisions()) this.synth._unroute(d.channel);
    if (this.midiListener) this.synth.off('midi', this.midiListener);
    this.midiListener = undefined;
  }

  /** @internal Engine channels the organ holds: its divisions, and its noises once on. */
  _channels(): number[] {
    return [...this.divisions().map((d) => d.channel), ...(this.noise ? [this.noise.channel] : [])];
  }

  /** @internal Play a stop's drawing or retiring noise. */
  _stopNoise(stop: StopDefinition, on: boolean, time: number | undefined): void {
    const nz = this.definition.noises;
    if (!this.noisesOn_ || !this.noise || !nz?.stops || !stop.actionNoise) return;
    const note = stop.actionNoise[on ? 0 : 1];
    const n = this.synth._native();
    n.noteOn(this.noise.channel, note, 100, time);
    n.noteOff(this.noise.channel, note, time);
  }

  /** Turn the machinery noises on or off. */
  private noises(on: boolean, time: number | undefined): void {
    const nz = this.definition.noises;
    this.noisesOn_ = on;
    if (!nz) return;
    const n = this.synth._native();
    const gain = nz.gain ?? 0;
    if (!this.noise) {
      // one engine part for the blower, the room and the stop action: the blower on key 1,
      // the room on key 2, the stops on their own notes; key noise is a layer of each division
      const channel = this.synth._attach(this);
      const layers: NativeLayer[] = [];
      const at = (model: string, key: number, note: number): NativeLayer => ({
        ...this.synth._layer({ model, transpose: note - key, gain, keyLow: key, keyHigh: key }),
      });
      if (nz.blower) layers.push(at(nz.blower.model, 1, nz.blower.note ?? 60));
      if (nz.ambient) layers.push(at(nz.ambient.model, 2, nz.ambient.note ?? 60));
      if (nz.stops) layers.push({ ...this.synth._layer({ model: nz.stops, gain, keyLow: 3, keyHigh: 127 }) });
      n.setInstrument(channel, layers);
      n.setParam(channel, 'reverbSend', this.definition.reverbSend ?? ORGAN_DEFAULTS.reverbSend);
      const keyLayers = new Map<DivisionName, number[]>();
      for (const d of this.divisions()) {
        const k = nz.keys?.[d.name];
        if (!k) continue;
        const idx: number[] = [];
        if (k.down) idx.push(d._addLayer({ ...this.synth._layer({ model: k.down, gain }), directOnly: true, enabled: false }));
        if (k.up) idx.push(d._addLayer({ ...this.synth._layer({ model: k.up, gain, trigger: 'release' }), directOnly: true, enabled: false }));
        keyLayers.set(d.name, idx);
      }
      this.noise = { channel, keyLayers };
    }
    const ch = this.noise.channel;
    for (const key of [1, 2]) {
      if (on) n.noteOn(ch, key, 100, time);
      else n.noteOff(ch, key, time);
    }
    for (const d of this.divisions()) for (const li of this.noise.keyLayers.get(d.name) ?? []) n.setLayerEnabled(d.channel, li, on, time);
  }

  private lookup(preset: string | OrganPreset): OrganPreset {
    if (typeof preset !== 'string') return preset;
    const all = this.presets();
    const p = all[preset];
    if (!p) throw new SupersynthError(`Unknown preset '${preset}'. Presets: ${Object.keys(all).join(', ')}`);
    return p;
  }
}
