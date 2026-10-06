# supersynth

Acoustic instrument sounds for Node.js and browsers, played by a Rust engine (native in Node.js,
WebAssembly on several cores in a browser): piano, harpsichord, sixteen pipe organs and a
harmonium, strings, winds, brass and mallets. Each instrument is a spectral model analysed from
freely licensed recordings.

```ts
import { Synth } from '@supersynth/core';

const synth = new Synth();
const piano = synth.add('grand-piano');
await synth.start();

piano.play(['C4', 'E4', 'G4'], { velocity: 80, duration: 2 });
await synth.idle();   // real-time output does not keep Node.js running by itself
synth.close();
```

## What it's for

- Generative and algorithmic music, sonification, games and installations: anything that plays
  notes from code. Notes, controllers and settings can all be scheduled to the sample with `{ at }`.
- Rendering MIDI files or generated scores to WAV, on a server or in a build step, without an
  audio device.
- Small or headless machines. The bundled instruments take 36 MB and the engine is prebuilt for
  64-bit ARM. (The Raspberry Pi 5 numbers under [Performance](#performance) are estimated on a
  cloud VM, not measured on a Pi.)
- Playing a MIDI keyboard through Node, including multi-manual organs whose stops, couplers and
  presets you control from code.
- Changing the sound while it plays: brightness, attack, release, vibrato, inharmonicity, noise
  and effects.

If you want the most faithful reproduction of one particular instrument, use something else. A
sampler (sfizz, FluidSynth, Decent Sampler) plays the recordings themselves, and VCSL and VSCO 2
CE are available in sampler formats. GrandOrgue plays the organ sample sets directly. Physical
models simulate things this engine doesn't, like the coupling between piano strings, and some
sample libraries record the transitions between notes.

## How it works

For each recorded note and dynamic level, the analysis in `tools/ssm/` ([docs/models.md](docs/models.md))
measures:

- the frequency and amplitude envelope of each harmonic partial (up to 512, keeping those within
  80 dB of the strongest), plus string stiffness (piano inharmonicity), vibrato and pitch drift;
- stable inharmonic peaks in what's left over, such as resonances in a piano recording or the
  modes of a bar or bell;
- the noise in 30 frequency bands over time: breath, bow, hammer, wind, key action;
- for almost every instrument, the first 40–250 ms of the recording itself (the attack), which
  the engine cross-fades into the synthesised tone;
- sustain loops, release behaviour and the tuning of each note.

The engine plays this back with an oscillator bank and band-shaped noise. Notes between
recorded pitches or dynamics blend the partial levels of the nearest recordings, with formant
preservation for strings, winds and brass. The attack and the envelope shape come from the
nearest recording, resampled to the new pitch.

## Limitations

- There's no published comparison with the recordings. `tools/ssm/` has scripts that compare
  synthesised notes with the recordings and with a simple pitch-shifting sampler
  ([docs/models.md](docs/models.md#evaluation)), but none of their results are in the repository
  and there have been no recorded listening tests. So this README makes no claim about how close
  the instruments come to the real thing, or to a sampler.
- Between recorded notes, the attack and envelope come from one of the two neighbouring
  recordings and switch over halfway between them, much like sampler zones. The attack is
  resampled with linear interpolation, which can alias when it's transposed a long way up.
- Piano: sympathetic and pedal resonance come from a bank of tuned string resonators driven
  by what is played (`resonance`), not from recordings with the pedal down. The strings
  without dampers at the top of the keyboard aren't in it: their resonance is already in
  every recording. A note between two recorded dynamics plays the nearer one's recorded hammer
  attack, reshaped to the blended timbre; there are three dynamic layers (no *pp* recording).
- Strings, winds and brass: legato is a pitch glide into the next note's sustain, not a recorded
  transition. Sections (`strings`, `violins`, …) are a single model, not individual players.
- Organs: the Bureå and Piotr Grabowski sample sets record every pipe, so these models
  resynthesise those recordings rather than interpolating between them. Pipes don't interact,
  apart from a simple shared-wind model (`wind`).
- Live MIDI is applied at the start of the next audio buffer, so its timing can be off by up to
  one buffer (2.7 ms at 128 frames).
- The largest organs at full registration probably need more CPU than a Raspberry Pi 5 has
  (see [Performance](#performance)).

## Instruments

| Family | Instruments (ids) |
|---|---|
| Keyboards | `grand-piano`, `upright-piano`, `harpsichord` |
| Organs | `burea` (the Bureå church organ: 40 stops, 4 divisions); `vcsl` (the VCSL church organ plus a Renaissance chamber organ); 15 organs from Piotr Grabowski's free sample sets, such as `friesach`, `cracow` and `szczecinek` ([full list](docs/piotr-organs.md)); `pipe-organ` and `chamber-organ` (single sounds). Apart from `vcsl` and the single sounds, organs are installed separately ([Install](#install)) |
| Strings | `violin`, `violins`, `violas`, `cellos`, `contrabass`, `strings` (full section), `harp`, `violin-pizzicato`, `cello-pizzicato`, `contrabass-pizzicato` |
| Woodwinds | `flute`, `oboe`, `clarinet`, `bassoon`, `tenor-sax` |
| Brass | `trumpet`, `french-horn`, `trombone`, `tuba`, `brass` (section) |
| Percussion | `marimba`, `vibraphone`, `xylophone`, `glockenspiel`, `tubular-bells` |

Every instrument has presets (`synth.add('grand-piano', { preset: 'felt' })`). `INSTRUMENTS` and
`ORGANS` hold the whole catalog with presets and descriptions, also listed in
[docs/instruments.md](docs/instruments.md).

## API overview

- `Synth` is the engine. `synth.add(id)` adds anything from the catalog: `add('violin')` returns
  an `Instrument`, and `add('burea')` an `Organ` with four `Division`s (its keyboards).
- Instruments and divisions are both `Playable`: `noteOn`, `noteOff`, `play`, `sequence`,
  `expression`, `allNotesOff`.
- Notes, controllers, parameters, presets, stops, couplers, volume and reverb all take `{ at }`
  or `{ delay }` as their last argument, so you can schedule a whole piece and render it in one
  pass.
- `set(settings)` changes only the settings you pass: `synth.set({ volume, reverb })`,
  `instrument.set({ brightness })`, `organ.set({ tremulant, wind, noises })`,
  `division.set({ stops })`.
- Instruments and organs have the same preset methods: `preset(name | object)`, `presets()`,
  `savePreset(name)`, `current()`, `activePreset()`.
- MIDI channels are numbered 1–16. A MIDI keyboard only plays what you've assigned a channel
  to: `instrument.midi(1)`, `organ.midi({ great: 1, pedal: 2 })`.
- Instruments and organs are plain configuration objects (`InstrumentDefinition`,
  `OrganDefinition`). The built-in ones are in `INSTRUMENTS` and `ORGANS`, keyed by id; copy
  one, change it and pass it to `add`.

Reference: [docs/synth.md](docs/synth.md) (`Synth` and `Instrument`), [docs/organ.md](docs/organ.md),
[docs/parameters.md](docs/parameters.md) (parameters and reverb), [docs/midi.md](docs/midi.md),
[docs/errors.md](docs/errors.md), and [docs/models.md](docs/models.md) for how the models are built.

## Install

```bash
npm install @supersynth/core
```

This installs the prebuilt engine for your platform and every instrument except the separately
packaged organs (36 MB). Prebuilt engines are available for Linux x64 and arm64 (glibc 2.35 or
newer, e.g. Raspberry Pi OS Bookworm on a Pi 5), Linux x64 musl (Alpine), macOS (Intel and Apple
silicon) and Windows x64. Node 18 or later is required. On Linux the engine uses ALSA's
`libasound.so.2` (package `libasound2` or `alsa-lib`).

Each organ is its own package, so you only download the ones you use:

```bash
npm install @supersynth/organ-burea      # the Bureå organ (71 MB)
npm install @supersynth/organ-friesach   # one of Piotr Grabowski's organs: @supersynth/organ-<id>
npm install @supersynth/organs           # all 16 organs (about 900 MB)
```

If the package isn't installed, `synth.add('friesach')` throws an error that tells you which one
to install. The VCSL organ (`vcsl`) and the single organ sounds come with supersynth itself.

### In a browser

The same package runs in a browser, with the same API. Its engine is compiled to WebAssembly,
renders in an AudioWorklet and spreads voices over the cores with Web Workers. The page must be
cross-origin isolated (two headers), and models are downloaded before use:

```ts
const synth = await Synth.create();          // instead of new Synth()
await synth.load('grand-piano');             // downloads the models (in Node.js: a no-op check)
synth.add('grand-piano').play('C4');
await synth.start();                         // from a user gesture
```

See [docs/browser.md](docs/browser.md) (headers, where the files are served from, bundlers,
what differs), and `examples/browser/` for a page to play every instrument.

To build from source you need Rust ([rustup.rs](https://rustup.rs)). On Linux you also need
`pkg-config` and the ALSA and JACK development headers (`libasound2-dev libjack-jackd2-dev` on
Debian/Ubuntu); JACK itself is only loaded at run time if it's installed. Then run
`npm ci && npm run build` in a clone (the browser engine: `npm run build:wasm`, see
[docs/browser.md](docs/browser.md#building-it)). The models aren't in git: they're published
on npm with their packages, and `npm run models:fetch` downloads them into a clone
(`packages/*/models/`, about 1 GB for everything; `npm run models:fetch -- instruments organ-burea`
fetches only those).

## Usage

### Playing notes

```ts
const synth = new Synth({ reverb: 'concert-hall' });
const piano = synth.add('grand-piano');
const violin = synth.add('violin', { preset: 'expressive' });
const cellos = synth.add('cellos');

violin.play('A4', { velocity: 90, duration: 2 });          // names or MIDI numbers
cellos.play(['C3', 'G3'], { delay: 0.5, duration: 3 });     // chords, relative timing
violin.sequence([['E5', 1], ['D5', 0.5], ['C5', 0.5], ['B4', 2]], { tempo: 80 });

piano.noteOn('C4', 100); /* … */ piano.noteOff('C4');      // manual control
piano.sustain(true);                                        // pedal
violin.pitchBend(0.5); violin.modulation(0.3); violin.expression(0.6); // swells
```

All note methods take `{ at }` (seconds on the `synth.currentTime` clock) or `{ delay }`
(seconds from now), and are scheduled to the sample.

### Presets and tweaks

```ts
piano.set({ brightness: 1.5, release: 2, reverbSend: 0.3 });
violin.set({ vibrato: 8, vibratoRate: 5.8, naturalVibrato: 0.5 });
synth.add('grand-piano', { preset: 'honky-tonk', parameters: { volume: -3 } });

piano.preset('felt');                       // replaces every parameter
piano.savePreset('mine');                   // the sound as it is now
piano.presets();                            // the instrument's presets and yours
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
const organ = synth.add('burea', { preset: 'plenum' });   // npm install @supersynth/organ-burea
organ.great.play(['C4', 'E4', 'G4'], { duration: 4 });
organ.pedal.play('C2', { duration: 4 });

organ.great.pull("Trumpet 8'");           // draw a stop, even while notes are held
organ.swell.pull(["Salicional 8'", "Voix céleste 8'"]);
organ.great.couple('swell');              // Swell to Great
organ.great.couple({ division: 'swell', octave: 1 });   // Swell to Great 4'
organ.swell.expression(0.4);              // swell pedal
organ.set({ tremulant: { swell: true } });
organ.set({ noises: true });              // blower, room, key and stop action (Piotr Grabowski's organs)

organ.preset('celeste', { at: 8 });       // plenum, flutes, cornet, trumpet, krummhorn, celeste, full, …
organ.preset({ great: ["Principal 8'"], pedal: ["Subbass 16'"], couple: { pedal: ['great'] } });
organ.savePreset('mine');                 // what is drawn now, under a name

await synth.enableMidi();
organ.midi({ great: 1, swell: 2, pedal: 3 });   // keyboards per channel, couplers included
```

### Custom instruments and organs

Every instrument (`GRAND_PIANO`, `VIOLAS`, …) and organ (`BUREA_ORGAN`, `VCSL_ORGAN`,
`FRIESACH_ORGAN`, …) is a plain object that you can import, copy and modify. They're exported
from `@supersynth/core` as well as `@supersynth/core/instruments` and `@supersynth/core/organs`:

```ts
import { GRAND_PIANO } from '@supersynth/core/instruments';
import { BUREA_ORGAN, type OrganDefinition } from '@supersynth/core/organs';

synth.add({ ...GRAND_PIANO, id: 'dark-piano', parameters: { brightness: -1.5 } });

const organ: OrganDefinition = {
  ...BUREA_ORGAN,
  presets: { ...BUREA_ORGAN.presets, solo: { description: 'Krummhorn solo', positive: ["Gedackt 8'", "Krummhorn 8'"] } },
};
synth.add(organ, { preset: 'solo' });
```

See [docs/organ.md](docs/organ.md#organs-are-configuration) and [docs/instruments.md](docs/instruments.md).

### Offline rendering and MIDI files

```ts
const synth = new Synth();
synth.add('harpsichord').play(['D4', 'F4', 'A4'], { duration: 2 });
synth.renderToFile('chord.wav', 3);                     // no audio device needed
// or, instead: const audio = synth.render(3);          // { sampleRate, left, right, duration }
// (each render continues from where the last one ended)

synth.renderMidi('bach.mid', { instrument: 'harpsichord' });
await synth.playMidi('song.mid', { channels: { 1: 'violin', 2: 'cellos' } });
```

### Hardware MIDI

```ts
const synth = new Synth();
synth.add('grand-piano').midi(1);          // MIDI channel 1
await synth.start();                       // MIDI input plays only while output runs
await synth.enableMidi('Keystation');      // routed in the engine, not through JavaScript
synth.on('midi', (e) => console.log(e));
```

Incoming messages take effect at the start of the next audio buffer. While a MIDI input is
open, Node.js keeps running until you call `disableMidi()` or `close()`.

## Examples

```bash
npm run example:tour          # piano, harpsichord, strings, winds, brass, harp and mallets
npm run example:piano         # pedal, dynamics, presets
npm run example:organ         # hymn in four parts across presets
npm run example:orchestra     # strings, harp, oboe, horn, pizzicato bass
npm run example:midi          # Bach's BWV 532 from a MIDI file, on the piano
npm run demos -- demos/       # render every instrument × preset to WAV
```

Add `-- out.wav` to any of the first four to render to a file instead of playing through the
speakers. The MIDI example takes `-- --organ` (the Bureå plenum, which needs
`@supersynth/organ-burea`), `-- --instrument <id>` and `-- --out file.wav`.

## Performance

The engine runs outside Node's event loop and garbage collector, and the API talks to it
through a lock-free queue. Each audio block is rendered on several cores. The `threads` option
defaults to one less than the number of cores, up to 8 (so 3 on a Raspberry Pi 5). New notes
are set up and voices rendered across all of them, then each part's noise and effects. The
output is identical whatever the thread count. The voice code is vectorised (NEON on ARM; SSE2,
SSE4.1 or AVX2 on x86-64, picked at run time), and every variant produces the same samples.

`npm run bench`, offline on a 2.1 GHz Xeon cloud VM with AVX2. The 1-thread column is the share
of one core needed to keep up in real time; the 3-thread column (`npm run bench -- --threads 3`)
is elapsed time as a share of the audio's duration:

| Scenario | 0.2.0 | now, 1 thread | now, 3 threads (wall clock) |
|---|---|---|---|
| 16 held piano notes with pedal | 40 % | 18 % | 11 % |
| 8-note string-orchestra chord | 54 % | 26 % | 15 % |
| Bureå plenum chord + pedal (25 pipes) | 30 % | 26 % | 16 % |
| Bureå full organ, all couplers (116 pipes) | 118 % | 95 % | 48 % |

For live playing, averages matter less than the slowest buffers. `npm run live-test` and
`npm run bench:organs` drive the engine the way a performer would, one 128-frame buffer
(2.67 ms) at a time with keys arriving at buffer boundaries, and time every buffer. The
Raspberry Pi estimates use this VM's SSE4.1 code path (4 lanes, like NEON; set
`SUPERSYNTH_SIMD=sse4.1`) at 3 threads (`--threads 3`) and assume a CPU 1.7× slower.
`--repeat 3` keeps the fastest of three runs for each buffer, because a shared VM adds random
stalls of its own (an engine rendering nothing still shows 36 % at p99.9 here). Every buffer has
to finish within its 2.67 ms, so anything under 59 % on this VM should keep up on a Pi.

With `live-test` (3 threads, SSE4.1, `--repeat 3`), the mean and worst-0.1 % buffer loads are
13 % and 24 % for BWV 532 on the piano with pedal, 35 % and 53 % for fortissimo piano chords,
20 % and 36 % for strings, and 31 % and 57 % for BWV 532 on the Bureå plenum. By this estimate
all of them keep up on a Pi 5. Version 0.2.0 on one thread had worst cases of 154, 396, 82 and
297 %, and dropped out even on this VM.

| Organ, 6-note chord + 2 pedal notes (`bench:organs`) | voices | mean | worst 0.1 % | Pi 5 (est.) |
|---|---|---|---|---|
| green-positiv, harmonium, ledziny (tutti + couplers) | 31–70 | 12–21 % | 20–31 % | fits |
| strassburg, saint-jean-de-luz, skrzatusz, melcer, lipiny, dluga-koscielna, azzio, vcsl | 54–158 | 23–37 % | 35–54 % | fits |
| giubiasco, raszczyce | 124–133 | 38–41 % | 56–65 % | about at the limit |
| szczecinek, friesach grand-choeur, cracow grand-choeur | 162–220 | 56–62 % | 75–95 % | no: needs a faster machine or `releaseCulling` |
| Bureå full / tutti, Friesach and Cracow tutti + couplers | 130–285 | 55–89 % | 93–140 % | no |

The hardest case for a large organ is a fast piece on a full registration, because every pipe
plays its recorded release: the pipe itself plus several seconds of the church. BWV 532 on the
Friesach plenum keeps up to 955 pipes sounding at once (586 on average over the 45 s that
`live-test` plays) and needs about 3.8 cores of this VM, more than a Pi 5 has. `maxVoices`
defaults to 1024 so that none of them get cut off.

Because release tails play in full by default, the largest organs (Friesach, Cracow,
Szczecinek, Bureå) at full registration probably need a faster machine than a Pi 5. The opt-in
`releaseCulling` setting ends quiet tails early, which does change the sound. The gentlest
useful setting, `{ belowMixDb: 80, hold: 'smooth' }`, only ends a tail once it is 80 dB below
both its own keyboard and the whole organ, so tails still ring out when the music stops.
Measured on BWV 532, comparing third-octave band levels in 100 ms windows with the full tails:

| `releaseCulling` | Friesach plenum voices (mean / peak) | largest band change while playing / in pauses and the final decay |
|---|---|---|
| off (default) | 586 / 955 | — |
| `{ belowMixDb: 80, hold: 'smooth' }` | 425 / 688 | Friesach 0.78 / 0.53 dB; Cracow 0.12 / 0.42 dB; Bureå 0.12 / 0.08 dB (2.8 dB in the pauses of full-organ chords) |
| `{ floorDb: -80 }` | 287 / 498 | up to 1.8 dB, and the end of the room tail is cut in pauses |

Neither setting saves enough to fit fast pieces on the Friesach or Cracow plenum onto a Pi 5:
they need about 4× its budget. On a Pi, either use lighter registrations on the large organs,
which should fit, or turn on the overload guard and accept shorter tails when the CPU runs out.

### Overload guard

`new Synth({ overloadGuard: true })` is opt-in and only applies to real-time output. It measures
how long each audio buffer takes to render (wall clock, all threads). When that load, smoothed
over about 100 ms, goes above 85 % of the buffer's duration, or a buffer is late on a busy
engine, it ends the quietest notes that are in their release, with a 10 ms fade. It ends just
as many as the measured cost per voice says are needed to bring the next buffers under 70 %.
Only when there are no released notes left does it start fading out the upper partials of the
quietest held notes, and never below a quarter of them. Held notes and attacks are never cut.
It lets go once the load has stayed under 50 % for 0.5 s (and at least 1 s after it kicked in),
and the partials fade back in. When nothing is overloaded it does nothing at all: the output is
identical to running without it (tested on piano, strings and the Bureå plenum played live),
and offline rendering is never guarded. `synth.guardActive` and `synth.guardStats`
(`{ active, voicesShed, partialsReduced }`) report what it's doing.

By the Pi 5 estimate, a large organ then degrades gracefully, with shorter tails under load
instead of crackling. Results for BWV 532 played live (`live-test --guard --repeat 3`, SSE4.1).
Dropouts are buffers that missed their deadline, out of 16,875. Band change compares
third-octave levels in 100 ms windows with the full render while the guard is active
(`bench/bands.ts`):

| | Pi 5 estimate (3 threads, 1.7× slower) off → on | 1 thread on this VM off → on | voices (peak) off → on | band change, median / p90 / p99 |
|---|---|---|---|---|
| Bureå plenum | 2380 → 1 | 3430 → 0 | 113 → 54 | 0.09 / 0.98 / 5.5 dB |
| Friesach plenum | 16209 → 0 | 16353 → 1 | 945 → 105 | 0.41 / 2.7 / 10.9 dB |
| Cracow plein-jeu | 15817 → 0 | 16068 → 1 | 1029 → 119 | 0.40 / 2.9 / 18 dB |

The large changes are in the quiet bands of the room between notes, where the shed releases
were; the notes themselves aren't touched. On a machine that keeps up, the guard never engages.

### Raspberry Pi 5 settings

Suggested settings, based on the estimates above: a 64-bit OS, `threads: 'auto'` (or 4 if
nothing else is running), `bufferSize: 256` (5.3 ms) for organs, and the defaults for everything
else. Add `overloadGuard: true` to play the large organs (Friesach, Cracow, Szczecinek, Bureå at
full registration) with shorter tails instead of dropouts. Check with
`npm run live-test -- --repeat 3` and `npm run bench:organs` on the Pi itself. During real-time
output the render threads get the same scheduling as the audio thread. With JACK or PipeWire
that's the real-time priority of their audio thread; with ALSA on Linux, supersynth requests
`SCHED_FIFO` for the audio and render threads together, which is granted if the user's
real-time priority limit allows it. Render threads never run at a higher priority than the
audio thread.

Models are loaded off the JavaScript thread. Adding an organ only waits for the stops in its
starting preset, which load in parallel; the rest load in the background, so drawing a stop
later doesn't hold up playback ([organ.md](docs/organ.md#loading)). On a 4-core cloud VM
(`npm run load-test`), Friesach with every stop drawn is ready in 0.95 s (430 MB decoded), and
with its default preset `add()` returns in 0.12 s.

## Architecture

```
TypeScript API (src/)          Synth · Instrument · Organ · catalog · MIDI files · WAV
  src/platform/                what differs by platform, behind the `#platform` import:
                               node.ts (napi engine, model files) · browser.ts (WebAssembly engine,
                               AudioWorklet, Web Workers, fetched models, Web MIDI)
        │ napi-rs (Node.js)            │ wasm-bindgen (browser)
native/src/                    native/wasm/
  CPAL audio output, MIDI input  render entry for the AudioWorklet, threads for Web Workers
        └──────────────┬───────────────┘
native/host/                   supersynth-host: everything the two share — argument checks,
                               commands at their frame, models and their (background) loading,
                               MIDI routing, the overload guard's controls
native/core/                   supersynth-core (pure Rust)
  ├── model/                   .ssm spectral model format
  ├── dsp/                     biquads, FFT, noise, SIMD kernels chosen at run time
  ├── voice/                   spectral voice (oscillator bank, transients), pooled FFT noise
  ├── engine/                  lock-free command queue, sample-accurate scheduling, parts, mixing,
  │                            worker pool rendering each block on several cores
  ├── fx/                      FDN reverb, EQ, chorus, drive, rotary speaker, limiter
  └── bin/ssrender.rs          offline renderer of a single model, for the analysis tools
tools/ssm/                     Python analysis: recordings → models; evaluation scripts
models/                        the analysed instruments shipped with supersynth (CC0)
packages/organ-<id>/           one npm package per organ: models/organ/<id>/*.ssm
                               (Bureå: packages/organ-burea/models/organ/*.ssm)
packages/organs/               @supersynth/organs: depends on every organ package
npm/<platform>/                the engine prebuilt per platform (@supersynth/<platform>)
wasm/                          the browser engine (built by scripts/build-wasm.mjs; in the package)
scripts/                       build-native.mjs, build-wasm.mjs, release helpers, doc generators
```

The repository is an npm workspace. `npm ci` links the organ packages into `node_modules`, where
supersynth finds them just as it would if they were installed from npm.

Rebuild the models from the source recordings with `npm run models` (Python 3.12 with the
packages in `tools/ssm/requirements.txt`, in an active virtual environment; see
[tools/ssm/README.md](tools/ssm/README.md)).

## Tests

```bash
npm run build:native # the engine, needed by npm test
npm test             # TypeScript API (offline, no audio device); with the browser engine built
                     # (npm run build:wasm), also that engine against the native one
npm run test:unit    # notes, WAV and MIDI-file parsing only (no engine needed)
npm run typecheck    # sources, tests, examples and benchmarks
npm run test:rust    # engine and DSP
npm run test:browser # the browser engine in headless Chromium (after build:wasm and build:ts)
```

CI also runs `cargo clippy --release --workspace -- -D warnings` in `native/`.

## License

The code is MIT-licensed ([LICENSE](LICENSE)). The instrument models bundled with `supersynth`
come from CC0 recordings. The organ packages have their own licenses: `@supersynth/organ-burea`
is CC BY-SA 2.5 SE (attribution: Lars Palo), and Piotr Grabowski's organs
(`@supersynth/organ-<id>`) can be used freely but not sold or built into products for sale.
See [NOTICE.md](NOTICE.md).
