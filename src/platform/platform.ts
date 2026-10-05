// What differs between Node.js and a browser, behind one interface. The API (Synth, Instrument,
// Organ, …) is the same code on both; it reaches the platform through the `#platform` import,
// which package.json maps to `platform/node.js`, or to `platform/browser.js` for bundlers (the
// `browser` condition). Node.js runs exactly what it always did: the napi engine, files.
import type { NativeEngine } from '../engine.js';

/** @internal Bytes handed out by the API: a Buffer in Node.js (with Node's types), a
 *  Uint8Array in a browser. */
export type Bytes = typeof globalThis extends { Buffer: { prototype: infer B } } ? B : Uint8Array;

/** @internal An engine's settings (see `SynthOptions`). */
export interface EngineOptions {
  sampleRate?: number;
  backend?: string;
  maxVoices?: number;
  reverb?: string;
  bufferSize?: number;
  threads?: number;
}

/** @internal How the API gets ready on a platform (see `Synth.create`). */
export interface PrepareOptions {
  /** Browser: where the WebAssembly engine is (default: next to supersynth's `wasm/supersynth.js`). */
  wasmUrl?: string | URL;
}

/** @internal */
export interface Platform {
  readonly name: 'node' | 'browser';
  /** Get ready to create engines (a browser compiles the WebAssembly engine). */
  prepare(options: PrepareOptions): Promise<void>;
  createEngine(options: EngineOptions): NativeEngine;
  /** Where model `name` is (a file, a URL); a SupersynthError saying what to install (or to
   *  load first, in a browser) when it is not available. */
  locateModel(name: string, modelsDirectory?: string): string;
  /** The bytes of a model `locateModel` found. */
  readModel(location: string): Uint8Array;
  /** Size of a model's file, bytes. */
  modelSize(location: string): number;
  /** Make these models available to `locateModel` (a browser downloads them). */
  fetchModels(names: readonly string[], modelsDirectory?: string): Promise<void>;
  /** Memory to plan model preloading with, bytes. */
  memory(): number;
  readFile(path: string): Uint8Array;
  writeFile(path: string, data: Uint8Array): void;
  /** Zeroed bytes for a file being made. */
  allocBytes(n: number): Bytes;
}
