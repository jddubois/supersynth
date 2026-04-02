# Errors

All supersynth errors extend `SupersynthError`, which extends the built-in `Error`.

```ts
import { SupersynthError, AudioBackendError, MidiError } from 'supersynth';
```

## SupersynthError

Base class for all errors thrown by supersynth. You can catch this to handle any library error generically.

```ts
try {
  await synth.start();
  await synth.enableMidi('KeyStep');
} catch (err) {
  if (err instanceof SupersynthError) {
    console.error('supersynth error:', err.message);
  }
}
```

## AudioBackendError

Thrown by `synth.start()` when the audio backend fails to open. Common causes:

- No audio output device available
- Requested backend not supported on this platform (e.g., asking for `'jack'` on macOS)
- Another process holds exclusive access to the audio device (WASAPI on Windows)

```ts
import { AudioBackendError } from 'supersynth';

try {
  await synth.start();
} catch (err) {
  if (err instanceof AudioBackendError) {
    console.error('Could not open audio:', err.message);
    // Fall back to offline rendering
  }
}
```

## MidiError

Thrown by `synth.enableMidi()` when the MIDI device cannot be connected. Common causes:

- No MIDI devices found
- Device name substring match returned no results
- Device disconnected during connection

```ts
import { MidiError } from 'supersynth';

try {
  await synth.enableMidi('Arturia');
} catch (err) {
  if (err instanceof MidiError) {
    console.error('MIDI connection failed:', err.message);
    console.log('Available devices:', synth.listMidiDevices());
  }
}
```
