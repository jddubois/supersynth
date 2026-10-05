import { noteNumber, type NoteLike } from './notes.js';
import { atLeast, finite, positive } from './validate.js';

/** When a change happens: every method that makes or changes sound takes these as its last
 *  argument. Without either, it happens now. */
export interface TimeOptions {
  /** Absolute time (seconds, `synth.currentTime` clock). */
  at?: number;
  /** Seconds from now. */
  delay?: number;
}

export interface PlayOptions extends TimeOptions {
  /** 1–127. @default 90 (organ divisions are not velocity sensitive and ignore it) */
  velocity?: number;
  /** Seconds the key is held. @default 1 */
  duration?: number;
}

/** One step of `sequence()`: `[note(s), beats]` or an object; `null` is a rest. */
export type SequenceStep =
  | [NoteLike | NoteLike[] | null, number]
  | { note: NoteLike | NoteLike[] | null; beats: number; velocity?: number };

export interface SequenceOptions extends TimeOptions {
  /** Beats per minute. @default 120 */
  tempo?: number;
  /** Velocity of steps that do not set their own. @default 90 */
  velocity?: number;
  /** Fraction of each step the key is held. @default 0.95 */
  legato?: number;
}

/**
 * Anything you can play notes on: an {@link Instrument} or one {@link Division} of an organ.
 * Code written against `Playable` plays either.
 */
export interface Playable {
  /** Press a key. */
  noteOn(note: NoteLike, velocity?: number, options?: TimeOptions): this;
  /** Release a key. */
  noteOff(note: NoteLike, options?: TimeOptions): this;
  /** Play notes together for a duration. */
  play(notes: NoteLike | NoteLike[], options?: PlayOptions): this;
  /** Play steps one after another; returns the length in seconds. */
  sequence(steps: SequenceStep[], options?: SequenceOptions): number;
  /** Expression (swell pedal) 0–1. */
  expression(value: number, options?: TimeOptions): this;
  /** Release every held key. */
  allNotesOff(options?: TimeOptions): this;
}

/** Absolute engine time of a {@link TimeOptions}, or undefined for "now". */
export function resolveTime(now: number, o: TimeOptions): number | undefined {
  if (o.at !== undefined) return finite(o.at, 'at');
  if (o.delay !== undefined) return now + finite(o.delay, 'delay');
  return undefined;
}

/** What plays notes: key presses, and room for `n` events in the engine's queue. */
export interface Keys {
  noteOn(note: number, velocity: number, time: number | undefined): void;
  noteOff(note: number, time: number): void;
  /** Throw unless `events` more events fit in the engine's queue. */
  reserve(events: number): void;
}

/** Press notes together and release them after `options.duration`. Everything is checked
 *  before the first note is sent, so a call plays all its notes or none. */
export function playNotes(kb: Keys, now: number, notes: NoteLike | NoteLike[], options: PlayOptions, velocity: number): void {
  const list = (Array.isArray(notes) ? notes : [notes]).map(noteNumber);
  const dur = Math.max(0, finite(options.duration ?? 1, 'duration'));
  const t = resolveTime(now, options);
  const start = t ?? now;
  kb.reserve(2 * list.length);
  for (const note of list) {
    kb.noteOn(note, velocity, t);
    kb.noteOff(note, start + dur);
  }
}

/** Play steps one after another; returns the sequence's length in seconds. Every step is
 *  checked before the first is played. */
export function playSequence(
  play: (notes: number[], options: PlayOptions) => unknown,
  reserve: (events: number) => void,
  now: number,
  steps: SequenceStep[],
  options: SequenceOptions,
): number {
  const beat = 60 / positive(options.tempo ?? 120, 'tempo');
  const legato = atLeast(options.legato ?? 0.95, 0, 'legato');
  const velocity = finite(options.velocity ?? 90, 'velocity');
  let t = resolveTime(now, options) ?? now;
  const start = t;
  const checked = steps.map((s) => {
    const [note, beats, vel] = Array.isArray(s) ? [s[0], s[1], undefined] : [s.note, s.beats, s.velocity];
    return {
      notes: note === null ? null : (Array.isArray(note) ? note : [note]).map(noteNumber),
      beats: atLeast(beats, 0, 'beats'),
      velocity: vel === undefined ? velocity : finite(vel, 'velocity'),
    };
  });
  reserve(2 * checked.reduce((n, s) => n + (s.notes?.length ?? 0), 0));
  for (const s of checked) {
    if (s.notes !== null) play(s.notes, { at: t, duration: s.beats * beat * legato, velocity: s.velocity });
    t += s.beats * beat;
  }
  return t - start;
}
