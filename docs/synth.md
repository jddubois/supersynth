# API

## The model

| | |
|---|---|
| `Synth` | the engine: clock, real-time output or offline rendering, master volume and room, MIDI |
| `Instrument` | an instrument playing in the synth, on its own channel — `synth.add('violin', { preset, parameters })` |
| `Organ`, `Division` | a church organ and its four keyboards (great, swell, positive, pedal) — `synth.add('burea', { preset })`; see [organ.md](organ.md) |
| `InstrumentDefinition`, `OrganDefinition` | instruments and organs as plain configuration objects; `INSTRUMENTS` and `ORGANS` hold the built-in ones by id, and `synth.add` takes an id or a definition of either |
| `Playable` | anything you play notes on: an `Instrument` or a `Division` |

Six rules hold everywhere:

1. **Playing.** Instruments and divisions are `Playable`: `noteOn`, `noteOff`, `play`,
   `sequence`, `expression`, `allNotesOff`.
2. **Time.** Every method that makes or changes sound takes `{ at }` (seconds on
   `synth.currentTime`) or `{ delay }` (seconds from now) as its last argument; without either
   it acts now (`panic()` and `remove()` always act at once). That includes presets, stops,
   couplers, the tremulant, volume and room, so a whole piece — registration changes included —
   can be scheduled and rendered in one go.
   Schedule changes in time order: methods that report state (`drawn()`, `activePreset()`, …)
   report what was last asked for, including changes scheduled for later.
3. **`set(settings)`** changes some of an object's settings and leaves the rest:
   `synth.set({ volume, reverb })`, `instrument.set({ brightness, … })`,
   `organ.set({ tremulant, wind, noises })`, `division.set({ stops, couple })`. The settings are those
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
| `reverb` | `'auto'` | preset name, `ReverbOptions`, `false`, or `'auto'` (the room suggested by the first instrument or organ added; it follows that instrument's presets until the reverb is set by hand) |
| `volume` | `0.5` | master volume 0–1 |
| `quality` | `'high'` | partials per note: `'high'` 512, `'balanced'` 128, `'eco'` 32 (small boards such as a Raspberry Pi) |
| `maxVoices` | `192` | quietest/oldest voices are stolen beyond this |
| `bufferSize` | device default | frames per audio callback |
| `modelsDirectory` | none | a directory searched first for `.ssm` models, laid out like `models/` (`organ/friesach/<stop>.ssm`; also `$SUPERSYNTH_MODELS_DIR`); then supersynth's own models and the installed organ packages |

| Method | |
|---|---|
| `add(id \| definition, options)` | add an instrument → `Instrument` (options `{ preset, parameters }`), or an organ → `Organ` (options `{ preset, presets, tremulant, wind, noises, preload }`; its other stops load in the background, see [organ.md](organ.md#loading)) |
| `ready()` | a promise: every organ added has loaded the models it loads in the background |
| `instruments()`, `remove(instrument \| organ)` | the instruments and organs added; remove one (its notes stop, its channels — an organ's noise channel too — are freed and cleared, the models nothing else uses are unloaded; using it afterwards throws) |
| `set({ volume, reverb }, { at })` | master volume and room, see [parameters.md](parameters.md#reverb) |
| `start()` / `stop()` / `close()` | real-time output; `close()` also releases every instrument, organ and model, and the synth cannot be used afterwards |
| `render(seconds)` | offline → `{ sampleRate, left, right, duration }` |
| `renderToFile(path, seconds, { bitDepth, mono, dither })` | offline → WAV: 16-bit (TPDF-dithered; digital silence stays 0) or 24-bit PCM, or 32-bit float |
| `renderMidi(file, options)` / `playMidi(file, options)` | Standard MIDI Files, see [midi.md](midi.md) |
| `allNotesOff({ at })`, `panic()` | release every note; silence everything at once |
| `enableMidi(device?, { route })`, `disableMidi()` | hardware MIDI input, see [midi.md](midi.md) |
| `listMidiDevices()`, `listAudioBackends()` | |

| Property | |
|---|---|
| `currentTime` | engine clock, seconds — schedule with `{ at: synth.currentTime + x }` |
| `sampleRate`, `activeVoices`, `cpuLoad`, `isRunning` | |
| `engineError` | the engine's internal error, or `null`; after one the engine is silent until a new `Synth` is created |

Events: `'midi'` (`MidiEvent`) for every message once hardware MIDI is enabled; `'error'` for an
organ preset that fails on a MIDI program change (see [organ.md](organ.md#midi-keyboards)) and
for an organ's model that fails to load in the background (see [organ.md](organ.md#loading)).

### The event queue

Everything scheduled — notes, controllers, parameter, preset and stop changes — waits in the
engine's queue until it is rendered (offline) or played (real time). The queue holds 32,768
events; a note is two (key down and key up). A call that does not fit throws `SupersynthError`
before it sends anything, so a chord never leaves a key held. Offline, render (or, in real
time, let the output play) what is scheduled before scheduling more; `renderMidi` and
`playMidi` do this on their own.

## `Instrument`

Returned by `synth.add`: one instrument on one channel.

| Method | |
|---|---|
| `play(notes, { velocity, duration, at, delay })` | notes: `'C4'`, `60`, or arrays (chords) |
| `sequence(steps, { tempo, velocity, legato, at, delay })` | `[note, beats]` or `{ note, beats, velocity }`; `null` is a rest; returns seconds |
| `noteOn(note, velocity?, { at })`, `noteOff(note, { at })`, `allNotesOff()` | |
| `sustain(down)`, `pitchBend(-1…1)`, `modulation(0…1)`, `expression(0…1)`, `controlChange(n, v)` | controllers |
| `set(parameters, { at })`, `get(name)`, `parameters()` | sound parameters, see [parameters.md](parameters.md) |
| `preset(name \| preset, { at })`, `presets()`, `savePreset(name, preset?)`, `current()`, `activePreset()` | presets |
| `midi(channel?)` | play it from a MIDI keyboard on channel 1–16 (every channel if left out) |

| Property | |
|---|---|
| `definition` | the `InstrumentDefinition` it plays (`range`, `presets`, …) |
| `synth` | the synth it plays in |

### Presets

A preset is a set of parameters, and optionally layers, applied together; each instrument's
presets are listed in [instruments.md](instruments.md). Applying one replaces every parameter;
`preset('default')` returns to the instrument as recorded. `activePreset()` names the preset in
use until a parameter is changed by hand (parameters given with the preset to `synth.add` count
as part of it):

```ts
const piano = synth.add('grand-piano', { preset: 'mellow', parameters: { volume: -3 } });
piano.activePreset();                     // 'mellow'
piano.set({ release: 2 });                // now undefined
piano.savePreset('mine');                 // the sound as it is now
piano.preset('bright').preset('mine', { at: 10 });
piano.preset({ parameters: { brightness: -2, decay: 1.5 } });   // a preset object
```

## Notes

`noteNumber('F#3')` → 54, `noteName(61)` → `'C#4'`, `noteFrequency('A4')` → 440,
`chord('C4')`, `chord('A3', 'm7')`, `chord('F#3m7b5')`.
