# supersynth

Acoustic instrument sounds for Node.js, played by a native Rust engine: a piano, a harpsichord,
sixteen pipe organs and a harmonium, strings, winds, brass and mallets. Every instrument is a
spectral model analysed from freely licensed recordings.

```ts
import { Synth } from 'supersynth';

const synth = new Synth();
const piano = synth.add('grand-piano');
await synth.start();

piano.play(['C4', 'E4', 'G4'], { velocity: 80, duration: 2 });
await synth.idle();   // real-time output does not keep Node.js running by itself
synth.close();
```

## Where it is useful

- **Programs that make music**: generative and algorithmic music, sonification, games and
  installations that play notes from code, with every note, controller and setting scheduled
  to the sample (`{ at }`).
- **Rendering offline**: MIDI files or generated scores to WAV on a server or in a build step,
  with no audio device.
- **Small or headless machines**: the shipped instruments take 36 MB, and the engine is prebuilt for
  64-bit ARM. The Raspberry Pi 5 figures in [Performance](#performance) are estimates from a
  cloud VM; they were not measured on a Pi.
- **Playing a MIDI keyboard through Node**, including organs with several keyboards, couplers,
  stops and presets driven from code.
- **Changing the sound from code**: brightness, attack, release, vibrato, inharmonicity, noise
  and effects can be changed while notes sound.

When the goal is the most faithful reproduction of a particular instrument, other tools are
the usual choice. A sampler (sfizz, FluidSynth, Decent Sampler) plays the source recordings
themselves; VCSL and VSCO 2 CE are available for samplers. GrandOrgue plays the organ sample
sets. Physically modelled instruments simulate what this engine does not, such as the coupling
of piano strings, and some sample libraries record the transitions between notes.

## How it works

For each recorded note and dynamic level, the analysis (`tools/ssm/`, [docs/models.md](docs/models.md))
measures:

- the frequency and amplitude envelope of each harmonic partial: up to 512, keeping those within
  80 dB of the strongest. It also measures string stiffness (piano inharmonicity), vibrato and
  pitch drift;
- stable inharmonic peaks in what is left: resonances in the piano recording, the modes of a
  bar or bell;
- the noise in 30 frequency bands over time: breath, bow, hammer, wind and key action;
- for nearly every instrument, the first 40–250 ms of the recording itself (the attack), which
  the engine cross-fades into the synthesised tone;
- sustain loops, release behaviour and the tuning of each note.

The engine plays this back with an oscillator bank and band-shaped noise. Notes between
recorded pitches or dynamics blend the partial levels of the nearest recordings (with formant
preservation for strings, winds and brass). The attack excerpt and the shape of the envelope come
from the nearest recording, resampled to the new pitch.

## Limitations

- **No published comparison with the recordings.** `tools/ssm/` contains scripts that compare
  synthesised notes with recordings and with a simple pitch-shifting sampler (see
  [docs/models.md](docs/models.md#evaluation)). The repository holds no results from them and no
  record of listening tests with people, so it makes no claim about how close the instruments
  are to the real ones or to a sampler.
- **Between recorded notes**, the attack and envelope come from one neighbouring recording.
  They switch to the other neighbour halfway between them, much like a sampler's zones.
  The attack is resampled by linear interpolation, which can alias on high transpositions.
- **Piano**: there is no sympathetic or pedal resonance between notes. Resonances in each recording
  are kept. Re-striking a note that still sounds (held by the pedal, too) releases the previous
  strike.
- **Strings, winds and brass**: legato is a pitch glide into the next note's sustain, not a
  recorded transition. A section (`strings`, `violins`, …) is one model, not separate players.
- **Organs**: the Bureå and Piotr Grabowski sample sets record every pipe, so these models are
  resyntheses of those recordings rather than interpolations. The pipes do not interact, apart
  from a simple shared-wind model (`wind`).
- **Live MIDI** is applied at the start of the next audio buffer, so its timing varies by up to
  one buffer (2.7 ms at 128 frames).
- **CPU**: by estimate, the largest organs at full registration need more than a Raspberry Pi 5
  ([Performance](#performance)).

## Instruments

| Family | Instruments (ids) |
|---|---|
| Keyboards | `grand-piano`, `upright-piano`, `harpsichord` |
| Organs | `burea` — the full Bureå church organ (40 stops, 4 divisions); `vcsl` — the VCSL church organ with a Renaissance chamber organ; 15 organs from Piotr Grabowski's free sample sets (`friesach`, `cracow`, `szczecinek`, … — [docs/piotr-organs.md](docs/piotr-organs.md)); `pipe-organ`, `chamber-organ` (single sounds). The organs other than `vcsl` install separately ([Install](#install)) |
| Strings | `violin`, `violins`, `violas`, `cellos`, `contrabass`, `strings` (full section), `harp`, `violin-pizzicato`, `cello-pizzicato`, `contrabass-pizzicato` |
| Woodwinds | `flute`, `oboe`, `clarinet`, `bassoon`, `tenor-sax` |
| Brass | `trumpet`, `french-horn`, `trombone`, `tuba`, `brass` (section) |
| Percussion | `marimba`, `vibraphone`, `xylophone`, `glockenspiel`, `tubular-bells` |

Each comes with presets (`synth.add('grand-piano', { preset: 'felt' })`); `INSTRUMENTS` and
`ORGANS` list everything, with presets and descriptions (see [docs/instruments.md](docs/instruments.md)).

## The API in one screen

- **`Synth`** is the engine; `synth.add(id)` adds anything in the catalog. `add('violin')`
  gives an **`Instrument`**, `add('burea')` an **`Organ`** with four **`Division`s** (its keyboards).
- Instruments and divisions are **`Playable`**: `noteOn`, `noteOff`, `play`, `sequence`,
  `expression`, `allNotesOff`.
- **Every change can be scheduled**: notes, controllers, parameters, presets, stops, couplers,
  volume and room all take `{ at }` or `{ delay }` last, so a whole piece renders in one go.
- **`set(settings)`** changes some settings and keeps the rest — `synth.set({ volume, reverb })`,
  `instrument.set({ brightness })`, `organ.set({ tremulant, wind, noises })`, `division.set({ stops })`.
- Instruments and organs share one **preset** API: `preset(name | object)`, `presets()`,
  `savePreset(name)`, `current()`, `activePreset()`.
- **MIDI channels** are 1–16, and a MIDI keyboard plays only what you give a channel:
  `instrument.midi(1)`, `organ.midi({ great: 1, pedal: 2 })`.
- Instruments and organs are **configuration** (`InstrumentDefinition`, `OrganDefinition`), with
  the built-in ones in `INSTRUMENTS` and `ORGANS` by id: import, copy, change, and pass to `add`.

Reference: [docs/synth.md](docs/synth.md) (Synth, Instrument, the rules above),
[docs/organ.md](docs/organ.md), [docs/parameters.md](docs/parameters.md) (parameters, reverb),
[docs/midi.md](docs/midi.md), [docs/errors.md](docs/errors.md).

## Install

```bash
npm install supersynth
```

This brings the engine prebuilt for your platform — Linux x64 and arm64 (glibc 2.35+, e.g. a
Raspberry Pi 5 on Raspberry Pi OS Bookworm), Linux x64 musl (Alpine), macOS (Intel and Apple
silicon), Windows x64; Node 18 or later — and every instrument except the organs (36 MB). On
Linux the engine uses ALSA's `libasound.so.2` (package `libasound2` or `alsa-lib`).

Each organ's models are a package of their own, so you download only the organs you play:

```bash
npm install @supersynth/organ-burea      # the Bureå organ (71 MB)
npm install @supersynth/organ-friesach   # one of Piotr Grabowski's organs: @supersynth/organ-<id>
npm install @supersynth/organs           # all 16 organs (about 900 MB)
```

`synth.add('friesach')` without its package throws an error naming the package to install. The
VCSL organ (`vcsl`) and the single organ sounds ship with supersynth.

Building from source needs Rust ([rustup.rs](https://rustup.rs)) and, on Linux, `pkg-config`
and the ALSA and JACK development headers (Debian/Ubuntu: `libasound2-dev libjack-jackd2-dev`;
JACK itself is loaded at run time only if it is installed). Then run `npm ci && npm run build`
in a clone. The git history holds every version of the models, so a full clone is about 1 GB
(`git clone --depth 1` fetches only the current ones).

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

All note methods accept `{ at }` (absolute seconds on `synth.currentTime`) or `{ delay }` for
sample-accurate scheduling.

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

### Instruments and organs are configuration

Every instrument (`GRAND_PIANO`, `VIOLAS`, …) and organ (`BUREA_ORGAN`, `VCSL_ORGAN`) is a plain
object you can import, copy and change, from `supersynth` or from `supersynth/instruments` and
`supersynth/organs`:

```ts
import { GRAND_PIANO } from 'supersynth/instruments';
import { BUREA_ORGAN, type OrganDefinition } from 'supersynth/organs';

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
const audio = synth.render(3);                          // { sampleRate, left, right, duration }

synth.renderMidi('bach.mid', { instrument: 'harpsichord' });
await synth.playMidi('song.mid', { channels: { 1: 'violin', 2: 'cellos' } });
```

### Hardware MIDI

```ts
synth.add('grand-piano').midi(1);          // MIDI channel 1
await synth.start();                       // MIDI input plays only while output runs
await synth.enableMidi('Keystation');      // routed in the engine, not through JavaScript
synth.on('midi', (e) => console.log(e));
```

Messages are applied at the start of the next audio buffer. An open MIDI input keeps Node.js
running until `disableMidi()` or `close()`.

## Examples

```bash
npm run example:tour          # every instrument family
npm run example:piano         # pedal, dynamics, presets
npm run example:organ         # hymn in four parts across presets
npm run example:orchestra     # strings, harp, oboe, horn, pizzicato bass
npm run example:midi          # a Bach organ work from a MIDI file
npm run demos -- demos/       # render every instrument × preset to WAV
```

Append `-- out.wav` to the first four to render to a file instead of the speakers.

## Performance

The engine runs outside Node's event loop and garbage collector; the API talks to it through a
lock-free queue. Each audio block is rendered on several cores (`threads`, default: one per core
but one, so 3 on a Raspberry Pi 5): new notes are set up and voices rendered on every core, then
each part's noise and effects; the result is bit-for-bit the same for any number of threads. The
voice code is vectorised (NEON on ARM; SSE2, SSE4.1 or AVX2 on x86-64, chosen at run time),
without changing a single output sample.

`npm run bench` (offline, 2.1 GHz Xeon cloud VM with AVX2; share of one core needed in real time,
and with 3 threads the share of real time that passes):

| Scenario | 0.2.0 | now, 1 thread | now, 3 threads (wall clock) |
|---|---|---|---|
| 16 held piano notes with pedal | 40 % | 18 % | 11 % |
| 8-note string-orchestra chord | 54 % | 26 % | 15 % |
| Bureå plenum chord + pedal (25 pipes) | 30 % | 26 % | 16 % |
| Bureå full organ, all couplers (116 pipes) | 118 % | 95 % | 48 % |

Playing live is what counts: `npm run live-test` and `npm run bench:organs` play the engine as a
performer does, one 128-frame buffer (2.67 ms) at a time with keys arriving at buffer boundaries,
and time every buffer. The Raspberry Pi estimate below takes this VM's SSE4.1 code (4 lanes, as
NEON) at 3 threads and a CPU 1.7× slower; `--repeat 3` keeps each buffer's fastest of three runs,
since a shared VM adds random stalls of its own (an engine rendering nothing shows 36 % p99.9 here).
A buffer must finish within its 2.67 ms: below 59 % here leaves the Pi on time.

Live play (`live-test`, 3 threads, SSE4.1, `--repeat 3`): piano BWV 532 with pedal 13 % mean / 24 %
worst 0.1 %, fortissimo piano chords 35 / 53 %, strings 20 / 36 %, BWV 532 on the Bureå plenum
31 / 57 %: all on time on a Pi 5 by this estimate (0.2.0, one thread: 154 / 396 / 82 / 297 % worst,
with dropouts even on this VM).

| Organ, 6-note chord + 2 pedal notes (`bench:organs`) | voices | mean | worst 0.1 % | Pi 5 (est.) |
|---|---|---|---|---|
| green-positiv, harmonium, ledziny (tutti + couplers) | 31–70 | 12–21 % | 20–31 % | fits |
| strassburg, saint-jean-de-luz, skrzatusz, melcer, lipiny, dluga-koscielna, azzio, vcsl | 54–158 | 23–37 % | 35–54 % | fits |
| giubiasco, raszczyce | 124–133 | 38–41 % | 56–65 % | about at the limit |
| szczecinek, friesach grand-choeur, cracow grand-choeur | 162–220 | 56–62 % | 75–95 % | no: needs a faster machine or `releaseCulling` |
| Bureå full / tutti, Friesach and Cracow tutti + couplers | 130–285 | 55–89 % | 93–140 % | no |

The decisive load for a large organ is a fast piece on a plenum: every pipe plays its recorded
release (the pipe and several seconds of the church), so BWV 532 on the Friesach plenum keeps up to
1007 pipes sounding at once (mean 671) and needs about 3.8 cores of this VM — more than a Pi 5 has.
`maxVoices` defaults to 1024 so that none of them is cut.

By default every release tail plays in full, so by this estimate the largest organs (Friesach,
Cracow, Szczecinek, Bureå) at full registration need a faster machine than a Pi 5.
`releaseCulling` (opt-in, it changes the sound) ends quiet release tails early. Its gentlest useful setting,
`{ belowMixDb: 80, hold: 'smooth' }`, ends a tail only when it is 80 dB below both its keyboard and
the whole organ, so tails still ring out when the music stops. Measured on BWV 532 (third-octave
band levels per 100 ms, against the full tails):

| `releaseCulling` | Friesach plenum voices (mean / peak) | largest band change while playing / in pauses and the final decay |
|---|---|---|
| off (default) | 551 / 1007 | — |
| `{ belowMixDb: 80, hold: 'smooth' }` | 402 / 710 | Friesach 0.78 / 0.53 dB; Cracow 0.12 / 0.42 dB; Bureå 0.12 / 0.08 dB (2.8 dB in the pauses of full-organ chords) |
| `{ floorDb: -80 }` | 334 / 529 | up to 1.8 dB, and the end of the room tail is cut in pauses |

Neither saves enough for fast pieces on the Friesach and Cracow plena to fit a Pi 5
(about 4× its budget); on the Pi, play the large organs with lighter registrations, which fit
by this estimate.

Suggested settings for a Raspberry Pi 5 (derived from the estimates above): 64-bit OS, `threads: 'auto'` (or 4 if nothing else runs),
`bufferSize: 256` (5.3 ms) for organs, and the defaults otherwise. Check with
`npm run live-test -- --repeat 3` and `npm run bench:organs` on the Pi itself. During real-time
output the render threads take the audio thread's scheduling: the real-time priority of a JACK
or PipeWire audio thread or, with ALSA on Linux, `SCHED_FIFO` requested for the audio thread
and render threads together (granted where the user's real-time priority limit allows it).
They never run above the audio thread.

Models load off the JavaScript thread. Adding an organ waits only for its starting preset's
stops (loaded in parallel); the others load in the background, so drawing a stop never stalls
playing ([organ.md](docs/organ.md#loading)). On a 4-core cloud VM, `npm run load-test`: Friesach with
every stop drawn is ready in 0.95 s (430 MB decoded), and with its default preset `add()` returns
in 0.12 s.

## Architecture

```
TypeScript API (src/)          Synth · Instrument · Organ · catalog · MIDI files · WAV · model lookup
        │ napi-rs
native/src/                    bindings, CPAL audio output, MIDI input
native/core/                   supersynth-core (pure Rust)
  ├── model/                   .ssm spectral model format
  ├── voice/                   spectral voice (oscillator bank, transients), pooled FFT noise
  ├── engine/                  lock-free command queue, sample-accurate scheduling, parts, mixing,
  │                            worker pool rendering each block on several cores
  └── fx/                      FDN reverb, EQ, chorus, drive, rotary speaker, limiter
tools/ssm/                     Python analysis: recordings → models; evaluation scripts
models/                        the analysed instruments shipped with supersynth (CC0)
packages/organ-<id>/           one npm package per organ: models/organ/<id>/*.ssm
                               (Bureå: packages/organ-burea/models/organ/*.ssm)
packages/organs/               @supersynth/organs: depends on every organ package
npm/<platform>/                the engine prebuilt per platform (@supersynth/<platform>)
scripts/                       build-native.mjs, release helpers, doc generators
```

The repository is an npm workspace: `npm ci` links the organ packages into `node_modules`, where
supersynth finds them as it does when they are installed from npm.

Rebuild the models from the source recordings with `npm run models` (Python 3.12 with numpy,
scipy, numba, soundfile; see `tools/ssm/`).

## Tests

```bash
npm test             # TypeScript API (offline, no audio device)
npm run test:rust    # engine and DSP
```

## License

Code: MIT. The instrument models in `supersynth` are derived from CC0 recordings. The organ
packages carry their own licenses: `@supersynth/organ-burea` CC BY-SA 2.5 SE (attribution: Lars
Palo); Piotr Grabowski's organs (`@supersynth/organ-<id>`) may be used freely but not sold or built
into products for sale. See [NOTICE.md](NOTICE.md).
