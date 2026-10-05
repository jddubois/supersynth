import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';

import { INSTRUMENTS, type InstrumentDefinition, type InstrumentId, type LayerDefinition } from './catalog/index.js';
import { AudioBackendError, MidiError, SupersynthError } from './errors.js';
import { Instrument, type InstrumentOptions } from './Instrument.js';
import { parseMidiFile, type MidiFileData, type MidiFileEvent } from './midifile.js';
import { assertOrganModels, resolveModelFile } from './models.js';
import { loadNative, type NativeEngine, type NativeLayer } from './native.js';
import type { ReverbOptions, ReverbPreset } from './parameters.js';
import { REVERB_FIELDS } from './parameters.js';
import { Organ, type Division, type OrganOptions } from './Organ.js';
import { ORGAN_DEFAULTS } from './organs/defaults.js';
import { ORGANS, type OrganDefinition, type OrganId } from './organs/index.js';
import { resolveTime, type TimeOptions } from './scheduling.js';
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
  /** Directory searched first for `.ssm` models, laid out like the package's `models/`
   *  (`organ/friesach/<stop>.ssm`; also `$SUPERSYNTH_MODELS_DIR`). Default: the models shipped
   *  with supersynth and the installed organ packages (`supersynth-organ-<id>`). */
  modelsDirectory?: string;
  /** CPU/quality trade-off: partials per note up to 512 (`'high'`), 128 (`'balanced'`) or 32 (`'eco'`,
   *  for small boards such as a Raspberry Pi). @default 'high' */
  quality?: 'high' | 'balanced' | 'eco';
}

export interface MidiFileOptions {
  /** Where each MIDI channel (1–16) plays — or each track, with `byTrack` — e.g.
   *  `{ 1: 'violin', 2: organ.pedal }`. Default: every channel plays `instrument`. */
  channels?: Record<number, MidiTarget>;
  /** Where channels not listed play. @default 'grand-piano' */
  instrument?: MidiTarget;
  /** Map by track index instead of channel. @default false */
  byTrack?: boolean;
  /** Tempo scale (2 = twice as fast). @default 1 */
  speed?: number;
  /** Transpose all notes (semitones). @default 0 */
  transpose?: number;
  /** Seconds of tail rendered/waited after the last event. @default 3 */
  tail?: number;
}

/** Where the notes of a MIDI file go: an instrument id (added for the file), an instrument, or
 *  an organ division. */
export type MidiTarget = InstrumentId | Instrument | Division;

const MODEL_BYTES = new Map<string, Buffer>();

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
  private models = new Map<string, number>();
  private modelsDirectory: string | undefined;
  private reverbMode: 'auto' | 'set';
  private maxPartials: number;
  private closed = false;

  constructor(options: SynthOptions = {}) {
    super();
    const N = loadNative();
    const reverbPreset = typeof options.reverb === 'string' && options.reverb !== 'auto' ? options.reverb : 'hall';
    try {
      this.engine = new N.SynthEngine({
        ...(options.sampleRate !== undefined ? { sampleRate: options.sampleRate } : {}),
        ...(options.backend ? { backend: options.backend } : {}),
        ...(options.maxVoices !== undefined ? { maxVoices: options.maxVoices } : {}),
        ...(options.bufferSize !== undefined ? { bufferSize: options.bufferSize } : {}),
        reverb: reverbPreset,
      });
    } catch (e) {
      throw new SupersynthError((e as Error).message);
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

  get isRunning(): boolean {
    return this.engine.isRunning;
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
    const organ = typeof what === 'string' ? (ORGANS as Record<string, OrganDefinition>)[what] : 'stops' in what ? what : undefined;
    if (organ) {
      assertOrganModels(organ, this.modelsDirectory); // a missing organ package fails before any channel is taken
      this._suggestRoom(organ.reverb ?? ORGAN_DEFAULTS.reverb);
      return new Organ(this, organ, options as OrganOptions);
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

  /** Remove an instrument or an organ: its notes stop at once, and its channels and MIDI
   *  channels are freed. */
  remove(item: Instrument | Organ): void {
    const channels = item instanceof Organ ? item.divisions().map((d) => d.channel) : [item.channel];
    if (channels.some((ch) => this.slots[ch] !== item)) return;
    if (item instanceof Organ) item._detachMidi();
    for (const ch of channels) {
      this._unroute(ch);
      this.engine.setInstrument(ch, []);
      this.slots[ch] = null;
    }
  }

  // ── sound ─────────────────────────────────────────────────────────────────

  /**
   * Change the master volume and/or the room; what is left out stays as it is.
   *
   * ```ts
   * synth.set({ volume: 0.8 });
   * synth.set({ reverb: 'cathedral' });
   * synth.set({ reverb: { preset: 'hall', decay: 3.2, predelay: 30 } }, { at: 12 });
   * ```
   */
  set(settings: SynthSettings, options: TimeOptions = {}): this {
    const t = resolveTime(this.currentTime, options);
    const n = this.engine;
    if (settings.volume !== undefined) {
      const v = Math.max(0, Math.min(1, settings.volume));
      n.setMasterParam('volume', v <= 0 ? -120 : 20 * Math.log10(v), t);
    }
    const reverb = settings.reverb;
    if (reverb !== undefined) {
      this.reverbMode = 'set';
      if (reverb === false) {
        n.setMasterParam('reverbLevel', -120, t);
      } else {
        const opts: ReverbOptions = typeof reverb === 'string' ? { preset: reverb } : reverb;
        if (opts.preset) n.setReverbPreset(opts.preset, t);
        if (opts.level === undefined) n.setMasterParam('reverbLevel', 0, t);
        for (const [k, name] of Object.entries(REVERB_FIELDS)) {
          const v = (opts as Record<string, number | undefined>)[k];
          if (v !== undefined) n.setMasterParam(name, v, t);
        }
      }
    }
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

  /** Stop output and MIDI. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.engine.disableMidi();
    } catch {
      /* not enabled */
    }
    this.engine.stop();
  }

  /**
   * Render audio offline (no audio device needed). Advances the engine clock.
   * Notes scheduled with `play()`/`at` are rendered at their times.
   */
  render(seconds: number): AudioBuffer {
    if (this.engine.isRunning) throw new SupersynthError('render() is unavailable while real-time output is running');
    const total = Math.round(Math.max(0, seconds) * this.sampleRate);
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
   * Render a Standard MIDI File offline.
   *
   * @example
   * const audio = synth.renderMidi('bach.mid', { instrument: 'harpsichord' });
   */
  renderMidi(file: string | Uint8Array, options: MidiFileOptions = {}): AudioBuffer {
    const { midi, route } = this.prepareMidi(file, options);
    const tail = options.tail ?? 3;
    const t0 = this.currentTime;
    const end = midi.duration + tail;
    const chunk = 1.0;
    const parts: AudioBuffer[] = [];
    let i = 0;
    for (let t = 0; t < end; t += chunk) {
      const until = t0 + t + chunk + 0.5;
      while (i < midi.events.length && t0 + midi.events[i]!.time < until) {
        route(midi.events[i]!, t0);
        i++;
      }
      parts.push(this.render(Math.min(chunk, end - t)));
    }
    return concatAudio(this.sampleRate, parts);
  }

  /**
   * Play a Standard MIDI File in real time (call `start()` first). Resolves when finished.
   */
  async playMidi(file: string | Uint8Array, options: MidiFileOptions = {}): Promise<void> {
    if (!this.isRunning) await this.start();
    const { midi, route } = this.prepareMidi(file, options);
    const t0 = this.currentTime + 0.2;
    let i = 0;
    await new Promise<void>((resolve) => {
      const pump = () => {
        const horizon = this.currentTime + 1.5;
        while (i < midi.events.length && t0 + midi.events[i]!.time < horizon) {
          route(midi.events[i]!, t0);
          i++;
        }
        if (i >= midi.events.length) {
          clearInterval(timer);
          setTimeout(resolve, Math.max(0, (t0 + midi.duration - this.currentTime + (options.tail ?? 3)) * 1000));
        }
      };
      const timer = setInterval(pump, 100);
      pump();
    });
  }

  private prepareMidi(file: string | Uint8Array, options: MidiFileOptions) {
    const bytes = typeof file === 'string' ? readFileSync(file) : file;
    const raw = parseMidiFile(bytes);
    const speed = options.speed ?? 1;
    const midi: MidiFileData = speed === 1 ? raw : {
      ...raw,
      duration: raw.duration / speed,
      events: raw.events.map((e) => ({ ...e, time: e.time / speed })),
    };
    const transpose = options.transpose ?? 0;
    const channelByKey = new Map<number, number>();
    const resolveChannel = (key: number): number => {
      let ch = channelByKey.get(key);
      if (ch !== undefined) return ch;
      const spec = options.channels?.[key] ?? options.instrument ?? 'grand-piano';
      ch = typeof spec === 'string' ? this.add(spec).channel : spec.channel;
      channelByKey.set(key, ch);
      return ch;
    };
    const n = this.engine;
    const route = (e: MidiFileEvent, t0: number) => {
      const key = options.byTrack ? e.track : e.channel + 1;
      if (!options.byTrack && e.channel === 9 && !options.channels?.[10]) return; // GM drums: skip unless mapped
      const ch = resolveChannel(key);
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
    return { midi, route };
  }

  // ── MIDI input ────────────────────────────────────────────────────────────

  /**
   * Connect a hardware MIDI input: the first device, or the first whose name contains `device`.
   * With `route` (default), notes and controllers go straight to the engine, with no JavaScript
   * in between, to the instruments and organs given MIDI channels with {@link Instrument.midi}
   * and {@link Organ.midi}. Every message is also emitted as a `'midi'` event.
   */
  async enableMidi(device?: string, options: { route?: boolean } = {}): Promise<this> {
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

  /** @internal Give an instrument or an organ division a free engine channel. */
  _attach(owner: Instrument | Organ): number {
    // channel 9 (MIDI channel 10) is conventionally drums; use it last
    const order = [...Array(32).keys()].filter((c) => c !== 9).concat([9]);
    const ch = order.find((c) => this.slots[c] === null);
    if (ch === undefined) throw new SupersynthError('All 32 channels are in use');
    this.slots[ch] = owner;
    return ch;
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

  /** @internal The room of the first instrument or organ, while the reverb is automatic. */
  _suggestRoom(room: ReverbPreset): void {
    if (this.reverbMode !== 'auto') return;
    this.engine.setReverbPreset(room);
    this.reverbMode = 'set';
  }

  /** @internal Partial cap implied by the `quality` option. */
  get _maxPartials(): number {
    return this.maxPartials;
  }

  /** @internal */
  _native(): NativeEngine {
    return this.engine;
  }

  /** @internal Load (once) and return the native id of a model. */
  _model(name: string): number {
    const cached = this.models.get(name);
    if (cached !== undefined) return cached;
    const file = resolveModelFile(name, this.modelsDirectory);
    let bytes = MODEL_BYTES.get(file);
    if (!bytes) {
      if (!existsSync(file)) throw new SupersynthError(`Instrument model '${name}' not found at ${file}`);
      bytes = readFileSync(file);
      MODEL_BYTES.set(file, bytes);
    }
    const id = this.engine.loadModel(bytes);
    this.models.set(name, id);
    return id;
  }

  /** @internal Model metadata. */
  _modelInfo(name: string): { noteRange: [number, number]; displayName: string; source: string } {
    return JSON.parse(this.engine.modelInfo(this._model(name)));
  }

  /** @internal */
  _layer(l: LayerDefinition): NativeLayer {
    return {
      model: this._model(l.model),
      transpose: l.transpose ?? 0,
      gainDb: l.gain ?? 0,
      pan: l.pan ?? 0,
      keyLo: l.keyLow ?? 0,
      keyHi: l.keyHigh ?? 127,
      enabled: true,
      detuneCents: l.detune ?? 0,
      onRelease: l.trigger === 'release',
    };
  }

  /** @internal */
  _setLayers(channel: number, layers: LayerDefinition[], time?: number): void {
    this.engine.setInstrument(channel, layers.map((l) => this._layer(l)), time);
  }
}

function concatAudio(sampleRate: number, parts: AudioBuffer[]): AudioBuffer {
  const n = parts.reduce((a, p) => a + p.left.length, 0);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  let o = 0;
  for (const p of parts) {
    l.set(p.left, o);
    r.set(p.right, o);
    o += p.left.length;
  }
  return makeAudioBuffer(sampleRate, l, r);
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
