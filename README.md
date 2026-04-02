# supersynth

[![npm](https://img.shields.io/npm/v/supersynth)](https://www.npmjs.com/package/supersynth)
[![GitHub](https://img.shields.io/badge/github-jddubois%2Fsupersynth-blue)](https://github.com/jddubois/supersynth)

High-performance audio synthesis for Node.js, Bun, and Deno — backed by native Rust bindings via [CPAL](https://github.com/RustAudio/cpal).

- **12 waveforms** — sine, square, sawtooth, triangle, principal, trumpet, flute, pulse, noise, plucked, struck, electric
- **Expressive oscillators** — exponential ADSR, pitch/amplitude LFOs, chiff pipe-attack transients
- **Organ engine** — stops, presets, mixture ranks, drawbar control, key-click
- **Effects** — Freeverb reverb, overdrive, Leslie rotary speaker, limiter
- **MIDI input** — hardware device support via [midir](https://github.com/Boddlnagg/midir)
- **Multi-backend** — CoreAudio, WASAPI, ALSA, PulseAudio, PipeWire, JACK
- **Offline rendering** — generate audio without hardware for testing and file export
- **TypeScript-first** — full type definitions throughout

## Status

> **The organ engine is the current focus of active development and is the most polished part of the library.** The baroque pipe organ simulation — including the `principal` waveform, mixture ranks, breaking stops, drawbar control, key-click, and Leslie rotary speaker — is production-quality.
>
> All other instrument classes (`Piano`, `Guitar`, `Flute`, `Trumpet`, etc.) are **works in progress**. They produce sound and are usable, but their voices have not been tuned to the same standard. Expect rough edges.

## Install

```bash
npm install supersynth
```

> **Prerequisites:** Rust and Cargo must be installed to build the native addon.
> Install from [rustup.rs](https://rustup.rs).

## Quick start

```ts
import { Synth } from 'supersynth';

// Play a note through your speakers
const synth = new Synth({ masterVolume: 0.5 });
await synth.start();

synth.noteOn(69, 100);                          // A4, velocity 100
await new Promise(r => setTimeout(r, 2000));
synth.noteOff(69);
synth.stop();
```

Use a pre-built instrument class for a specific sound:

```ts
import { Organ, Piano, Flute } from 'supersynth';

const organ = new Organ({ masterVolume: 0.7 });
await organ.start();
organ.activatePreset('principal');
organ.noteOn(60, 100).noteOn(64, 100).noteOn(67, 100); // C major chord
```

Configure voice directly for custom synthesis:

```ts
import { Synth } from 'supersynth';

const synth = new Synth({
  voice: {
    oscillators: [{ waveform: 'sawtooth', attackTime: 0.1, releaseTime: 0.4 }],
  },
  reverb: { roomSize: 0.8, wet: 0.3 },
  masterVolume: 0.6,
});
```

## Documentation

| Topic | Description |
|-------|-------------|
| [Synth](docs/synth.md) | Core class — constructor, methods, events |
| [Voice & Oscillators](docs/voice.md) | `VoiceConfig`, `OscillatorTemplate`, `VelocityCurve` |
| [Waveforms](docs/waveforms.md) | All 12 waveforms with parameters and implementation notes |
| [Instruments](docs/instruments.md) | 20 pre-built instrument classes |
| [Organ](docs/organ.md) | Organ engine — stops, presets, drawbars, mixture ranks |
| [Effects](docs/effects.md) | Reverb, overdrive, Leslie, limiter |
| [MIDI](docs/midi.md) | Hardware input, events, raw MIDI bytes |
| [Errors](docs/errors.md) | Error classes and handling |

## Examples

```bash
npm run example:tone    # 440 Hz sine for 2 seconds
npm run example:chord   # C major chord with reverb
npm run example:midi    # Bach BWV 532 MIDI file through organ
```

Play any MIDI file:
```bash
node --import tsx examples/midi-file.ts /path/to/your.mid
```

See the [`examples/`](examples/) directory for 20+ instrument demonstrations.

## Benchmarks

```bash
npm run bench           # throughput vs node-web-audio-api and web-audio-api
npm run bench:realtime  # real-time callback timing under GC pressure
```

### Why native Rust?

- **Real-time reliability** — the CPAL audio thread runs outside Node's event loop, never paused by V8's garbage collector
- **JACK support** — direct low-latency connection to JACK audio graph for professional Linux setups
- **Synthesis features** — mixture ranks, Freeverb, Leslie rotary, and Karplus-Strong have no equivalent in standard Web Audio API node graphs

## Tests

```bash
npm test            # TypeScript integration tests (no hardware required)
npm run test:rust   # Rust unit tests
```

## Building from source

```bash
git clone https://github.com/jddubois/supersynth
cd supersynth
npm install
npm run build
npm test
```

## Architecture

```
TypeScript API (src/)
      ↓  napi-rs bindings
Rust synthesis engine (native/src/)
  ├── synth/     oscillators, envelopes, LFOs, chiff, waveforms, Karplus-Strong
  ├── effects/   Freeverb reverb, overdrive, biquad, low-pass, limiter, Leslie
  ├── midi/      MIDI parsing, device input (midir)
  └── audio/     CPAL backend selection and stream management
      ↓  CPAL
CoreAudio / WASAPI / ALSA / PulseAudio / PipeWire / JACK
```

## License

MIT
