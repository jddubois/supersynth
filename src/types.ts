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
  /** Raw MIDI bytes. */
  raw: Buffer;
}
