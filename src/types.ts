import type { Bytes } from './platform/platform.js';

/** A parsed MIDI input message (emitted as the `'midi'` event by {@link Synth}). */
export interface MidiEvent {
  type: 'noteOn' | 'noteOff' | 'cc' | 'programChange' | 'pitchBend' | 'unknown';
  /** MIDI channel, 1–16. */
  channel: number;
  note?: number;
  velocity?: number;
  controller?: number;
  value?: number;
  program?: number;
  /** Raw MIDI bytes (a Buffer in Node.js, a Uint8Array in a browser). */
  raw: Bytes;
}
