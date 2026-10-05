# In a browser

supersynth runs in a browser with the same API as in Node.js. The engine is the same Rust code,
compiled to WebAssembly. It renders in an AudioWorklet, and it spreads voices over the
machine's cores with Web Workers, so a full organ plays in real time where one core would not
keep up.

```ts
import { Synth } from 'supersynth';

const synth = await Synth.create();         // loads the WebAssembly engine
await synth.load('grand-piano', 'burea');   // downloads their models
const piano = synth.add('grand-piano');
const organ = synth.add('burea', { preset: 'plenum' });

button.onclick = () => synth.start();       // audio starts from a user gesture
piano.play(['C4', 'E4', 'G4'], { duration: 2 });
```

`examples/browser/` is a page to play every instrument and a few organs:
`npm run build:wasm && npm run build:ts && npm run example:browser`, then open
http://localhost:8080.

## What a page needs

- **Cross-origin isolation.** The engine runs on several threads over shared memory, which a
  page can use only when it is served with these two headers:

  ```
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  ```

  Without them, `Synth.create()` throws an error naming them. With `require-corp`, everything
  the page loads from other origins needs CORS or `Cross-Origin-Resource-Policy` headers.
  Models served from a CDN such as jsDelivr have them.
- **`await Synth.create()`** instead of `new Synth()`. It loads the engine (once per page) and
  waits for its render workers to start. A Web Worker only starts while the page's main thread
  is free, so a synth created with `new Synth()` and used straight away would render on one
  thread until then.
- **`await synth.load(...)`** before `add()`. It downloads the models of the instruments and
  organs named: an instrument is 0.2–6 MB, an organ 5–150 MB. In Node.js, `load()` only checks
  that the models are installed, so the same code runs on both.
- **A user gesture for `start()`.** Browsers start audio only after the user has interacted
  with the page. `start()` returns at once, and the sound begins once the page is allowed to
  play.

## Where the files are

| Option | Default | |
|---|---|---|
| `wasmUrl` | next to the module: `node_modules/supersynth/wasm/supersynth_bg.wasm` | the engine, `wasm/supersynth_bg.wasm` in the package |
| `modelsDirectory` | next to the module: `node_modules/@supersynth/instruments/models/`, `node_modules/@supersynth/organ-<id>/models/` | a URL laid out like the package's `models/` (`grand-piano.ssm`, `organ/friesach/<stop>.ssm`, Bureå `organ/<stop>.ssm`) |

The defaults work when the packages are served as installed: from `node_modules`, or by a CDN
that serves npm packages unchanged. A bundled application knows neither location, so it serves
the files itself and passes their URLs:

```ts
const synth = await Synth.create({
  wasmUrl: '/supersynth/supersynth_bg.wasm',          // copied from node_modules/supersynth/wasm/
  modelsDirectory: 'https://cdn.jsdelivr.net/npm/supersynth@0.3.0/models/',
});
```

The organs' models are in their own packages, so `modelsDirectory` must hold them all in one
tree (for example a copy of `models/` with `organ/<id>/` added from each organ package).

Bundlers pick supersynth's browser code through the `browser` condition of the package's
`#platform` import. esbuild with `--platform=browser` is tested; Vite and webpack 5 resolve the
condition the same way. The worklet and the workers are built into the module, so there is
nothing else to configure.

## What differs from Node.js

| | Node.js | Browser |
|---|---|---|
| engine | native (napi), SSE/AVX2 or NEON | WebAssembly with 128-bit SIMD, 1.3–1.5× slower |
| audio output | the audio device (CPAL) | an AudioWorklet (128-frame buffers) |
| render threads | `threads`, default one per core but one | the same, as Web Workers |
| models | read from disk when used | downloaded by `synth.load()`, then parsed on the page's main thread when first used (an organ's other stops: one per task, between other work) |
| MIDI input | hardware devices (`midir`) | Web MIDI; `listMidiDevices()` lists the inputs once `enableMidi()` has been granted access |
| files | `renderToFile()`, `renderMidi(path)` | none: `encodeWav(audio)` makes a WAV file's bytes, `renderMidi(bytes)` |
| `encodeWav()`, MIDI event `raw` | Buffer | Uint8Array |
| `overloadGuard` | follows the render time of every buffer | follows the load the AudioWorklet reports every 64 buffers (about 170 ms), so it reacts more slowly |
| `backend` | the audio API | ignored |
| `bufferSize` | the device's buffer | the AudioContext's latency hint |

Nothing about the sound differs. The WebAssembly engine's output matches the native one within
2·10⁻⁶ (−113 dB). Only the math library differs, in the last bits. As natively, the output is
bit for bit the same on any number of threads.

Parsing a model blocks the page's main thread for 20–250 ms. The audio thread is not affected,
so sound does not drop out, but a page that adds an organ while it animates will stutter. Add
large organs before playing, or between interactions.

## Performance

Measured in headless Chromium on a 4-core 2.1 GHz cloud VM (`npm run test:browser`, several
runs), as a share of real time:

| Scenario | 1 thread | 4 threads |
|---|---|---|
| grand piano, 3-note chord, live | 13 % | 10 % |
| Bureå full organ, 7 notes, all couplers (116 pipes), offline | 110–140 % | 44–50 % |
| the same, live through the AudioWorklet | over 100 %: it falls behind (0.73 s rendered per second) | 46 %, in real time |

## Building it

The engine is built from `native/wasm`, which uses the same `native/host` layer as the Node.js
addon, so the two engines share all of their code but the platform's own parts:

```bash
rustup toolchain install nightly --component rust-src --target wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129   # the version native/wasm/Cargo.toml pins
npm run build:wasm        # → wasm/supersynth.js, wasm/supersynth_bg.wasm
npm test -- test/wasm.test.ts   # the WebAssembly engine against the native one, in Node.js
npm run test:browser      # in headless Chromium (playwright-core; CHROMIUM_PATH to choose one)
```

Threads need the standard library rebuilt with atomics. That build is not available on stable
Rust, so the engine needs nightly. `scripts/build-wasm.mjs` passes the flags (atomics, bulk
memory, SIMD, shared memory up to 4 GiB).
