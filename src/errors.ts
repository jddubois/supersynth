export class SupersynthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupersynthError';
  }
}

export class AudioBackendError extends SupersynthError {
  constructor(message: string) {
    super(message);
    this.name = 'AudioBackendError';
  }
}

export class MidiError extends SupersynthError {
  constructor(message: string) {
    super(message);
    this.name = 'MidiError';
  }
}

/** {@link Synth.playMidi} stopped by its `signal`. */
export class AbortError extends SupersynthError {
  constructor(message = 'MIDI playback was aborted') {
    super(message);
    this.name = 'AbortError';
  }
}
