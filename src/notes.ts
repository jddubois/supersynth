/**
 * A note: a MIDI number (60 = middle C) or a name such as `'C4'`, `'F#3'`, `'Bb2'`, `'A-1'`.
 * Middle C is C4 (MIDI 60), A4 = 440 Hz (MIDI 69).
 */
export type NoteLike = number | string;

const LETTERS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ACCIDENTAL = '#{1,2}|b{1,2}|♯{1,2}|♭{1,2}';
const NOTE_RE = new RegExp(`^\\s*([A-Ga-g])(${ACCIDENTAL})?\\s*(-?\\d+)\\s*$`);
/** A chord symbol: a note name with its octave (one digit, or -1), then the quality. */
const CHORD_RE = new RegExp(`^\\s*([A-Ga-g](?:${ACCIDENTAL})?\\s*(?:-1|\\d))(.*)$`);

/** Convert a note name or number to a MIDI note number (0–127). */
export function noteNumber(note: NoteLike): number {
  if (typeof note === 'number') {
    if (!Number.isInteger(note) || note < 0 || note > 127) {
      throw new RangeError(`MIDI note must be an integer 0-127, got ${note}`);
    }
    return note;
  }
  const m = NOTE_RE.exec(note);
  if (!m) throw new RangeError(`Invalid note name '${note}' (expected e.g. 'C4', 'F#3', 'Bb2')`);
  const [, letter, acc = '', octave] = m;
  let n = LETTERS[letter!.toLowerCase()]!;
  for (const ch of acc) n += ch === '#' || ch === '♯' ? 1 : -1;
  const midi = 12 * (Number(octave) + 1) + n;
  if (midi < 0 || midi > 127) throw new RangeError(`Note '${note}' is outside the MIDI range`);
  return midi;
}

/** MIDI note number (an integer 0–127) → name, e.g. 61 → 'C#4'. */
export function noteName(midi: number): string {
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) {
    throw new RangeError(`MIDI note must be an integer 0-127, got ${midi}`);
  }
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Frequency in Hz of a note in 12-tone equal temperament (A4 = 440 Hz by default). */
export function noteFrequency(note: NoteLike, a4 = 440): number {
  return a4 * 2 ** ((noteNumber(note) - 69) / 12);
}

const CHORDS: Record<string, number[]> = {
  '': [0, 4, 7], maj: [0, 4, 7], M: [0, 4, 7], m: [0, 3, 7], min: [0, 3, 7], dim: [0, 3, 6],
  aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11],
  M7: [0, 4, 7, 11], m7: [0, 3, 7, 10], min7: [0, 3, 7, 10], dim7: [0, 3, 6, 9], m7b5: [0, 3, 6, 10],
  '6': [0, 4, 7, 9], m6: [0, 3, 7, 9], '9': [0, 4, 7, 10, 14], maj9: [0, 4, 7, 11, 14], add9: [0, 4, 7, 14],
};

/**
 * Notes of a chord, e.g. `chord('C4')` → C E G, `chord('A3', 'm7')` → A C E G,
 * or a symbol: `chord('F#3m7b5')`, `chord('G37')` (G3, dominant seventh). A symbol always
 * has the octave, so `chord('C7')` is a C major triad in octave 7. Throws `RangeError` when a
 * note of the chord is above the MIDI range.
 */
export function chord(root: NoteLike, quality?: string): number[] {
  let r: number;
  let q = quality;
  if (typeof root === 'string' && q === undefined) {
    const m = CHORD_RE.exec(root);
    if (!m) throw new RangeError(`Invalid chord '${root}'`);
    r = noteNumber(m[1]!);
    q = m[2]!.trim();
  } else {
    r = noteNumber(root);
  }
  const iv = CHORDS[q ?? ''];
  if (!iv) throw new RangeError(`Unknown chord quality '${q}' (known: ${Object.keys(CHORDS).filter(Boolean).join(', ')})`);
  const notes = iv.map((i) => r + i);
  if (notes[notes.length - 1]! > 127) throw new RangeError(`Chord '${typeof root === 'string' ? root : noteName(r)}${quality ?? ''}' goes above the MIDI range`);
  return notes;
}
