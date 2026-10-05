/** Builders for Standard MIDI Files in tests (no native code). */

export const vlq = (n: number): number[] => {
  const out = [n & 0x7f];
  while ((n >>>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
};

export const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
export const u16 = (n: number): number[] => [(n >>> 8) & 255, n & 255];

/** Track bytes (events with their delta times), ended by an end-of-track meta event. */
export const END_OF_TRACK = [0, 0xff, 0x2f, 0];

/** A track chunk; `length` overrides the length field. */
export function trackChunk(bytes: number[], length = bytes.length): number[] {
  return [0x4d, 0x54, 0x72, 0x6b, ...u32(length), ...bytes];
}

/** A whole file from track chunks. */
export function smf(chunks: number[][], { format = chunks.length > 1 ? 1 : 0, division = 480, tracks = chunks.length } = {}): Uint8Array {
  return Uint8Array.from([0x4d, 0x54, 0x68, 0x64, ...u32(6), ...u16(format), ...u16(tracks), ...u16(division), ...chunks.flat()]);
}

/** A format-0 file (480 ticks per beat, 120 bpm) of `[delta ticks, status, data1, data2]` events. */
export function midiFile(events: [number, number, number, number][]): Uint8Array {
  const body = events.flatMap(([dt, st, a, b]) => [...vlq(dt), st, a, b]).concat(END_OF_TRACK);
  return smf([trackChunk(body)]);
}

/** A tempo meta event (microseconds per beat). */
export const tempo = (dt: number, usPerBeat: number): number[] => [...vlq(dt), 0xff, 0x51, 3, (usPerBeat >> 16) & 255, (usPerBeat >> 8) & 255, usPerBeat & 255];
