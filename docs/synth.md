# API

## The model

| | |
|---|---|
| `Synth` | the engine: clock, real-time output or offline rendering, master volume and room, MIDI |
| `Instrument` | an instrument playing in the synth, on its own channel — `synth.add(id, { preset, params })` |
| `Organ`, `Division` | a church organ and its four keyboards (great, swell, positive, pedal) — `synth.addOrgan(id, { preset })`; see [organ.md](organ.md) |
| `InstrumentDef`, `OrganDef` | instruments and organs as plain configuration objects; `INSTRUMENTS` and `ORGANS` hold the built-in ones by id |
| `Playable` | anything you play notes on: an `Instrument` or a `Division` |

Six rules hold everywhere:

1. **Playing.** Instruments and divisions are `Playable`: `noteOn`, `noteOff`, `play`,
   `sequence`, `expression`, `allNotesOff`.
2. **Time.** Every method that makes or changes sound takes `{ at }` (seconds on
   `synth.currentTime`) or `{ delay }` (seconds from now) as its last argument; without either
   it acts now (`panic()` and `remove()` always act at once). That includes presets, stops, couplers, the tremulant, volume and room, so a
   whole piece — registration changes included — can be scheduled and rendered in one go.
   Schedule changes in time order: methods that report state (`drawn()`, `activePreset()`, …)
   report what was last asked for, including changes scheduled for later.
3. **`set(settings)`** changes some of an object's settings and leaves the rest:
   `synth.set({ volume, reverb })`, `instrument.set({ brightness, … })`,
   `organ.set({ tremulant, wind })`, `division.set({ stops, couple })`. The settings are those
   the object can be created with.
4. **Presets** work the same on instruments and organs: `preset(name | object)`, `presets()`,
   `savePreset(name)`, `current()`, `activePreset()`.
5. **MIDI channels** are 1–16, and nothing plays from a MIDI keyboard until it is given a
   channel: `instrument.midi(1)`, `organ.midi({ great: 1, pedal: 2 })`.
6. **Properties are read-only state** (`synth.currentTime`, `instrument.definition`);
   everything you change, and every list, is a method. Methods that change something return
   the object, so calls chain: `synth.add('grand-piano').preset('mellow').midi(1)`.

## `new Synth(options?)`

| Option | Default | |
|---|---|---|
| `sampleRate` | device rate (48000 without a device) | Hz |
| `backend` | `'auto'` | `'coreaudio' \| 'wasapi' \| 'alsa' \| 'jack' \| 'pulseaudio' \| 'pipewire'` |
| `reverb` | `'auto'` | preset name, `ReverbOptions`, `false`, or `'auto'` (the room suggested by the first instrument or organ added) |
| `volume` | `0.5` | master volume 0–1 |
| `quality` | `'high'` | partials per note: `'high'` 512, `'balanced'` 128, `'eco'` 32 (small boards such as a Raspberry Pi) |
| `maxVoices` | `192` | quietest/oldest voices are stolen beyond this |
| `bufferSize` | device default | frames per audio callback |
| `modelsDir` | package `models/` | where `.ssm` models are loaded from |

| Method | |
|---|---|
| `add(id \| def, { preset, params })` | add an instrument → `Instrument` |
| `addOrgan(id \| def, { preset, presets, tremulant, wind })` | add a church organ → `Organ` |
| `instruments()`, `remove(instrument \| organ)` | the instruments added; remove one, or an organ |
| `set({ volume, reverb }, { at })` | master volume and room, see [parameters.md](parameters.md#reverb) |
| `start()` / `stop()` / `close()` | real-time output |
| `render(seconds)` | offline → `{ sampleRate, left, right, duration }` |
| `renderToFile(path, seconds, { bitDepth, mono })` | offline → WAV |
| `renderMidi(file, options)` / `playMidi(file, options)` | Standard MIDI Files, see [midi.md](midi.md) |
| `allNotesOff({ at })`, `panic()` | release every note; silence everything at once |
| `enableMidi(device?, { route })`, `disableMidi()` | hardware MIDI input, see [midi.md](midi.md) |
| `listMidiDevices()`, `listAudioBackends()` | |

| Property | |
|---|---|
| `currentTime` | engine clock, seconds — schedule with `{ at: synth.currentTime + x }` |
| `sampleRate`, `activeVoices`, `cpuLoad`, `isRunning` | |

Events: `'midi'` (`MidiEvent`) for every message once hardware MIDI is enabled.

## `Instrument`

Returned by `synth.add`: one instrument on one channel.

| Method | |
|---|---|
| `play(notes, { velocity, duration, at, delay })` | notes: `'C4'`, `60`, or arrays (chords) |
| `sequence(steps, { bpm, velocity, legato, at, delay })` | `[note, beats]` or `{ note, beats, velocity }`; `null` is a rest; returns seconds |
| `noteOn(note, velocity?, { at })`, `noteOff(note, { at })`, `allNotesOff()` | |
| `sustain(down)`, `pitchBend(-1…1)`, `modWheel(0…1)`, `expression(0…1)`, `cc(n, v)` | controllers |
| `set(params, { at })`, `get(name)`, `params()` | sound parameters, see [parameters.md](parameters.md) |
| `preset(name \| preset, { at })`, `presets()`, `savePreset(name, preset?)`, `current()`, `activePreset()` | presets |
| `midi(channel?)` | play it from a MIDI keyboard on channel 1–16 (every channel if left out) |

| Property | |
|---|---|
| `definition` | the `InstrumentDef` it plays (`range`, `presets`, …) |
| `synth` | the synth it plays in |

### Presets

A preset is a set of parameters, and optionally layers, applied together; each instrument's
presets are listed in [instruments.md](instruments.md). Applying one replaces every parameter;
`preset('default')` returns to the instrument as recorded. `activePreset()` names the preset in
use until a parameter is changed by hand (parameters given with the preset to `synth.add` count
as part of it):

```ts
const piano = synth.add('grand-piano', { preset: 'mellow', params: { volume: -3 } });
piano.activePreset();                     // 'mellow'
piano.set({ release: 2 });                // now undefined
piano.savePreset('mine');                 // the sound as it is now
piano.preset('bright').preset('mine', { at: 10 });
piano.preset({ params: { brightness: -2, decay: 1.5 } });   // a preset object
```

## Notes

`noteNumber('F#3')` → 54, `noteName(61)` → `'C#4'`, `noteFrequency('A4')` → 440,
`chord('C4')`, `chord('A3', 'm7')`, `chord('F#3m7b5')`.
