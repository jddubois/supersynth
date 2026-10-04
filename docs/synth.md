# Synth and Part

## `new Synth(options?)`

| Option | Default | |
|---|---|---|
| `sampleRate` | device rate (48000 without a device) | Hz |
| `backend` | `'auto'` | `'coreaudio' \| 'wasapi' \| 'alsa' \| 'jack' \| 'pulseaudio' \| 'pipewire'` |
| `reverb` | `'auto'` | preset name, `ReverbOptions`, `false`, or `'auto'` (room of the first instrument) |
| `volume` | `0.5` | master volume 0–1 |
| `maxVoices` | `192` | quietest/oldest voices are stolen beyond this |
| `bufferSize` | device default | frames per audio callback |
| `modelsDir` | package `models/` | where `.ssm` models are loaded from |

### Members

| | |
|---|---|
| `add(id \| def, { preset, params, channel })` | add an instrument → `Part` |
| `organ(id \| { instrument, preset, presets, tremulant, wind })` | a church organ → `Organ` |
| `part(channel)`, `remove(part)` | |
| `start()` / `stop()` / `close()` | real-time output |
| `render(seconds)` | offline → `{ sampleRate, left, right }` |
| `renderToFile(path, seconds, { bitDepth, mono })` | offline → WAV |
| `renderMidi(file, options)` / `playMidi(file, options)` | Standard MIDI Files |
| `setReverb(preset \| options \| false)`, `setVolume(v)` | |
| `allNotesOff()`, `panic()` | |
| `enableMidi(device?, { route })`, `listMidiDevices()`, `listAudioBackends()` | hardware MIDI |
| `currentTime` | engine clock, seconds — schedule with `{ at: synth.currentTime + x }` |
| `activeVoices`, `cpuLoad`, `sampleRate`, `isRunning` | |
| `Synth.instruments()` | catalog with presets |

Events: `'midi'` (`MidiEvent`) when hardware MIDI is enabled.

## `Part`

Returned by `synth.add`. One instrument on one channel (MIDI channel = `index + 1`).

| | |
|---|---|
| `play(notes, { velocity, duration, at, delay })` | notes: `'C4'`, `60`, or arrays (chords) |
| `sequence(steps, { bpm, at, velocity, legato })` | `[note, beats]` or `{ note, beats, velocity }`; returns seconds |
| `noteOn(note, velocity?, { at })` / `noteOff(note, { at })` | |
| `sustain(down)`, `pitchBend(-1…1)`, `modWheel(0…1)`, `expression(0…1)`, `cc(n, v)` | |
| `set(params, { at })`, `get(name)`, `reset()` | see [parameters.md](parameters.md) |
| `usePreset(name, extraParams?)`, `presets`, `preset` | |
| `allNotesOff()` | |

## Standalone instruments

`new Piano()`, `new Violin()`, `new Strings()`, `new Flute()`, `new Trumpet()`, `new ChurchOrgan()` …
(or `new Instrument(id, options)`) create their own `Synth` with one part — the quickest way to play:

```ts
const piano = new Piano({ preset: 'mellow' });
await piano.start();
piano.play(['C4', 'E4', 'G4'], { duration: 2 });
```

## Notes

`noteNumber('F#3')` → 54, `noteName(61)` → `'C#4'`, `noteFrequency('A4')` → 440,
`chord('C4')`, `chord('A3', 'm7')`, `chord('F#3m7b5')`.
