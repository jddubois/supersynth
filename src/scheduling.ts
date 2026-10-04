import type { NoteLike } from './notes.js';

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
  if (o.at !== undefined) return o.at;
  if (o.delay !== undefined) return now + o.delay;
  return undefined;
}

/** Press notes together and release them after `options.duration`. */
export function playNotes(kb: Pick<Playable, 'noteOn' | 'noteOff'>, now: number, notes: NoteLike | NoteLike[], options: PlayOptions, velocity: number): void {
  const list = Array.isArray(notes) ? notes : [notes];
  const dur = Math.max(0, options.duration ?? 1);
  const t = resolveTime(now, options);
  const start = t ?? now;
  for (const note of list) {
    kb.noteOn(note, velocity, t !== undefined ? { at: t } : {});
    kb.noteOff(note, { at: start + dur });
  }
}

/** Play steps one after another; returns the sequence's length in seconds. */
export function playSequence(
  play: (notes: NoteLike | NoteLike[], options: PlayOptions) => unknown,
  now: number,
  steps: SequenceStep[],
  options: SequenceOptions,
): number {
  const beat = 60 / (options.tempo ?? 120);
  const legato = options.legato ?? 0.95;
  let t = resolveTime(now, options) ?? now;
  const start = t;
  for (const s of steps) {
    const [note, beats, vel] = Array.isArray(s) ? [s[0], s[1], undefined] : [s.note, s.beats, s.velocity];
    if (note !== null) {
      play(note, { at: t, duration: beats * beat * legato, velocity: vel ?? options.velocity ?? 90 });
    }
    t += beats * beat;
  }
  return t - start;
}
