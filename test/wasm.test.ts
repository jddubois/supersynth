// The browser's engine (WebAssembly, native/wasm), run in Node.js: the same API over it renders
// what the native engine renders, on any number of threads (worker_threads standing in for Web
// Workers), and loads models as a browser does. Needs the module built: `npm run build:wasm`
// (skipped otherwise).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import { Synth, SupersynthError, type SynthOptions } from '../src/index.js';
import type { NativeEngine } from '../src/engine.js';
import { platform } from '../src/platform/node.js';
import { prepareWasm, WasmEngine } from '../src/platform/web/engine.js';
import { instantiate, setThreadStarter } from '../src/platform/web/threads.js';

const WASM = path.join(process.cwd(), 'wasm', 'supersynth_bg.wasm');
const built = existsSync(WASM);
const maybe = built ? describe : describe.skip;

const createEngine = platform.createEngine;

/** A synth on the WebAssembly engine (the platform otherwise stays Node's: model files). */
function wasmSynth(options: SynthOptions = {}): Synth {
  platform.createEngine = (o) => new WasmEngine(o, (file) => platform.readModel(file));
  try {
    return new Synth(options);
  } finally {
    platform.createEngine = createEngine;
  }
}

/** Wait for the engine's render workers to run. */
const ready = (s: Synth) => (s as unknown as { _native(): NativeEngine })._native().ready?.();

const workers: Worker[] = [];

beforeAll(async () => {
  if (!built) return;
  await prepareWasm(async () => readFileSync(WASM));
  // render workers: worker_threads running the browser's thread code
  setThreadStarter((shared) => {
    const source = `const { workerData, parentPort } = require('node:worker_threads');
${instantiate.toString()}
const x = instantiate(workerData.module, workerData.memory);
parentPort.postMessage('started');
x.runQueuedThread();
x.__wbindgen_thread_destroy();`;
    const w = new Worker(source, { eval: true, workerData: shared });
    workers.push(w);
    return new Promise<void>((resolve, reject) => {
      w.once('message', () => resolve());
      w.once('error', reject);
    });
  });
});

afterAll(async () => {
  setThreadStarter(undefined);
  await Promise.all(workers.map((w) => w.terminate()));
});

const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / Math.max(1, a.length));
function diff(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i]! - b[i]!));
  return d;
}

function piece(s: Synth) {
  s.add('grand-piano', { preset: 'mellow' }).play(['C3', 'E4', 'G4', 'C5'], { velocity: 96, duration: 0.8 });
  s.add('violins').play(['A4', 'E5'], { at: 0.2, velocity: 80, duration: 0.8 });
  return s.render(1.5);
}

maybe('WebAssembly engine', () => {
  test('renders what the native engine renders', () => {
    const native = piece(new Synth({ sampleRate: 48000, threads: 1 }));
    const wasm = piece(wasmSynth({ sampleRate: 48000, threads: 1 }));
    expect(rms(wasm.left)).toBeGreaterThan(1e-3);
    // the same code; only the math library (sin, exp, …) differs, in the last bits (measured:
    // 2e-6 at most, -113 dB)
    expect(diff(native.left, wasm.left)).toBeLessThan(1e-4);
    expect(diff(native.right, wasm.right)).toBeLessThan(1e-4);
  });

  test('exactly the same on any number of threads, the workers rendering with it', async () => {
    const play = async (threads: number) => {
      const s = wasmSynth({ sampleRate: 48000, threads });
      await ready(s);
      expect(s.threads).toBe(threads);
      // (enough pipes for the voices to be shared out between threads)
      const organ = s.add('burea', { preset: 'full', preload: false });
      organ.great.play(['C3', 'G3', 'C4', 'E4', 'G4', 'C5'], { velocity: 100, duration: 1 });
      organ.pedal.play('C2', { velocity: 100, duration: 1 });
      const a = s.render(1.5);
      s.close();
      return a;
    };
    const one = await play(1);
    const three = await play(3);
    expect(rms(one.left)).toBeGreaterThan(1e-3);
    expect(diff(one.left, three.left)).toBe(0);
    expect(diff(one.right, three.right)).toBe(0);
  });

  test('an organ loads its models between other work, as in a browser', async () => {
    const s = wasmSynth({ sampleRate: 48000, threads: 1 });
    const organ = s.add('green-positiv', { preload: 'all' });
    expect(s._loadedModels().length).toBeGreaterThan(1);
    await organ.ready; // loaded one per task
    organ.great.play('C4', { duration: 0.3 });
    expect(rms(s.render(0.5).left)).toBeGreaterThan(1e-4);
    s.close();
  });

  test('engine errors become SupersynthErrors', () => {
    const s = wasmSynth();
    expect(() => s._native().noteOn(0, 200, 100)).toThrow(SupersynthError);
    expect(() => s.set({ reverb: 'no-such-room' as never })).toThrow(/unknown reverb preset/);
    s.close();
  });
});
