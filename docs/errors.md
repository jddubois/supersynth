# Errors

| Class | Thrown when |
|---|---|
| `SupersynthError` | a name is unknown — instrument, organ, preset, stop, division, parameter (the message lists the valid ones) — or a model or the native engine is missing (an organ whose package is not installed: "The organ 'friesach' needs its models: npm install @supersynth/organ-friesach"), all 32 channels are in use, the engine's event queue is full, `render()` is called during real-time output, an instrument or organ is used after `synth.remove()`, or a synth after `close()`; a number is not finite (NaN, ±Infinity, not a number) or out of its range — the message names the argument |
| `AudioBackendError` | `start()` cannot open the audio device (e.g. unsupported sample rate — omit `sampleRate` to use the device's) |
| `MidiError` | `enableMidi()` finds no device or cannot connect; a MIDI file cannot be parsed (not a Standard MIDI File, truncated or corrupt, format 2, SMPTE timing) |
| `AbortError` | `playMidi()` is stopped by its `signal` |

`AudioBackendError`, `MidiError` and `AbortError` extend `SupersynthError`, and so does every
error from the native engine. A bad note name or note number and a MIDI channel outside 1–16
throw `RangeError`.

Every number the API passes to the engine is checked first: a NaN reaching the engine would
silence it for good, so `piano.pitchBend(NaN)` throws and nothing is sent. A method that sends
several events (a chord, a sequence, a preset) checks everything, and that the events fit in
the queue, before it sends the first, so it does all of it or nothing.
