# Errors

| Class | Thrown when |
|---|---|
| `SupersynthError` | base class; unknown instrument/stop/registration, missing model, engine errors |
| `AudioBackendError` | `start()` cannot open the audio device (e.g. unsupported sample rate — omit `sampleRate` to use the device's) |
| `MidiError` | `enableMidi()` finds no device or cannot connect |

Invalid arguments (bad note names, unknown parameters or presets) throw `RangeError`/`TypeError`
with the list of valid values.
