# API

## The model

| | |
|---|---|
| `Synth` | the engine: clock, real-time output or offline rendering, master volume and room, MIDI |
| `Part` | one instrument on its own channel — `synth.add(instrument, { preset, params })` |
| `Organ` | a church organ with four `Division`s (great, swell, positive, pedal) — `synth.organ({ instrument, preset })`; see [organ.md](organ.md) |
| `InstrumentDef`, `OrganDef` | instruments and organs as plain configuration objects, to import, copy and change |
| `Instrument`, `Piano`, …, `ChurchOrgan` | a `Part` or an `Organ` with its own engine, for a single instrument |

The same ideas work the same way everywhere:

- **Keyboards.** Parts, organ divisions and standalone instruments are all `Keyboard`s:
  `noteOn`, `noteOff`, `play`, `sequence`, `expression`, `allNotesOff`.
- **Time.** Notes, controllers and `part.set` take `{ at }` (seconds on `synth.currentTime`)
  or `{ delay }` (seconds from now) as their last argument; without either they act now.
  Presets, stops and the room change at once.
- **Presets.** Parts and organs share one preset API: `preset(name | object)`, `presets()`,
  `savePreset(name)`, `current()`, `activePreset()`.
- **MIDI channels** are always 1–16: `part.midi(1)`, `organ.midi({ great: 1 })`,
  `renderMidi(file, { channels: { 1: … } })`, the `channel` of a `'midi'` event.
- **Chaining.** Methods that change something return the object, so calls chain:
  `synth.add('piano').preset('mellow').midi(1)`.
- **Properties are read-only state** (`synth.currentTime`, `part.definition`); everything you
  set or that returns a list is a method.

## `new Synth(options?)`

| Option | Default | |
|---|---|---|
| `sampleRate` | device rate (48000 without a device) | Hz |
| `backend` | `'auto'` | `'coreaudio' \| 'wasapi' \| 'alsa' \| 'jack' \| 'pulseaudio' \| 'pipewire'` |
| `reverb` | `'auto'` | preset name, `ReverbOptions`, `false`, or `'auto'` (the room of the first instrument or organ) |
| `volume` | `0.5` | master volume 0–1 |
| `quality` | `'high'` | partials per note: `'high'` 512, `'balanced'` 128, `'eco'` 32 (small boards such as a Raspberry Pi) |
| `maxVoices` | `192` | quietest/oldest voices are stolen beyond this |
| `bufferSize` | device default | frames per audio callback |
| `modelsDir` | package `models/` | where `.ssm` models are loaded from |

| Method | |
|---|---|
| `add(id \| def, { preset, params })` | add an instrument → `Part` |
| `organ(id \| { instrument, preset, presets, tremulant, wind })` | add a church organ → `Organ` |
| `parts()`, `remove(part)` | the parts added; remove one |
| `start()` / `stop()` / `close()` | real-time output |
| `render(seconds)` | offline → `{ sampleRate, left, right, duration }` |
| `renderToFile(path, seconds, { bitDepth, mono })` | offline → WAV |
| `renderMidi(file, options)` / `playMidi(file, options)` | Standard MIDI Files, see [midi.md](midi.md) |
| `volume(0–1)`, `reverb(preset \| options \| false)` | master volume and room, see [parameters.md](parameters.md#reverb) |
| `allNotesOff()`, `panic()` | release every note; silence everything at once |
| `enableMidi(device?, { route })`, `disableMidi()` | hardware MIDI input, see [midi.md](midi.md) |
| `listMidiDevices()`, `listAudioBackends()` | |

| Property | |
|---|---|
| `currentTime` | engine clock, seconds — schedule with `{ at: synth.currentTime + x }` |
| `sampleRate`, `activeVoices`, `cpuLoad`, `isRunning` | |

Events: `'midi'` (`MidiEvent`) for every message once hardware MIDI is enabled.

## `Part`

Returned by `synth.add`: one instrument on one channel.

| Method | |
|---|---|
| `play(notes, { velocity, duration, at, delay })` | notes: `'C4'`, `60`, or arrays (chords) |
| `sequence(steps, { bpm, velocity, legato, at, delay })` | `[note, beats]` or `{ note, beats, velocity }`; `null` is a rest; returns seconds |
| `noteOn(note, velocity?, { at })`, `noteOff(note, { at })`, `allNotesOff()` | |
| `sustain(down)`, `pitchBend(-1…1)`, `modWheel(0…1)`, `expression(0…1)`, `cc(n, v)` | controllers |
| `set(params, { at })`, `get(name)`, `params()`, `reset()` | sound parameters, see [parameters.md](parameters.md) |
| `preset(name \| preset)`, `presets()`, `savePreset(name, preset?)`, `current()`, `activePreset()` | presets |
| `midi(channel)` | play it from MIDI channel 1–16 of a hardware keyboard |

| Property | |
|---|---|
| `definition` | the `InstrumentDef` it plays (`range`, `presets`, …) |
| `synth` | its engine |

### Presets

A preset is a set of parameters, and optionally layers, applied together; the instruments'
presets are listed in [instruments.md](instruments.md). Applying one replaces every parameter.
`activePreset()` names the preset in use until a parameter is changed by hand (parameters given
with the preset to `synth.add` count as part of it):

```ts
const piano = synth.add('grand-piano', { preset: 'mellow', params: { volume: -3 } });
piano.activePreset();                     // 'mellow'
piano.set({ release: 2 });                // now undefined
piano.savePreset('mine');                 // the sound as it is now
piano.preset('bright').preset('mine');
piano.preset({ params: { brightness: -2, decay: 1.5 } });   // a preset object
```

## Standalone instruments

`new Piano()`, `new Violin()`, `new Strings()`, `new Flute()`, `new Trumpet()` … (or
`new Instrument(id | def, options)`) create their own `Synth` and are a `Part` on it, with the
engine's `start`, `stop`, `close`, `render`, `renderToFile` and `currentTime`. They take the
`Synth` options and the part's `preset` and `params`. `new ChurchOrgan(options)` is the same for
an `Organ`.

```ts
const piano = new Piano({ preset: 'mellow' });
await piano.start();
piano.sustain(true).play(['C4', 'E4', 'G4'], { duration: 2 });
piano.synth.add('cellos');                // more instruments on the same engine
```

## Notes

`noteNumber('F#3')` → 54, `noteName(61)` → `'C#4'`, `noteFrequency('A4')` → 440,
`chord('C4')`, `chord('A3', 'm7')`, `chord('F#3m7b5')`.
