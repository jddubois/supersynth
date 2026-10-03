import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  chord, encodeWav, INSTRUMENTS, noteName, noteNumber, parseMidiFile, Piano, Synth, SupersynthError,
} from '../src/index.js';

const peak = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / Math.max(1, a.length));

describe('notes', () => {
  test('names and numbers', () => {
    expect(noteNumber('C4')).toBe(60);
    expect(noteNumber('A4')).toBe(69);
    expect(noteNumber('F#3')).toBe(54);
    expect(noteNumber('Bb2')).toBe(46);
    expect(noteNumber('C-1')).toBe(0);
    expect(noteNumber(72)).toBe(72);
    expect(noteName(61)).toBe('C#4');
    expect(() => noteNumber('H2')).toThrow(RangeError);
    expect(() => noteNumber(128)).toThrow(RangeError);
  });

  test('chords', () => {
    expect(chord('C4')).toEqual([60, 64, 67]);
    expect(chord('A3', 'm7')).toEqual([57, 60, 64, 67]);
    expect(chord('F#3m7b5')).toEqual([54, 57, 60, 64]);
  });
});

describe('Synth offline rendering', () => {
  test('silence with no notes, correct length, stereo', () => {
    const synth = new Synth({ sampleRate: 48000 });
    const a = synth.render(0.25);
    expect(a.left.length).toBe(12000);
    expect(a.right.length).toBe(12000);
    expect(peak(a.left)).toBeLessThan(1e-9);
  });

  test('a piano note sounds, stays finite and bounded, and ends after release', () => {
    const synth = new Synth({ sampleRate: 48000 });
    const piano = synth.add('piano');
    piano.play('C4', { velocity: 100, duration: 0.5 });
    const a = synth.render(1.5);
    expect(rms(a.left)).toBeGreaterThan(1e-3);
    for (const v of a.left) expect(Number.isFinite(v)).toBe(true);
    expect(peak(a.left)).toBeLessThanOrEqual(1.0);
    synth.render(4);
    expect(synth.activeVoices).toBe(0);
  });

  test('velocity changes loudness and timbre', () => {
    const level = (vel: number) => {
      const s = new Synth({ sampleRate: 48000, reverb: false });
      s.add('grand-piano').play('C4', { velocity: vel, duration: 1 });
      return rms(s.render(1).left);
    };
    expect(level(110)).toBeGreaterThan(level(40) * 2);
  });

  test('scheduling is sample accurate', () => {
    const synth = new Synth({ sampleRate: 48000, reverb: false });
    synth.add('marimba').play('C5', { at: 0.5, duration: 0.5 });
    const a = synth.render(1);
    const first = a.left.findIndex((v) => Math.abs(v) > 1e-4);
    expect(first).toBeGreaterThanOrEqual(24000);
    expect(first).toBeLessThan(24000 + 200);
  });

  test('many notes are limited below full scale', () => {
    const synth = new Synth({ sampleRate: 48000, volume: 1 });
    const p = synth.add('strings');
    for (let n = 36; n < 90; n += 2) p.play(n, { velocity: 127, duration: 2 });
    const a = synth.render(2);
    expect(peak(a.left)).toBeLessThanOrEqual(1.0);
  });
});

describe('instruments', () => {
  test.each(INSTRUMENTS.map((d) => d.id))('%s loads and plays', (id) => {
    const synth = new Synth({ sampleRate: 48000 });
    const part = synth.add(id);
    const mid = Math.round((part.instrument.range[0] + part.instrument.range[1]) / 2);
    part.play(mid, { velocity: 100, duration: 0.6 });
    const a = synth.render(0.8);
    expect(rms(a.left)).toBeGreaterThan(1e-4);
  });

  test('presets and parameters', () => {
    const synth = new Synth({ sampleRate: 48000 });
    const p = synth.add('grand-piano', { preset: 'mellow' });
    expect(p.preset).toBe('mellow');
    expect(p.get('brightness')).toBeLessThan(0);
    p.usePreset('honky-tonk');
    expect(p.preset).toBe('honky-tonk');
    p.set({ brightness: 2, release: 1.5, leslie: 'slow' });
    expect(p.get('brightness')).toBe(2);
    expect(() => p.usePreset('nope')).toThrow(RangeError);
    expect(() => p.set({ nope: 1 } as never)).toThrow(RangeError);
    p.reset();
    expect(p.get('brightness')).toBe(0);
  });

  test('unknown instrument throws a helpful error', () => {
    const synth = new Synth({ sampleRate: 48000 });
    expect(() => synth.add('kazoo')).toThrow(SupersynthError);
  });

  test('standalone instrument classes', () => {
    const piano = new Piano({ sampleRate: 48000, preset: 'bright' });
    piano.play(['C4', 'E4', 'G4'], { duration: 0.5 });
    expect(rms(piano.render(0.6).left)).toBeGreaterThan(1e-3);
  });

  test('catalog lists available instruments', () => {
    const list = Synth.instruments();
    expect(list.length).toBeGreaterThan(20);
    expect(list.every((i) => i.available)).toBe(true);
  });
});

describe('organ', () => {
  test('registrations, stops and couplers', () => {
    const synth = new Synth({ sampleRate: 48000 });
    const organ = synth.organ({ registration: 'flutes' });
    expect(organ.great.drawn).toEqual(["Gedackt 8'", "Rohrflöte 4'"]);
    organ.great.play(['C4', 'E4'], { duration: 0.5 });
    organ.pedal.play('C2', { duration: 0.5 });
    expect(rms(synth.render(0.8).left)).toBeGreaterThan(1e-3);
    organ.useRegistration('plenum');
    expect(organ.great.drawn).toContain('Mixture V');
    organ.great.pull("Trumpet 8'");
    expect(organ.great.drawn).toContain("Trumpet 8'");
    organ.great.push("Trumpet 8'");
    expect(organ.great.drawn).not.toContain("Trumpet 8'");
    expect(() => organ.great.pull('Bombarde 32')).toThrow(SupersynthError);
  });

  test('pulling a stop while a note is held adds it to the sounding note', () => {
    const synth = new Synth({ sampleRate: 48000, reverb: false });
    const organ = synth.organ({ registration: 'flute-8' });
    organ.positive.noteOn('C4');
    const before = rms(synth.render(0.5).right);
    organ.positive.pull("Krummhorn 8'");
    synth.render(0.2);
    const after = rms(synth.render(0.5).right);
    // the recorded Krummhorn C4 sounds ~4.5 dB below the Gedackt: about +1.4 dB together
    expect(after).toBeGreaterThan(before * 1.1);
  });
});

describe('files', () => {
  test('MIDI file parse and render', () => {
    const bytes = readFileSync(path.join(process.cwd(), 'examples', 'jsbwv532.mid'));
    const midi = parseMidiFile(bytes);
    expect(midi.events.length).toBeGreaterThan(100);
    expect(midi.duration).toBeGreaterThan(10);
    const synth = new Synth({ sampleRate: 22050 });
    const short = { ...midi, events: midi.events.filter((e) => e.time < 2) };
    expect(short.events.length).toBeGreaterThan(0);
    const audio = synth.renderMidi(bytes, { instrument: 'harpsichord', tail: 0.5, speed: 8 });
    expect(audio.duration).toBeGreaterThan(1);
    expect(rms(audio.left)).toBeGreaterThan(1e-3);
  });

  test('WAV encoding', () => {
    const buf = encodeWav({ sampleRate: 48000, left: new Float32Array(10), right: new Float32Array(10), duration: 10 / 48000 });
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buf.length).toBe(44 + 10 * 2 * 2);
  });
});
