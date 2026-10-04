import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { findInstrument, INSTRUMENTS, type InstrumentDef, type LayerDef } from './catalog/index.js';
import { AudioBackendError, MidiError, SupersynthError } from './errors.js';
import { parseMidiFile, type MidiFileData, type MidiFileEvent } from './midifile.js';
import { loadNative, packageRoot, type NativeEngine, type NativeLayer } from './native.js';
import type { InstrumentParams, ReverbOptions, ReverbPreset } from './params.js';
import { REVERB_FIELDS } from './params.js';
import { Division, Organ, resolveOrgan, type OrganOptions } from './Organ.js';
import { ORGAN_DEFAULTS } from './organs/defaults.js';
import type { OrganInstrument } from './organs/index.js';
import { Part } from './Part.js';
import { deinterleave, makeAudioBuffer, writeWav, type AudioBuffer, type WavOptions } from './wav.js';
import type { MidiEvent } from './types.js';

export type BackendKind = 'auto' | 'coreaudio' | 'wasapi' | 'alsa' | 'jack' | 'pulseaudio' | 'pipewire';

export interface SynthOptions {
  /** Sample rate in Hz. Default: the audio device's rate (48000 if there is no device). */
  sampleRate?: number;
  /** Audio backend. @default 'auto' */
  backend?: BackendKind;
  /** Room reverb: a preset name, detailed options, `false` for none, or `'auto'` to use
   *  the first instrument's recommended room. @default 'auto' */
  reverb?: ReverbPreset | ReverbOptions | false | 'auto';
  /** Master volume, 0–1 (linear). @default 0.5 */
  volume?: number;
  /** Maximum sounding voices before the quietest are stolen. @default 192 */
  maxVoices?: number;
  /** Audio buffer size in frames (smaller = lower latency, more CPU risk). Default: device default. */
  bufferSize?: number;
  /** Directory with `.ssm` models. Default: the package's `models/` folder. */
  modelsDir?: string;
  /** CPU/quality trade-off: partials per note up to 512 (`'high'`), 128 (`'balanced'`) or 32 (`'eco'`,
   *  for small boards such as a Raspberry Pi). @default 'high' */
  quality?: 'high' | 'balanced' | 'eco';
}

export interface AddOptions {
  /** Preset name (see `part.presets`). @default 'default' */
  preset?: string;
  /** Parameter tweaks on top of the preset. */
  params?: InstrumentParams;
  /** Engine channel 0–31 (MIDI channel − 1). Default: next free channel. */
  channel?: number;
}

/** Information about an available instrument. */
export interface InstrumentInfo {
  id: string;
  name: string;
  family: string;
  description: string;
  presets: Record<string, string>;
  aliases: string[];
  available: boolean;
}

export interface MidiPlayOptions {
  /** Instrument per MIDI channel (1–16) or track name/index, e.g. `{ 1: 'grand-piano', 10: drums }`.
   *  Default: every channel plays `instrument`. */
  channels?: Record<number, MidiTarget>;
  /** Instrument used for channels not listed. @default 'grand-piano' */
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

/** Where MIDI file notes go: an instrument id, a part, or an organ division. */
export type MidiTarget = string | Part | Division;

const MODEL_BYTES = new Map<string, Buffer>();

/**
 * The synthesizer: an engine that plays real instruments.
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
 * const audio = synth.render(3);        // { sampleRate, left, right }
 * synth.renderToFile('chord.wav', 3);
 * ```
 */
export class Synth extends EventEmitter {
  private engine: NativeEngine;
  private parts: (Part | null)[] = new Array(32).fill(null);
  private models = new Map<string, number>();
  private modelsDir: string;
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
    this.modelsDir = options.modelsDir ?? path.join(packageRoot(), 'models');
    this.maxPartials = { high: 512, balanced: 128, eco: 32 }[options.quality ?? 'high'];
    this.reverbMode = options.reverb === undefined || options.reverb === 'auto' ? 'auto' : 'set';
    if (options.reverb !== undefined && options.reverb !== 'auto') this.setReverb(options.reverb);
    this.setVolume(options.volume ?? 0.5);
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

  /** All instruments in the catalog. */
  static instruments(): InstrumentInfo[] {
    const dir = path.join(packageRoot(), 'models');
    return INSTRUMENTS.map((d) => ({
      id: d.id,
      name: d.name,
      family: d.family,
      description: d.description,
      presets: Object.fromEntries(Object.entries(d.presets).map(([k, p]) => [k, p.description])),
      aliases: d.aliases ?? [],
      available: d.layers.every((l) => existsSync(path.join(dir, `${l.model}.ssm`))),
    }));
  }

  // ── parts ─────────────────────────────────────────────────────────────────

  /**
   * Add an instrument on its own channel.
   *
   * @param instrument  Catalog id or alias (`'grand-piano'`, `'violin'`, `'strings'`, …) or a custom
   *                    {@link InstrumentDef}.
   */
  add(instrument: string | InstrumentDef, options: AddOptions = {}): Part {
    const def = typeof instrument === 'string' ? findInstrument(instrument) : instrument;
    if (!def) {
      throw new SupersynthError(
        `Unknown instrument '${String(instrument)}'. Available: ${INSTRUMENTS.map((d) => d.id).join(', ')}`,
      );
    }
    let ch: number;
    if (options.channel !== undefined) {
      ch = options.channel;
      if (!Number.isInteger(ch) || ch < 0 || ch > 31) throw new RangeError('channel must be an integer 0-31');
      this.used.add(ch);
    } else {
      ch = this.freeChannel();
    }
    const part = new Part(this, ch, def);
    this.parts[ch] = part;
    part.usePreset(options.preset ?? 'default', options.params);

    if (this.reverbMode === 'auto') {
      const preset = def.presets[options.preset ?? 'default'];
      this.engine.setReverbPreset(preset?.reverb ?? def.reverb);
      this.reverbMode = 'set';
    }
    return part;
  }

  /** The part on a channel, if any. */
  part(channel: number): Part | undefined {
    return this.parts[channel] ?? undefined;
  }

  /** Remove a part (its notes stop immediately). */
  remove(part: Part): void {
    if (this.parts[part.index] !== part) return;
    this.engine.setInstrument(part.index, []);
    this.parts[part.index] = null;
    this.used.delete(part.index);
  }

  /** @internal Reserve a free channel (used by the organ's divisions). */
  _reserveChannel(): number {
    return this.freeChannel();
  }

  private freeChannel(): number {
    // channel 9 (MIDI channel 10) is conventionally drums; use it last
    const order = [...Array(32).keys()].filter((c) => c !== 9).concat([9]);
    const ch = order.find((c) => !this.used.has(c));
    if (ch === undefined) throw new SupersynthError('All 32 channels are in use');
    this.used.add(ch);
    return ch;
  }

  private used = new Set<number>();

  /**
   * A church organ (four divisions with drawable stops): the Bureå organ, another built-in
   * organ by id, or any {@link OrganDef}.
   *
   * @example
   * const organ = synth.organ({ preset: 'plenum' });
   * organ.great.play(['C4','E4','G4'], { duration: 4 });
   * synth.organ('vcsl');
   * synth.organ({ instrument: VCSL_ORGAN, preset: 'flutes' });
   */
  organ(options: OrganOptions | OrganInstrument = {}): Organ {
    if (typeof options === 'string') options = { instrument: options };
    if (this.reverbMode === 'auto') {
      this.engine.setReverbPreset(resolveOrgan(options.instrument).reverb ?? ORGAN_DEFAULTS.reverb);
      this.reverbMode = 'set';
    }
    const organ = new Organ(this, options);
    if (this.maxPartials < 512) {
      for (const d of organ.divisions()) this.engine.setParam(d.channel, 'maxPartials', this.maxPartials);
    }
    return organ;
  }

  // ── sound ─────────────────────────────────────────────────────────────────

  /** Master volume 0–1 (linear). */
  setVolume(volume: number): this {
    const v = Math.max(0, Math.min(1, volume));
    this.engine.setMasterParam('volume', v <= 0 ? -120 : 20 * Math.log10(v));
    return this;
  }

  /** Change the room: a preset, detailed options, or `false` to switch reverb off. */
  setReverb(reverb: ReverbPreset | ReverbOptions | false): this {
    this.reverbMode = 'set';
    if (reverb === false) {
      this.engine.setMasterParam('reverbLevel', -120);
      return this;
    }
    const opts: ReverbOptions = typeof reverb === 'string' ? { preset: reverb } : reverb;
    if (opts.preset) this.engine.setReverbPreset(opts.preset);
    if (opts.level === undefined) this.engine.setMasterParam('reverbLevel', 0);
    for (const [k, native] of Object.entries(REVERB_FIELDS)) {
      const v = (opts as Record<string, number | undefined>)[k];
      if (v !== undefined) this.engine.setMasterParam(native, v);
    }
    return this;
  }

  /** Release every held note on every part. */
  allNotesOff(): this {
    this.engine.allNotesOff(null);
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
  renderMidi(file: string | Uint8Array, options: MidiPlayOptions = {}): AudioBuffer {
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
  async playMidi(file: string | Uint8Array, options: MidiPlayOptions = {}): Promise<void> {
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

  private prepareMidi(file: string | Uint8Array, options: MidiPlayOptions) {
    const bytes = typeof file === 'string' ? readFileSync(file) : file;
    const raw = parseMidiFile(bytes);
    const speed = options.speed ?? 1;
    const midi: MidiFileData = speed === 1 ? raw : {
      ...raw,
      duration: raw.duration / speed,
      events: raw.events.map((e) => ({ ...e, time: e.time / speed })),
    };
    const transpose = options.transpose ?? 0;
    const partsByKey = new Map<number, { index: number }>();
    const resolvePart = (key: number): { index: number } => {
      let p = partsByKey.get(key);
      if (p) return p;
      const spec = options.channels?.[key] ?? options.instrument ?? 'grand-piano';
      p = typeof spec === 'string' ? this.add(spec) : spec instanceof Division ? { index: spec.channel } : spec;
      partsByKey.set(key, p);
      return p;
    };
    const n = this.engine;
    const route = (e: MidiFileEvent, t0: number) => {
      const key = options.byTrack ? e.track : e.channel + 1;
      if (!options.byTrack && e.channel === 9 && !options.channels?.[10]) return; // GM drums: skip unless mapped
      const p = resolvePart(key);
      const at = t0 + e.time;
      switch (e.type) {
        case 'noteOn': {
          const note = e.note + transpose;
          if (note >= 0 && note <= 127) n.noteOn(p.index, note, e.velocity, at);
          break;
        }
        case 'noteOff': {
          const note = e.note + transpose;
          if (note >= 0 && note <= 127) n.noteOff(p.index, note, at);
          break;
        }
        case 'cc':
          if ([1, 7, 10, 11, 64, 91].includes(e.controller)) n.controlChange(p.index, e.controller, e.value, at);
          break;
        case 'pitchBend':
          n.pitchBend(p.index, e.value, at);
          break;
        default:
          break;
      }
    };
    return { midi, route };
  }

  // ── MIDI input ────────────────────────────────────────────────────────────

  /**
   * Connect a hardware MIDI input. With `route` (default), channel N plays the part on
   * channel N−1 with no JS round-trip (an organ's {@link Organ.midi} assigns channels to its
   * divisions). Emits `'midi'` events for every message.
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

  listMidiDevices(): string[] {
    return this.engine.listMidiDevices();
  }

  listAudioBackends(): string[] {
    return this.engine.listAudioBackends();
  }

  // ── internals ─────────────────────────────────────────────────────────────

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
    const file = path.join(this.modelsDir, `${name}.ssm`);
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
  _layer(l: LayerDef): NativeLayer {
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
  _setLayers(channel: number, layers: LayerDef[]): void {
    this.engine.setInstrument(channel, layers.map((l) => this._layer(l)));
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
