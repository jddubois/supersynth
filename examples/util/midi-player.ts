/**
 * Shared MIDI file playback utility.
 * Parses a MIDI file and schedules note events on a Synth instance.
 */
import { readFileSync } from 'node:fs';
import { parseMidi } from 'midi-file';
import type { NotePlayer } from '../../src/index.ts';

interface MidiFileEvent {
  type: string;
  absoluteTick: number;
  deltaTime: number;
  noteNumber?: number;
  velocity?: number;
  microsecondsPerBeat?: number;
  trackIndex: number;
}

interface TempoChange { tick: number; ms: number; tempo: number }

export interface PlayMidiOptions {
  /** Called once with total duration in seconds before playback begins. */
  onInfo?: (info: { path: string; tracks: number; ticksPerBeat: number; durationSec: number; noteCount: number }) => void;
  /**
   * Optional per-track player selector. When provided, note events from track
   * `trackIndex` are sent to the returned player rather than the default `player`.
   */
  synthForTrack?: (trackIndex: number) => NotePlayer;
}

/**
 * Parse a MIDI file and schedule all note events on `player`.
 *
 * @returns A promise that resolves when the last note has been scheduled and
 *          the tail (1.5s) has elapsed, i.e. when playback is complete.
 */
export async function playMidiFile(midiPath: string, player: NotePlayer, options: PlayMidiOptions = {}): Promise<void> {
  const { synthForTrack } = options;
  const midi = parseMidi(readFileSync(midiPath));
  const ticksPerBeat = midi.header.ticksPerBeat ?? 480;

  // Flatten all tracks into a single sorted event list with absolute tick times
  const events: MidiFileEvent[] = [];
  for (let ti = 0; ti < midi.tracks.length; ti++) {
    let absoluteTick = 0;
    for (const event of midi.tracks[ti] as MidiFileEvent[]) {
      absoluteTick += event.deltaTime;
      events.push({ ...event, absoluteTick, trackIndex: ti });
    }
  }
  events.sort((a, b) => a.absoluteTick - b.absoluteTick || (a.type === 'setTempo' ? -1 : 0));

  // Build tempo map for accurate tick → ms conversion
  const tempoMap: TempoChange[] = [{ tick: 0, ms: 0, tempo: 500000 }];
  for (const e of events) {
    if (e.type === 'setTempo' && e.microsecondsPerBeat != null) {
      const last = tempoMap.at(-1)!;
      const msPerTick = last.tempo / ticksPerBeat / 1000;
      const ms = last.ms + (e.absoluteTick - last.tick) * msPerTick;
      tempoMap.push({ tick: e.absoluteTick, ms, tempo: e.microsecondsPerBeat });
    }
  }

  function tickToMs(tick: number): number {
    let tc = tempoMap[0]!;
    for (const t of tempoMap) {
      if (t.tick <= tick) tc = t;
      else break;
    }
    return tc.ms + (tick - tc.tick) * (tc.tempo / ticksPerBeat / 1000);
  }

  const totalMs = tickToMs(Math.max(...events.map((e) => e.absoluteTick)));

  let scheduledNotes = 0;
  for (const event of events) {
    const ms = tickToMs(event.absoluteTick);
    const target = synthForTrack ? synthForTrack(event.trackIndex) : player;
    if (event.type === 'noteOn' && (event.velocity ?? 0) > 0 && event.noteNumber != null) {
      setTimeout(() => target.noteOn(event.noteNumber!, event.velocity!), ms);
      scheduledNotes++;
    } else if (
      (event.type === 'noteOff' || (event.type === 'noteOn' && event.velocity === 0)) &&
      event.noteNumber != null
    ) {
      setTimeout(() => target.noteOff(event.noteNumber!), ms);
    }
  }

  options.onInfo?.({
    path: midiPath,
    tracks: midi.tracks.length,
    ticksPerBeat,
    durationSec: totalMs / 1000,
    noteCount: scheduledNotes,
  });

  await new Promise((r) => setTimeout(r, totalMs + 1500));
}
