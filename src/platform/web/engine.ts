// The engine in a browser: the WebAssembly build of the same Rust host layer as the Node.js addon
// (native/wasm over native/host), behind the same interface (`NativeEngine`). What differs is
// only what a browser provides: audio goes out through an AudioWorklet, the render workers are
// Web Workers, models arrive as fetched bytes, MIDI comes from Web MIDI.
//
// Everything runs on one shared memory: the API calls on the page's main thread, rendering on the
// audio thread (the worklet) and the render workers, models loading on loading workers (Web
// Workers too). The main thread never blocks: a use of a model still loading spins until it has.
import initWasm, { freeAudioHandle, queuedThreads, setLoadingThreads, sweep, SynthEngine } from '#wasm';

import type { NativeCoupler, NativeEngine, NativeLayer } from '../../engine.js';
import { SupersynthError } from '../../errors.js';
import type { EngineOptions } from '../platform.js';
import { addWorklet, canStartThreads, startThreads, WORKLET_FRAMES, type WasmShared } from './threads.js';

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
    // as natively: the cores less two (the page's main thread, the audio thread), 1–6
    setLoadingThreads(Math.max(1, Math.min(6, cores() - 2)));
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

function cores(): number {
  return (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator?.hardwareConcurrency ?? 1;
}

/** Threads to render with by default: one per core but one, 1–8 (as in Node.js). */
function defaultThreads(): number {
  return Math.max(1, Math.min(8, cores() - 1));
}

/** Start the threads the engine asked for (render workers when it is created; loading workers
 *  and the model reclaimer when it first needs them); resolves once they run. */
function startQueued(): Promise<void> {
  // (threads started but not running yet have not taken theirs from the queue)
  const n = queuedThreads() - starting;
  if (!shared || n <= 0) return pendingStarts;
  starting += n;
  const started = startThreads(shared, n).finally(() => {
    starting -= n;
  });
  pendingStarts = Promise.all([pendingStarts, started]).then(() => undefined);
  return pendingStarts;
}

/** Threads started that have not taken a queued thread yet, and when they all will have. */
let starting = 0;
let pendingStarts: Promise<void> = Promise.resolve();

interface Watcher {
  ids: number[];
  callback: (error: string | null) => void;
}

/** A MIDI input of the browser engine: the device it follows. */
interface WebMidiInput {
  pattern: string;
  route: boolean;
  onMessage: (bytes: Uint8Array) => void;
  onState: (connected: boolean, name: string) => void;
  port: MIDIInput | undefined;
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
  /** MIDI inputs by source (see `openMidiInput`). */
  private midiInputs = new Map<number, WebMidiInput>();
  /** Told when the output stops by itself. */
  private onEvent: ((stopped: string | null) => void) | undefined;
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
    this.started = startQueued();
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

  get peak(): number {
    return this.e.peak;
  }

  /** (In a browser the guard follows the load the AudioWorklet reports, every 64 buffers.) */
  setOverloadGuard(on: boolean): void {
    this.e.setOverloadGuard(on);
  }

  setRealtimeEmulation(on: boolean): void {
    this.e.setRealtimeEmulation(on);
  }

  get guardActive(): boolean {
    return this.e.guardActive;
  }

  get guardStats(): { active: boolean; voicesShed: number; partialsReduced: number } {
    const [active, voicesShed, partialsReduced] = this.e.guardStats();
    return { active: active === 1, voicesShed: voicesShed!, partialsReduced: partialsReduced! };
  }

  get isRunning(): boolean {
    return this.node !== undefined;
  }

  /** (A browser schedules its audio thread itself: not known.) */
  get realtime(): boolean | null {
    return null;
  }

  get xruns(): number {
    return 0;
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

  /** Queue a model's (fetched) bytes: a loading worker parses it. */
  queueModelFile(location: string): number {
    const id = this.e.queueModelBytes(location, this.bytes(location));
    void startQueued();
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
    void startQueued(); // (the reclaimer, the first time)
  }

  modelInfo(id: number): string {
    return this.e.modelInfo(id);
  }

  /** Settle the watchers whose models have loaded, checking every few milliseconds while
   *  some wait. Where no thread can be started, load the queued models here, one per task. */
  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    const threads = canStartThreads();
    const tick = () => {
      this.settle();
      const more = !threads && this.e.loadNext();
      this.settle();
      if (more || this.watchers.length > 0) setTimeout(tick, threads ? 5 : 0);
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

  setMidiRoute(channel: number, part: number, source?: number, controllers?: boolean): void {
    this.e.setMidiRoute(channel, part, source ?? 0, controllers ?? true);
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
  async start(onEvent?: (stopped: string | null) => void): Promise<void> {
    if (this.node || !shared) return;
    this.onEvent = onEvent;
    this.e.checkOpen();
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
      this.onEvent?.(this.failure);
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
    this.onEvent = undefined;
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

  listMidiOutputs(): string[] {
    return this.midiAccess ? [...this.midiAccess.outputs.values()].map((o) => o.name ?? o.id) : [];
  }

  listAudioBackends(): string[] {
    return ['webaudio'];
  }

  async openMidiInput(
    source: number,
    options: { device?: string | null; route: boolean; optional: boolean },
    onMessage: (bytes: Uint8Array) => void,
    onState: (connected: boolean, name: string) => void,
  ): Promise<string | null> {
    const nav = globalThis.navigator as Navigator | undefined;
    if (!nav?.requestMIDIAccess) throw new Error('Web MIDI is not available in this browser');
    const access = (this.midiAccess ??= await nav.requestMIDIAccess({ sysex: false }));
    access.onstatechange = () => this.rescanMidi();
    this.closeMidiInput(source);
    const pattern = (options.device ?? '').toLowerCase();
    const inputs = [...access.inputs.values()];
    const found = inputs.find((i) => (i.name ?? '').toLowerCase().includes(pattern) && i.state === 'connected');
    if (!found && !options.optional) {
      throw new Error(options.device ? `No MIDI input matching '${options.device}'. Inputs: ${inputs.map((i) => i.name).join(', ') || 'none'}` : 'No MIDI input device found');
    }
    const input: WebMidiInput = { pattern, route: options.route, onMessage, onState, port: undefined };
    this.midiInputs.set(source, input);
    if (found) this.attachMidi(source, input, found);
    return found ? (found.name ?? found.id) : null;
  }

  private attachMidi(source: number, input: WebMidiInput, port: MIDIInput): void {
    input.port = port;
    port.onmidimessage = (ev: MIDIMessageEvent) => {
      const data = ev.data;
      if (!data) return;
      if (input.route) this.e.midiInput(data, source);
      input.onMessage(data);
    };
    input.onState(true, port.name ?? port.id);
  }

  /** A device was plugged in or out: inputs follow their devices. */
  private rescanMidi(): void {
    const inputs = [...(this.midiAccess?.inputs.values() ?? [])];
    for (const [source, input] of this.midiInputs) {
      const port = input.port;
      if (port && port.state !== 'connected') {
        port.onmidimessage = null;
        input.port = undefined;
        this.e.midiRelease(source);
        input.onState(false, port.name ?? port.id);
      }
      if (!input.port) {
        const found = inputs.find((i) => (i.name ?? '').toLowerCase().includes(input.pattern) && i.state === 'connected');
        if (found) this.attachMidi(source, input, found);
      }
    }
  }

  closeMidiInput(source?: number | null): void {
    for (const [s, input] of [...this.midiInputs]) {
      if (source != null && s !== source) continue;
      if (input.port) input.port.onmidimessage = null;
      this.midiInputs.delete(s);
      this.e.midiRelease(s);
    }
  }

  sendMidi(device: string, bytes: Uint8Array): boolean {
    const pattern = device.toLowerCase();
    const out = [...(this.midiAccess?.outputs.values() ?? [])].find((o) => (o.name ?? '').toLowerCase().includes(pattern) && o.state === 'connected');
    if (!out) return false;
    out.send(bytes);
    return true;
  }

  releaseResources(): void {
    this.stop();
    this.closeMidiInput();
    this.watchers = [];
    this.e.releaseResources();
    void startQueued();
    void this.ctx?.close();
    this.ctx = undefined;
  }
}
