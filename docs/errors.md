# Errors

| Class | Thrown when |
|---|---|
| `SupersynthError` | a name is unknown — instrument, organ, preset, stop, division, parameter (the message lists the valid ones) — or a model or the native engine is missing (an organ whose package is not installed: "The organ 'friesach' needs its models: npm install supersynth-organ-friesach"), all 32 channels are in use, `render()` is called during real-time output |
| `AudioBackendError` | `start()` cannot open the audio device (e.g. unsupported sample rate — omit `sampleRate` to use the device's) |
| `MidiError` | `enableMidi()` finds no device or cannot connect; a MIDI file cannot be parsed |

`AudioBackendError` and `MidiError` extend `SupersynthError`. Malformed values — a bad note
name, a MIDI channel outside 1–16, a parameter of the wrong type — throw `RangeError` or
`TypeError`.
