// The engine as the TypeScript API drives it: the Node.js addon (napi, native/src) and the
// browser's WebAssembly module (native/wasm, wrapped by src/platform/web/engine.ts) both have
// this shape, over the same Rust host layer (native/host).

/** @internal The engine surface: the napi addon in Node.js, WebAssembly in a browser. */
export interface NativeLayer {
  model: number;
  transpose?: number;
  gainDb?: number;
  pan?: number;
  keyLo?: number;
  keyHi?: number;
  enabled?: boolean;
  detuneCents?: number;
  onRelease?: boolean;
  speechMs?: number;
  directOnly?: boolean;
}

/** @internal */
export interface NativeCoupler {
  part: number;
  shift?: number;
}

/** @internal */
export interface NativeEngine {
  readonly sampleRate: number;
  readonly currentTime: number;
  readonly activeVoices: number;
  readonly cpuLoad: number;
  /** Peak output level of the last buffers (0–1), in steps of 0.001. */
  readonly peak: number;
  /** Threads rendering audio, the audio thread included. */
  readonly threads: number;
  readonly isRunning: boolean;
  /** The overload guard is shedding load now. */
  readonly guardActive: boolean;
  readonly guardStats: { active: boolean; voicesShed: number; partialsReduced: number };
  /** Opt-in overload guard (armed only while rendering in real time). */
  setOverloadGuard(on: boolean): void;
  /** Treat `render()` calls as real-time buffers (benchmarks, tests). */
  setRealtimeEmulation(on: boolean): void;
  readonly queueFree: number;
  /** The audio thread hit an internal error and now outputs silence. */
  readonly faulted: boolean;
  readonly error: string | null;
  loadModel(bytes: Uint8Array): number;
  /** Load a model file on a background thread; the id is usable at once (a use waits for
   *  just that model, loading it on the spot if no worker has started it). */
  queueModelFile(path: string): number;
  /** Calls back once all these models have loaded (or been unloaded): with null, or the first
   *  loading error. The wait does not keep Node.js running. */
  watchModels(ids: number[], callback: (error: string | null) => void): void;
  /** Load these models next, before the other models queued. */
  hurryModels(ids: number[]): void;
  /** Whether a model is still loading in the background (a use would wait for it). */
  modelLoading(id: number): boolean;
  /** Decoded size of a model in bytes, or null while it is still loading. */
  modelBytes(id: number): number | null;
  unloadModel(id: number): void;
  modelInfo(id: number): string;
  setInstrument(part: number, layers: NativeLayer[], time?: number | null): void;
  addLayer(part: number, layer: NativeLayer, time?: number | null): void;
  noteOn(part: number, note: number, velocity: number, time?: number | null): void;
  noteOff(part: number, note: number, time?: number | null): void;
  controlChange(part: number, controller: number, value: number, time?: number | null): void;
  pitchBend(part: number, value: number, time?: number | null): void;
  setParam(part: number, name: string, value: number, time?: number | null): void;
  setMasterParam(name: string, value: number, time?: number | null): void;
  setReverbPreset(name: string, time?: number | null): void;
  setLayerEnabled(part: number, layer: number, enabled: boolean, time?: number | null): void;
  setLayerGain(part: number, layer: number, gainDb: number, time?: number | null): void;
  setCouplers(part: number, targets: NativeCoupler[], unisonOff?: boolean | null, time?: number | null): void;
  setMidiRoute(channel: number, part: number): void;
  allNotesOff(part?: number | null, time?: number | null): void;
  allSoundOff(): void;
  /** Start real-time output (a browser sets up its audio graph asynchronously). */
  start(): void | Promise<void>;
  stop(): void;
  render(frames: number): Float32Array;
  listMidiDevices(): string[];
  listAudioBackends(): string[];
  /** (A browser asks for MIDI access asynchronously.) */
  enableMidi(deviceName: string | null | undefined, route: boolean, callback: (bytes: Uint8Array) => void): void | Promise<void>;
  disableMidi(): void;
  /** Resolves once the engine's threads run (a browser's Web Workers start asynchronously). */
  ready?(): Promise<void>;
  /** Stop and let go of every instrument and model now; the engine cannot be used afterwards. */
  releaseResources(): void;
}

/** @internal */
export interface NativeModule {
  SynthEngine: new (options?: {
    sampleRate?: number;
    backend?: string;
    maxVoices?: number;
    reverb?: string;
    bufferSize?: number;
    /** Rendering threads, the audio thread included; 0 or absent: one per core but one. */
    threads?: number;
  }) => NativeEngine;
  reverbPresets(): string[];
  partParamNames(): string[];
}
