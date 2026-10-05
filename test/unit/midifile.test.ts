import { readFileSync } from 'node:fs';
import path from 'node:path';

import { MidiError } from '../../src/errors.js';
import { parseMidiFile } from '../../src/midifile.js';
import { END_OF_TRACK, midiFile, smf, tempo, trackChunk, u32, vlq } from '../smf.js';

/** Files that are not MIDI, truncated or corrupt. */
const BAD: [string, Uint8Array][] = [
  ['not MIDI', Uint8Array.from([1, 2, 3, 4])],
  ['empty', new Uint8Array(0)],
  ['header only', Uint8Array.from([0x4d, 0x54, 0x68, 0x64, ...u32(6), 0, 0])],
  ['short header length', Uint8Array.from([0x4d, 0x54, 0x68, 0x64, ...u32(2), 0, 0])],
  // a track claiming 1 MB that has 4 bytes
  ['overlong track', smf([trackChunk([0, 0x90, 60, 100], 1 << 20)])],
  ['0xFFFFFFFF track', smf([trackChunk([0, 0x90, 60, 100], 0xffffffff)])],
  ['event cut short', smf([trackChunk([0, 0x90, 60])])],
  ['meta past the track', smf([trackChunk([0, 0xff, 0x01, 50, 1, 2])])],
  ['sysex past the track', smf([trackChunk([0, 0xf0, 0x7f, 1])])],
  ['5-byte VLQ', smf([trackChunk([0x81, 0x81, 0x81, 0x81, 0x01, 0x90, 60, 100])])],
  ['missing track', smf([trackChunk([0, 0x90, 60, 100, ...END_OF_TRACK])], { tracks: 2 })],
  ['data byte without status', smf([trackChunk([0, 60, 100, ...END_OF_TRACK])])],
  ['status byte as data', smf([trackChunk([0, 0x90, 0x90, 100, ...END_OF_TRACK])])],
  ['system common message', smf([trackChunk([0, 0xf2, 0, 0, ...END_OF_TRACK])])],
];

const bwv532 = () => readFileSync(path.join(process.cwd(), 'examples', 'jsbwv532.mid'));

describe('MIDI file parser', () => {
  test('a real file', () => {
    const midi = parseMidiFile(bwv532());
    expect(midi.events.length).toBeGreaterThan(100);
    expect(midi.duration).toBeGreaterThan(10);
    for (const e of midi.events) {
      expect(e.channel).toBeGreaterThanOrEqual(1);
      expect(e.channel).toBeLessThanOrEqual(16);
      if (e.type === 'noteOn' || e.type === 'noteOff') expect(Number.isInteger(e.note)).toBe(true);
    }
    expect(midi.events.every((e, i, a) => i === 0 || a[i - 1]!.time <= e.time)).toBe(true);
  });

  test('channels are 1-16 and tracks 0-based', () => {
    const midi = parseMidiFile(midiFile([[0, 0x90, 60, 100], [0, 0x9f, 62, 90], [480, 0x80, 60, 0], [0, 0x8f, 62, 0]]));
    expect(midi.events.map((e) => [e.type, e.channel, e.track])).toEqual([
      ['noteOn', 1, 0], ['noteOn', 16, 0], ['noteOff', 1, 0], ['noteOff', 16, 0],
    ]);
    expect(midi.events[2]!.time).toBeCloseTo(0.5);
  });

  test('running status, including note-on with velocity 0 as note-off', () => {
    const body = [0, 0x90, 60, 100, 0, 64, 100, ...vlq(480), 60, 0, 0, 64, 0, 0, 0xb0, 7, 100, 0, 10, 64, ...END_OF_TRACK];
    const midi = parseMidiFile(smf([trackChunk(body)]));
    expect(midi.events.map((e) => e.type)).toEqual(['noteOn', 'noteOn', 'noteOff', 'noteOff', 'cc', 'cc']);
    const ccs = midi.events.filter((e) => e.type === 'cc');
    expect(ccs.map((e) => (e.type === 'cc' ? [e.controller, e.value] : []))).toEqual([[7, 100], [10, 64]]);
  });

  test('sysex and meta events are skipped; meta and sysex cancel running status', () => {
    const body = [
      0, 0xff, 0x03, 5, ...Buffer.from('Organ'), // track name
      0, 0xff, 0x01, 3, 1, 2, 3, // text
      0, 0xf0, 4, 0x7e, 0x7f, 0x09, 0xf7, // sysex
      0, 0xf7, 2, 0x01, 0x02, // escape
      0, 0xff, 0x7f, ...vlq(200), ...new Array(200).fill(0x90), // long sequencer-specific meta
      0, 0x91, 60, 100,
      ...vlq(480), 0x81, 60, 0,
      ...END_OF_TRACK,
    ];
    const midi = parseMidiFile(smf([trackChunk(body)]));
    expect(midi.trackNames).toEqual(['Organ']);
    expect(midi.events.map((e) => [e.type, e.channel])).toEqual([['noteOn', 2], ['noteOff', 2]]);
    // a data byte right after a meta event has no running status to use
    const bad = [0, 0x90, 60, 100, 0, 0xff, 0x01, 1, 65, 0, 60, 0, ...END_OF_TRACK];
    expect(() => parseMidiFile(smf([trackChunk(bad)]))).toThrow(MidiError);
  });

  test('tempo changes mid-file, in the tempo track of a format-1 file', () => {
    const tempoTrack = [...tempo(0, 500000), ...tempo(960, 250000), ...END_OF_TRACK];
    const notes = [0, 0x90, 60, 100, ...vlq(960), 0x80, 60, 0, 0, 0x90, 62, 100, ...vlq(480), 0x80, 62, 0, ...END_OF_TRACK];
    const midi = parseMidiFile(smf([trackChunk(tempoTrack), trackChunk(notes)]));
    expect(midi.tracks).toBe(2);
    expect(midi.events.map((e) => [e.type, e.track, +e.time.toFixed(6)])).toEqual([
      ['noteOn', 1, 0], ['noteOff', 1, 1], ['noteOn', 1, 1], ['noteOff', 1, 1.25],
    ]);
    expect(midi.duration).toBeCloseTo(1.25);
  });

  test('format 1: tracks are merged in time order, note-offs before note-ons at the same tick', () => {
    const a = [0, 0x90, 60, 100, ...vlq(480), 0x80, 60, 0, ...END_OF_TRACK];
    const b = [...vlq(480), 0x91, 60, 90, ...vlq(240), 0x81, 60, 0, ...END_OF_TRACK];
    const c = [...vlq(240), 0xb2, 64, 127, ...END_OF_TRACK];
    const midi = parseMidiFile(smf([trackChunk(a), trackChunk(b), trackChunk(c)]));
    expect(midi.events.map((e) => [e.type, e.track, e.channel, e.time])).toEqual([
      ['noteOn', 0, 1, 0], ['cc', 2, 3, 0.25], ['noteOff', 0, 1, 0.5], ['noteOn', 1, 2, 0.5], ['noteOff', 1, 2, 0.75],
    ]);
  });

  test('a zero-length note keeps its note-off after its note-on; a re-struck note is ended first', () => {
    // tick 0: C4 on; tick 480: C4 on (re-struck, written before the note-off ending the first),
    // C4 off, E4 on and off (zero length, as drum and notation exports write them)
    const body = [0, 0x90, 60, 100, ...vlq(480), 0x90, 60, 90, 0, 0x80, 60, 0, 0, 0x90, 64, 80, 0, 0x80, 64, 0, ...vlq(480), 0x80, 60, 0, ...END_OF_TRACK];
    const midi = parseMidiFile(smf([trackChunk(body)], { tracks: 1, format: 0 }));
    expect(midi.events.map((e) => [e.type, 'note' in e ? e.note : 0, e.time])).toEqual([
      ['noteOn', 60, 0], ['noteOff', 60, 0.5], ['noteOn', 60, 0.5], ['noteOn', 64, 0.5], ['noteOff', 64, 0.5], ['noteOff', 60, 1],
    ]);
    // a trailing tempo change is not part of the music
    const tempoAfter = parseMidiFile(smf([trackChunk([0, 0x90, 60, 100, ...vlq(480), 0x80, 60, 0, ...tempo(480, 400000), ...END_OF_TRACK])], { tracks: 1, format: 0 }));
    expect(tempoAfter.duration).toBeCloseTo(0.5);
  });

  test('chunks that are not tracks are skipped', () => {
    const alien = [0x58, 0x58, 0x58, 0x58, ...u32(3), 1, 2, 3];
    const midi = parseMidiFile(smf([alien, trackChunk([0, 0x90, 60, 1, ...END_OF_TRACK])], { tracks: 1, format: 0 }));
    expect(midi.events).toHaveLength(1);
  });

  test('SMPTE time, format 2 and 0 ticks per beat are rejected', () => {
    const track = trackChunk([0, 0x90, 60, 100, ...END_OF_TRACK]);
    expect(() => parseMidiFile(smf([track], { division: 0xe728 }))).toThrow(/SMPTE/);
    expect(() => parseMidiFile(smf([track], { format: 2 }))).toThrow(/format 2/);
    expect(() => parseMidiFile(smf([track], { format: 7 }))).toThrow(MidiError);
    expect(() => parseMidiFile(smf([track], { division: 0 }))).toThrow(/0 ticks/);
  });

  test.each(BAD)('%s: MidiError', (_what, bytes) => {
    expect(() => parseMidiFile(bytes)).toThrow(MidiError);
  });

  test('every truncation of a real file parses or throws MidiError, never junk', () => {
    const full = bwv532();
    for (let n = 0; n < full.length; n += 97) {
      try {
        const midi = parseMidiFile(full.subarray(0, n));
        for (const e of midi.events) {
          if (e.type === 'noteOn' || e.type === 'noteOff') expect(e.note).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(e.time)).toBe(true);
        }
      } catch (e) {
        expect(e).toBeInstanceOf(MidiError);
      }
    }
  });

  test('a corrupt byte anywhere parses or throws MidiError', () => {
    const full = bwv532();
    for (let i = 0; i < full.length; i += 31) {
      const copy = Uint8Array.from(full);
      copy[i] = (copy[i]! + 0x85) & 0xff;
      try {
        parseMidiFile(copy);
      } catch (e) {
        expect(e).toBeInstanceOf(MidiError);
      }
    }
  });

});
