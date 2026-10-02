# supersynth

Real instrument sounds for Node.js — a concert grand, a complete Swedish church organ, an orchestra
of strings, winds, brass and mallets — synthesised in real time by a native Rust engine.

```ts
import { Synth } from 'supersynth';

const synth = new Synth();
const piano = synth.add('grand-piano');
await synth.start();

piano.play(['C4', 'E4', 'G4'], { velocity: 80, duration: 2 });
```

## How it sounds real

Every instrument is a **spectral model analysed from real recordings** (all freely licensed, see
[NOTICE.md](NOTICE.md)). For each recorded note and dynamic level the analysis measures:

- the frequency and amplitude envelope of every partial (up to 128), including **string stiffness**
  (piano inharmonicity), **vibrato and pitch drift**, and the start phases that shape the attack;
- stable **inharmonic components** — sympathetic and duplex resonances in a piano, the modes of a bell
  or marimba bar;
- the **noise** the instrument makes — breath, bow, hammer, wind, key action — as a time-varying spectrum;
- for struck and plucked instruments, the first milliseconds of the **real attack**, which the engine
  cross-fades phase-coherently into the synthesised tone;
- sustain loops, release behaviour and each pipe's or string's own tuning.

The engine resynthesises this with an oscillator bank (vectorised complex rotators) and spectral
noise shaping, morphing smoothly between recorded pitches and dynamics. Notes that were never
recorded are interpolated — with formant preservation for bowed strings and winds — rather than
pitch-shifted like a sampler. Every aspect can be tweaked live: brightness, attack, decay, release,
vibrato, inharmonicity, noise, stereo spread, and more.

**Validated against the recordings.** For each instrument, held-out notes (left out of the model)
are synthesised and compared with the real recordings. The synthesiser is typically closer to the
missing recording than a conventional sampler pitch-shifting its nearest recording, and independent
blind listening tests (see `tools/ssm/blind.py`) are used to hunt down any remaining tells.

## Instruments

| Family | Instruments (ids) |
|---|---|
| Keyboards | `grand-piano`, `upright-piano`, `harpsichord` |
| Organs | `organ()` — the full Bureå church organ (40 stops, 4 divisions); `organ({ instrument: 'vcsl' })` — the VCSL church organ with a Renaissance chamber organ; `pipe-organ`, `chamber-organ` |
| Strings | `violin`, `violins`, `violas`, `cellos`, `contrabass`, `strings` (full section), `harp`, `violin-pizzicato`, `cello-pizzicato`, `contrabass-pizzicato` |
| Woodwinds | `flute`, `oboe`, `clarinet`, `bassoon`, `tenor-sax` |
| Brass | `trumpet`, `french-horn`, `trombone`, `tuba`, `brass` (section) |
| Percussion | `marimba`, `vibraphone`, `xylophone`, `glockenspiel`, `tubular-bells` |

Each comes with presets (`synth.add('grand-piano', { preset: 'felt' })`); list everything with
`Synth.instruments()`.

## Install

```bash
npm install supersynth
```

Building from source needs Rust ([rustup.rs](https://rustup.rs)): `npm run build`.

## Usage

### Playing notes

```ts
const synth = new Synth({ reverb: 'concert-hall' });
const violin = synth.add('violin', { preset: 'expressive' });
const cellos = synth.add('cellos');

violin.play('A4', { velocity: 90, duration: 2 });          // names or MIDI numbers
cellos.play(['C3', 'G3'], { delay: 0.5, duration: 3 });     // chords, relative timing
violin.sequence([['E5', 1], ['D5', 0.5], ['C5', 0.5], ['B4', 2]], { bpm: 80 });

piano.noteOn('C4', 100); /* … */ piano.noteOff('C4');      // manual control
piano.sustain(true);                                        // pedal
violin.pitchBend(0.5); violin.modWheel(0.3); violin.expression(0.6); // swells
```

All note methods accept `{ at }` (absolute seconds on `synth.currentTime`) for sample-accurate
scheduling.

### Tweaks

```ts
piano.set({ brightness: 1.5, release: 2, reverbSend: 0.3 });
violin.set({ vibrato: 8, vibratoRate: 5.8, naturalVibrato: 0.5 });
synth.add('grand-piano', { preset: 'honky-tonk', params: { volume: -3 } });
```

| Parameter | Meaning |
|---|---|
| `brightness` | spectral tilt, dB/octave (+ brighter, − darker) |
| `attack`, `decay`, `release` | time scales (2 = twice as long) |
| `vibrato`, `vibratoRate`, `vibratoDelay`, `naturalVibrato` | added vibrato; how much recorded vibrato to keep |
| `noise` | breath / bow / hammer noise, dB |
| `inharmonicity`, `evenHarmonics`, `formant` | timbre structure |
| `spread`, `pan`, `volume`, `reverbSend` | placement and level |
| `legato`, `glide` | slurred melodies: notes connect without re-attacking |
| `humanize`, `velocitySensitivity`, `transpose`, `tune`, `bendRange`, `mono` | playing |
| `tremolo`, `jitter` | synchronous pulsation; per-partial micro-fluctuation |
| `eqLow/Mid/High…`, `lowCut`, `highCut`, `chorus`, `drive`, `leslie` | effects |

### The church organ

```ts
const organ = synth.organ({ registration: 'plenum' });
organ.great.play(['C4', 'E4', 'G4'], { duration: 4 });
organ.pedal.play('C2', { duration: 4 });

organ.great.pull("Trumpet 8'");           // draw a stop, even while notes are held
organ.swell.pull("Salicional 8'", "Voix céleste 8'");
organ.couple('swell>great');
organ.swell.expression(0.4);              // swell pedal
organ.tremulant(true);
Organ.registrations;                       // plenum, flutes, cornet, trumpet, krummhorn, celeste, full, …
```

### Offline rendering and MIDI files

```ts
const synth = new Synth();
synth.add('harpsichord').play(['D4', 'F4', 'A4'], { duration: 2 });
synth.renderToFile('chord.wav', 3);                     // no audio device needed
const audio = synth.render(3);                          // { sampleRate, left, right }

synth.renderMidi('bach.mid', { instrument: 'harpsichord' });
await synth.playMidi('song.mid', { channels: { 1: 'violin', 2: 'cellos' } });
```

### Hardware MIDI

```ts
synth.add('grand-piano', { channel: 0 });   // MIDI channel 1
await synth.enableMidi('Keystation');      // played directly by the engine, no JS latency
synth.on('midi', (e) => console.log(e));
```

## Examples

```bash
npm run example:tour          # every instrument family
npm run example:piano         # pedal, dynamics, presets
npm run example:organ         # hymn in four parts across registrations
npm run example:orchestra     # strings, harp, oboe, horn, pizzicato bass
npm run example:midi          # a Bach organ work from a MIDI file
npm run demos -- demos/       # render every instrument × preset to WAV
```

Append `-- out.wav` to the first four to render to a file instead of the speakers.

## Performance

The engine runs on its own audio thread, outside Node's event loop and garbage collector; the API
talks to it through a lock-free queue. Measured with `npm run bench` (Apple M1 Max, one core,
48 kHz stereo including reverb):

| Scenario | CPU |
|---|---|
| 16 held piano notes with pedal | 5.5 % |
| 8-note string-orchestra chord | 5.2 % |
| Organ plenum chord + pedal | 6.0 % |
| Full organ, all couplers (116 voices) | 19.6 % |

## Architecture

```
TypeScript API (src/)          Synth · Part · Organ · instruments · MIDI files · WAV
        │ napi-rs
native/src/                    bindings, CPAL audio output, MIDI input
native/core/                   supersynth-core (pure Rust)
  ├── model/                   .ssm spectral model format
  ├── voice/                   spectral voice (oscillator bank, transients), pooled FFT noise
  ├── engine/                  lock-free command queue, sample-accurate scheduling, parts, mixing
  └── fx/                      FDN reverb, EQ, chorus, drive, rotary speaker, limiter
tools/ssm/                     Python analysis: recordings → models; evaluation; blind tests
models/                        the analysed instruments
```

Rebuild the models from the source recordings with `npm run models` (Python 3.12 with numpy,
scipy, numba, soundfile; see `tools/ssm/`).

## Tests

```bash
npm test             # TypeScript API (offline, no audio device)
npm run test:rust    # engine and DSP
```

## License

Code: MIT. Instrument models are derived from recordings under their own licenses — CC0 and
CC BY-SA 2.5 SE (the Bureå organ, attribution: Lars Palo). See [NOTICE.md](NOTICE.md).
