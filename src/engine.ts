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
  /** Real-time output renders at real-time priority: null until its first buffer (or with
   *  output stopped, or where it is not known: a browser), false when the system refused it. */
  readonly realtime: boolean | null;
  /** Xruns the audio backend has reported (JACK does). */
  readonly xruns: number;
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
  /** Part that MIDI `channel` of `source` plays (source 0, the default: any input; 1…: the
   *  inputs opened with `openMidiInput`, whose routes come first); 255: none. */
  setMidiRoute(channel: number, part: number, source?: number): void;
  allNotesOff(part?: number | null, time?: number | null): void;
  allSoundOff(): void;
  /** Start real-time output (a browser sets up its audio graph asynchronously). `onEvent` is
   *  called with null for an xrun, and with the reason when the output stops by itself. */
  start(onEvent?: (stopped: string | null) => void): void | Promise<void>;
  stop(): void;
  render(frames: number): Float32Array;
  listMidiDevices(): string[];
  listMidiOutputs(): string[];
  listAudioBackends(): string[];
  /** Open MIDI input `source` (1–15) on the first device whose name contains `device` (any
   *  case; the first device when null), now and whenever one appears again; `onState` hears it
   *  connect and go away. Resolves to the device's name, or null (`optional`: none now). (A
   *  browser asks for MIDI access asynchronously.) */
  openMidiInput(
    source: number,
    options: { device?: string | null; route: boolean; optional: boolean },
    onMessage: (bytes: Uint8Array) => void,
    onState: (connected: boolean, name: string) => void,
  ): string | null | Promise<string | null>;
  /** Close MIDI input `source`, or all of them. */
  closeMidiInput(source?: number | null): void;
  /** Send whole MIDI messages to the first output device whose name contains `device`; false
   *  when there is none. */
  sendMidi(device: string, bytes: Uint8Array): boolean;
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
    /** The engine's name in JACK and the ALSA sequencer. */
    clientName?: string;
  }) => NativeEngine;
  reverbPresets(): string[];
  partParamNames(): string[];
}
