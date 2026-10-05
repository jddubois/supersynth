import { MidiError } from './errors.js';

/**
 * Minimal Standard MIDI File (SMF format 0/1) reader → time-ordered events in seconds.
 */

/** A MIDI file event. `channel` is 1–16; `track` is the 0-based index of its track. */
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

/**
 * Parse a Standard MIDI File: format 0 or 1, timed in ticks per beat. Throws {@link MidiError}
 * if it is not one, or is truncated or corrupt.
 */
export function parseMidiFile(data: Uint8Array): MidiFileData {
  let p = 0;
  /** End of what may be read: the file, or the track being read. */
  let limit = data.length;
  const need = (n: number, what: string) => {
    if (p + n > limit) {
      throw new MidiError(`Corrupt MIDI file: ${what} at byte ${p} runs past the end of the ${limit === data.length ? 'file' : 'track'}`);
    }
  };
  const u8 = (what: string) => {
    need(1, what);
    return data[p++]!;
  };
  const u16 = (what: string) => {
    need(2, what);
    const v = (data[p]! << 8) | data[p + 1]!;
    p += 2;
    return v;
  };
  const u32 = (what: string) => {
    need(4, what);
    const v = ((data[p]! << 24) | (data[p + 1]! << 16) | (data[p + 2]! << 8) | data[p + 3]!) >>> 0;
    p += 4;
    return v;
  };
  const tag = (what: string) => {
    need(4, what);
    const v = String.fromCharCode(data[p]!, data[p + 1]!, data[p + 2]!, data[p + 3]!);
    p += 4;
    return v;
  };
  /** Variable-length quantity: at most 4 bytes. */
  const vlq = (what: string) => {
    const at = p;
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = u8(what);
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
    throw new MidiError(`Corrupt MIDI file: ${what} at byte ${at} is longer than 4 bytes`);
  };
  /** A data byte (0–127) of a channel message. */
  const data7 = () => {
    const b = u8('event data');
    if (b & 0x80) throw new MidiError(`Corrupt MIDI file: status byte 0x${b.toString(16)} at byte ${p - 1} where a data byte was expected`);
    return b;
  };

  if (data.length < 4 || tag('header') !== 'MThd') throw new MidiError('Not a MIDI file (missing MThd)');
  const hlen = u32('header length');
  if (hlen < 6) throw new MidiError(`Corrupt MIDI file: header length ${hlen} (at least 6)`);
  need(hlen, 'header');
  const hstart = p;
  const format = u16('format');
  const ntracks = u16('track count');
  const division = u16('time division');
  p = hstart + hlen;
  if (format === 2) throw new MidiError('MIDI file format 2 (independent sequences) is not supported, only formats 0 and 1');
  if (format > 2) throw new MidiError(`Unknown MIDI file format ${format}`);
  if (division & 0x8000) throw new MidiError('SMPTE time division is not supported, only ticks per beat');
  if (division === 0) throw new MidiError('Corrupt MIDI file: 0 ticks per beat');
  const tpb = division;

  interface Raw { tick: number; track: number; order: number; ev: WithoutTime<MidiFileEvent> | { type: 'tempo'; usPerBeat: number } }
  const raw: Raw[] = [];
  const trackNames: string[] = [];
  let order = 0;
  for (let t = 0; t < ntracks; t++) {
    // skip chunks that are not tracks
    let len: number;
    for (;;) {
      if (p >= data.length) throw new MidiError(`Truncated MIDI file: ${t} of ${ntracks} tracks found`);
      const id = tag('chunk type');
      len = u32('chunk length');
      need(len, `${id} chunk of ${len} bytes`);
      if (id === 'MTrk') break;
      p += len;
    }
    const end = p + len;
    limit = end;
    let tick = 0;
    let running = 0; // running status: the status byte of the last channel message
    while (p < end) {
      tick += vlq('delta time');
      let status = u8('event');
      if (status & 0x80) {
        if (status < 0xf0) running = status;
      } else {
        if (!running) throw new MidiError(`Corrupt MIDI file: data byte at byte ${p - 1} without a running status`);
        status = running;
        p--;
      }
      if (status === 0xff) {
        const mt = u8('meta event type');
        const ml = vlq('meta event length');
        need(ml, 'meta event');
        if (mt === 0x51 && ml === 3) {
          const us = (data[p]! << 16) | (data[p + 1]! << 8) | data[p + 2]!;
          if (us > 0) raw.push({ tick, track: t, order: order++, ev: { type: 'tempo', usPerBeat: us } });
        } else if (mt === 0x03) {
          trackNames[t] = Buffer.from(data.subarray(p, p + ml)).toString('latin1');
        }
        p += ml;
        running = 0; // meta and sysex events cancel running status
        if (mt === 0x2f) break; // end of track
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        const sl = vlq('sysex length');
        need(sl, 'sysex event');
        p += sl;
        running = 0;
        continue;
      }
      if (status >= 0xf0) throw new MidiError(`Corrupt MIDI file: unexpected status byte 0x${status.toString(16)} at byte ${p - 1}`);
      const kind = status & 0xf0;
      const ch = (status & 0x0f) + 1;
      if (kind === 0x80 || kind === 0x90) {
        const note = data7();
        const vel = data7();
        const ev = kind === 0x90 && vel > 0
          ? { type: 'noteOn' as const, track: t, channel: ch, note, velocity: vel }
          : { type: 'noteOff' as const, track: t, channel: ch, note };
        raw.push({ tick, track: t, order: order++, ev });
      } else if (kind === 0xb0) {
        const controller = data7();
        const value = data7();
        raw.push({ tick, track: t, order: order++, ev: { type: 'cc', track: t, channel: ch, controller, value } });
      } else if (kind === 0xe0) {
        const lsb = data7();
        const msb = data7();
        raw.push({ tick, track: t, order: order++, ev: { type: 'pitchBend', track: t, channel: ch, value: (((msb << 7) | lsb) - 8192) / 8192 } });
      } else if (kind === 0xc0) {
        raw.push({ tick, track: t, order: order++, ev: { type: 'program', track: t, channel: ch, program: data7() } });
      } else if (kind === 0xd0) {
        data7(); // channel pressure
      } else {
        data7(); // polyphonic key pressure
        data7();
      }
    }
    p = end;
    limit = data.length;
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
