# API

## Overview

| | |
|---|---|
| `Synth` | the engine: clock, real-time output or offline rendering, master volume and reverb, MIDI |
| `Instrument` | one instrument in the synth, on its own channel: `synth.add('violin', { preset, parameters })` |
| `Organ`, `Division` | a church organ and its four keyboards (great, swell, positive, pedal): `synth.add('burea', { preset })`; see [organ.md](organ.md) |
| `InstrumentDefinition`, `OrganDefinition` | instruments and organs as plain configuration objects. `INSTRUMENTS` and `ORGANS` hold the built-in ones by id, and `synth.add` accepts either an id or a definition |
| `Playable` | anything you can play notes on: an `Instrument` or a `Division` |

A few conventions apply across the whole API.

Instruments and divisions are both `Playable`, with `noteOn`, `noteOff`, `play`, `sequence`,
`expression` and `allNotesOff`.

Any method that makes or changes sound takes `{ at }` (seconds on `synth.currentTime`) or
`{ delay }` (seconds from now) as its last argument. Without either, it happens immediately;
`panic()` and `remove()` always act immediately. This covers presets, stops, couplers, the
tremulant, volume and reverb too, so you can schedule a whole piece, registration changes
included, and render it in one pass. Schedule changes in time order: methods that report state
(`drawn()`, `activePreset()`, …) return whatever was last requested, even if it's scheduled for
later.

`set(settings)` changes only the settings you pass and leaves the others alone:
`synth.set({ volume, reverb })`, `instrument.set({ brightness, … })`,
`organ.set({ tremulant, wind, noises })`, `division.set({ stops, couple })`. The settings are
the ones you can pass when you create the object.

Presets work the same way on instruments and organs: `preset(name | object)`, `presets()`,
`savePreset(name)`, `current()`, `activePreset()`.

MIDI channels are numbered 1–16. A MIDI keyboard doesn't play anything until you assign a channel:
`instrument.midi(1)`, `organ.midi({ great: 1, pedal: 2 })`.

Properties are read-only state (`synth.currentTime`, `instrument.definition`). Anything you can
change, and anything that returns a list, is a method. Methods that change something return the
object, so you can chain them: `synth.add('grand-piano').preset('mellow').midi(1)`. The exceptions
are `start()` and `enableMidi()`, which return a promise of the object, and `remove()` and
`close()`, which return nothing.

## `new Synth(options?)`

| Option | Default | |
|---|---|---|
| `sampleRate` | device rate (48000 without a device) | Hz |
| `backend` | `'auto'` | `'coreaudio' \| 'wasapi' \| 'alsa' \| 'jack' \| 'pulseaudio' \| 'pipewire'` |
| `reverb` | `'auto'` | preset name, `ReverbOptions`, `false`, or `'auto'` (the room suggested by the first instrument or organ added; it follows that instrument's presets until the reverb is set by hand) |
| `volume` | `0.5` | master volume 0–1 |
| `quality` | `'high'` | partials per note: `'high'` 512, `'balanced'` 128, `'eco'` 32 (small boards such as a Raspberry Pi) |
| `maxVoices` | `1024` | 8–4096; quietest/oldest voices are stolen beyond this (about 85 kB each; a full organ plenum playing a fast piece keeps several hundred pipes sounding in their release) |
| `bufferSize` | device default | frames per audio callback |
| `threads` | `'auto'` | CPU cores rendering audio, the audio thread included (1–16); `'auto'`: one per core but one, at most 8 (3 on a Raspberry Pi 5). Voices, and then the parts' effects, are shared out over the cores; the sound is bit-for-bit the same for any number. Offline `render()` uses them too |
| `releaseCulling` | `false` | opt-in for machines too slow for a large organ (it changes the sound): `{ floorDb?, belowMixDb?, hold? }` ends notes in their release early: below `floorDb` dBFS (−200 … 0), or more than `belowMixDb` dB (0 … 200) below both their keyboard's output and the whole output (followed with `hold: 'peak'`, held 1 s then falling 40 dB/s, or `'smooth'`, ~300 ms). Off, every recorded tail plays out in full. Also with `synth.set({ releaseCulling })`. See the README's Performance section for what it saves and changes |
| `overloadGuard` | `false` | opt-in, real-time output only. When buffers get close to their deadline (render time, smoothed over about 100 ms, above 85 % of the buffer's duration, or a late buffer on a busy engine), it ends the quietest released notes early with a 10 ms fade, just enough of them, by the measured cost per voice, for the next buffers to fit in 70 %. Only when no released notes are left does it fade out upper partials of the quietest notes past their attack. Held notes and attacks are never touched. It lets go once the load has stayed under 50 % for 0.5 s (and at least 1 s after it engaged), and the partials fade back in. When nothing is overloaded the output is identical to running without it, and offline rendering (`render()`, `renderMidi()`) is never guarded. Can also be changed with `synth.set({ overloadGuard })`, which takes effect immediately rather than being scheduled. See `guardActive` and `guardStats` below, and the README's Performance section |
| `modelsDirectory` | none | a directory searched first for `.ssm` models, laid out like `models/` (`organ/friesach/<stop>.ssm`; also `$SUPERSYNTH_MODELS_DIR`); then supersynth's own models and the installed organ packages |

| Method | |
|---|---|
| `add(id \| definition, options)` | add an instrument → `Instrument` (options `{ preset, parameters }`), or an organ → `Organ` (options `{ preset, presets, tremulant, wind, noises, preload }`; its other stops load in the background, see [organ.md](organ.md#loading)) |
| `ready()` | a promise: every organ added has loaded the models it loads in the background |
| `instruments()`, `remove(instrument \| organ)` | list the instruments and organs added, or remove one. Removing stops its notes, frees and clears its channels (including an organ's noise channel) and unloads models nothing else uses. Using it afterwards throws |
| `set({ volume, reverb, releaseCulling, overloadGuard }, { at })` | master volume (0–1) and room (see [parameters.md](parameters.md#reverb)), plus release culling and the overload guard as in the options above. Everything is checked before anything changes |
| `start()` / `stop()` / `close()` | real-time output; `close()` also releases every instrument, organ and model, and the synth cannot be used afterwards. Output alone does not keep Node.js running: a script that plays and then ends exits at once, so wait for the music (`idle()`) |
| `idle()` | a promise: everything sent so far has played out with real-time output running (no event waiting, no note sounding, the output below −60 dBFS). A held note, or an organ's blower and room noise, keeps it waiting; it resolves at once without output, and when output stops |
| `render(seconds)` | offline → `{ sampleRate, left, right, duration }` |
| `renderToFile(path, seconds, { bitDepth, mono, dither })` | offline → WAV: 16-bit (TPDF-dithered; digital silence stays 0) or 24-bit PCM, or 32-bit float; also returns the audio |
| `renderMidi(file, options)` / `playMidi(file, options)` | Standard MIDI Files, see [midi.md](midi.md) |
| `allNotesOff({ at })`, `panic()` | release every note; silence everything at once |
| `enableMidi(device?, { route })`, `disableMidi()` | hardware MIDI input, see [midi.md](midi.md) |
| `listMidiDevices()`, `listAudioBackends()` | |

| Property | |
|---|---|
| `currentTime` | the engine clock in seconds; schedule with `{ at: synth.currentTime + x }` |
| `sampleRate`, `activeVoices`, `cpuLoad`, `isRunning` | |
| `guardActive` | the overload guard (`overloadGuard`) is shedding load now |
| `guardStats` | `{ active, voicesShed, partialsReduced }`: what the overload guard has done so far (released notes it ended early, partials it faded out); all zero while it never had to act |
| `threads` | threads rendering audio (the audio thread included) |
| `engineError` | the engine's internal error, or `null`; after one the engine is silent until a new `Synth` is created |

Events: `'midi'` (`MidiEvent`) for every message once hardware MIDI is enabled; `'error'` for an
organ preset that fails on a MIDI program change (see [organ.md](organ.md#midi-keyboards)) and
for an organ's model that fails to load in the background (see [organ.md](organ.md#loading)).

### The event queue

Everything you schedule (notes, controllers, parameter, preset and stop changes) waits in the
engine's queue until it's rendered offline or played in real time. The queue holds 32,768
events; a note is two (key down and key up). A call that does not fit throws `SupersynthError`
before it sends anything, so a chord never leaves a key held. Offline, render (or, in real
time, let the output play) what is scheduled before scheduling more; `renderMidi` and
`playMidi` do this on their own.

## `Instrument`

Returned by `synth.add`: one instrument on one channel.

| Method | |
|---|---|
| `play(notes, { velocity, duration, at, delay })` | notes: `'C4'`, `60`, or arrays (chords); velocity 90 and 1 s by default |
| `sequence(steps, { tempo, velocity, legato, at, delay })` | `[note, beats]` or `{ note, beats, velocity }`; `null` is a rest; returns seconds. Defaults: 120 bpm, velocity 90, each key held 0.95 of its step |
| `noteOn(note, velocity = 90, { at })`, `noteOff(note, { at })`, `allNotesOff()` | |
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
`preset('default')` returns to the defaults (no adjustments). `activePreset()` names the preset in
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

`noteNumber('F#3')` → 54, `noteName(61)` → `'C#4'`, `noteFrequency('A4')` → 440
(`noteFrequency('A4', 415)` for another pitch standard), `chord('C4')`, `chord('A3', 'm7')`,
`chord('F#3m7b5')`.

## WAV files

`render()` returns an `AudioBuffer`, `{ sampleRate, left, right, duration }` (samples in −1 … 1).
`writeWav(path, audio, { bitDepth, mono, dither })` writes one to a file and `encodeWav(audio,
options)` returns the file as a `Buffer`, with the options of `renderToFile`: `bitDepth` 16
(default), 24 or 32 (float), `mono` (the average of both channels), `dither` (TPDF at 16 bits,
default on).
