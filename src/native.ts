import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @internal The native engine surface (napi-rs). */
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
}

/** @internal */
export interface NativeEngine {
  readonly sampleRate: number;
  readonly currentTime: number;
  readonly activeVoices: number;
  readonly cpuLoad: number;
  readonly isRunning: boolean;
  readonly queueFree: number;
  loadModel(bytes: Buffer): number;
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
  allNotesOff(part?: number | null, time?: number | null): void;
  allSoundOff(): void;
  start(): void;
  stop(): void;
  render(frames: number): Float32Array;
  listMidiDevices(): string[];
  listAudioBackends(): string[];
  enableMidi(deviceName: string | null | undefined, route: boolean, callback: (bytes: Buffer) => void): void;
  disableMidi(): void;
}

/** @internal */
export interface NativeModule {
  SynthEngine: new (options?: {
    sampleRate?: number;
    backend?: string;
    maxVoices?: number;
    reverb?: string;
    bufferSize?: number;
  }) => NativeEngine;
  reverbPresets(): string[];
  partParamNames(): string[];
}

let native: NativeModule | null = null;

/** @internal */
export function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

/** @internal Load the compiled addon (platform-specific binary first). */
export function loadNative(): NativeModule {
  if (native) return native;
  const require = createRequire(import.meta.url);
  const root = packageRoot();
  const candidates = [`supersynth.${process.platform}-${process.arch}.node`, 'supersynth.node'];
  const errors: string[] = [];
  for (const name of candidates) {
    try {
      native = require(path.join(root, name)) as NativeModule;
      return native;
    } catch (e) {
      errors.push(`${name}: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  throw new Error(
    `No supersynth native binary for ${process.platform}-${process.arch}. ` +
      `Build it with \`npm run build:native\` (requires Rust).\n  ${errors.join('\n  ')}`,
  );
}
