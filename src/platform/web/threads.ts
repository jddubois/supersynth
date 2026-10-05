// The engine's other threads in a browser: Web Workers running its render workers, and the
// AudioWorklet rendering it for the audio device. Each instantiates the engine's WebAssembly
// module on the shared memory and calls one export: it needs none of the JavaScript glue (whose
// imports it stubs), so these are self-contained scripts, started from Blob URLs (nothing for
// an application's bundler to know about).

/** What a thread instantiates. */
export interface WasmShared {
  module: WebAssembly.Module;
  memory: WebAssembly.Memory;
}

/** Exports of the module a thread calls (the raw exports, not the glue's wrappers). */
interface ThreadExports {
  __wbindgen_start(stackSize?: number): void;
  __wbindgen_thread_destroy(): void;
  runQueuedThread(): number;
  renderAudio(handle: number, frames: number): number;
  reportLoad(handle: number, secs: number, frames: number): void;
}

// The two functions below run in other threads, from their source text: they may use nothing
// from this module (and nothing TypeScript would compile to helpers).

/** Instantiate the module on the shared memory as a thread of its own; the glue's imports are
 *  stubbed (the exports a thread calls use none). (Exported for tests, which start threads with
 *  Node's worker_threads from this same source.) */
export function instantiate(module: WebAssembly.Module, memory: WebAssembly.Memory): ThreadExports {
  const imports: Record<string, Record<string, unknown>> = {};
  for (const imp of WebAssembly.Module.imports(module)) {
    const ns = (imports[imp.module] ??= {});
    ns[imp.name] =
      imp.kind === 'memory'
        ? memory
        : () => {
            throw new Error(`supersynth: ${imp.name} is not available on this thread`);
          };
  }
  const x = new WebAssembly.Instance(module, imports as WebAssembly.Imports).exports as unknown as ThreadExports;
  x.__wbindgen_start(); // this thread's stack and thread-locals
  return x;
}

/** A Web Worker: runs one render worker of an engine until the engine is gone. */
function workerMain(): void {
  const scope = globalThis as unknown as { onmessage: ((ev: { data: WasmShared }) => void) | null; postMessage(m: unknown): void; close(): void };
  scope.onmessage = (ev) => {
    scope.onmessage = null;
    const x = instantiate(ev.data.module, ev.data.memory);
    scope.postMessage('started');
    x.runQueuedThread();
    x.__wbindgen_thread_destroy();
    scope.close();
  };
}

/** The AudioWorklet processor: renders the engine, 128 frames at a time. */
function workletMain(): void {
  const g = globalThis as unknown as {
    AudioWorkletProcessor: new () => { port: MessagePort };
    registerProcessor(name: string, ctor: unknown): void;
    performance?: { now(): number };
  };
  // (an AudioWorklet may have no `performance`: Date.now() then, averaged over many buffers)
  const clock = g.performance ? () => g.performance!.now() : () => Date.now();
  class SupersynthProcessor extends g.AudioWorkletProcessor {
    private x: ThreadExports;
    private memory: WebAssembly.Memory;
    private handle: number;
    private stopped = false;
    private view: Float32Array | null = null;
    private busy = 0;
    private buffers = 0;

    constructor(options: { processorOptions: WasmShared & { handle: number } }) {
      super();
      const o = options.processorOptions;
      this.x = instantiate(o.module, o.memory);
      this.memory = o.memory;
      this.handle = o.handle;
      this.port.onmessage = (ev: MessageEvent) => {
        if (ev.data !== 'stop' || this.stopped) return;
        this.stopped = true;
        this.x.__wbindgen_thread_destroy();
        this.port.postMessage('closed');
      };
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
      if (this.stopped) return false;
      const out = outputs[0]!;
      const l = out[0]!;
      const r = out[1] ?? l;
      const n = l.length;
      const t0 = clock();
      const ptr = this.x.renderAudio(this.handle, n) >>> 0;
      this.busy += clock() - t0;
      if (++this.buffers === 64) {
        this.x.reportLoad(this.handle, this.busy / 1000, 64 * n);
        this.busy = 0;
        this.buffers = 0;
      }
      // (a grown memory has a new buffer)
      const buf = this.memory.buffer;
      if (this.view === null || this.view.buffer !== buf) this.view = new Float32Array(buf);
      const s = this.view;
      const at = ptr >> 2;
      for (let i = 0; i < n; i++) {
        l[i] = s[at + 2 * i]!;
        r[i] = s[at + 2 * i + 1]!;
      }
      return true;
    }
  }
  g.registerProcessor('supersynth', SupersynthProcessor);
}

/** Most frames the worklet renders at once (the render quantum is 128). */
export const WORKLET_FRAMES = 1024;

function scriptUrl(main: () => void): string {
  const source = `${instantiate.toString()}\n(${main.toString()})();\n`;
  return URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
}

let workerUrl: string | undefined;
let workletUrl: string | undefined;

/** How a thread is started: a Web Worker (replaceable, e.g. by worker_threads in tests).
 *  Resolves once the thread runs. */
export type ThreadStarter = (shared: WasmShared) => Promise<void> | void;

let starter: ThreadStarter | undefined;

/** @internal Start threads another way (tests in Node.js). */
export function setThreadStarter(s: ThreadStarter | undefined): void {
  starter = s;
}

/** Start `count` threads, each running one of the threads the engines asked for; resolves once
 *  they run. A Web Worker only starts while the page's main thread is free: until then the
 *  engine renders without it. Without Web Workers nothing starts, and the engine renders on its
 *  own thread. */
export function startThreads(shared: WasmShared, count: number): Promise<void> {
  const started: (Promise<void> | void)[] = [];
  for (let i = 0; i < count; i++) {
    if (starter) {
      started.push(starter(shared));
    } else if (typeof Worker === 'function') {
      workerUrl ??= scriptUrl(workerMain);
      const w = new Worker(workerUrl, { name: 'supersynth-render' });
      started.push(
        new Promise<void>((resolve) => {
          w.onmessage = () => resolve();
          w.onerror = () => resolve(); // (it renders without this thread)
        }),
      );
      w.postMessage(shared);
    }
  }
  return Promise.all(started).then(() => undefined);
}

/** The AudioWorklet's module, added once per audio context. */
const added = new WeakSet<BaseAudioContext>();
export async function addWorklet(ctx: BaseAudioContext): Promise<void> {
  if (added.has(ctx)) return;
  workletUrl ??= scriptUrl(workletMain);
  await ctx.audioWorklet.addModule(workletUrl);
  added.add(ctx);
}
