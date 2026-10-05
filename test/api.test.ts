import {
  AbortError, BUREA_ORGAN, GRAND_PIANO, MidiError, Synth, SupersynthError, type Instrument, type OrganDefinition,
} from '../src/index.js';
import { END_OF_TRACK, midiFile, smf, tempo, trackChunk, vlq } from './smf.js';

const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / Math.max(1, a.length));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Wait until `cond` holds (at most 10 s). */
async function until(cond: () => boolean): Promise<void> {
  for (let t = 0; !cond(); t += 10) {
    if (t > 10000) throw new Error('timed out');
    await sleep(10);
  }
}

/** Record the engine calls named in `names`. */
function spy(synth: Synth, names: string[]): [string, ...unknown[]][] {
  const calls: [string, ...unknown[]][] = [];
  const engine = synth['engine'];
  synth['engine'] = new Proxy(engine, {
    get(target, prop) {
      const v = Reflect.get(target, prop) as unknown;
      if (typeof v !== 'function' || !names.includes(String(prop))) return v;
      return (...args: unknown[]) => {
        calls.push([String(prop), ...args]);
        return (v as (...a: unknown[]) => unknown)(...args);
      };
    },
  });
  return calls;
}

/** Pretend real-time output runs, the clock advancing 5× faster than real time (rendered
 *  offline, so no audio device is needed). */
function fakeOutput(synth: Synth) {
  let running = true;
  Object.defineProperty(synth, 'isRunning', { get: () => running, configurable: true });
  const engine = synth._native();
  const timer = setInterval(() => {
    if (running) engine.render(Math.round(synth.sampleRate * 0.05));
  }, 10);
  return {
    stop: () => (running = false),
    done: () => clearInterval(timer),
  };
}

/** One note on each of the 16 MIDI channels. */
const allChannels = midiFile([
  ...[...Array(16).keys()].map((ch): [number, number, number, number] => [0, 0x90 | ch, 60, 100]),
  ...[...Array(16).keys()].map((ch): [number, number, number, number] => [ch === 0 ? 240 : 0, 0x80 | ch, 60, 0]),
]);

describe('MIDI files', () => {
  test('instruments added for a file are removed after it, so a 16-channel file renders again and again', () => {
    const synth = new Synth({ sampleRate: 22050, reverb: false });
    for (let i = 0; i < 4; i++) {
      const a = synth.renderMidi(allChannels, { instrument: 'flute', tail: 0.1, channels: { 10: 'marimba' } });
      expect(rms(a.left)).toBeGreaterThan(1e-3);
      expect(synth.instruments()).toEqual([]);
    }
    // instruments passed by object stay
    const flute = synth.add('flute');
    synth.renderMidi(allChannels, { instrument: flute, tail: 0.1 });
    expect(synth.instruments()).toEqual([flute]);
  });

  test('speed, tail and transpose are checked', () => {
    const synth = new Synth({ sampleRate: 22050 });
    const file = midiFile([[0, 0x90, 60, 100], [480, 0x80, 60, 0]]);
    for (const bad of [{ speed: 0 }, { speed: -1 }, { speed: NaN }, { speed: Infinity }, { tail: -1 }, { tail: NaN }, { transpose: 0.5 }, { transpose: NaN }]) {
      expect(() => synth.renderMidi(file, bad)).toThrow(SupersynthError);
    }
    expect(synth.instruments()).toEqual([]);
  });

  test('channels are 1-16; GM drums (10) are skipped unless mapped; byTrack keys are 0-based track indices', () => {
    const synth = new Synth({ sampleRate: 22050, reverb: false });
    const quiet = synth.add('flute', { parameters: { volume: -120 } });
    const level = (file: Uint8Array, options: Parameters<Synth['renderMidi']>[1]) => {
      synth.render(0.2); // the end of the last one
      return rms(synth.renderMidi(file, { tail: 0.05, instrument: 'flute', ...options }).left);
    };
    const ch2 = midiFile([[0, 0x91, 69, 100], [480, 0x81, 69, 0]]);
    expect(level(ch2, { channels: { 2: quiet } })).toBeLessThan(1e-4);
    expect(level(ch2, { channels: { 1: quiet } })).toBeGreaterThan(1e-3);
    const drums = midiFile([[0, 0x99, 69, 100], [480, 0x89, 69, 0]]);
    expect(level(drums, {})).toBeLessThan(1e-6);
    expect(level(drums, { channels: { 10: 'marimba' } })).toBeGreaterThan(1e-4);
    const twoTracks = smf([trackChunk([...tempo(0, 500000), ...END_OF_TRACK]), trackChunk([0, 0x90, 69, 100, ...vlq(480), 0x80, 69, 0, ...END_OF_TRACK])]);
    expect(level(twoTracks, { byTrack: true, channels: { 1: quiet } })).toBeLessThan(1e-4);
    expect(level(twoTracks, { byTrack: true, channels: { 0: quiet } })).toBeGreaterThan(1e-3);
  });

  test('a file with more events than the engine queue holds renders, on time', () => {
    const synth = new Synth({ sampleRate: 22050, reverb: false });
    // 40 000 controller changes at once, then a note at 2 s (1920 ticks at 120 bpm)
    const events: [number, number, number, number][] = [];
    for (let i = 0; i < 40000; i++) events.push([0, 0xb0, 1, i % 128]);
    events.push([1920, 0x90, 69, 100], [480, 0x80, 69, 0]);
    const a = synth.renderMidi(midiFile(events), { instrument: 'flute', tail: 0.2 });
    expect(a.duration).toBeCloseTo(2.7, 1);
    expect(rms(a.left.subarray(0, 1.9 * 22050))).toBeLessThan(1e-6);
    expect(rms(a.left.subarray(2.05 * 22050, 2.45 * 22050))).toBeGreaterThan(1e-3);
  });

  test('a corrupt file throws MidiError and adds nothing', () => {
    const synth = new Synth({ sampleRate: 22050 });
    expect(() => synth.renderMidi(Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xe0, 0x4d, 0x54, 0x72, 0x6b, 0, 16, 0, 0, 0, 0x90]))).toThrow(MidiError);
    expect(synth.instruments()).toEqual([]);
  });
});

describe('playMidi', () => {
  const long = midiFile([[0, 0x90, 69, 100], [9600, 0x80, 69, 0]]); // 10 s

  test('resolves at the end and removes the instruments it added', async () => {
    const synth = new Synth({ sampleRate: 22050, reverb: false });
    const out = fakeOutput(synth);
    try {
      await synth.playMidi(allChannels, { instrument: 'flute', tail: 0.2 });
      expect(synth.currentTime).toBeGreaterThan(0.6);
      expect(synth.instruments()).toEqual([]);
    } finally {
      out.done();
    }
  });

  test('an error while playing rejects the promise (and stops the timer)', async () => {
    const synth = new Synth({ sampleRate: 22050, reverb: false });
    const out = fakeOutput(synth);
    const engine = synth['engine'];
    synth['engine'] = new Proxy(engine, {
      get: (t, p) => (p === 'noteOn' ? () => { throw new SupersynthError('boom'); } : Reflect.get(t, p)),
    });
    try {
      await expect(synth.playMidi(long, { instrument: 'flute' })).rejects.toThrow('boom');
      expect(synth.instruments()).toEqual([]);
    } finally {
      synth['engine'] = engine;
      out.done();
    }
  });

  test('stop() or close() during playback settles it', async () => {
    for (const how of ['stop', 'close'] as const) {
      const synth = new Synth({ sampleRate: 22050, reverb: false });
      const out = fakeOutput(synth);
      try {
        const playing = synth.playMidi(long, { instrument: 'flute' });
        await until(() => synth.activeVoices > 0);
        if (how === 'stop') out.stop();
        else synth.close();
        await expect(playing).resolves.toBeUndefined();
        expect(synth.instruments()).toEqual([]);
      } finally {
        out.done();
      }
    }
  });

  test('an AbortSignal stops it, releases its notes and rejects with AbortError', async () => {
    const synth = new Synth({ sampleRate: 22050, reverb: false });
    const flute = synth.add('flute');
    const out = fakeOutput(synth);
    try {
      const ac = new AbortController();
      const playing = synth.playMidi(long, { instrument: flute, signal: ac.signal });
      await until(() => synth.activeVoices > 0);
      const t = synth.currentTime;
      ac.abort();
      await expect(playing).rejects.toBeInstanceOf(AbortError);
      await until(() => synth.activeVoices === 0); // the flute's release
      expect(synth.currentTime - t).toBeLessThan(3); // not the 10 s note
      expect(synth.instruments()).toEqual([flute]);
      // already aborted: nothing is played
      await expect(synth.playMidi(long, { signal: AbortSignal.abort() })).rejects.toBeInstanceOf(AbortError);
      expect(synth.instruments()).toEqual([flute]);
    } finally {
      out.done();
    }
  });
});

describe('the engine never sees a number that is not finite', () => {
  test('every numeric argument is checked, and a bad one leaves the engine playing', () => {
    const synth = new Synth({ sampleRate: 22050, reverb: false });
    const piano = synth.add('grand-piano');
    const organ = synth.add('burea', { preset: 'flutes' });
    const calls: [string, () => unknown][] = [
      ['pitchBend', () => piano.pitchBend(NaN)],
      ['modulation', () => piano.modulation(NaN)],
      ['expression', () => piano.expression(Infinity)],
      ['control change value', () => piano.controlChange(7, NaN)],
      ['controller', () => piano.controlChange(NaN, 1)],
      ['velocity', () => piano.noteOn('C4', NaN)],
      ['velocity', () => piano.play('C4', { velocity: NaN })],
      ['duration', () => piano.play('C4', { duration: NaN })],
      ['at', () => piano.play('C4', { at: NaN })],
      ['delay', () => piano.play('C4', { delay: Infinity })],
      ['brightness', () => piano.set({ brightness: NaN })],
      ['volume', () => piano.set({ volume: 'loud' as never })],
      ['release', () => piano.preset({ parameters: { release: NaN } })],
      ['beats', () => piano.sequence([['C4', NaN]])],
      ['tempo', () => piano.sequence([['C4', 1]], { tempo: 0 })],
      ['tempo', () => piano.sequence([['C4', 1]], { tempo: NaN })],
      ['volume', () => synth.set({ volume: NaN })],
      ['reverb.decay', () => synth.set({ reverb: { decay: NaN } })],
      ['at', () => synth.set({ volume: 1 }, { at: NaN })],
      ['at', () => synth.allNotesOff({ at: Infinity })],
      ['seconds', () => synth.render(NaN)],
      ['wind', () => organ.set({ wind: NaN })],
      ['expression', () => organ.great.expression(NaN)],
      ['velocity', () => organ.great.noteOn('C4', NaN)],
      ['volume', () => synth.add('flute', { parameters: { volume: NaN } })],
      ['argument 2', () => synth._native().pitchBend(piano.channel, NaN)], // the backstop
    ];
    for (const [name, call] of calls) {
      let error: unknown;
      try {
        call();
      } catch (e) {
        error = e;
      }
      expect([name, error instanceof SupersynthError]).toEqual([name, true]);
      expect((error as Error).message).toContain(name);
    }
    expect(synth.instruments()).toHaveLength(2);
    piano.play('A4', { duration: 0.4 });
    organ.great.play('C4', { duration: 0.4 });
    const a = synth.render(0.5);
    expect(a.left.every(Number.isFinite)).toBe(true);
    expect(rms(a.left)).toBeGreaterThan(1e-3);
  });

  test('native errors are SupersynthErrors', () => {
    const synth = new Synth({ sampleRate: 22050 });
    expect(() => synth._native().setParam(0, 'nope', 1)).toThrow(SupersynthError);
  });
});

describe('the engine queue', () => {
  test('a note that does not fit throws before anything is sent: no stuck notes', () => {
    const synth = new Synth({ sampleRate: 22050, reverb: false });
    const flute = synth.add('flute');
    const n = synth._native();
    let i = 0;
    expect(() => {
      for (;;) {
        flute.play(['C4', 'E4', 'G4'], { at: 1 + i * 0.001, duration: 0.0005 });
        i++;
      }
    }).toThrow(/queue is full/);
    expect(i).toBeGreaterThan(5000);
    const free = n.queueFree;
    expect(free).toBeLessThan(6);
    // neither a chord nor a sequence that does not fit sends anything
    expect(() => flute.play(['C4', 'E4', 'G4'])).toThrow(SupersynthError);
    expect(() => flute.sequence([['C4', 1], ['D4', 1], ['E4', 1]])).toThrow(SupersynthError);
    expect(n.queueFree).toBe(free);
    // once rendered, there is room again
    synth.render(0.01);
    flute.play(['C4', 'E4', 'G4']);
  });
});

describe('failed constructors take nothing', () => {
  test('instruments and organs that fail to be created leave every channel free', () => {
    const synth = new Synth({ sampleRate: 22050 });
    const great = BUREA_ORGAN.stops.find((s) => s.division === 'great')!;
    const ghostOrgan: OrganDefinition = {
      ...BUREA_ORGAN, id: 'ghost', stops: [{ ...great, model: 'organ/no-such-model' }], presets: { x: { great: [great.name] } }, defaultPreset: 'x',
    };
    const failures: (() => unknown)[] = [
      () => synth.add('grand-piano', { parameters: { brightness: NaN } }),
      () => synth.add('grand-piano', { parameters: { nope: 1 } as never }),
      () => synth.add('grand-piano', { preset: 'nope' }),
      () => synth.add({ ...GRAND_PIANO, id: 'ghost', layers: [{ model: 'no/such-model' }] }),
      () => synth.add('burea', { preset: { great: ['Bombarde 32'] } }),
      () => synth.add('burea', { wind: NaN }),
      () => synth.add({ ...BUREA_ORGAN, stops: [] }, { preset: 'plenum' }),
      () => synth.add(ghostOrgan),
    ];
    for (const f of failures) expect(f).toThrow(SupersynthError);
    expect(synth['roomOwner']).toBeUndefined();
    expect(synth._loadedModels()).toEqual([]);
    const flutes = [...Array(32)].map(() => synth.add('flute'));
    expect(synth.instruments()).toHaveLength(32);
    expect(synth['roomOwner']).toBe(flutes[0]);
  });
});

describe('removed instruments', () => {
  test('using a removed instrument or organ throws', () => {
    const synth = new Synth({ sampleRate: 22050 });
    const piano = synth.add('grand-piano');
    const organ = synth.add('burea', { preset: 'flutes' });
    synth.remove(piano);
    synth.remove(organ);
    expect(() => piano.play('C4')).toThrow(SupersynthError);
    expect(() => piano.noteOn('C4')).toThrow(/removed/);
    expect(() => piano.set({ brightness: 1 })).toThrow(SupersynthError);
    expect(() => piano.midi(1)).toThrow(SupersynthError);
    expect(() => organ.great.play('C4')).toThrow(/removed/);
    expect(() => organ.preset('plenum')).toThrow(SupersynthError);
    expect(() => organ.great.pull("Principal 8'")).toThrow(SupersynthError);
    expect(() => synth.renderMidi(allChannels, { instrument: piano })).toThrow(SupersynthError);
    expect(piano.activePreset()).toBe('default'); // state can still be read
    synth.remove(piano); // twice is fine
  });

  test('models are unloaded when nothing uses them, and close() releases everything', () => {
    const synth = new Synth({ sampleRate: 22050 });
    const a = synth.add('flute');
    const b = synth.add('flute');
    const organ = synth.add('burea', { preset: 'flutes' });
    expect(synth._loadedModels()).toContain('flute');
    synth.remove(a);
    expect(synth._loadedModels()).toContain('flute'); // b still plays it
    synth.remove(b);
    expect(synth._loadedModels()).not.toContain('flute');
    organ.great.pull("Principal 8'");
    synth.remove(organ);
    expect(synth._loadedModels()).toEqual([]);
    // swapping organs keeps only the one playing
    const vcsl = synth.add('vcsl');
    const loaded = synth._loadedModels();
    synth.remove(synth.add('burea', { preset: 'plenum' }));
    expect(synth._loadedModels()).toEqual(loaded);
    synth.close();
    expect(synth._loadedModels()).toEqual([]);
    expect(synth.instruments()).toEqual([]);
    expect(() => vcsl.great.play('C4')).toThrow(SupersynthError);
    expect(() => synth.add('flute')).toThrow(/closed/);
  });

  test('a channel freed by remove() comes back clean', () => {
    const level = (setup: (f: Instrument) => void) => {
      const synth = new Synth({ sampleRate: 22050, reverb: false });
      const old = synth.add('flute');
      setup(old);
      synth.remove(old);
      const fresh = synth.add('flute');
      expect(fresh.channel).toBe(old.channel);
      fresh.play('A4', { duration: 0.5 });
      return rms(synth.render(0.5).left);
    };
    const reference = level(() => {});
    expect(reference).toBeGreaterThan(1e-3);
    const after = level((f) => f.set({ volume: -80 }).expression(0).pitchBend(1).sustain(true));
    expect(after).toBeGreaterThan(reference * 0.8);
    expect(after).toBeLessThan(reference * 1.25);
  });
});

describe('organ', () => {
  test('MIDI program-change presets are checked when given; a failing one never throws out of the event', () => {
    const synth = new Synth({ sampleRate: 22050 });
    const organ = synth.add('burea');
    expect(() => organ.midi({ great: 1 }, { presets: ['flutes', 'plenumm'] })).toThrow(SupersynthError);
    organ.midi({ great: 1 });
    organ.savePreset('broken', { great: ['Bombarde 32'] });
    const program = Object.keys(organ.presets()).indexOf('broken');
    const change = { type: 'programChange', channel: 1, program, raw: Buffer.from([0xc0, program]) };
    expect(() => synth.emit('midi', change)).not.toThrow();
    const errors: unknown[] = [];
    synth.on('error', (e) => errors.push(e));
    synth.emit('midi', change);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(SupersynthError);
  });

  test('velocity 0 on a division is clamped, not a key-off', () => {
    const synth = new Synth({ sampleRate: 22050, reverb: false });
    const organ = synth.add('burea', { preset: 'flutes' });
    organ.great.noteOn('C4', 0);
    expect(rms(synth.render(0.4).left)).toBeGreaterThan(1e-3);
    organ.great.noteOn('E4', 1000);
    organ.great.allNotesOff();
  });
});

describe('synth settings', () => {
  test('changing the reverb keeps its level; turning it back on restores it', () => {
    const synth = new Synth({ sampleRate: 22050 });
    const calls = spy(synth, ['setMasterParam']);
    const levels = () => calls.filter((c) => c[1] === 'reverbLevel').map((c) => c[2]);
    synth.set({ reverb: { level: -6 } });
    synth.set({ reverb: { decay: 4 } });
    synth.set({ reverb: 'cathedral' });
    expect(levels()).toEqual([-6]);
    synth.set({ reverb: false });
    synth.set({ reverb: { decay: 3 } });
    expect(levels()).toEqual([-6, -120, -6]);
    synth.set({ reverb: false }).set({ reverb: { level: -3 } });
    expect(levels()).toEqual([-6, -120, -6, -120, -3]);
  });

  test("while the room is automatic it follows the first instrument's presets", () => {
    const synth = new Synth({ sampleRate: 22050 });
    const calls = spy(synth, ['setReverbPreset']);
    const rooms = () => calls.map((c) => c[1]);
    const piano = synth.add('grand-piano');
    expect(rooms()).toEqual(['hall']);
    piano.preset('concert');
    piano.preset('studio');
    expect(rooms()).toEqual(['hall', 'concert-hall', 'studio']);
    const other = synth.add('grand-piano');
    other.preset('concert'); // not the instrument that chose the room
    expect(rooms()).toEqual(['hall', 'concert-hall', 'studio']);
    synth.set({ reverb: 'room' });
    piano.preset('concert'); // the room was set by hand
    expect(rooms()).toEqual(['hall', 'concert-hall', 'studio', 'room']);
  });
});
