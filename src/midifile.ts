import { MidiError } from './errors.js';

/**
 * Minimal Standard MIDI File (SMF type 0/1) reader → time-ordered events in seconds.
 */

export type MidiFileEvent =
  | { type: 'noteOn'; time: number; track: number; channel: number; note: number; velocity: number }
  | { type: 'noteOff'; time: number; track: number; channel: number; note: number }
  | { type: 'cc'; time: number; track: number; channel: number; controller: number; value: number }
  | { type: 'pitchBend'; time: number; track: number; channel: number; value: number }
  | { type: 'program'; time: number; track: number; channel: number; program: number };

type WithoutTime<T> = T extends unknown ? Omit<T, 'time'> : never;

export interface MidiFileData {
  /** Events sorted by time (seconds from the start). */
  events: MidiFileEvent[];
  /** Time of the last event, seconds. */
  duration: number;
  tracks: number;
  /** Track names (from meta events), by track index. */
  trackNames: string[];
  ticksPerBeat: number;
}

/** Parse a Standard MIDI File (throws {@link MidiError} if it is not one). */
export function parseMidiFile(data: Uint8Array): MidiFileData {
  let p = 0;
  const u32 = () => {
    const v = (data[p]! << 24) | (data[p + 1]! << 16) | (data[p + 2]! << 8) | data[p + 3]!;
    p += 4;
    return v >>> 0;
  };
  const u16 = () => {
    const v = (data[p]! << 8) | data[p + 1]!;
    p += 2;
    return v;
  };
  const vlq = () => {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = data[p++]!;
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return v;
  };
  const tag = () => String.fromCharCode(data[p]!, data[p + 1]!, data[p + 2]!, data[p + 3]!);
  if (tag() !== 'MThd') throw new MidiError('Not a MIDI file (missing MThd)');
  p += 4;
  const hlen = u32();
  const hstart = p;
  u16(); // format
  const ntracks = u16();
  const division = u16();
  p = hstart + hlen;
  if (division & 0x8000) throw new MidiError('SMPTE time division is not supported');
  const tpb = division;

  interface Raw { tick: number; track: number; order: number; ev: WithoutTime<MidiFileEvent> | { type: 'tempo'; usPerBeat: number } }
  const raw: Raw[] = [];
  const trackNames: string[] = [];
  let order = 0;
  for (let t = 0; t < ntracks && p < data.length; t++) {
    while (p < data.length && tag() !== 'MTrk') {
      p += 4;
      p += u32();
    }
    if (p >= data.length) break;
    p += 4;
    const len = u32();
    const end = p + len;
    let tick = 0;
    let status = 0;
    while (p < end) {
      tick += vlq();
      let b = data[p]!;
      if (b & 0x80) {
        status = b;
        p++;
      }
      const kind = status & 0xf0;
      const ch = status & 0x0f;
      if (status === 0xff) {
        const mt = data[p++]!;
        const ml = vlq();
        if (mt === 0x51 && ml === 3) {
          const us = (data[p]! << 16) | (data[p + 1]! << 8) | data[p + 2]!;
          raw.push({ tick, track: t, order: order++, ev: { type: 'tempo', usPerBeat: us } });
        } else if (mt === 0x03) {
          trackNames[t] = Buffer.from(data.subarray(p, p + ml)).toString('latin1');
        }
        p += ml;
        status = 0;
      } else if (status === 0xf0 || status === 0xf7) {
        p += vlq();
        status = 0;
      } else if (kind === 0x80 || kind === 0x90) {
        const note = data[p++]!;
        const vel = data[p++]!;
        const ev = kind === 0x90 && vel > 0
          ? { type: 'noteOn' as const, track: t, channel: ch, note, velocity: vel }
          : { type: 'noteOff' as const, track: t, channel: ch, note };
        raw.push({ tick, track: t, order: order++, ev });
      } else if (kind === 0xb0) {
        const controller = data[p++]!;
        const value = data[p++]!;
        raw.push({ tick, track: t, order: order++, ev: { type: 'cc', track: t, channel: ch, controller, value } });
      } else if (kind === 0xe0) {
        const lsb = data[p++]!;
        const msb = data[p++]!;
        raw.push({ tick, track: t, order: order++, ev: { type: 'pitchBend', track: t, channel: ch, value: (((msb << 7) | lsb) - 8192) / 8192 } });
      } else if (kind === 0xc0) {
        raw.push({ tick, track: t, order: order++, ev: { type: 'program', track: t, channel: ch, program: data[p++]! } });
      } else if (kind === 0xd0) {
        p += 1;
      } else if (kind === 0xa0) {
        p += 2;
      } else {
        // unknown running status — skip a byte to resync
        b = data[p++]!;
      }
    }
    p = end;
  }
  // note-offs before note-ons at the same tick so re-struck notes are not cut
  raw.sort((a, b) => a.tick - b.tick || rank(a) - rank(b) || a.order - b.order);
  const events: MidiFileEvent[] = [];
  let usPerBeat = 500000;
  let lastTick = 0;
  let time = 0;
  for (const r of raw) {
    time += ((r.tick - lastTick) * usPerBeat) / tpb / 1e6;
    lastTick = r.tick;
    if (r.ev.type === 'tempo') {
      usPerBeat = r.ev.usPerBeat;
      continue;
    }
    events.push({ ...(r.ev as WithoutTime<MidiFileEvent>), time } as MidiFileEvent);
  }
  return { events, duration: time, tracks: ntracks, trackNames, ticksPerBeat: tpb };
}

function rank(r: { ev: { type: string } }): number {
  return r.ev.type === 'tempo' ? 0 : r.ev.type === 'noteOff' ? 1 : r.ev.type === 'noteOn' ? 3 : 2;
}
