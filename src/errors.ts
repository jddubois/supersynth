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
