export { Synth } from './Synth.js';
export { Organ } from './instruments/organ.js';
export { Piano } from './instruments/piano.js';
export { Strings, Violin, Cello } from './instruments/strings.js';
export { Guitar, ElectricGuitar, BassGuitar, Harp, Harpsichord } from './instruments/guitar.js';
export { Flute, Clarinet, Saxophone, Oboe } from './instruments/woodwind.js';
export { Trumpet, FrenchHorn, Trombone } from './instruments/brass.js';
export { SynthLead } from './instruments/electronic.js';
export { HiHat, Marimba } from './instruments/percussion.js';
export { AudioBackendError, MidiError, SupersynthError } from './errors.js';
export type {
  BackendKind,
  InstrumentConfig,
  MidiEvent,
  NoteOnOptions,
  NotePlayer,
  OrganBreakPoint,
  OrganConfig,
  OrganPreset,
  OrganStop,
  OscillatorTemplate,
  ReverbConfig,
  SynthConfig,
  VelocityCurve,
  VoiceConfig,
  WaveformKind,
} from './types.js';
export { isBreakingStop } from './types.js';
