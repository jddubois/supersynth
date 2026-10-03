export { Synth } from './Synth.js';
export type { SynthOptions, AddOptions, InstrumentInfo, MidiPlayOptions, MidiTarget, BackendKind } from './Synth.js';
export { Part, PARAM_DEFAULTS } from './Part.js';
export type { PlayOptions, TimeOptions, SequenceStep, SequenceOptions } from './scheduling.js';
export { Organ, Division } from './Organ.js';
export type { OrganOptions } from './Organ.js';
export {
  Instrument, Piano, UprightPiano, Harpsichord, Harp, Violin, Cello, Strings, Flute, Oboe, Clarinet,
  Bassoon, Saxophone, Trumpet, FrenchHorn, Trombone, Tuba, Marimba, Vibraphone, ChurchOrgan,
} from './instruments.js';
export type { InstrumentOptions } from './instruments.js';
// configurations (also importable on their own from 'supersynth/instruments' and 'supersynth/organs')
export * from './catalog/index.js';
export * from './organs/index.js';
export type { InstrumentParams, ReverbPreset, ReverbOptions } from './params.js';
export { noteNumber, noteName, noteFrequency, chord } from './notes.js';
export type { NoteLike } from './notes.js';
export { parseMidiFile } from './midifile.js';
export type { MidiFileData, MidiFileEvent } from './midifile.js';
export { writeWav, encodeWav } from './wav.js';
export type { AudioBuffer, WavOptions } from './wav.js';
export { AudioBackendError, MidiError, SupersynthError } from './errors.js';
export type { MidiEvent, NotePlayer } from './types.js';
