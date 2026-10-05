import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SupersynthError } from './errors.js';

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
  readonly isRunning: boolean;
  readonly queueFree: number;
  /** The audio thread hit an internal error and now outputs silence. */
  readonly faulted: boolean;
  readonly error: string | null;
  loadModel(bytes: Buffer): number;
  /** Load a model file on a background thread; the id is usable at once (a use waits for
   *  just that model, loading it on the spot if no worker has started it). */
  queueModelFile(path: string): number;
  /** Calls back once all these models have loaded (or been unloaded): with null, or the first
   *  loading error. The wait does not keep Node.js running. */
  watchModels(ids: number[], callback: (error: string | null) => void): void;
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

/** @internal Platforms with a prebuilt engine, each in the npm package `@supersynth/<platform>`. */
export const NATIVE_PLATFORMS = ['linux-x64-gnu', 'linux-x64-musl', 'linux-arm64-gnu', 'darwin-x64', 'darwin-arm64', 'win32-x64-msvc'] as const;

/** @internal Whether this Linux uses musl (Alpine) rather than glibc. */
export function isMusl(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    // glibc's ldd is a script naming GNU libc; musl's is a link to the musl loader
    const ldd = readFileSync('/usr/bin/ldd', 'latin1');
    if (ldd.includes('musl')) return true;
    if (ldd.includes('GLIBC') || ldd.includes('GNU C Library')) return false;
  } catch {
    // no ldd: ask Node
  }
  try {
    const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
    return !report?.header?.glibcVersionRuntime;
  } catch {
    return false;
  }
}

/** @internal This machine as a platform package suffix: `linux-x64-gnu`, `darwin-arm64`, `win32-x64-msvc`, … */
export function nativePlatform(): string {
  const base = `${process.platform}-${process.arch}`;
  if (process.platform === 'linux') return `${base}-${isMusl() ? 'musl' : 'gnu'}`;
  if (process.platform === 'win32') return `${base}-msvc`;
  return base;
}

/**
 * @internal Load the compiled engine: `supersynth.node` built in a source checkout
 * (`npm run build:native`; never published), else the platform package
 * (`@supersynth/<platform>`, an optional dependency), else `supersynth.<platform>.node` next to
 * the package.
 */
export function loadNative(): NativeModule {
  if (native) return native;
  const require = createRequire(import.meta.url);
  const root = packageRoot();
  const platform = nativePlatform();
  const pkg = `@supersynth/${platform}`;
  const candidates = [path.join(root, 'supersynth.node'), pkg, path.join(root, `supersynth.${platform}.node`)];
  const errors: string[] = [];
  for (const id of candidates) {
    const file = path.isAbsolute(id);
    if (file && !existsSync(id)) continue;
    try {
      native = require(id) as NativeModule;
      return native;
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      // the platform package not being installed is reported below; a binary that is there
      // but does not load (wrong libc, missing libasound, …) is reported as is
      if (!file && err.code === 'MODULE_NOT_FOUND' && err.message.includes(`'${pkg}'`)) continue;
      errors.push(`${file ? path.basename(id) : id}: ${err.message.split('\n')[0]}`);
    }
  }
  const prebuilt = (NATIVE_PLATFORMS as readonly string[]).includes(platform);
  throw new SupersynthError(
    [
      `supersynth's native engine could not be loaded for ${platform} (Node ${process.version}).`,
      ...errors.map((e) => `  ${e}`),
      ...(existsSync(path.join(root, 'native', 'Cargo.toml'))
        ? ['In this source checkout, build it with `npm run build:native` (needs Rust, https://rustup.rs).']
        : [
            prebuilt
              ? `It comes in the package ${pkg}, an optional dependency of supersynth: reinstall without --omit=optional ` +
                `(if package-lock.json was made on another platform, delete it and node_modules first).`
              : `There is no prebuilt engine for ${platform}; prebuilt: ${NATIVE_PLATFORMS.join(', ')}.`,
            `To build it from source (needs Rust, https://rustup.rs): clone https://github.com/jddubois/supersynth, run ` +
              `\`npm ci && npm run build\` in it, then install that folder (npm install /path/to/supersynth).`,
          ]),
    ].join('\n'),
  );
}
