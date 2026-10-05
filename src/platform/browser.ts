// Browsers: the WebAssembly engine (src/platform/web/engine.ts), models fetched over HTTP, a
// small EventEmitter. Bundlers pick this module through the `browser` condition of `#platform`.
import { SupersynthError } from '../errors.js';
import { INSTRUMENTS_PACKAGE, modelPackage } from '../models.js';
import type { Bytes, Platform } from './platform.js';
import { prepareWasm, WasmEngine } from './web/engine.js';

export { EventEmitter } from './web/emitter.js';

/** Fetched model files, by URL (shared by every synth of the page). */
const fetched = new Map<string, Uint8Array>();

/** Where the page is, to resolve relative URLs against. */
function pageUrl(): string {
  return (globalThis as { location?: { href: string } }).location?.href ?? import.meta.url;
}

/**
 * The URL of a model: in `modelsDirectory` (a URL, laid out like the package's `models/`:
 * `<dir>/grand-piano.ssm`, `<dir>/organ/friesach/<stop>.ssm`), else next to this module as
 * installed (`node_modules/@supersynth/instruments/models/`,
 * `node_modules/@supersynth/organ-<id>/models/`).
 * A bundled application gives `modelsDirectory` (it does not know where the files are served).
 */
function modelUrl(name: string, modelsDirectory?: string): string {
  const file = `${name}.ssm`;
  if (modelsDirectory !== undefined) {
    const dir = modelsDirectory.endsWith('/') ? modelsDirectory : `${modelsDirectory}/`;
    return new URL(file, new URL(dir, pageUrl())).href;
  }
  const pkg = modelPackage(name)?.pkg ?? INSTRUMENTS_PACKAGE;
  // (not `new URL('literal', import.meta.url)`: bundlers would try to bundle the directory)
  const dir = ['..', '..', '..', pkg, 'models', ''].join('/');
  return new URL(file, new URL(dir, import.meta.url)).href;
}

async function download(url: string): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new SupersynthError(`Cannot download model ${url}: ${(e as Error).message}`);
  }
  if (!res.ok) throw new SupersynthError(`Cannot download model ${url}: HTTP ${res.status} ${res.statusText}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Downloads at once, at most. */
const PARALLEL = 6;

/** @internal */
export const platform: Platform = {
  name: 'browser',
  async prepare({ wasmUrl }) {
    const url = wasmUrl ?? new URL('../../wasm/supersynth_bg.wasm', import.meta.url);
    await prepareWasm(async () => {
      const res = await fetch(url);
      if (!res.ok) throw new SupersynthError(`Cannot load the WebAssembly engine from ${String(url)}: HTTP ${res.status}`);
      return res.arrayBuffer();
    });
  },
  createEngine(options) {
    return new WasmEngine(options, (url) => platform.readModel(url));
  },
  locateModel(name, modelsDirectory) {
    const url = modelUrl(name, modelsDirectory);
    if (!fetched.has(url)) {
      throw new SupersynthError(`Model '${name}' has not been downloaded: in a browser, \`await synth.load(…)\` the instruments and organs before adding them (it is fetched from ${url})`);
    }
    return url;
  },
  readModel(url) {
    const bytes = fetched.get(url);
    if (!bytes) throw new SupersynthError(`Model ${url} has not been downloaded (await synth.load(…) first)`);
    return bytes;
  },
  modelSize: (url) => platform.readModel(url).length,
  async fetchModels(names, modelsDirectory) {
    const todo = [...new Set(names.map((n) => modelUrl(n, modelsDirectory)))].filter((u) => !fetched.has(u));
    let next = 0;
    const lane = async () => {
      while (next < todo.length) {
        const url = todo[next++]!;
        fetched.set(url, await download(url));
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, lane));
  },
  memory() {
    // a WebAssembly memory holds at most 4 GiB; `deviceMemory` (GiB, Chromium) is rounded down
    const device = ((globalThis as { navigator?: { deviceMemory?: number } }).navigator?.deviceMemory ?? 4) * 2 ** 30;
    return Math.min(device, 2 ** 32);
  },
  readFile() {
    throw new SupersynthError('There are no files in a browser: pass the MIDI file as bytes (a Uint8Array)');
  },
  writeFile() {
    throw new SupersynthError('There are no files in a browser: encodeWav() makes the bytes of a WAV file (to download, or play)');
  },
  allocBytes: (n) => new Uint8Array(n) as Bytes,
};
