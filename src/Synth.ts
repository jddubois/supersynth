import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';

import { INSTRUMENTS, type InstrumentDefinition, type InstrumentId, type LayerDefinition } from './catalog/index.js';
import { AbortError, AudioBackendError, MidiError, SupersynthError } from './errors.js';
import { Instrument, type InstrumentOptions } from './Instrument.js';
import { parseMidiFile, type MidiFileData, type MidiFileEvent } from './midifile.js';
import { assertOrganModels, resolveModelFile } from './models.js';
import { loadNative, type NativeEngine, type NativeLayer } from './native.js';
import type { ReverbOptions, ReverbPreset } from './parameters.js';
import { defaultParameter, PARAMETER_NAMES, REVERB_FIELDS, toNativeParameter, type InstrumentParameters } from './parameters.js';
import { Organ, type Division, type OrganOptions } from './Organ.js';
import { ORGAN_DEFAULTS } from './organs/defaults.js';
import { ORGANS, type OrganDefinition, type OrganId } from './organs/index.js';
import { resolveTime, type TimeOptions } from './scheduling.js';
import { atLeast, clamp, finite, guardEngine, integer, positive, QUEUE_CAPACITY } from './validate.js';
import { deinterleave, makeAudioBuffer, writeWav, type AudioBuffer, type WavOptions } from './wav.js';
import type { MidiEvent } from './types.js';

export type AudioBackend = 'auto' | 'coreaudio' | 'wasapi' | 'alsa' | 'jack' | 'pulseaudio' | 'pipewire';

/** What {@link Synth.set} changes. */
export interface SynthSettings {
  /** Master volume, 0–1 (linear). */
  volume?: number;
  /** The room: a reverb preset, detailed options, or `false` for no reverb. */
  reverb?: ReverbPreset | ReverbOptions | false;
}

export interface SynthOptions extends Omit<SynthSettings, 'reverb'> {
  /** Sample rate in Hz. Default: the audio device's rate (48000 if there is no device). */
  sampleRate?: number;
  /** Audio backend. @default 'auto' */
  backend?: AudioBackend;
  /** The room: a reverb preset, detailed options, `false` for none, or `'auto'` for the room
   *  suggested by the first instrument or organ added. @default 'auto' */
  reverb?: ReverbPreset | ReverbOptions | false | 'auto';
  /** Master volume, 0–1 (linear). @default 0.5 */
  volume?: number;
  /** Maximum sounding voices before the quietest are stolen. @default 192 */
  maxVoices?: number;
  /** Audio buffer size in frames (smaller = lower latency, more CPU risk). Default: device default. */
  bufferSize?: number;
  /** CPU cores rendering audio, the audio thread included (1–16), or `'auto'`: one per core
   *  but one, at most 8 (3 on a Raspberry Pi 5). Voices are spread over the cores; the sound is
   *  exactly the same for any number. Offline rendering uses them too. @default 'auto' */
  threads?: number | 'auto';
  /** Directory searched first for `.ssm` models, laid out like the package's `models/`
   *  (`organ/friesach/<stop>.ssm`; also `$SUPERSYNTH_MODELS_DIR`). Default: the models shipped
   *  with supersynth and the installed organ packages (`@supersynth/organ-<id>`). */
  modelsDirectory?: string;
  /** CPU/quality trade-off: partials per note up to 512 (`'high'`), 128 (`'balanced'`) or 32 (`'eco'`,
   *  for small boards such as a Raspberry Pi). @default 'high' */
  quality?: 'high' | 'balanced' | 'eco';
}

export interface MidiFileOptions {
  /** Where each MIDI channel (1–16) plays — or each track (0-based track index), with
   *  `byTrack` — e.g. `{ 1: 'violin', 2: organ.pedal }`. Default: every channel plays `instrument`. */
  channels?: Record<number, MidiTarget>;
  /** Where channels not listed play. @default 'grand-piano' */
  instrument?: MidiTarget;
  /** Map by track index (0 = the first track) instead of channel. @default false */
  byTrack?: boolean;
  /** Tempo scale, above 0 (2 = twice as fast). @default 1 */
  speed?: number;
  /** Transpose all notes (whole semitones). @default 0 */
  transpose?: number;
  /** Seconds of tail rendered/waited after the last event, 0 or more. @default 3 */
  tail?: number;
  /** {@link Synth.playMidi} only: stops playback when aborted (its notes are released) and
   *  rejects the promise with an {@link AbortError}. */
  signal?: AbortSignal;
}

/** Where the notes of a MIDI file go: an instrument id (added for the file, and removed when
 *  it ends), an instrument, or an organ division. */
export type MidiTarget = InstrumentId | Instrument | Division;

/** Events sent ahead of the engine, at most, while a MIDI file plays (some room is kept for
 *  other calls). */
const MIDI_PENDING = QUEUE_CAPACITY - 1024;

/** A model loaded in the engine, and the instruments and organs that use it. */
interface LoadedModel {
  id: number;
  users: Set<object>;
}

/**
 * The synthesizer: an engine that plays real instruments, in real time or offline.
 *
 * ```ts
 * import { Synth } from 'supersynth';
 *
 * const synth = new Synth();
 * const piano = synth.add('grand-piano');
 * await synth.start();                  // real-time output
 * piano.play(['C4', 'E4', 'G4'], { duration: 2 });
 *
 * // or offline, without an audio device:
 * const audio = synth.render(3);        // { sampleRate, left, right, duration }
 * synth.renderToFile('chord.wav', 3);
 * ```
 */
export class Synth extends EventEmitter {
  private engine: NativeEngine;
  /** What owns each engine channel. */
  private slots: (Instrument | Organ | null)[] = new Array(32).fill(null);
  /** Engine channel each MIDI channel (1–16, index 0–15) plays, if any. */
  private routes: (number | null)[] = new Array(16).fill(null);
  private models = new Map<string, LoadedModel>();
  private modelsDirectory: string | undefined;
  /** `'auto'`: the room follows the first instrument or organ added (`roomOwner`). */
  private reverbMode: 'auto' | 'set';
  private roomOwner: object | undefined;
  /** Reverb return level (dB) last asked for, restored when the reverb is turned back on. */
  private reverbLevel = 0;
  private reverbOn = true;
  private maxPartials: number;
  private closed = false;

  constructor(options: SynthOptions = {}) {
    super();
    const N = loadNative();
    const reverbPreset = typeof options.reverb === 'string' && options.reverb !== 'auto' ? options.reverb : 'hall';
    try {
      this.engine = guardEngine(new N.SynthEngine({
        ...(options.sampleRate !== undefined ? { sampleRate: integer(options.sampleRate, 1, 1e7, 'sampleRate') } : {}),
        ...(options.backend ? { backend: options.backend } : {}),
        ...(options.maxVoices !== undefined ? { maxVoices: integer(options.maxVoices, 1, 1e6, 'maxVoices') } : {}),
        ...(options.bufferSize !== undefined ? { bufferSize: integer(options.bufferSize, 1, 1e7, 'bufferSize') } : {}),
        ...(options.threads !== undefined && options.threads !== 'auto' ? { threads: integer(options.threads, 1, 16, 'threads') } : {}),
        reverb: reverbPreset,
      }));
    } catch (e) {
      throw e instanceof SupersynthError ? e : new SupersynthError((e as Error).message);
    }
    this.modelsDirectory = options.modelsDirectory;
    this.maxPartials = { high: 512, balanced: 128, eco: 32 }[options.quality ?? 'high'];
    this.reverbMode = options.reverb === undefined || options.reverb === 'auto' ? 'auto' : 'set';
    this.set({
      volume: options.volume ?? 0.5,
      ...(options.reverb !== undefined && options.reverb !== 'auto' ? { reverb: options.reverb } : {}),
    });
  }

  // ── info ──────────────────────────────────────────────────────────────────

  get sampleRate(): number {
    return this.engine.sampleRate;
  }

  /** Engine clock in seconds. Use it to schedule events precisely (`{ at: synth.currentTime + 0.5 }`). */
  get currentTime(): number {
    return this.engine.currentTime;
  }

  /** Number of sounding voices. */
  get activeVoices(): number {
    return this.engine.activeVoices;
  }

  /** Fraction of real time the last audio buffer took to render (0.1 = 10 % of a core). */
  get cpuLoad(): number {
    return this.engine.cpuLoad;
  }

  /** Threads rendering audio, the audio thread included (see {@link SynthOptions.threads}). */
  get threads(): number {
    return this.engine.threads;
  }

  get isRunning(): boolean {
    return this.engine.isRunning;
  }

  /** The engine's internal error, if it hit one: it then outputs silence until a new `Synth`
   *  is created. `null` while all is well. */
  get engineError(): string | null {
    return this.engine.faulted ? (this.engine.error ?? 'engine fault') : null;
  }

  // ── instruments ───────────────────────────────────────────────────────────

  /**
   * Add an instrument or an organ: a built-in one by id (see `INSTRUMENTS` and `ORGANS`) or
   * any definition. An instrument plays on one channel; an organ has four divisions (great,
   * swell, positive, pedal), each on its own channel.
   *
   * @example
   * const piano = synth.add('grand-piano', { preset: 'mellow', parameters: { volume: -3 } });
   * const organ = synth.add('burea', { preset: 'plenum' });
   * organ.great.play(['C4', 'E4', 'G4'], { duration: 4 });
   */
  add(instrument: InstrumentId | InstrumentDefinition, options?: InstrumentOptions): Instrument;
  add(organ: OrganId | OrganDefinition, options?: OrganOptions): Organ;
  add(what: InstrumentId | OrganId | InstrumentDefinition | OrganDefinition, options: InstrumentOptions | OrganOptions = {}): Instrument | Organ {
    this.checkOpen();
    const organ = typeof what === 'string' ? (ORGANS as Record<string, OrganDefinition>)[what] : 'stops' in what ? what : undefined;
    if (organ) {
      assertOrganModels(organ, this.modelsDirectory); // a missing organ package fails before any channel is taken
      const o = new Organ(this, organ, options as OrganOptions);
      this._suggestRoom(organ.reverb ?? ORGAN_DEFAULTS.reverb, o);
      return o;
    }
    if (typeof what === 'string' && !(what in INSTRUMENTS)) {
      throw new SupersynthError(`Unknown instrument '${what}'. Instruments: ${Object.keys(INSTRUMENTS).join(', ')}; organs: ${Object.keys(ORGANS).join(', ')}`);
    }
    return new Instrument(this, what as InstrumentId | InstrumentDefinition, options as InstrumentOptions);
  }

  /** The instruments and organs added, in the order of their first channel. */
  instruments(): (Instrument | Organ)[] {
    return [...new Set(this.slots.filter((x): x is Instrument | Organ => x !== null))];
  }

  /** Remove an instrument or an organ: its notes stop at once, its channels and MIDI channels
   *  are freed, and the models nothing else uses are unloaded. Using it afterwards throws. */
  remove(item: Instrument | Organ): void {
    const channels = item instanceof Organ ? item._channels() : [item.channel];
    if (channels.some((ch) => this.slots[ch] !== item)) return;
    item._remove();
    this._detach(item, channels);
  }

  // ── sound ─────────────────────────────────────────────────────────────────

  /**
   * Change the master volume and/or the room; what is left out stays as it is (the reverb
   * level too: `reverb: false` and back restores it).
   *
   * ```ts
   * synth.set({ volume: 0.8 });
   * synth.set({ reverb: 'cathedral' });
   * synth.set({ reverb: { preset: 'hall', decay: 3.2, predelay: 30 } }, { at: 12 });
   * ```
   */
  set(settings: SynthSettings, options: TimeOptions = {}): this {
    this.checkOpen();
    const t = resolveTime(this.currentTime, options);
    const n = this.engine;
    const volume = settings.volume === undefined ? undefined : clamp(settings.volume, 0, 1, 'volume');
    const reverb = settings.reverb;
    const opts: ReverbOptions | undefined = reverb === undefined || reverb === false ? undefined : typeof reverb === 'string' ? { preset: reverb } : reverb;
    for (const k of Object.keys(REVERB_FIELDS)) {
      const v = (opts as Record<string, unknown> | undefined)?.[k];
      if (v !== undefined) finite(v, `reverb.${k}`);
    }
    this._reserve(2 + Object.keys(REVERB_FIELDS).length * 2);
    if (reverb !== undefined) {
      this.reverbMode = 'set';
      if (reverb === false) {
        n.setMasterParam('reverbLevel', -120, t);
        this.reverbOn = false;
      } else if (opts) {
        if (opts.preset) n.setReverbPreset(opts.preset, t);
        if (opts.level !== undefined) this.reverbLevel = opts.level;
        else if (!this.reverbOn) n.setMasterParam('reverbLevel', this.reverbLevel, t);
        this.reverbOn = true;
        for (const [k, name] of Object.entries(REVERB_FIELDS)) {
          const v = (opts as Record<string, number | undefined>)[k];
          if (v !== undefined) n.setMasterParam(name, v, t);
        }
      }
    }
    if (volume !== undefined) n.setMasterParam('volume', volume <= 0 ? -120 : 20 * Math.log10(volume), t);
    return this;
  }

  /** Release every held note of every instrument and organ. */
  allNotesOff(options: TimeOptions = {}): this {
    this.engine.allNotesOff(null, resolveTime(this.currentTime, options));
    return this;
  }

  /** Silence everything immediately. */
  panic(): this {
    this.engine.allSoundOff();
    return this;
  }

  // ── output ────────────────────────────────────────────────────────────────

  /** Start real-time audio output. */
  async start(): Promise<this> {
    this.checkOpen();
    try {
      this.engine.start();
    } catch (e) {
      throw new AudioBackendError(`Failed to start audio: ${(e as Error).message}`);
    }
    return this;
  }

  /** Stop real-time output (the engine keeps its state; `render()` works again). */
  stop(): this {
    this.engine.stop();
    return this;
  }

  /** Stop output and MIDI, and release every instrument, organ and model. The synth cannot
   *  be used afterwards. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.engine.disableMidi();
    } catch {
      /* not enabled */
    }
    this.engine.stop();
    for (const item of this.instruments()) this.remove(item);
    for (const m of this.models.values()) this.unload(m.id);
    this.models.clear();
  }

  /**
   * Render audio offline (no audio device needed). Advances the engine clock.
   * Notes scheduled with `play()`/`at` are rendered at their times.
   */
  render(seconds: number): AudioBuffer {
    this.checkOpen();
    if (this.engine.isRunning) throw new SupersynthError('render() is unavailable while real-time output is running');
    const total = Math.round(Math.max(0, finite(seconds, 'seconds')) * this.sampleRate);
    const left = new Float32Array(total);
    const right = new Float32Array(total);
    const chunk = 8192;
    for (let pos = 0; pos < total; pos += chunk) {
      const n = Math.min(chunk, total - pos);
      const [l, r] = deinterleave(this.engine.render(n));
      left.set(l, pos);
      right.set(r, pos);
    }
    return makeAudioBuffer(this.sampleRate, left, right);
  }

  /** Render offline and write a WAV file. */
  renderToFile(file: string, seconds: number, options: WavOptions = {}): AudioBuffer {
    const audio = this.render(seconds);
    writeWav(file, audio, options);
    return audio;
  }

  // ── MIDI files ────────────────────────────────────────────────────────────

  /**
   * Render a Standard MIDI File offline. Instruments named by id are added for the file and
   * removed when it is rendered.
   *
   * @example
   * const audio = synth.renderMidi('bach.mid', { instrument: 'harpsichord' });
   */
  renderMidi(file: string | Uint8Array, options: MidiFileOptions = {}): AudioBuffer {
    this.checkOpen();
    if (this.engine.isRunning) throw new SupersynthError('renderMidi() is unavailable while real-time output is running');
    const { midi, route, tail, release } = this.prepareMidi(file, options);
    try {
      const sr = this.sampleRate;
      const events = midi.events;
      const t0 = this.currentTime;
      const total = Math.round((midi.duration + tail) * sr);
      const left = new Float32Array(total);
      const right = new Float32Array(total);
      let pos = 0; // frames rendered
      let sent = 0; // events sent to the engine
      let due = 0; // events sent that the engine has played
      while (pos < total) {
        const now = pos / sr;
        while (due < sent && events[due]!.time <= now) due++;
        // send a second and a half ahead, as long as the engine's queue has room
        const horizon = now + 1.5;
        while (sent < events.length && events[sent]!.time < horizon && sent - due < MIDI_PENDING && this.engine.queueFree > 64) {
          route(events[sent]!, t0);
          sent++;
        }
        let to = Math.min(total, pos + sr);
        // the queue is full: render up to the next event, then send more
        if (sent < events.length && events[sent]!.time < horizon) to = Math.min(to, Math.max(pos + 1, Math.floor(events[sent]!.time * sr)));
        const [l, r] = deinterleave(this.engine.render(to - pos));
        left.set(l, pos);
        right.set(r, pos);
        pos = to;
      }
      return makeAudioBuffer(sr, left, right);
    } finally {
      release();
    }
  }

  /**
   * Play a Standard MIDI File in real time (starts output if needed). Resolves when it has
   * finished, or early when output stops (`stop()`, `close()`). With `signal`, aborting stops
   * it and rejects with an {@link AbortError}. Instruments named by id are added for the file
   * and removed when it ends.
   */
  async playMidi(file: string | Uint8Array, options: MidiFileOptions = {}): Promise<void> {
    this.checkOpen();
    const signal = options.signal;
    if (signal?.aborted) throw abortError(signal);
    if (!this.isRunning) await this.start();
    const { midi, route, tail, release, channels } = this.prepareMidi(file, options);
    const events = midi.events;
    const t0 = this.currentTime + 0.2;
    let sent = 0;
    let due = 0;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      /** Release what this file holds (its notes, if `silence`) and settle. */
      const finish = (error?: unknown, silence = false) => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        signal?.removeEventListener('abort', onAbort);
        try {
          if (silence && !this.closed) {
            // notes sent ahead start and stop at once; held ones are released now
            const now = this.currentTime;
            for (let k = due; k < sent; k++) {
              const e = events[k]!;
              if (e.type === 'noteOn' && t0 + e.time > now) route({ ...e, type: 'noteOff' }, t0);
            }
            for (const ch of channels) this.engine.allNotesOff(ch);
          }
        } catch {
          /* queue full: the instruments added are removed below anyway */
        }
        try {
          release();
        } catch (e) {
          error ??= e;
        }
        if (error !== undefined) reject(error);
        else resolve();
      };
      const onAbort = () => finish(abortError(signal!), true);
      const pump = () => {
        try {
          if (this.closed || !this.isRunning) return finish(undefined, true);
          const now = this.currentTime;
          while (due < sent && t0 + events[due]!.time <= now) due++;
          const horizon = now + 1.5;
          while (sent < events.length && t0 + events[sent]!.time < horizon && sent - due < MIDI_PENDING && this.engine.queueFree > 64) {
            route(events[sent]!, t0);
            sent++;
          }
          if (sent >= events.length && now >= t0 + midi.duration + tail) finish();
        } catch (e) {
          finish(e, true);
        }
      };
      const timer = setInterval(pump, 100);
      signal?.addEventListener('abort', onAbort, { once: true });
      pump();
    });
  }

  /** Parse a file and resolve where its channels (or tracks) play, adding the instruments named
   *  by id. `release()` removes those again. */
  private prepareMidi(file: string | Uint8Array, options: MidiFileOptions) {
    const speed = positive(options.speed ?? 1, 'speed');
    const transpose = integer(options.transpose ?? 0, -127, 127, 'transpose');
    const tail = atLeast(options.tail ?? 3, 0, 'tail');
    const bytes = typeof file === 'string' ? readFileSync(file) : file;
    const raw = parseMidiFile(bytes);
    const midi: MidiFileData = speed === 1 ? raw : {
      ...raw,
      duration: raw.duration / speed,
      events: raw.events.map((e) => ({ ...e, time: e.time / speed })),
    };
    const keyOf = (e: MidiFileEvent) => (options.byTrack ? e.track : e.channel);
    // GM drums (channel 10): skipped unless mapped
    const skip = (e: MidiFileEvent) => e.type === 'program' || (!options.byTrack && e.channel === 10 && !options.channels?.[10]);
    const added: Instrument[] = [];
    const release = () => {
      for (const i of added.splice(0)) this.remove(i);
    };
    const channelByKey = new Map<number, number>();
    try {
      for (const e of midi.events) {
        const key = keyOf(e);
        if (skip(e) || channelByKey.has(key)) continue;
        const spec = options.channels?.[key] ?? options.instrument ?? 'grand-piano';
        if (typeof spec === 'string') {
          const inst = this.add(spec);
          if (!(inst instanceof Instrument)) {
            this.remove(inst);
            throw new SupersynthError(`A MIDI file plays an instrument or an organ division ('${spec}' is an organ: pass organ.great, …)`);
          }
          added.push(inst);
          channelByKey.set(key, inst.channel);
        } else {
          spec._engine(); // not removed
          channelByKey.set(key, spec.channel);
        }
      }
    } catch (e) {
      release();
      throw e;
    }
    const n = this.engine;
    const route = (e: MidiFileEvent, t0: number) => {
      if (skip(e)) return;
      const ch = channelByKey.get(keyOf(e))!;
      const at = t0 + e.time;
      switch (e.type) {
        case 'noteOn': {
          const note = e.note + transpose;
          if (note >= 0 && note <= 127) n.noteOn(ch, note, e.velocity, at);
          break;
        }
        case 'noteOff': {
          const note = e.note + transpose;
          if (note >= 0 && note <= 127) n.noteOff(ch, note, at);
          break;
        }
        case 'cc':
          if ([1, 7, 10, 11, 64, 91].includes(e.controller)) n.controlChange(ch, e.controller, e.value, at);
          break;
        case 'pitchBend':
          n.pitchBend(ch, e.value, at);
          break;
        default:
          break;
      }
    };
    return { midi, route, tail, release, channels: [...new Set(channelByKey.values())] };
  }

  // ── MIDI input ────────────────────────────────────────────────────────────

  /**
   * Connect a hardware MIDI input: the first device, or the first whose name contains `device`.
   * With `route` (default), notes and controllers go straight to the engine, with no JavaScript
   * in between, to the instruments and organs given MIDI channels with {@link Instrument.midi}
   * and {@link Organ.midi}. Every message is also emitted as a `'midi'` event.
   */
  async enableMidi(device?: string, options: { route?: boolean } = {}): Promise<this> {
    this.checkOpen();
    try {
      this.engine.enableMidi(device ?? null, options.route ?? true, (raw: Buffer) => {
        this.emit('midi', parseMidiBytes(raw));
      });
    } catch (e) {
      throw new MidiError(`Failed to enable MIDI: ${(e as Error).message}`);
    }
    return this;
  }

  /** Disconnect the MIDI input. */
  disableMidi(): this {
    this.engine.disableMidi();
    return this;
  }

  listMidiDevices(): string[] {
    return this.engine.listMidiDevices();
  }

  listAudioBackends(): string[] {
    return this.engine.listAudioBackends();
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private checkOpen(): void {
    if (this.closed) throw new SupersynthError('This synth is closed');
  }

  /** @internal Throw unless `events` more events fit in the engine's command queue. */
  _reserve(events: number): void {
    const free = this.engine.queueFree;
    if (events > free) {
      throw new SupersynthError(
        `The engine's command queue is full: ${events} events do not fit in the ${free} free of ${QUEUE_CAPACITY}. ` +
          'Render (or let real-time output play) what is scheduled before scheduling more',
      );
    }
  }

  /** @internal Give an instrument or an organ division a free engine channel. */
  _attach(owner: Instrument | Organ): number {
    this.checkOpen();
    // channel 9 (MIDI channel 10) is conventionally drums; use it last
    const order = [...Array(32).keys()].filter((c) => c !== 9).concat([9]);
    const ch = order.find((c) => this.slots[c] === null);
    if (ch === undefined) throw new SupersynthError('All 32 channels are in use');
    this.slots[ch] = owner;
    return ch;
  }

  /** @internal Free an owner's channels (their notes stop at once and their settings return to
   *  the defaults) and unload the models nothing else uses. */
  _detach(owner: Instrument | Organ, channels: number[]): void {
    for (const ch of channels) {
      if (this.slots[ch] !== owner) continue;
      this._unroute(ch);
      try {
        this.resetChannel(ch);
      } catch {
        /* queue full: the next owner sets the channel up anyway */
      }
      this.slots[ch] = null;
    }
    this._release(owner);
  }

  /** Silence a channel and put back the defaults, so whatever takes it next starts clean. */
  private resetChannel(ch: number): void {
    const n = this.engine;
    n.setInstrument(ch, []);
    n.setCouplers(ch, []);
    n.pitchBend(ch, 0);
    n.controlChange(ch, 64, 0);
    n.controlChange(ch, 1, 0);
    n.controlChange(ch, 11, 127);
    for (const name of PARAMETER_NAMES) {
      const key = name as keyof InstrumentParameters;
      n.setParam(ch, key, toNativeParameter(key, defaultParameter(key)));
    }
    n.setParam(ch, 'swellBox', 0);
    n.setParam(ch, 'swellClosed', -9);
    n.setParam(ch, 'swellShelf', -14);
    n.setParam(ch, 'wind', 0);
  }

  /** @internal Play MIDI channel `midiChannel` (1–16) on engine channel `channel`. */
  _route(midiChannel: number, channel: number): void {
    this.engine.setMidiRoute(midiChannel, channel);
    this.routes[midiChannel - 1] = channel;
  }

  /** @internal Stop playing any MIDI channel on engine channel `channel`. */
  _unroute(channel: number): void {
    for (let i = 0; i < 16; i++) {
      if (this.routes[i] !== channel) continue;
      this.engine.setMidiRoute(i + 1, 255);
      this.routes[i] = null;
    }
  }

  /** @internal The room of the first instrument or organ added, while the reverb is
   *  automatic; it follows that instrument's presets. */
  _suggestRoom(room: ReverbPreset, owner: Instrument | Organ, time?: number): void {
    if (this.reverbMode !== 'auto' || (this.roomOwner !== undefined && this.roomOwner !== owner)) return;
    this.roomOwner = owner;
    this.engine.setReverbPreset(room, time);
  }

  /** @internal Partial cap implied by the `quality` option. */
  get _maxPartials(): number {
    return this.maxPartials;
  }

  /** @internal */
  _native(): NativeEngine {
    return this.engine;
  }

  /** @internal Load (once per synth) and return the native id of a model `owner` uses. */
  _model(name: string, owner: object): number {
    let m = this.models.get(name);
    if (!m) {
      const file = resolveModelFile(name, this.modelsDirectory);
      if (!existsSync(file)) throw new SupersynthError(`Instrument model '${name}' not found at ${file}`);
      // the engine parses the bytes into its own model, so they are not kept
      m = { id: this.engine.loadModel(readFileSync(file)), users: new Set() };
      this.models.set(name, m);
    }
    m.users.add(owner);
    return m.id;
  }

  /** @internal `owner` no longer uses these models (any model, when left out): unload those
   *  nothing else uses. */
  _release(owner: object, names: Iterable<string> = [...this.models.keys()]): void {
    for (const name of names) {
      const m = this.models.get(name);
      if (!m) continue;
      m.users.delete(owner);
      if (m.users.size > 0) continue;
      this.models.delete(name);
      this.unload(m.id);
    }
  }

  private unload(id: number): void {
    try {
      this.engine.unloadModel(id);
    } catch {
      /* already gone */
    }
  }

  /** @internal Names of the models loaded. */
  _loadedModels(): string[] {
    return [...this.models.keys()];
  }

  /** @internal Model metadata. */
  _modelInfo(name: string): { noteRange: [number, number]; displayName: string; source: string } {
    try {
      return JSON.parse(this.engine.modelInfo(this._model(name, this)));
    } finally {
      this._release(this, [name]);
    }
  }

  /** @internal A layer for the engine, its model loaded for `owner`. */
  _layer(l: LayerDefinition, owner: object): NativeLayer {
    const layer = {
      transpose: finite(l.transpose ?? 0, 'layer transpose'),
      gainDb: finite(l.gain ?? 0, 'layer gain'),
      pan: finite(l.pan ?? 0, 'layer pan'),
      keyLo: integer(l.keyLow ?? 0, 0, 127, 'layer keyLow'),
      keyHi: integer(l.keyHigh ?? 127, 0, 127, 'layer keyHigh'),
      enabled: true,
      detuneCents: finite(l.detune ?? 0, 'layer detune'),
      onRelease: l.trigger === 'release',
    };
    return { model: this._model(l.model, owner), ...layer };
  }

  /** @internal */
  _setLayers(channel: number, layers: LayerDefinition[], owner: object, time?: number): void {
    this.engine.setInstrument(channel, layers.map((l) => this._layer(l, owner)), time);
  }
}

function abortError(signal: AbortSignal): AbortError {
  const reason: unknown = signal.reason;
  const err = new AbortError(reason instanceof Error && reason.name !== 'AbortError' ? `MIDI playback was aborted: ${reason.message}` : undefined);
  if (reason !== undefined) err.cause = reason;
  return err;
}

function parseMidiBytes(raw: Buffer): MidiEvent {
  const status = raw[0] ?? 0;
  const kind = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  const b1 = raw[1] ?? 0;
  const b2 = raw[2] ?? 0;
  switch (kind) {
    case 0x80:
      return { type: 'noteOff', channel, note: b1, velocity: b2, raw };
    case 0x90:
      return b2 === 0 ? { type: 'noteOff', channel, note: b1, velocity: 0, raw } : { type: 'noteOn', channel, note: b1, velocity: b2, raw };
    case 0xb0:
      return { type: 'cc', channel, controller: b1, value: b2, raw };
    case 0xc0:
      return { type: 'programChange', channel, program: b1, raw };
    case 0xe0:
      return { type: 'pitchBend', channel, value: (((b2 << 7) | b1) - 8192) / 8192, raw };
    default:
      return { type: 'unknown', channel, raw };
  }
}
