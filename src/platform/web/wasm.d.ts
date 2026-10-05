// Types of the WebAssembly engine's JavaScript glue (`wasm/supersynth.js`, which wasm-bindgen
// generates from native/wasm when it is built: `npm run build:wasm`), as far as
// src/platform/web uses it. tsconfig maps `#wasm` here so that the TypeScript checks without
// a build; the package maps it to the glue.

export class SynthEngine {
  constructor(options?: { sampleRate?: number | undefined; maxVoices?: number | undefined; reverb?: string | undefined; threads?: number | undefined });
  free(): void;
  readonly faulted: boolean;
  readonly error: string | undefined;
  readonly sampleRate: number;
  readonly currentTime: number;
  readonly activeVoices: number;
  readonly cpuLoad: number;
  readonly threads: number;
  readonly queueFree: number;
  setRunning(running: boolean): void;
  loadModel(bytes: Uint8Array): number;
  queueModelBytes(name: string, bytes: Uint8Array): number;
  loadNext(): boolean;
  hurryModels(ids: Uint32Array | number[]): void;
  modelLoading(id: number): boolean;
  modelError(id: number): string | undefined;
  modelBytes(id: number): number | undefined;
  unloadModel(id: number): void;
  modelInfo(id: number): string;
  setInstrument(part: number, layers: unknown, time?: number | null): void;
  addLayer(part: number, layer: unknown, time?: number | null): void;
  noteOn(part: number, note: number, velocity: number, time?: number | null): void;
  noteOff(part: number, note: number, time?: number | null): void;
  controlChange(part: number, controller: number, value: number, time?: number | null): void;
  pitchBend(part: number, value: number, time?: number | null): void;
  setParam(part: number, name: string, value: number, time?: number | null): void;
  setMasterParam(name: string, value: number, time?: number | null): void;
  setReverbPreset(name: string, time?: number | null): void;
  setLayerEnabled(part: number, layer: number, enabled: boolean, time?: number | null): void;
  setLayerGain(part: number, layer: number, gainDb: number, time?: number | null): void;
  setCouplers(part: number, targets: unknown, unisonOff?: boolean | null, time?: number | null): void;
  setMidiRoute(channel: number, part: number): void;
  allNotesOff(part?: number | null, time?: number | null): void;
  allSoundOff(): void;
  render(frames: number): Float32Array;
  midiInput(bytes: Uint8Array): void;
  releaseResources(): void;
  audioHandle(frames: number): number;
}

/** Instantiate the module (on `memory`, shared by every thread). */
export default function init(options: { module_or_path: WebAssembly.Module | URL | string; memory?: WebAssembly.Memory; thread_stack_size?: number }): Promise<unknown>;
export function initSync(options: { module: WebAssembly.Module; memory?: WebAssembly.Memory; thread_stack_size?: number }): unknown;
export function queuedThreads(): number;
export function freeAudioHandle(handle: number): void;
export function sweep(): void;
export function reverbPresets(): string[];
export function partParamNames(): string[];
