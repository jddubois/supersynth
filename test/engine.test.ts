import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import {
  chord, encodeWav, INSTRUMENTS, MidiError, noteName, noteNumber, Organ, parseMidiFile, Synth,
  SupersynthError, type InstrumentDefinition, type InstrumentId, type OrganDefinition, type Playable,
} from '../src/index.js';
import * as instrumentConfigs from '../src/catalog/index.js';
import { BUREA_ORGAN, ORGANS, PIOTR_ORGANS } from '../src/organs/index.js';
import { stopModel } from '../src/Organ.js';

const peak = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / Math.max(1, a.length));

/** A format-0 MIDI file (480 ticks per beat, 120 bpm) of `[delta ticks, status, data1, data2]` events. */
function midiFile(events: [number, number, number, number][]): Uint8Array {
  const vlq = (n: number) => {
    const out = [n & 0x7f];
    while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
    return out;
  };
  const body = events.flatMap(([dt, st, a, b]) => [...vlq(dt), st, a, b]).concat([0, 0xff, 0x2f, 0]);
  const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  return Uint8Array.from([0x4d, 0x54, 0x68, 0x64, ...u32(6), 0, 0, 0, 1, 0x01, 0xe0, 0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body]);
}

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
    const piano = synth.add('grand-piano');
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
  test.each(Object.keys(INSTRUMENTS) as InstrumentId[])('%s loads and plays', (id) => {
    const synth = new Synth({ sampleRate: 48000 });
    const part = synth.add(id);
    const mid = Math.round((part.definition.range[0] + part.definition.range[1]) / 2);
    part.play(mid, { velocity: 100, duration: 0.6 });
    const a = synth.render(0.8);
    expect(rms(a.left)).toBeGreaterThan(1e-4);
  });

  test('presets and parameters', () => {
    const synth = new Synth({ sampleRate: 48000 });
    const p = synth.add('grand-piano', { preset: 'mellow' });
    expect(p.activePreset()).toBe('mellow');
    expect(p.get('brightness')).toBeLessThan(0);
    p.preset('honky-tonk');
    expect(p.activePreset()).toBe('honky-tonk');
    p.set({ brightness: 2, release: 1.5, leslie: 'slow' });
    expect(p.get('brightness')).toBe(2);
    expect(p.activePreset()).toBeUndefined();
    expect(() => p.preset('nope')).toThrow(SupersynthError);
    expect(() => p.set({ nope: 1 } as never)).toThrow(SupersynthError);
    p.preset('default');
    expect(p.get('brightness')).toBe(0);
    expect(p.get('reverbSend')).toBeUndefined(); // the instrument's own
  });

  test('parameters given with the preset at creation keep it active', () => {
    const synth = new Synth({ sampleRate: 22050 });
    const p = synth.add('grand-piano', { preset: 'mellow', parameters: { volume: -3 } });
    expect(p.activePreset()).toBe('mellow');
    expect(p.get('volume')).toBe(-3);
    expect(p.parameters()).toMatchObject({ volume: -3, brightness: -1.6 });
  });

  test('presets can be objects, saved and read back (like the organ)', () => {
    const synth = new Synth({ sampleRate: 22050 });
    const p = synth.add('grand-piano');
    expect(Object.keys(p.presets())).toContain('felt');
    p.preset({ parameters: { brightness: -2, release: 1.5 } });
    expect(p.activePreset()).toBeUndefined();
    p.savePreset('mine');
    p.preset('bright').preset('mine');
    expect(p.activePreset()).toBe('mine');
    expect(p.get('brightness')).toBe(-2);
    expect(p.get('eqHighGain')).toBe(0); // the old preset's parameters are gone
    expect(Object.keys(p.presets())).toContain('mine');
  });

  test('instruments and organs are listed and removed', () => {
    const synth = new Synth({ sampleRate: 22050, reverb: false });
    const a = synth.add('grand-piano');
    const organ = synth.add('burea', { preset: 'flutes' });
    const b = synth.add('violin');
    expect(organ).toBeInstanceOf(Organ);
    expect(synth.instruments()).toEqual([a, organ, b]);
    synth.remove(a);
    expect(synth.instruments()).toEqual([organ, b]);
    organ.great.play('C4', { duration: 0.2 });
    synth.remove(organ);
    expect(rms(synth.render(0.3).left.subarray(1100))).toBeLessThan(1e-6); // after a 50 ms fade
    // the organ's four channels are free again
    for (let i = 0; i < 4; i++) synth.add('flute');
    expect(() => b.midi(17)).toThrow(RangeError);
    b.midi(1);
  });

  test('presets and parameters can be scheduled', () => {
    const synth = new Synth({ sampleRate: 22050, reverb: false });
    const p = synth.add('flute');
    p.noteOn('A4');
    p.set({ volume: -40 }, { at: 0.5 });
    const a = synth.render(1);
    expect(rms(a.left.subarray(11025 + 1000))).toBeLessThan(rms(a.left.subarray(2000, 11025)) * 0.1);
    p.preset('default', { delay: 0.2 });
    synth.render(0.3);
    expect(p.get('volume')).toBe(0);
  });

  test('unknown instrument throws a helpful error', () => {
    const synth = new Synth({ sampleRate: 48000 });
    expect(() => synth.add('kazoo' as InstrumentId)).toThrow(SupersynthError);
    // an organ definition is recognised as one, and checked like one
    expect(() => synth.add({ ...BUREA_ORGAN, stops: [] }, { preset: 'plenum' })).toThrow(SupersynthError);
  });

  test('instruments and organ divisions are both playable', () => {
    const synth = new Synth({ sampleRate: 22050, reverb: false });
    const playables: Playable[] = [synth.add('flute'), synth.add('burea', { preset: 'flutes' }).great];
    for (const k of playables) k.play('C5', { duration: 0.2 }).expression(0.8);
    expect(rms(synth.render(0.3).left)).toBeGreaterThan(1e-4);
    for (const k of playables) k.noteOn('G4').allNotesOff();
  });

  test('synth settings', () => {
    const level = (volume: number) => {
      const s = new Synth({ sampleRate: 22050, reverb: false });
      s.add('flute').play('A4', { duration: 0.5 });
      s.set({ volume });
      return rms(s.render(0.5).left);
    };
    expect(level(0.1)).toBeLessThan(level(0.8) * 0.3);
    const s = new Synth({ sampleRate: 22050 });
    s.set({ reverb: 'cathedral' }, { at: 1 }).set({ reverb: { preset: 'hall', decay: 2 } }).set({ reverb: false });
  });
});

describe('organ', () => {
  test('presets, stops and couplers', () => {
    const synth = new Synth({ sampleRate: 48000 });
    const organ = synth.add('burea', { preset: 'flutes' });
    expect(organ.great.drawn()).toEqual(["Gedackt 8'", "Rohrflöte 4'"]);
    expect(organ.activePreset()).toBe('flutes');
    organ.great.play(['C4', 'E4'], { duration: 0.5 });
    organ.pedal.play('C2', { duration: 0.5 });
    expect(rms(synth.render(0.8).left)).toBeGreaterThan(1e-3);
    organ.preset('plenum');
    expect(organ.great.drawn()).toContain('Mixture V');
    expect(organ.pedal.coupled()).toEqual(['great']);
    organ.great.pull("Trumpet 8'");
    expect(organ.great.drawn()).toContain("Trumpet 8'");
    expect(organ.activePreset()).toBeUndefined();
    organ.great.push('great-trumpet-8'); // by id
    expect(organ.great.drawn()).not.toContain("Trumpet 8'");
    organ.great.set({ stops: ["Principal 8'", "Octave 4'"] });
    expect(organ.great.drawn()).toEqual(["Principal 8'", "Octave 4'"]);
    organ.great.pull(["Trumpet 8'", 'Mixture V']).push("Trumpet 8'");
    expect(organ.great.drawn()).toEqual(["Principal 8'", "Octave 4'", 'Mixture V']);
    organ.pedal.set({ couple: [] });
    expect(organ.pedal.coupled()).toEqual([]);
    expect(() => organ.great.pull('Bombarde 32')).toThrow(SupersynthError);
    expect(() => organ.great.set({ stops: ['Bombarde 32'] })).toThrow(SupersynthError);
    expect(organ.great.drawn()).toEqual(["Principal 8'", "Octave 4'", 'Mixture V']);
  });

  test('a preset can be an object, saved and read back', () => {
    const synth = new Synth({ sampleRate: 22050 });
    const organ = synth.add('burea', { presets: { soft: { description: 'Soft', swell: ["Salicional 8'"], pedal: ["Subbass 16'"] } }, preset: 'soft' });
    expect(organ.swell.drawn()).toEqual(["Salicional 8'"]);
    organ.preset({ great: ["Principal 8'"], swell: ["Rohrflöte 8'"], couple: { great: ['swell'] } });
    expect(organ.current()).toEqual({ great: ["Principal 8'"], swell: ["Rohrflöte 8'"], couple: { great: ['swell'] } });
    expect(organ.activePreset()).toBeUndefined();
    organ.savePreset('mine');
    organ.preset('plenum').preset('mine');
    expect(organ.current()).toEqual({ great: ["Principal 8'"], swell: ["Rohrflöte 8'"], couple: { great: ['swell'] } });
    expect(Object.keys(organ.presets())).toContain('mine');
    // a bad preset changes nothing
    expect(() => organ.preset({ great: ['Bombarde 32'] })).toThrow(SupersynthError);
    expect(() => organ.preset('nope')).toThrow(SupersynthError);
    expect(organ.great.drawn()).toEqual(["Principal 8'"]);
  });

  test('couplers act in the engine, for every note source', () => {
    const synth = new Synth({ sampleRate: 22050, reverb: false });
    const organ = synth.add('burea', { preset: { swell: ["Rohrflöte 8'"] } });
    // a MIDI file played on the great (straight to the engine, like a MIDI keyboard)
    const great = () => rms(synth.renderMidi(midiFile([[0, 0x90, 60, 100], [240, 0x80, 60, 0]]), { instrument: organ.great, tail: 0.1 }).left);
    expect(great()).toBeLessThan(1e-6); // nothing drawn on the great
    organ.great.couple('swell');
    expect(great()).toBeGreaterThan(1e-3); // sounds the swell
    organ.great.uncouple('swell');
    synth.render(3);
    expect(great()).toBeLessThan(1e-6);
  });

  test('program changes select presets', () => {
    const synth = new Synth({ sampleRate: 22050 });
    const organ = synth.add('burea').midi({ great: 1, pedal: 2 }, { presets: ['flutes', 'plenum'] });
    synth.emit('midi', { type: 'programChange', channel: 2, program: 1, raw: Buffer.from([0xc1, 1]) });
    expect(organ.activePreset()).toBe('plenum');
    synth.emit('midi', { type: 'programChange', channel: 5, program: 0, raw: Buffer.from([0xc4, 0]) });
    expect(organ.activePreset()).toBe('plenum'); // not one of the organ's channels
  });

  test('pulling a stop while a note is held adds it to the sounding note', () => {
    const synth = new Synth({ sampleRate: 48000, reverb: false });
    const organ = synth.add('burea', { preset: 'flute-8' });
    organ.positive.noteOn('C4');
    // treble (first difference): the Krummhorn's reedy upper partials over the Gedackt's
    const treble = (x: Float32Array) => rms(x.map((v, i) => (i ? v - x[i - 1]! : 0)));
    const before = treble(synth.render(0.5).right);
    organ.positive.pull("Krummhorn 8'");
    synth.render(0.2);
    const after = treble(synth.render(0.5).right);
    expect(after).toBeGreaterThan(before * 2);
  });

  test('preset changes can be scheduled, so a piece renders in one go', () => {
    const synth = new Synth({ sampleRate: 22050, reverb: false });
    const organ = synth.add('burea', { preset: { positive: ["Gedackt 8'"] } });
    organ.positive.play('C4', { at: 0, duration: 2 });
    organ.preset({ positive: ["Gedackt 8'", "Krummhorn 8'"] }, { at: 1 });
    organ.set({ tremulant: true }, { at: 1.5 });
    expect(organ.positive.drawn()).toEqual(["Gedackt 8'", "Krummhorn 8'"]);
    const a = synth.render(2);
    // the Krummhorn's fundamental may add to the Gedackt's or partly cancel it (their phases
    // differ from note to note, as real pipes'); its reedy upper partials always add treble
    const treble = (x: Float32Array) => x.map((v, i) => (i ? v - x[i - 1]! : 0));
    const level = (from: number, to: number) => rms(treble(a.right.subarray(from * 22050, to * 22050)));
    expect(level(1.2, 1.5)).toBeGreaterThan(level(0.5, 0.95) * 2);
  });

  test('a stop pulled for later sounds only from then', () => {
    const synth = new Synth({ sampleRate: 22050, reverb: false });
    const organ = synth.add('burea', { preset: {} });
    organ.great.noteOn('C4');
    organ.great.pull("Principal 8'", { at: 0.5 });
    const a = synth.render(1);
    expect(rms(a.left.subarray(0, 10000))).toBeLessThan(1e-6);
    expect(rms(a.left.subarray(13000))).toBeGreaterThan(1e-3);
  });
});

describe('configurations', () => {
  /** The JSON header of a model file. */
  const header = (model: string) => {
    const raw = gunzipSync(readFileSync(path.join(process.cwd(), 'models', `${model}.ssm`)));
    return JSON.parse(raw.subarray(8, 8 + raw.readUInt32LE(4)).toString('utf8'));
  };

  test('instrument and organ ids are distinct (synth.add takes both)', () => {
    const organs = new Set(Object.keys(ORGANS));
    expect(Object.keys(INSTRUMENTS).filter((id) => organs.has(id))).toEqual([]);
    for (const [id, def] of Object.entries(ORGANS)) expect(def.id).toBe(id);
  });

  test('every named instrument config is in the catalog, under its own id', () => {
    const named = Object.values(instrumentConfigs).filter((v): v is InstrumentDefinition => typeof v === 'object' && v !== null && 'layers' in v);
    expect(named.length).toBe(Object.keys(INSTRUMENTS).length);
    for (const def of named) expect((INSTRUMENTS as Record<string, InstrumentDefinition>)[def.id]).toBe(def);
  });

  test('an instrument config can be copied, changed and played', () => {
    const synth = new Synth({ sampleRate: 22050 });
    const marimba = synth.add({ ...instrumentConfigs.MARIMBA, id: 'dark-marimba', parameters: { brightness: -2 } });
    expect(marimba.get('brightness')).toBe(-2);
    marimba.play('C5', { duration: 0.3 });
    expect(rms(synth.render(0.5).left)).toBeGreaterThan(1e-4);
  });

  test('Bureå stops agree with the stop data analysed into their models', () => {
    for (const stop of BUREA_ORGAN.stops) {
      const h = header(`organ/${stop.id}`);
      expect([stop.id, h.stop.name, h.stop.footage_offset, h.stop.family]).toEqual([stop.id, stop.name, stop.transpose, stop.family]);
    }
  });

  test("Piotr Grabowski's organs: stops agree with the stop data analysed into their models", () => {
    for (const organ of Object.values(PIOTR_ORGANS)) {
      for (const stop of organ.stops) {
        const h = header(stopModel(stop));
        expect([organ.id, stop.id, h.stop.organ, h.stop.name, h.stop.footage_offset, h.stop.family])
          .toEqual([organ.id, stop.id, organ.id, stop.name, stop.transpose, stop.family]);
      }
    }
  });

  test("each of Piotr Grabowski's organs plays its default preset", () => {
    for (const organ of Object.values(PIOTR_ORGANS)) {
      const synth = new Synth({ sampleRate: 22050, reverb: false });
      const o = synth.add(organ);
      for (const name of ['great', 'swell', 'positive', 'pedal'] as const) {
        const d = o.division(name);
        if (d.drawn().length) d.play(name === 'pedal' ? 'C2' : ['C4', 'G4'], { duration: 0.4 });
      }
      expect([organ.id, rms(synth.render(0.6).left) > 1e-4]).toEqual([organ.id, true]);
    }
  });

  test('presets only name stops of their divisions', () => {
    for (const organ of Object.values(ORGANS)) {
      for (const [name, reg] of Object.entries(organ.presets)) {
        for (const div of ['great', 'swell', 'positive', 'pedal'] as const) {
          for (const stop of reg[div] ?? []) {
            expect([organ.id, name, div, organ.stops.some((s) => s.division === div && s.name === stop)]).toEqual([organ.id, name, div, true]);
          }
        }
      }
    }
  });

  /** Zero crossings per second: about twice the pitch of a flute. */
  const crossings = (x: Float32Array, sr: number) => {
    let n = 0;
    for (let i = 1; i < x.length; i++) if ((x[i - 1]! < 0) !== (x[i]! < 0)) n++;
    return n / (x.length / sr);
  };

  test('octave couplers and unison off', () => {
    const synth = new Synth({ sampleRate: 22050, reverb: false });
    const organ = synth.add('burea', { preset: { swell: ["Rohrflöte 8'"] } });
    const pitch = (play: () => void) => {
      play();
      synth.render(0.3);
      const hz = crossings(synth.render(0.4).left, 22050) / 2;
      organ.allNotesOff();
      synth.render(2);
      return hz;
    };
    const direct = pitch(() => organ.swell.noteOn('C5'));
    expect(direct).toBeGreaterThan(450);
    // Swell to Great 4' with the great's unison off: the great's C4 plays the swell's C5
    organ.great.couple({ division: 'swell', octave: 1 }).unison(false);
    expect(pitch(() => organ.great.noteOn('C4')) / direct).toBeCloseTo(1, 1);
    expect(organ.great.coupled()).toEqual([{ division: 'swell', octave: 1 }]);
    expect(organ.current()).toEqual({ swell: ["Rohrflöte 8'"], couple: { great: [{ division: 'swell', octave: 1 }] }, unisonOff: ['great'] });
    // the swell's sub octave on itself with its unison off: C5 plays C4
    const c4 = pitch(() => organ.swell.noteOn('C4'));
    organ.preset({ swell: ["Rohrflöte 8'"], couple: { swell: [{ division: 'swell', octave: -1 }] }, unisonOff: ['swell'] });
    expect(organ.great.unisonOn()).toBe(true);
    expect(pitch(() => organ.swell.noteOn('C5')) / c4).toBeCloseTo(1, 1);
    organ.swell.uncouple('swell').unison(true);
    expect(organ.swell.coupled()).toEqual([]);
    expect(() => organ.great.couple({ division: 'swell', octave: 2 as 1 })).toThrow(RangeError);
  });

  test('a stop with fewer pipes than keys is silent outside them', () => {
    const def: OrganDefinition = {
      ...BUREA_ORGAN,
      stops: BUREA_ORGAN.stops.map((s) => (s.id === 'great-gedackt-8' ? { ...s, keys: [60, 96] as [number, number] } : s)),
    };
    const synth = new Synth({ sampleRate: 22050, reverb: false });
    const organ = synth.add(def, { preset: { great: ["Gedackt 8'"] } });
    organ.great.play('C3', { duration: 0.3 });
    expect(rms(synth.render(0.5).left)).toBeLessThan(1e-6);
    organ.great.play('C4', { duration: 0.3 });
    expect(rms(synth.render(0.5).left)).toBeGreaterThan(1e-3);
  });

  test('tremulants per division, in presets', () => {
    const def: OrganDefinition = {
      ...BUREA_ORGAN,
      tremulant: [
        { division: 'swell', name: 'Tremulant II', depth: 2, pitch: 6, rate: 5 },
        { division: ['positive', 'great'], name: 'Tremulant I', depth: 1, pitch: 4, rate: 6 },
      ],
    };
    const synth = new Synth({ sampleRate: 22050, reverb: false });
    const organ = synth.add(def, { tremulant: { swell: true } });
    expect(organ.tremulants().map((t) => t.on)).toEqual([true, false]);
    organ.set({ tremulant: { great: true } });
    expect(organ.tremulants().map((t) => t.on)).toEqual([true, true]);
    expect(organ.current().tremulant).toEqual(['swell', 'positive', 'great']);
    organ.preset({ swell: ["Rohrflöte 8'"], tremulant: ['positive'] });
    expect(organ.tremulants().map((t) => t.on)).toEqual([false, true]);
    organ.preset({ swell: ["Rohrflöte 8'"] }); // tremulants left as they are
    expect(organ.tremulants().map((t) => t.on)).toEqual([false, true]);
    organ.set({ tremulant: false });
    expect(organ.tremulants().map((t) => t.on)).toEqual([false, false]);
    // the swell's tremulant pulses its pipes
    organ.set({ tremulant: { swell: true } });
    organ.swell.noteOn('C4');
    synth.render(0.5);
    const a = synth.render(1).left;
    const env = [...Array(20).keys()].map((i) => rms(a.subarray(i * 1102, (i + 1) * 1102)));
    expect(Math.max(...env) / Math.min(...env)).toBeGreaterThan(1.2);
  });

  test('how much a swell box closes is part of the definition', () => {
    const level = (closed: number) => {
      const def: OrganDefinition = { ...BUREA_ORGAN, divisions: { swell: { swellBox: { closed, shelf: 0 } } } };
      const synth = new Synth({ sampleRate: 22050, reverb: false });
      const organ = synth.add(def, { preset: { swell: ["Rohrflöte 8'"] }, wind: 0 });
      organ.swell.noteOn('C4');
      synth.render(0.5);
      const open = rms(synth.render(0.5).left);
      organ.swell.expression(0);
      synth.render(0.2);
      return 20 * Math.log10(rms(synth.render(0.5).left) / open);
    };
    expect(level(-20)).toBeCloseTo(-20, 0);
    expect(level(-6)).toBeCloseTo(-6, 0);
  });

  test("a harmonium's Forte plays the forte recordings", () => {
    const synth = new Synth({ sampleRate: 22050, reverb: false });
    const organ = synth.add('harmonium', { preset: { great: ["Melodia 8'"] }, wind: 0 });
    organ.great.noteOn('C5');
    synth.render(0.6);
    const soft = rms(synth.render(0.5).left);
    organ.great.forte(true);
    synth.render(0.6);
    const loud = rms(synth.render(0.5).left);
    expect(loud).toBeGreaterThan(soft * 1.2);
    expect(organ.current()).toEqual({ great: ["Melodia 8'"], forte: ['great'] });
    organ.preset('diapason');
    expect(organ.great.forteIsOn()).toBe(false);
  });

  test('a custom organ definition plays', () => {
    const tiny: OrganDefinition = {
      id: 'tiny',
      name: 'Two-stop chamber organ',
      description: 'Bureå flutes as a box organ',
      stops: BUREA_ORGAN.stops.filter((s) => ['great-gedackt-8', 'pedal-subbass-16'].includes(s.id)),
      presets: { soft: { description: 'Gedackt and Subbass', great: ["Gedackt 8'"], pedal: ["Subbass 16'"] } },
      defaultPreset: 'soft',
      divisions: { great: { pan: -0.5 } },
      tremulant: { division: 'great', depth: 3, pitch: 5, rate: 5 },
    };
    const synth = new Synth({ sampleRate: 22050, reverb: false });
    const organ = synth.add(tiny, { tremulant: true });
    expect(organ.definition.id).toBe('tiny');
    expect(organ.great.drawn()).toEqual(["Gedackt 8'"]);
    expect(Object.keys(organ.presets())).toEqual(['soft']);
    const len = organ.great.sequence([['C4', 1], [['E4', 'G4'], 1]], { tempo: 240 });
    expect(len).toBeCloseTo(0.5);
    const out = synth.render(0.8);
    // panned left
    expect(rms(out.left)).toBeGreaterThan(rms(out.right) * 1.2);
    expect(() => organ.great.pull("Trumpet 8'")).toThrow(SupersynthError);
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

  test('a file that is not MIDI throws MidiError', () => {
    expect(() => parseMidiFile(Uint8Array.from([1, 2, 3, 4]))).toThrow(MidiError);
  });

  test('WAV encoding', () => {
    const buf = encodeWav({ sampleRate: 48000, left: new Float32Array(10), right: new Float32Array(10), duration: 10 / 48000 });
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buf.length).toBe(44 + 10 * 2 * 2);
  });
});
