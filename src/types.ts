import type { Bytes } from './platform/platform.js';

/** A parsed MIDI input message (emitted as the `'midi'` event by {@link Synth}). */
export interface MidiEvent {
  type: 'noteOn' | 'noteOff' | 'cc' | 'programChange' | 'pitchBend' | 'unknown';
  /** MIDI channel, 1–16. */
  channel: number;
  /** The input it came from: the `device` given to {@link Synth.enableMidi} (left out for the
   *  input opened without one). */
  device?: string;
  note?: number;
  velocity?: number;
  controller?: number;
  value?: number;
  program?: number;
  /** Raw MIDI bytes (a Buffer in Node.js, a Uint8Array in a browser). */
  raw: Bytes;
}

/**
 * Where an instrument or an organ division listens for MIDI input ({@link Instrument.midi},
 * {@link Organ.midi}): a channel (1–16) of every input, or `{ device, channel }`: the input
 * opened with `synth.enableMidi(device)` (any case), on one channel or, without `channel`, on
 * all of them. Routes naming a device come first for that device's messages.
 */
export type MidiSource = number | { device?: string; channel?: number };

/** A MIDI input of the synth ({@link Synth.midiInputs}, and the `'midiDevice'` event). */
export interface MidiInputInfo {
  /** What was passed to {@link Synth.enableMidi} (left out for the input opened without). */
  device?: string;
  /** The device connected now (or last), as the system names it; `null` before the first. */
  name: string | null;
  /** The device is connected now. */
  connected: boolean;
}
