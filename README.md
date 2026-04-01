# supersynth

High-performance audio synthesis for Node.js, Bun, and Deno — backed by native Rust bindings via [CPAL](https://github.com/RustAudio/cpal).

- **6 waveforms** — sine, square, sawtooth, triangle, trumpet, flute (additive)
- **Expressive oscillators** — exponential ADSR, pitch/amplitude LFOs, chiff pipe-attack transients
- **Effects** — Freeverb reverb, low-pass and biquad filters
- **MIDI input** — hardware device support via [midir](https://github.com/Boddlnagg/midir)
- **Multi-backend** — CoreAudio, WASAPI, ALSA, PulseAudio, PipeWire, JACK
- **Offline rendering** — generate audio without hardware for testing and file export
- **TypeScript-first** — full type definitions throughout

## Install

```bash
npm install supersynth
```

> **Prerequisites:** Rust and Cargo must be installed to build the native addon.
> Install from [rustup.rs](https://rustup.rs).
>
> ```bash
> npm install supersynth  # triggers cargo build automatically
> ```

## Quick start

```ts
import { Synth } from 'supersynth';

// Play a note through your speakers
const synth = new Synth({ waveform: 'flute', masterVolume: 0.5 });
await synth.start();

synth.noteOn(69, 100);                          // A4, velocity 100
await new Promise(r => setTimeout(r, 2000));
synth.noteOff(69);
synth.stop();
```

## API

### `new Synth(config?)`

Creates a synthesis engine. All config fields are optional.

```ts
const synth = new Synth({
  sampleRate: 48000,        // Hz. Default: 48000
  backend: 'auto',          // 'auto' | 'coreaudio' | 'wasapi' | 'alsa' | 'jack' | 'pulseaudio' | 'pipewire'
  waveform: 'sine',         // Default waveform for new notes
  masterVolume: 0.5,        // 0.0–1.0
  reverb: {
    roomSize: 0.85,         // 0.0–1.0
    damping: 0.5,           // 0.0–1.0
    wet: 0.35,              // reverb send level
    dry: 0.65,              // direct signal level
    preDelayMs: 20,         // ms before reverb tail begins
  },
  lowPassCutoff: 0.7,       // normalized coefficient, 0.0–1.0
});
```

### Playing notes

```ts
// MIDI note numbers: C4 = 60, A4 = 69, C5 = 72
synth.noteOn(69, 100);                     // A4, velocity 100
synth.noteOn(60, 80, { waveform: 'trumpet' }); // override waveform per-note
synth.noteOff(69);

// Chain calls
synth.noteOn(60, 90).noteOn(64, 90).noteOn(67, 90); // C major chord
```

### Waveforms

| Waveform | Character | Implementation |
|----------|-----------|----------------|
| `sine` | Pure, smooth | Standard sine |
| `square` | Hollow, buzzy | PolyBLEP anti-aliased |
| `sawtooth` | Bright, rich | PolyBLEP anti-aliased |
| `triangle` | Warm organ | Freq-dependent sine/triangle blend |
| `trumpet` | Reed/brass | 16-harmonic additive synthesis |
| `flute` | Soft, breathy | 6-harmonic additive with Nyquist taper |

Each oscillator also includes:
- **Chiff** — band-pass filtered noise burst at note onset, simulating pipe organ wind attack
- **Pitch LFO** — gentle vibrato (0.15–0.35 Hz, ±2–5 cents)
- **Amplitude LFO** — subtle tremolo (0.2–0.4 Hz, ±3–5%)
- **Equal loudness compensation** — A-weighting curve so notes sound even across the keyboard

### Real-time audio output

```ts
await synth.start();   // opens CPAL audio stream on a dedicated Rust thread
synth.noteOn(69, 100);
// ... audio plays through speakers ...
synth.stop();
```

### Offline rendering

No audio hardware required. Returns a mono `Float32Array`.

```ts
const synth = new Synth({ sampleRate: 48000 });
synth.noteOn(69, 100);
const samples = synth.render(48000); // render 1 second of audio
// samples is a Float32Array of 48000 mono samples in [-1, 1]
```

### MIDI input

```ts
await synth.start();

// List devices
console.log(synth.listMidiDevices()); // ['Arturia KeyStep', 'IAC Driver Bus 1']

// Connect (substring match, or omit for first device)
await synth.enableMidi('Arturia');

synth.on('noteOn',       ({ note, velocity, channel }) => synth.noteOn(note, velocity));
synth.on('noteOff',      ({ note }) => synth.noteOff(note));
synth.on('cc',           ({ controller, value }) => console.log(`CC ${controller}: ${value}`));
synth.on('midiMessage',  (event) => console.log(event)); // all messages
```

### Raw MIDI bytes

Feed MIDI directly into the engine — useful for playing MIDI files:

```ts
synth.sendMidiBytes(Buffer.from([0x90, 69, 100])); // note on,  A4, vel 100
synth.sendMidiBytes(Buffer.from([0x80, 69, 0]));   // note off, A4
```

### Audio backends

```ts
console.log(synth.listAudioBackends());
// macOS:   ['coreaudio']
// Linux:   ['alsa', 'jack']
// Windows: ['wasapi']

// Use JACK explicitly (Linux)
const synth = new Synth({ backend: 'jack' });
```

## Examples

Run with `node --import tsx examples/<name>.ts` or via npm scripts:

```bash
npm run example:tone    # 440 Hz sine for 2 seconds
npm run example:chord   # C major chord with reverb
npm run example:midi    # Bach BWV 532 MIDI file
```

Play any MIDI file:
```bash
node --import tsx examples/midi-file.ts /path/to/your.mid
```

## Benchmarks

```bash
npm run bench           # throughput vs node-web-audio-api and web-audio-api
npm run bench:realtime  # real-time callback timing under GC pressure
```

### Why native Rust?

- **Real-time reliability** — the CPAL audio thread runs outside Node's event loop and is never paused by V8's garbage collector. Pure-JS audio solutions running on the event loop are susceptible to GC-induced glitches.
- **JACK support** — direct low-latency connection to JACK audio graph, required for professional Linux audio setups.
- **Synthesis features** — the organ-style waveforms (`trumpet`, `flute`), chiff transients, and Freeverb have no equivalent in standard Web Audio API node graphs.

For offline rendering of standard waveforms, V8's JIT is competitive with Rust DSP. The native binding earns its overhead in real-time output quality and specialized synthesis features.

## Tests

```bash
npm test            # TypeScript integration tests (17 tests, no hardware required)
npm run test:rust   # Rust unit tests (29 tests)
```

## Building from source

```bash
git clone <repo>
cd supersynth
npm install         # also runs cargo build --release
npm run build       # compile TypeScript
npm test
```

## Architecture

```
TypeScript API (src/)
      ↓  napi-rs bindings
Rust synthesis engine (native/src/)
  ├── synth/     oscillators, envelopes, LFOs, chiff, waveforms
  ├── effects/   Freeverb, low-pass, biquad filters
  ├── midi/      MIDI parsing, device input (midir)
  └── audio/     CPAL backend selection and stream management
      ↓  CPAL
CoreAudio / WASAPI / ALSA / PulseAudio / PipeWire / JACK
```

## License

MIT
