import { EventEmitter, platform } from '#platform';
import type { Bytes } from './platform/platform.js';

import { INSTRUMENTS, type InstrumentDefinition, type InstrumentId, type LayerDefinition } from './catalog/index.js';
import { AbortError, AudioBackendError, MidiError, SupersynthError } from './errors.js';
import { Instrument, type InstrumentOptions } from './Instrument.js';
import { parseMidiFile, type MidiFileData, type MidiFileEvent } from './midifile.js';
import type { NativeEngine, NativeLayer } from './engine.js';
import { instrumentModels, organModels } from './models.js';
import type { ReverbOptions, ReverbPreset } from './parameters.js';
import { defaultParameter, PARAMETER_NAMES, REVERB_FIELDS, REVERB_PRESETS, toNativeParameter, type InstrumentParameters } from './parameters.js';
import { Organ, type Division, type OrganOptions } from './Organ.js';
import { ORGAN_DEFAULTS } from './organs/defaults.js';
import { ORGANS, type OrganDefinition, type OrganId } from './organs/index.js';
import { resolveTime, type TimeOptions } from './scheduling.js';
import { atLeast, finite, guardEngine, inRange, integer, midiKey, positive, QUEUE_CAPACITY } from './validate.js';
import { deinterleave, makeAudioBuffer, writeWav, type AudioBuffer, type WavOptions } from './wav.js';
import type { MidiEvent, MidiInputInfo } from './types.js';

export type AudioBackend = 'auto' | 'coreaudio' | 'wasapi' | 'alsa' | 'jack' | 'pulseaudio' | 'pipewire';

/** What {@link Synth.set} changes. */
export interface SynthSettings {
  /** Master volume, 0–1 (linear). */
  volume?: number;
  /** The room: a reverb preset, detailed options, or `false` for no reverb. */
  reverb?: ReverbPreset | ReverbOptions | false;
  /** Opt-in, for machines too slow for a large organ: end notes in their release (the
   *  recorded pipe and room tail) early, once they are quiet. `false` (the default) plays every
   *  tail out in full. See {@link ReleaseCulling}. */
  releaseCulling?: ReleaseCulling | false;
  /** Opt-in, real-time output only: when audio buffers come close to their deadline (the
   *  machine is too slow for what is playing), end the quietest notes in their release early,
   *  with a short fade, instead of letting the sound crackle; only if no released note is left,
   *  fade out upper partials of the quietest notes. Held notes and attacks are never touched,
   *  and as long as nothing is overloaded the sound is bit-for-bit the same as without it.
   *  Offline rendering is never guarded. See {@link Synth.guardStats}. @default false */
  overloadGuard?: boolean;
}

/** What the overload guard has done ({@link Synth.guardStats}). */
export interface GuardStats {
  /** Shedding load now. */
  active: boolean;
  /** Released notes ended early so far. */
  voicesShed: number;
  /** Partials faded out so far (the last resort, when no released note was left). */
  partialsReduced: number;
}

/**
 * When to end a released note early ({@link SynthSettings.releaseCulling}). This trades sound
 * for CPU: measured on BWV 532 on the Friesach plenum (hall reverb), `floorDb: -80` halves the
 * voices (mean 586 → 287) and changes third-octave band levels by at most 1.8 dB (p99 0.18 dB);
 * on the smaller Bureå organ the savings are smaller and single bands of the room tail change
 * by up to 15 dB.
 */
export interface ReleaseCulling {
  /** End a released note once its output is below this level (dBFS, e.g. -90 … -70). */
  floorDb?: number;
  /** End a released note once it is this many dB (e.g. 70) below both its keyboard's output
   *  and the whole output: tails far under the music end, tails that are what is left to hear
   *  (pauses, the end of a piece) play on. */
  belowMixDb?: number;
  /** How `belowMixDb` follows the output levels: `'peak'` holds a peak for 1 s, then lets it
   *  fall 40 dB/s; `'smooth'` averages the power over about 300 ms. @default 'peak' */
  hold?: 'peak' | 'smooth';
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
  /** Maximum sounding voices before the quietest are stolen (each takes about 85 kB). An organ
   *  plenum in a fast piece keeps hundreds of pipes sounding in their release. @default 1024 */
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
  /** Browser: where the WebAssembly engine is, if not next to supersynth's `wasm/supersynth.js`
   *  (read by the first {@link Synth.create}). */
  wasmUrl?: string | URL;
  /** The synth's name where the system lists it: its JACK client (`<name>_out`) and, on Linux,
   *  the ALSA sequencer client of its MIDI inputs. @default 'supersynth' */
  clientName?: string;
}

/** How to open a MIDI input ({@link Synth.enableMidi}). */
export interface MidiInputOptions {
  /** Play notes and controllers in the engine, on the instruments and organ divisions given
   *  MIDI sources with `midi()`. `false`: only the `'midi'` event. @default true */
  route?: boolean;
  /** Don't fail when no such device is connected now: the input connects when one appears.
   *  @default false */
  optional?: boolean;
}

/** Xruns reported together ({@link Synth} `'xrun'` event). */
export interface XrunEvent {
  /** Xruns since the last event. */
  count: number;
  /** Xruns since the synth was created ({@link Synth.xruns}). */
  total: number;
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

/** MIDI sources the engine routes: 0 (any input) and an input per device name. */
const MIDI_SOURCES = 16;

/** Shortest time between two `'xrun'` events, ms. */
const XRUN_EVENT_MS = 1000;

const NO_REALTIME_WARNING =
  'the audio threads could not get real-time priority, so the sound may drop out (xruns) whenever the machine is busy. ' +
  'Allow real-time scheduling for this user: in a systemd service, LimitRTPRIO=95 and LimitMEMLOCK=infinity; ' +
  'otherwise "@audio - rtprio 95" and "@audio - memlock unlimited" in /etc/security/limits.d/ with the user in the audio group ' +
  '(`ulimit -r` shows the limit). See https://github.com/jddubois/supersynth#real-time-priority';

/** Decoded models take about this many bytes per byte of their (gzip) file. */
const DECODED_PER_FILE_BYTE = 5;

/** A model loaded (or loading) in the engine, and the instruments and organs that use it. */
interface LoadedModel {
  id: number;
  users: Set<object>;
}

/**
 * The synthesizer: an engine that plays the instrument models, in real time or offline.
 *
 * ```ts
 * import { Synth } from '@supersynth/core';
 *
 * const synth = new Synth();
 * const piano = synth.add('grand-piano');
 * await synth.start();                  // real-time output
 * piano.play(['C4', 'E4', 'G4'], { duration: 2 });
 * await synth.idle();                   // until it has played out
 * synth.close();
 *
 * // or offline, without an audio device:
 * const audio = synth.render(3);        // { sampleRate, left, right, duration }
 * synth.renderToFile('chord.wav', 3);
 * ```
 */
export class Synth extends EventEmitter {
  /**
   * Create a synth, getting the platform ready first: in a browser this loads the WebAssembly
   * engine (once), which `new Synth()` needs; in Node.js it is the same as `new Synth()`.
   *
   * ```ts
   * const synth = await Synth.create();
   * await synth.load('grand-piano');      // a browser downloads the models first
   * const piano = synth.add('grand-piano');
   * ```
   */
  static async create(options: SynthOptions = {}): Promise<Synth> {
    await platform.prepare(options.wasmUrl === undefined ? {} : { wasmUrl: options.wasmUrl });
    const synth = new Synth(options);
    await synth.engine.ready?.();
    return synth;
  }

  private engine: NativeEngine;
  /** What owns each engine channel. */
  private slots: (Instrument | Organ | null)[] = new Array(32).fill(null);
  /** Engine channel each MIDI channel (1–16, index 0–15) of each MIDI source plays, if any
   *  (source 0: any input; the others: `midiSources`). */
  private routes: (number | null)[][] = Array.from({ length: MIDI_SOURCES }, () => new Array(16).fill(null));
  /** The MIDI source of each device name (by {@link midiKey}). */
  private midiSources = new Map<string, number>();
  /** MIDI inputs open, by source. */
  private midiOpen = new Map<number, MidiInputInfo>();
  /** Xruns not reported yet, and the timer that will (see the `'xrun'` event). */
  private xrunPending = 0;
  private xrunTimer: ReturnType<typeof setTimeout> | undefined;
  private lastXrunEvent = -Infinity;
  private realtimeTimer: ReturnType<typeof setInterval> | undefined;
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
  /** Behave as with real-time output running (benchmarks that drive the engine themselves:
   *  each `render()` is then a real-time buffer, e.g. for the overload guard). */
  private realtimeEmulated = false;
  private get emulateRealtime(): boolean {
    return this.realtimeEmulated;
  }
  private set emulateRealtime(on: boolean) {
    this.realtimeEmulated = on;
    this.engine.setRealtimeEmulation(on);
  }

  constructor(options: SynthOptions = {}) {
    super();
    const quality = options.quality ?? 'high';
    const partials = ({ high: 512, balanced: 128, eco: 32 } as Record<string, number>)[quality];
    if (partials === undefined) throw new SupersynthError(`quality must be 'high', 'balanced' or 'eco', got ${String(quality)}`);
    this.maxPartials = partials;
    const reverbPreset = typeof options.reverb === 'string' && options.reverb !== 'auto' ? options.reverb : 'hall';
    try {
      this.engine = guardEngine(platform.createEngine({
        ...(options.sampleRate !== undefined ? { sampleRate: integer(options.sampleRate, 1, 1e7, 'sampleRate') } : {}),
        ...(options.backend ? { backend: options.backend } : {}),
        ...(options.maxVoices !== undefined ? { maxVoices: integer(options.maxVoices, 1, 1e6, 'maxVoices') } : {}),
        ...(options.bufferSize !== undefined ? { bufferSize: integer(options.bufferSize, 1, 1e7, 'bufferSize') } : {}),
        ...(options.threads !== undefined && options.threads !== 'auto' ? { threads: integer(options.threads, 1, 16, 'threads') } : {}),
        ...(options.clientName !== undefined ? { clientName: clientName(options.clientName) } : {}),
        reverb: reverbPreset,
      }));
    } catch (e) {
      throw e instanceof SupersynthError ? e : new SupersynthError((e as Error).message);
    }
    this.modelsDirectory = options.modelsDirectory;
    this.reverbMode = options.reverb === undefined || options.reverb === 'auto' ? 'auto' : 'set';
    this.set({
      volume: options.volume ?? 0.5,
      ...(options.releaseCulling ? { releaseCulling: options.releaseCulling } : {}),
      ...(options.overloadGuard !== undefined ? { overloadGuard: options.overloadGuard } : {}),
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

  /** The overload guard ({@link SynthSettings.overloadGuard}) is shedding load now: the machine
   *  is too slow for what is playing, and release tails are being shortened. */
  get guardActive(): boolean {
    return this.engine.guardActive;
  }

  /** What the overload guard has done so far: whether it is active, released notes it ended
   *  early, partials it faded out (all zero while it never had to act). */
  get guardStats(): GuardStats {
    const s = this.engine.guardStats;
    return { active: s.active, voicesShed: s.voicesShed, partialsReduced: s.partialsReduced };
  }

  /** Real-time output is running. It stops by itself when its device goes away, the JACK
   *  server shuts down or the engine fails (the `'stopped'` event). */
  get isRunning(): boolean {
    return this.engine.isRunning;
  }

  /** Whether real-time output runs at real-time priority: `true`, `false` when the system
   *  refused it (on Linux, the user's `RLIMIT_RTPRIO`: see the README's
   *  [Real-time priority](https://github.com/jddubois/supersynth#real-time-priority)), or
   *  `null` while output is stopped, in its first buffer, or in a browser (not known). When
   *  refused, supersynth also warns once (Node.js: a process warning,
   *  `SUPERSYNTH_NO_REALTIME`). */
  get realtime(): boolean | null {
    return this.engine.realtime;
  }

  /** Xruns (buffers the audio system missed: an audible dropout) reported since the synth was
   *  created. JACK reports them; the ALSA, CoreAudio, WASAPI and browser outputs do not (0).
   *  See also the `'xrun'` event. */
  get xruns(): number {
    return this.engine.xruns;
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
      // a missing organ package fails before any channel is taken
      for (const name of organModels(organ)) platform.locateModel(name, this.modelsDirectory);
      const o = new Organ(this, organ, options as OrganOptions);
      this._suggestRoom(organ.reverb ?? ORGAN_DEFAULTS.reverb, o);
      return o;
    }
    if (typeof what === 'string' && !(what in INSTRUMENTS)) {
      throw new SupersynthError(`Unknown instrument '${what}'. Instruments: ${Object.keys(INSTRUMENTS).join(', ')}; organs: ${Object.keys(ORGANS).join(', ')}`);
    }
    return new Instrument(this, what as InstrumentId | InstrumentDefinition, options as InstrumentOptions);
  }

  /**
   * Make the models of these instruments and organs available. A browser downloads them, which
   * `add()` needs first (organs are large: 5–150 MB); in Node.js models are read from disk when
   * used, so this only checks that they are installed.
   *
   * ```ts
   * await synth.load('grand-piano', 'burea');
   * ```
   */
  async load(...items: (InstrumentId | OrganId | InstrumentDefinition | OrganDefinition)[]): Promise<this> {
    this.checkOpen();
    const names = new Set<string>();
    for (const what of items) {
      const organ = typeof what === 'string' ? (ORGANS as Record<string, OrganDefinition>)[what] : 'stops' in what ? what : undefined;
      const inst = organ ? undefined : typeof what === 'string' ? (INSTRUMENTS as Record<string, InstrumentDefinition>)[what] : (what as InstrumentDefinition);
      if (!organ && !inst) {
        throw new SupersynthError(`Unknown instrument '${String(what)}'. Instruments: ${Object.keys(INSTRUMENTS).join(', ')}; organs: ${Object.keys(ORGANS).join(', ')}`);
      }
      for (const name of organ ? organModels(organ) : instrumentModels(inst!)) names.add(name);
    }
    await platform.fetchModels([...names], this.modelsDirectory);
    return this;
  }

  /** The instruments and organs added, in the order of their first channel. */
  instruments(): (Instrument | Organ)[] {
    return [...new Set(this.slots.filter((x): x is Instrument | Organ => x !== null))];
  }

  /**
   * Resolves once every organ added so far has loaded all the models it preloads (see
   * {@link OrganOptions.preload}): drawing any of their stops is then instant. Rejects when a
   * model fails to load (that stop would throw when drawn). Instruments load in `add()`.
   *
   * ```ts
   * const organ = synth.add('friesach');   // its preset plays at once
   * await synth.ready();                   // every other stop is loaded too
   * ```
   */
  async ready(): Promise<void> {
    await Promise.all(this.instruments().map((i) => (i instanceof Organ ? i.ready : undefined)));
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
    // everything is checked before anything is sent, so a refused call changes nothing
    const volume = settings.volume === undefined ? undefined : inRange(settings.volume, 0, 1, 'volume');
    const reverb = settings.reverb;
    const opts: ReverbOptions | undefined = reverb === undefined || reverb === false ? undefined : typeof reverb === 'string' ? { preset: reverb } : reverb;
    if (opts?.preset !== undefined && !REVERB_PRESETS.includes(opts.preset)) {
      throw new SupersynthError(`Unknown reverb preset '${String(opts.preset)}'. Presets: ${REVERB_PRESETS.join(', ')}`);
    }
    for (const k of Object.keys(REVERB_FIELDS)) {
      const v = (opts as Record<string, unknown> | undefined)?.[k];
      if (v !== undefined) finite(v, `reverb.${k}`);
    }
    const rc = settings.releaseCulling;
    const culling = rc === undefined ? undefined : rc === false ? {} : rc;
    if (culling?.hold !== undefined && culling.hold !== 'peak' && culling.hold !== 'smooth') {
      throw new SupersynthError(`releaseCulling.hold must be 'peak' or 'smooth', got ${String(culling.hold)}`);
    }
    const floorDb = culling?.floorDb === undefined ? -200 : inRange(culling.floorDb, -200, 0, 'releaseCulling.floorDb');
    const belowMixDb = culling?.belowMixDb === undefined ? 0 : inRange(culling.belowMixDb, 0, 200, 'releaseCulling.belowMixDb');
    const guard = settings.overloadGuard;
    if (guard !== undefined && typeof guard !== 'boolean') throw new SupersynthError(`overloadGuard must be true or false, got ${String(guard)}`);
    this._reserve(5 + 11 + Object.keys(REVERB_FIELDS).length);
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
    if (culling !== undefined) {
      n.setMasterParam('releaseFloor', floorDb, t);
      n.setMasterParam('releaseBelowMix', belowMixDb, t);
      n.setMasterParam('releaseHold', culling.hold === 'smooth' ? 0 : 1, t);
    }
    if (guard !== undefined) n.setOverloadGuard(guard); // (at once: it is not an event of the music)
    return this;
  }

  /** Release every held note of every instrument and organ. */
  allNotesOff(options: TimeOptions = {}): this {
    this.checkOpen();
    this.engine.allNotesOff(null, resolveTime(this.currentTime, options));
    return this;
  }

  /** Silence everything immediately. */
  panic(): this {
    this.checkOpen();
    this.engine.allSoundOff();
    return this;
  }

  // ── output ────────────────────────────────────────────────────────────────

  /** Start real-time audio output. The output alone does not keep Node.js running: a script
   *  that plays and ends exits at once, so wait for the music with {@link idle} (or keep the
   *  process busy otherwise: a server, MIDI input, a timer).
   *
   *  Events: `'stopped'` when the output stops (with an {@link AudioBackendError} when it
   *  stopped by itself: the device went away, the JACK server shut down, the engine failed;
   *  `start()` again to resume), and `'xrun'` ({@link XrunEvent}, at most once a second) when
   *  the backend reports dropouts. */
  async start(): Promise<this> {
    this.checkOpen();
    if (this.engine.isRunning) return this;
    try {
      await this.engine.start((stopped) => this.outputEvent(stopped));
    } catch (e) {
      throw new AudioBackendError(`Failed to start audio: ${(e as Error).message}`);
    }
    this.watchRealtime();
    return this;
  }

  /** The output reported an xrun (`null`), or stopped by itself. */
  private outputEvent(stopped: string | null): void {
    if (stopped !== null) {
      if (this.closed) return;
      this.halt(new AudioBackendError(`Audio output stopped: ${stopped}`));
      return;
    }
    this.xrunPending++;
    if (this.xrunTimer !== undefined) return;
    const flush = () => {
      this.xrunTimer = undefined;
      if (this.xrunPending === 0) return;
      const count = this.xrunPending;
      this.xrunPending = 0;
      this.lastXrunEvent = Date.now();
      this.emit('xrun', { count, total: this.engine.xruns } satisfies XrunEvent);
    };
    const wait = this.lastXrunEvent + XRUN_EVENT_MS - Date.now();
    if (wait <= 0) flush();
    else {
      this.xrunTimer = setTimeout(flush, wait);
      unref(this.xrunTimer);
    }
  }

  /** Once the output knows whether it got real-time priority: warn if it did not. */
  private watchRealtime(): void {
    clearInterval(this.realtimeTimer);
    let checks = 0;
    this.realtimeTimer = setInterval(() => {
      const rt = this.closed || !this.engine.isRunning ? true : this.engine.realtime;
      if (rt === null && ++checks < 50) return;
      clearInterval(this.realtimeTimer);
      this.realtimeTimer = undefined;
      if (rt === false) platform.warn(NO_REALTIME_WARNING, 'SUPERSYNTH_NO_REALTIME');
    }, 100);
    unref(this.realtimeTimer);
  }

  /**
   * Resolves once what was sent so far has played out with real-time output running: no event
   * is waiting for its time, no note is sounding and the output (the reverb's tail too) has
   * fallen below -60 dBFS. A note held without a `noteOff` (or an organ's blower and room
   * noises) keeps it waiting. Resolves at once without real-time output, and when output
   * stops or the synth is closed. Node.js keeps running while it waits.
   *
   * ```ts
   * await synth.start();
   * piano.play(['C4', 'E4', 'G4'], { duration: 2 });
   * await synth.idle();
   * synth.close();
   * ```
   */
  async idle(): Promise<void> {
    await new Promise<void>((resolve) => {
      // three checks in a row (100 ms): the peak meter falls between buffers
      let quiet = 0;
      const check = () => {
        if (this.closed || !this.isRunning) quiet = 3;
        else if (this.engine.queueFree === QUEUE_CAPACITY && this.engine.activeVoices === 0 && this.engine.peak < 0.001) quiet++;
        else quiet = 0;
        if (quiet >= 3) {
          clearInterval(timer);
          resolve();
        }
      };
      const timer = setInterval(check, 50);
      check();
    });
  }

  /** Stop real-time output (the engine keeps its state; `render()` works again). */
  stop(): this {
    this.halt();
    return this;
  }

  /** Stop the output, which stopped by itself when there is an `error`, and tell. */
  private halt(error?: AudioBackendError): void {
    const was = this.engine.isRunning || error !== undefined;
    this.engine.stop();
    clearInterval(this.realtimeTimer);
    this.realtimeTimer = undefined;
    if (was && !this.closed) this.emit('stopped', error);
  }

  /** Stop output and MIDI, and release every instrument, organ and model. The synth cannot
   *  be used afterwards. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.engine.closeMidiInput();
    } catch {
      /* not enabled */
    }
    this.midiOpen.clear();
    this.engine.stop();
    clearInterval(this.realtimeTimer);
    clearTimeout(this.xrunTimer);
    for (const item of this.instruments()) this.remove(item);
    for (const m of this.models.values()) this.unload(m.id);
    this.models.clear();
    // the engine's instruments still hold the models: freed now (off this thread), not when
    // this object is garbage-collected, which a busy program may not let happen for long
    this.engine.releaseResources();
  }

  /**
   * Render audio offline (no audio device needed). Advances the engine clock.
   * Notes scheduled with `play()`/`at` are rendered at their times.
   */
  render(seconds: number): AudioBuffer {
    this.checkOpen();
    if (this.engine.isRunning) throw new SupersynthError('render() is unavailable while real-time output is running');
    const total = Math.round(Math.max(0, finite(seconds, 'seconds')) * this.sampleRate);
    this.loadDrawn();
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
    this.loadDrawn();
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
    if (signal?.aborted) throw abortError(signal); // while output was starting
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
    const bytes = typeof file === 'string' ? platform.readFile(file) : file;
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
    /** Engine channels of the instruments and divisions passed in (not removed afterwards). */
    const given = new Set<number>();
    const release = () => {
      // what the file leaves on the instruments passed in (a missing note-off, the pedal down,
      // a bend) does not carry over into what they play next
      for (const ch of given) {
        if (this.closed || this.slots[ch] === null) continue;
        try {
          this.engine.allNotesOff(ch);
          this.engine.controlChange(ch, 64, 0);
          this.engine.controlChange(ch, 66, 0);
          this.engine.controlChange(ch, 67, 0);
          this.engine.controlChange(ch, 1, 0);
          this.engine.controlChange(ch, 11, 127);
          this.engine.pitchBend(ch, 0);
        } catch {
          /* queue full */
        }
      }
      given.clear();
      for (const i of added.splice(0)) this.remove(i);
    };
    const channelByKey = new Map<number, number>();
    // channels (or tracks) with notes: one with only controllers gets no instrument
    const playing = new Set(midi.events.filter((e) => e.type === 'noteOn' && !skip(e)).map(keyOf));
    try {
      for (const e of midi.events) {
        const key = keyOf(e);
        if (skip(e) || !playing.has(key) || channelByKey.has(key)) continue;
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
          given.add(spec.channel);
        }
      }
    } catch (e) {
      release();
      throw e;
    }
    const n = this.engine;
    const route = (e: MidiFileEvent, t0: number) => {
      const ch = channelByKey.get(keyOf(e));
      if (skip(e) || ch === undefined) return;
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
          if ([1, 7, 10, 11, 64, 66, 67, 91].includes(e.controller)) n.controlChange(ch, e.controller, e.value, at);
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

  // ── MIDI devices ──────────────────────────────────────────────────────────

  /**
   * Connect a hardware MIDI input: the first device whose name contains `device` (ignoring
   * case), or the first device when it is left out. Call it once per device to play several;
   * calling it again with the same `device` replaces that input.
   *
   * The input stays with its device: when the device goes away (unplugged, switched off), the
   * keys and pedals it held are let go, and when a device of that name comes back it is
   * connected again. The `'midiDevice'` event ({@link MidiInputInfo}) tells both.
   *
   * With `route` (default), notes and controllers go straight to the engine, with no JavaScript
   * in between, to the instruments and organ divisions listening to it ({@link Instrument.midi},
   * {@link Organ.midi}: `{ device }` for this input's own routes, or a channel for any input).
   * Every message is also emitted as a `'midi'` event. Fails with a {@link MidiError} when no
   * such device is connected, unless `optional`.
   *
   * ```ts
   * await synth.enableMidi('piano', { optional: true });
   * await synth.enableMidi('pedalboard', { optional: true });
   * piano.midi({ device: 'piano' });
   * organ.midi({ pedal: { device: 'pedalboard' } });
   * ```
   */
  async enableMidi(device?: string, options: MidiInputOptions = {}): Promise<this> {
    this.checkOpen();
    if (device !== undefined && typeof device !== 'string') throw new MidiError(`The MIDI device must be a string, got ${typeof device}`);
    const source = this.midiSource(device);
    const info: MidiInputInfo = { ...(device !== undefined ? { device } : {}), name: null, connected: false };
    // (before opening: a browser tells of the device connecting while it opens)
    this.midiOpen.set(source, info);
    let name: string | null;
    try {
      name = await this.engine.openMidiInput(
        source,
        { device: device ?? null, route: options.route ?? true, optional: options.optional ?? false },
        (raw: Uint8Array) => {
          const e = parseMidiBytes(raw);
          if (device !== undefined) e.device = device;
          this.emit('midi', e);
        },
        (connected, portName) => {
          if (this.midiOpen.get(source) !== info) return;
          info.connected = connected;
          info.name = portName;
          this.emit('midiDevice', { ...info });
        },
      );
    } catch (e) {
      if (this.midiOpen.get(source) === info) this.midiOpen.delete(source);
      throw new MidiError(`Failed to enable MIDI: ${(e as Error).message}`);
    }
    if (name !== null && !info.connected) {
      // (the device's 'midiDevice' event is on its way; until then, what open() said)
      info.name = name;
      info.connected = true;
    }
    return this;
  }

  /** Disconnect the MIDI input opened with `device` (the keys and pedals it held are let go),
   *  or every MIDI input when it is left out. */
  disableMidi(device?: string): this {
    if (device === undefined) {
      this.engine.closeMidiInput();
      this.midiOpen.clear();
      return this;
    }
    const source = this.midiSources.get(midiKey(device));
    if (source !== undefined && this.midiOpen.delete(source)) this.engine.closeMidiInput(source);
    return this;
  }

  /** The MIDI inputs opened with {@link enableMidi}, and whether their device is connected. */
  midiInputs(): MidiInputInfo[] {
    return [...this.midiOpen.values()].map((i) => ({ ...i }));
  }

  /** Names of the MIDI input devices. */
  listMidiDevices(): string[] {
    return this.engine.listMidiDevices();
  }

  /** Names of the MIDI output devices. */
  listMidiOutputs(): string[] {
    return this.engine.listMidiOutputs();
  }

  /**
   * Send MIDI to the first output device whose name contains `device` (ignoring case): one or
   * more whole messages, each starting with its status byte. Returns `false`, sending nothing,
   * when there is no such device, so it can be called whether or not the device is on:
   *
   * ```ts
   * // Local Control Off on all 16 channels: the keyboard's own sound stays silent
   * synth.sendMidi('piano', Array.from({ length: 16 }, (_, ch) => [0xb0 | ch, 122, 0]).flat());
   * ```
   */
  sendMidi(device: string, message: ArrayLike<number>): boolean {
    this.checkOpen();
    if (typeof device !== 'string') throw new MidiError(`The MIDI device must be a string, got ${typeof device}`);
    const bytes: number[] = [];
    for (let i = 0; i < message.length; i++) bytes.push(integer(message[i], 0, 255, `MIDI byte ${i}`));
    try {
      return this.engine.sendMidi(device, platform.toBytes(bytes));
    } catch (e) {
      throw new MidiError(`Failed to send MIDI: ${(e as Error).message}`);
    }
  }

  /** The engine's MIDI source for an input device name (given one the first time). */
  private midiSource(device: string | undefined): number {
    const key = midiKey(device);
    let source = this.midiSources.get(key);
    if (source === undefined) {
      if (this.midiSources.size >= MIDI_SOURCES - 1) throw new MidiError(`At most ${MIDI_SOURCES - 1} MIDI devices`);
      source = this.midiSources.size + 1;
      this.midiSources.set(key, source);
    }
    return source;
  }

  listAudioBackends(): string[] {
    return this.engine.listAudioBackends();
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** Offline, sound the organ stops drawn while their models were loading (real-time output
   *  was running then), waiting for those models. */
  private loadDrawn(): void {
    for (const i of this.instruments()) if (i instanceof Organ) i._loadDrawn();
  }

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
    n.controlChange(ch, 66, 0);
    n.controlChange(ch, 67, 0);
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

  /** @internal Play MIDI channel `midiChannel` (1–16) of the input opened with `device` (of
   *  any input when left out) on engine channel `channel`: its notes, and its controllers
   *  unless `controllers` is false. */
  _route(midiChannel: number, channel: number, device?: string, controllers = true): void {
    const source = device === undefined ? 0 : this.midiSource(device);
    this.engine.setMidiRoute(midiChannel, channel, source, controllers);
    this.routes[source]![midiChannel - 1] = channel;
  }

  /** @internal Stop playing any MIDI channel on engine channel `channel`. */
  _unroute(channel: number): void {
    this.routes.forEach((channels, source) => {
      for (let i = 0; i < 16; i++) {
        if (channels[i] !== channel) continue;
        this.engine.setMidiRoute(i + 1, 255, source);
        channels[i] = null;
      }
    });
  }

  /** @internal The room of the first instrument or organ added, while the reverb is
   *  automatic; it follows that instrument's presets. */
  _suggestRoom(room: ReverbPreset, owner: Instrument | Organ, time?: number): void {
    if (this.reverbMode !== 'auto' || (this.roomOwner !== undefined && this.roomOwner !== owner)) return;
    this.roomOwner = owner;
    this.engine.setReverbPreset(room, time);
  }

  /** @internal Real-time output is running (or emulated): calls should not wait for models. */
  get _realtime(): boolean {
    return this.emulateRealtime || this.engine.isRunning;
  }

  /** @internal The native id of a model registered for some owner (0 if none). */
  _modelId(name: string): number {
    return this.models.get(name)?.id ?? 0;
  }

  /** @internal Partial cap implied by the `quality` option. */
  get _maxPartials(): number {
    return this.maxPartials;
  }

  /** @internal */
  _native(): NativeEngine {
    return this.engine;
  }

  /** @internal Load (once per synth) and return the native id of a model `owner` uses. A model
   *  still loading in the background is waited for when the engine first uses the id. */
  _model(name: string, owner: object): number {
    let m = this.models.get(name);
    if (!m) {
      // the engine parses the bytes into its own model, so they are not kept
      m = { id: this.engine.loadModel(platform.readModel(this._modelFile(name))), users: new Set() };
      this.models.set(name, m);
    }
    m.users.add(owner);
    return m.id;
  }

  /** @internal Start loading these models (that are not loaded yet) in the background, for
   *  `owner`; returns their ids. They are usable at once: a use waits for just that model. */
  _preload(names: Iterable<string>, owner: object): number[] {
    const ids: number[] = [];
    for (const name of names) {
      let m = this.models.get(name);
      if (!m) {
        m = { id: this.engine.queueModelFile(this._modelFile(name)), users: new Set() };
        this.models.set(name, m);
      }
      m.users.add(owner);
      ids.push(m.id);
    }
    return ids;
  }

  /** @internal The file (Node.js) or URL (browser) of a model. */
  _modelFile(name: string): string {
    return platform.locateModel(name, this.modelsDirectory);
  }

  /** @internal Preloading everything when these models would take at most a quarter of the
   *  machine's memory decoded (about 5 times their file size), else only a preset's. */
  _defaultPreload(names: Iterable<string>): 'all' | 'preset' {
    let bytes = 0;
    for (const name of names) bytes += platform.modelSize(this._modelFile(name));
    return bytes * DECODED_PER_FILE_BYTE <= platform.memory() / 4 ? 'all' : 'preset';
  }

  /** @internal Decoded size of the models loaded so far, in bytes. */
  _modelBytes(): number {
    let bytes = 0;
    for (const m of this.models.values()) bytes += this.engine.modelBytes(m.id) ?? 0;
    return bytes;
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

/** A timer that does not keep Node.js running (a browser's need not). */
function unref(timer: unknown): void {
  (timer as { unref?: () => void }).unref?.();
}

function clientName(name: unknown): string {
  if (typeof name !== 'string' || !/^[\w .-]{1,60}$/.test(name)) {
    throw new SupersynthError(`clientName must be 1-60 letters, digits, spaces, '.', '-' or '_', got ${JSON.stringify(name)}`);
  }
  return name;
}

function parseMidiBytes(bytes: Uint8Array): MidiEvent {
  // (a Buffer from the Node.js engine, a Uint8Array from a browser's)
  const raw = bytes as Bytes;
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
