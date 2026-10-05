// The engine in a browser: the WebAssembly build of the same Rust host layer as the Node.js addon
// (native/wasm over native/host), behind the same interface (`NativeEngine`). What differs is
// only what a browser provides: audio goes out through an AudioWorklet, the render workers are
// Web Workers, models arrive as fetched bytes, MIDI comes from Web MIDI.
//
// Everything runs on one shared memory: the API calls and the models on the page's main thread,
// rendering on the audio thread (the worklet) and the render workers. The main thread never
// blocks; models load on it, when first used or between other work (one per task).
import initWasm, { freeAudioHandle, queuedThreads, sweep, SynthEngine } from '#wasm';

import type { NativeCoupler, NativeEngine, NativeLayer } from '../../engine.js';
import { SupersynthError } from '../../errors.js';
import type { EngineOptions } from '../platform.js';
import { addWorklet, startThreads, WORKLET_FRAMES, type WasmShared } from './threads.js';

let shared: WasmShared | undefined;
let preparing: Promise<void> | undefined;

/** Load the WebAssembly engine (once): compile it, and instantiate it on a new shared memory. */
export function prepareWasm(source: () => Promise<ArrayBuffer | Uint8Array>): Promise<void> {
  preparing ??= (async () => {
    if (typeof SharedArrayBuffer === 'undefined' || (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === false) {
      throw new SupersynthError(
        'supersynth needs a cross-origin isolated page in a browser (its engine runs on several threads, over shared memory): ' +
          'serve the page with the headers Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp',
      );
    }
    const bytes = new Uint8Array(await source());
    const module = await WebAssembly.compile(bytes);
    const { initial, maximum } = memoryLimits(bytes);
    const memory = new WebAssembly.Memory({ initial, maximum, shared: true });
    await initWasm({ module_or_path: module, memory });
    shared = { module, memory };
  })();
  preparing.catch(() => {
    preparing = undefined; // (a later call tries again)
  });
  return preparing;
}

/** The limits of the memory a module imports (pages), read from its import section. */
export function memoryLimits(wasm: Uint8Array): { initial: number; maximum: number } {
  let p = 8; // magic, version
  const leb = () => {
    let v = 0;
    let shift = 0;
    for (;;) {
      const b = wasm[p++]!;
      v += (b & 0x7f) * 2 ** shift;
      if (b < 0x80) return v;
      shift += 7;
    }
  };
  const skipName = () => {
    const n = leb();
    p += n;
  };
  while (p < wasm.length) {
    const id = wasm[p++]!;
    const size = leb();
    const end = p + size;
    if (id === 2) {
      for (let count = leb(); count > 0; count--) {
        skipName();
        skipName();
        const kind = wasm[p++]!;
        if (kind === 0) leb(); // function: type index
        else if (kind === 1) {
          p++; // table: element type, then limits
          const flags = wasm[p++]!;
          leb();
          if (flags & 1) leb();
        } else if (kind === 2) {
          const flags = wasm[p++]!;
          const initial = leb();
          const maximum = flags & 1 ? leb() : 65536;
          return { initial, maximum };
        } else if (kind === 3) p += 2; // global: value type, mutability
        else if (kind === 4) {
          p++; // tag: attribute, type index
          leb();
        }
      }
    }
    p = end;
  }
  throw new SupersynthError('The WebAssembly engine imports no memory: it was not built for threads (npm run build:wasm)');
}

/** Threads to render with by default: one per core but one, 1–8 (as in Node.js). */
function defaultThreads(): number {
  const cores = (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator?.hardwareConcurrency ?? 1;
  return Math.max(1, Math.min(8, cores - 1));
}

interface Watcher {
  ids: number[];
  callback: (error: string | null) => void;
}

/** @internal */
export class WasmEngine implements NativeEngine {
  private e: SynthEngine;
  private bufferSize: number | undefined;
  private ctx: AudioContext | undefined;
  private node: AudioWorkletNode | undefined;
  /** What stopped the audio worklet, if it failed. */
  private failure: string | null = null;
  private watchers: Watcher[] = [];
  private pumping = false;
  /** While playing: frees unloaded models once the engine has let go of them (there is no
   *  reclaim thread here). */
  private sweeper: ReturnType<typeof setInterval> | undefined;
  private midiAccess: MIDIAccess | undefined;
  private midiIn: MIDIInput | undefined;
  /** Model bytes (fetched by the platform) by location. */
  private readonly bytes: (location: string) => Uint8Array;
  private readonly started: Promise<void>;

  constructor(options: EngineOptions, bytes: (location: string) => Uint8Array) {
    if (!shared) throw new SupersynthError('The WebAssembly engine is not loaded yet: create the synth with `await Synth.create()`');
    this.e = new SynthEngine({
      sampleRate: options.sampleRate,
      maxVoices: options.maxVoices,
      reverb: options.reverb,
      threads: options.threads ?? defaultThreads(),
    });
    this.bufferSize = options.bufferSize;
    this.bytes = bytes;
    // the render workers the engine asked for
    this.started = startThreads(shared, queuedThreads());
  }

  /** Resolves once the render workers run (Web Workers start only while the page's main thread
   *  is free). */
  ready(): Promise<void> {
    return this.started;
  }

  // ── state ─────────────────────────────────────────────────────────────────

  get sampleRate(): number {
    return this.e.sampleRate;
  }

  get currentTime(): number {
    return this.e.currentTime;
  }

  get activeVoices(): number {
    return this.e.activeVoices;
  }

  get cpuLoad(): number {
    return this.e.cpuLoad;
  }

  get threads(): number {
    return this.e.threads;
  }

  get isRunning(): boolean {
    return this.node !== undefined;
  }

  get queueFree(): number {
    return this.e.queueFree;
  }

  get faulted(): boolean {
    return this.failure !== null || this.e.faulted;
  }

  get error(): string | null {
    return this.failure ?? this.e.error ?? null;
  }

  // ── models ────────────────────────────────────────────────────────────────

  loadModel(bytes: Uint8Array): number {
    return this.e.loadModel(bytes);
  }

  queueModelFile(location: string): number {
    const id = this.e.queueModelBytes(location, this.bytes(location));
    this.pump();
    return id;
  }

  watchModels(ids: number[], callback: (error: string | null) => void): void {
    this.watchers.push({ ids, callback });
    this.pump();
  }

  hurryModels(ids: number[]): void {
    this.e.hurryModels(ids);
  }

  modelLoading(id: number): boolean {
    return this.e.modelLoading(id);
  }

  modelBytes(id: number): number | null {
    return this.e.modelBytes(id) ?? null;
  }

  unloadModel(id: number): void {
    this.e.unloadModel(id);
  }

  modelInfo(id: number): string {
    return this.e.modelInfo(id);
  }

  /** Load the queued models one per task (the page stays responsive between them), and settle
   *  the watchers whose models have loaded. */
  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    const tick = () => {
      this.settle();
      const more = this.e.loadNext();
      this.settle();
      if (more || this.watchers.length > 0) setTimeout(tick, 0);
      else this.pumping = false;
    };
    setTimeout(tick, 0);
  }

  private settle(): void {
    if (this.watchers.length === 0) return;
    const done: Watcher[] = [];
    this.watchers = this.watchers.filter((w) => {
      if (w.ids.some((id) => this.e.modelLoading(id))) return true;
      done.push(w);
      return false;
    });
    for (const w of done) {
      let error: string | null = null;
      for (const id of w.ids) error ??= this.e.modelError(id) ?? null;
      w.callback(error);
    }
  }

  // ── parts ─────────────────────────────────────────────────────────────────

  setInstrument(part: number, layers: NativeLayer[], time?: number | null): void {
    this.e.setInstrument(part, layers, time);
  }

  addLayer(part: number, layer: NativeLayer, time?: number | null): void {
    this.e.addLayer(part, layer, time);
  }

  noteOn(part: number, note: number, velocity: number, time?: number | null): void {
    this.e.noteOn(part, note, velocity, time);
  }

  noteOff(part: number, note: number, time?: number | null): void {
    this.e.noteOff(part, note, time);
  }

  controlChange(part: number, controller: number, value: number, time?: number | null): void {
    this.e.controlChange(part, controller, value, time);
  }

  pitchBend(part: number, value: number, time?: number | null): void {
    this.e.pitchBend(part, value, time);
  }

  setParam(part: number, name: string, value: number, time?: number | null): void {
    this.e.setParam(part, name, value, time);
  }

  setMasterParam(name: string, value: number, time?: number | null): void {
    this.e.setMasterParam(name, value, time);
  }

  setReverbPreset(name: string, time?: number | null): void {
    this.e.setReverbPreset(name, time);
  }

  setLayerEnabled(part: number, layer: number, enabled: boolean, time?: number | null): void {
    this.e.setLayerEnabled(part, layer, enabled, time);
  }

  setLayerGain(part: number, layer: number, gainDb: number, time?: number | null): void {
    this.e.setLayerGain(part, layer, gainDb, time);
  }

  setCouplers(part: number, targets: NativeCoupler[], unisonOff?: boolean | null, time?: number | null): void {
    this.e.setCouplers(part, targets, unisonOff, time);
  }

  setMidiRoute(channel: number, part: number): void {
    this.e.setMidiRoute(channel, part);
  }

  allNotesOff(part?: number | null, time?: number | null): void {
    this.e.allNotesOff(part, time);
  }

  allSoundOff(): void {
    this.e.allSoundOff();
  }

  // ── output ────────────────────────────────────────────────────────────────

  /** Start playing: an AudioWorklet renders the engine (sound starts once the page is allowed
   *  to play audio, after a user gesture). */
  async start(): Promise<void> {
    if (this.node || !shared) return;
    const sampleRate = this.e.sampleRate;
    this.ctx ??= new AudioContext({ sampleRate, latencyHint: this.bufferSize ? this.bufferSize / sampleRate : 'interactive' });
    const ctx = this.ctx;
    await addWorklet(ctx);
    if (this.node) return;
    const handle = this.e.audioHandle(WORKLET_FRAMES);
    const node = new AudioWorkletNode(ctx, 'supersynth', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { module: shared.module, memory: shared.memory, handle },
    });
    // the handle is freed once the worklet has let go of it
    node.port.onmessage = (ev: MessageEvent) => {
      if (ev.data === 'closed') freeAudioHandle(handle);
    };
    node.onprocessorerror = () => {
      this.failure ??= 'the audio engine failed (in its AudioWorklet)';
    };
    node.connect(ctx.destination);
    this.node = node;
    this.e.setRunning(true);
    this.sweeper = setInterval(sweep, 1000);
    void ctx.resume();
  }

  stop(): void {
    const node = this.node;
    if (!node) return;
    this.node = undefined;
    clearInterval(this.sweeper);
    this.e.setRunning(false);
    node.port.postMessage('stop');
    node.disconnect();
  }

  render(frames: number): Float32Array {
    const out = this.e.render(frames);
    sweep();
    return out;
  }

  // ── MIDI ──────────────────────────────────────────────────────────────────

  listMidiDevices(): string[] {
    return this.midiAccess ? [...this.midiAccess.inputs.values()].map((i) => i.name ?? i.id) : [];
  }

  listAudioBackends(): string[] {
    return ['webaudio'];
  }

  async enableMidi(deviceName: string | null | undefined, route: boolean, callback: (bytes: Uint8Array) => void): Promise<void> {
    const nav = globalThis.navigator as Navigator | undefined;
    if (!nav?.requestMIDIAccess) throw new Error('Web MIDI is not available in this browser');
    this.midiAccess ??= await nav.requestMIDIAccess();
    const inputs = [...this.midiAccess.inputs.values()];
    const input = deviceName ? inputs.find((i) => (i.name ?? '').includes(deviceName)) : inputs[0];
    if (!input) {
      throw new Error(deviceName ? `No MIDI input matching '${deviceName}'. Inputs: ${inputs.map((i) => i.name).join(', ') || 'none'}` : 'No MIDI input device found');
    }
    this.disableMidi();
    input.onmidimessage = (ev: MIDIMessageEvent) => {
      const data = ev.data;
      if (!data) return;
      if (route) this.e.midiInput(data);
      callback(data);
    };
    this.midiIn = input;
  }

  disableMidi(): void {
    if (this.midiIn) this.midiIn.onmidimessage = null;
    this.midiIn = undefined;
  }

  releaseResources(): void {
    this.stop();
    this.disableMidi();
    this.watchers = [];
    this.e.releaseResources();
    void this.ctx?.close();
    this.ctx = undefined;
  }
}
