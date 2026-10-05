import { chord, noteFrequency, noteName, noteNumber } from '../../src/notes.js';

describe('notes', () => {
  test('names and numbers', () => {
    expect(noteNumber('C4')).toBe(60);
    expect(noteNumber('A4')).toBe(69);
    expect(noteNumber('F#3')).toBe(54);
    expect(noteNumber('Bb2')).toBe(46);
    expect(noteNumber('C-1')).toBe(0);
    expect(noteNumber(72)).toBe(72);
    expect(noteName(61)).toBe('C#4');
    expect(noteFrequency('A4')).toBe(440);
    expect(() => noteNumber('H2')).toThrow(RangeError);
    expect(() => noteNumber(128)).toThrow(RangeError);
    expect(() => noteNumber(60.5)).toThrow(RangeError);
  });

  test('unicode and double accidentals', () => {
    expect(noteNumber('A♭3')).toBe(56);
    expect(noteNumber('F♯3')).toBe(54);
    expect(noteNumber('C##4')).toBe(62);
    expect(noteNumber('Ebb4')).toBe(62);
    expect(noteNumber('D♭♭4')).toBe(60);
  });

  test('noteName takes only integers 0-127', () => {
    expect(noteName(0)).toBe('C-1');
    expect(noteName(127)).toBe('G9');
    for (const bad of [60.5, -1, 128, NaN, Infinity]) expect(() => noteName(bad)).toThrow(RangeError);
  });

  test('chords', () => {
    expect(chord('C4')).toEqual([60, 64, 67]);
    expect(chord('A3', 'm7')).toEqual([57, 60, 64, 67]);
    expect(chord('F#3m7b5')).toEqual([54, 57, 60, 64]);
  });

  test('chord symbols with a number quality, and chords above the MIDI range', () => {
    expect(chord('G37')).toEqual([55, 59, 62, 65]);
    expect(chord('C49')).toEqual([60, 64, 67, 70, 74]);
    expect(chord('C-17')).toEqual([0, 4, 7, 10]);
    expect(chord('C7')).toEqual([96, 100, 103]); // the octave is always given
    expect(() => chord('G9')).toThrow(RangeError);
    expect(() => chord(120, 'maj7')).toThrow(RangeError);
  });

  test('chord symbols take every accidental a note name does', () => {
    expect(chord('A♭3')).toEqual([56, 60, 63]);
    expect(chord('F♯3m')).toEqual([54, 57, 61]);
    expect(chord('Bbb3maj7')).toEqual([57, 61, 64, 68]);
    expect(chord('C##4')).toEqual([62, 66, 69]);
    expect(chord('Eb4m7')).toEqual([63, 66, 70, 73]);
    expect(() => chord('H4')).toThrow(RangeError);
    expect(() => chord('C4', 'nope')).toThrow(RangeError);
  });
});
