# Errors

| Class | Thrown when |
|---|---|
| `SupersynthError` | see the list below |
| `AudioBackendError` | `start()` can't open the audio device, for example because of an unsupported sample rate (leave out `sampleRate` to use the device's own) |
| `MidiError` | `enableMidi()` finds no device or can't connect, or a MIDI file can't be parsed (not a Standard MIDI File, truncated or corrupt, format 2, or SMPTE timing) |
| `AbortError` | `playMidi()` is stopped through its `signal` |

`AudioBackendError`, `MidiError` and `AbortError` all extend `SupersynthError`, and so does every
error coming from the native engine.

`SupersynthError` is thrown when:

- a name is unknown: an instrument, organ, preset, stop, division or parameter. The message
  lists the valid names.
- a model or the native engine is missing. For an organ whose package isn't installed, the
  message names it: "The organ 'friesach' needs its models: npm install @supersynth/organ-friesach".
- all 32 channels are in use, or the engine's event queue is full.
- `render()` is called while real-time output is running.
- an instrument or organ is used after `synth.remove()`, or the synth after `close()`. After
  `close()`, `add`, `set`, `start`, `render`, `renderMidi`, `playMidi` and `enableMidi` throw;
  stopping and silencing never do.
- a number isn't finite (NaN, ±Infinity, or not a number at all), or one that must be a whole
  number or above a limit isn't (`sampleRate`, `threads`, `tempo`, `transpose`, `speed`, `tail`,
  a controller number, `bitDepth`, …). The message names the argument.
- an instrument parameter is outside its range (`PARAMETER_RANGES`), or the master volume or a
  `releaseCulling` level is out of range. Nothing is changed.

A bad note name or note number, a chord that goes above the MIDI range, a MIDI channel outside
1–16 and a coupler octave other than −1, 0 or 1 throw `RangeError`.

Some values are clamped rather than rejected, because they usually come from continuous
controls: a velocity to 1–127, `pitchBend` to −1 … 1, `modulation` and `expression` to 0 … 1,
and `controlChange` values to 0 … 127. The engine also clamps `maxVoices` to 8–4096.

Every number is checked before it's sent to the engine, since a NaN in the engine would silence
it for good: `piano.pitchBend(NaN)` throws and sends nothing. A method that sends several events
(a chord, a sequence, a preset) checks all of them, and that they fit in the queue, before
sending the first one, so it either does everything or nothing.
