import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BUREA_ORGAN, Synth, SupersynthError, type OrganDefinition, type OrganPreload } from '../src/index.js';
import { organModels } from '../src/models.js';
import { resolveModelFile } from '../src/platform/node-models.js';
import { stopModel } from '../src/Organ.js';

const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / Math.max(1, a.length));

/** Models of the stops a preset of the Bureå organ draws. */
function presetModels(name: string): string[] {
  const p = BUREA_ORGAN.presets[name]!;
  const stops = (['great', 'swell', 'positive', 'pedal'] as const).flatMap((d) => (p[d] ?? []).map((n) => BUREA_ORGAN.stops.find((s) => s.division === d && s.name === n)!));
  return [...new Set(stops.map(stopModel))];
}

const sorted = (a: string[]) => [...a].sort();

describe('background model loading', () => {
  test('an organ preloads all its models; its preset sounds at once, the rest by organ.ready', async () => {
    const synth = new Synth({ sampleRate: 22050, reverb: false });
    const organ = synth.add('burea', { preset: 'flutes', preload: 'all' });
    expect(sorted(synth._loadedModels())).toEqual(sorted(organModels(BUREA_ORGAN)));
    // the preset's models are loaded by add() itself
    const ids = synth['models'] as Map<string, { id: number }>;
    for (const m of presetModels('flutes')) expect(synth._native().modelBytes(ids.get(m)!.id)).toBeGreaterThan(0);
    organ.great.play('C4', { duration: 0.3 });
    expect(rms(synth.render(0.4).left)).toBeGreaterThan(1e-4);
    await organ.ready;
    await synth.ready();
    for (const { id } of ids.values()) expect(synth._native().modelBytes(id)).toBeGreaterThan(0);
    expect(synth._modelBytes()).toBeGreaterThan(100e6);
    synth.close();
    expect(synth._loadedModels()).toEqual([]);
  });

  test("preload 'preset' and false load only what is drawn; a stop drawn later loads then", async () => {
    for (const preload of ['preset', false] as const) {
      const synth = new Synth({ sampleRate: 22050, reverb: false });
      const organ = synth.add('burea', { preset: 'flutes', preload });
      await organ.ready;
      expect(sorted(synth._loadedModels())).toEqual(sorted(presetModels('flutes')));
      organ.swell.pull("Salicional 8'");
      expect(synth._loadedModels()).toContain('organ/swell-salicional-8');
      organ.swell.play('C4', { duration: 0.3 });
      expect(rms(synth.render(0.4).left)).toBeGreaterThan(1e-4);
      synth.close();
    }
    const synth = new Synth({ sampleRate: 22050 });
    expect(() => synth.add('burea', { preload: 'some' as OrganPreload })).toThrow(SupersynthError);
    expect(synth._loadedModels()).toEqual([]);
  });

  test('a stop drawn while its model is still loading sounds, exactly as when loaded beforehand', async () => {
    const render = (preload: OrganPreload) => {
      const synth = new Synth({ sampleRate: 22050, reverb: false });
      const organ = synth.add('burea', { preset: 'flute-8', preload });
      // drawn at once: still queued or loading in the background
      organ.great.pull(["Trumpet 8'", 'Mixture V', "Principal 8'"]);
      organ.swell.set({ stops: ["Schalmei 8'", 'Scharf III'] });
      organ.preset('full', { at: 0.5 });
      organ.great.play(['C4', 'G4'], { duration: 0.8 });
      organ.swell.play('E4', { duration: 0.8, at: 0.4 });
      const audio = synth.render(1);
      synth.close();
      return audio.left;
    };
    const late = render('all');
    const loaded = render(false);
    expect(rms(late)).toBeGreaterThan(1e-3);
    expect(late).toEqual(loaded);
  });

  test('in real time too, the registration given to add() sounds as soon as add() returns', () => {
    const synth = new Synth({ sampleRate: 22050, reverb: false });
    synth['emulateRealtime'] = true;
    const organ = synth.add('burea', { preset: 'plenum', preload: 'all' });
    for (const d of organ.divisions()) {
      const layers = d['layers'] as Map<string, number>;
      for (const name of d.drawn()) expect(layers.has(name)).toBe(true);
    }
    organ.great.play('C4', { duration: 0.3 });
    expect(rms(synth._native().render(Math.round(22050 * 0.4)))).toBeGreaterThan(1e-4);
    synth.close();
  });

  test('in real time, a stop drawn while its model loads does not wait: it sounds once loaded', async () => {
    const synth = new Synth({ sampleRate: 22050, reverb: false });
    synth['emulateRealtime'] = true;
    const organ = synth.add('burea', { preset: 'flute-8', preload: 'all' });
    const all = organModels(BUREA_ORGAN);
    // the last models queued are still loading right after add()
    const stops = BUREA_ORGAN.stops.filter((s) => all.indexOf(stopModel(s)) >= all.length - 6 && !presetModels('flute-8').includes(stopModel(s)));
    const loading = stops.filter((s) => synth._native().modelLoading(synth._modelId(stopModel(s))));
    expect(loading.length).toBeGreaterThan(1);
    const [a, b] = loading as [typeof stops[0], typeof stops[0]];
    const t0 = performance.now();
    organ.division(a.division).pull(a.name);
    organ.division(b.division).pull(b.name);
    expect(performance.now() - t0).toBeLessThan(20); // (a model takes longer than that to load)
    expect(organ.division(a.division).drawn()).toContain(a.name);
    organ.division(b.division).push(b.name); // retired before it had loaded: never sounds
    await organ.ready;
    await new Promise((r) => setTimeout(r, 20));
    const layers = (d: string) => organ.division(d as 'great')['layers'] as Map<string, number>;
    expect(layers(a.division).has(a.name)).toBe(true);
    expect(layers(b.division).has(b.name)).toBe(false);
    expect(organ.division(b.division).drawn()).not.toContain(b.name);
    organ.division(a.division).play(a.division === 'pedal' ? 'C3' : 'C4', { duration: 0.3 });
    expect(rms(synth.render(0.4).left)).toBeGreaterThan(1e-4);
    // drawn in real time and rendered offline before it loaded: render() waits for it
    synth.close();
    const s2 = new Synth({ sampleRate: 22050, reverb: false });
    s2['emulateRealtime'] = true;
    const o2 = s2.add('burea', { preset: 'flute-8', preload: 'all' });
    o2.division(a.division).pull(a.name);
    s2['emulateRealtime'] = false;
    o2.division(a.division).play(a.division === 'pedal' ? 'C3' : 'C4', { duration: 0.3 });
    expect(rms(s2.render(0.4).left)).toBeGreaterThan(1e-4);
    expect((o2.division(a.division)['layers'] as Map<string, number>).has(a.name)).toBe(true);
    s2.close();
  });

  test('removing an organ (or closing the synth) while it loads drops its models and settles ready', async () => {
    const synth = new Synth({ sampleRate: 22050, reverb: false });
    const flute = synth.add('flute');
    for (let i = 0; i < 5; i++) {
      const organ = synth.add('burea', { preset: 'flutes', preload: 'all' });
      const ids = [...(synth['models'] as Map<string, { id: number }>).entries()].filter(([n]) => n !== 'flute').map(([, m]) => m.id);
      if (i % 2) organ.great.pull("Trumpet 8'");
      synth.remove(organ);
      expect(synth._loadedModels()).toEqual(['flute']);
      await organ.ready; // resolves: nothing left to wait for
      for (const id of ids) expect(synth._native().modelBytes(id)).toBeNull();
      expect(() => synth._native().modelInfo(ids[0]!)).toThrow(/unknown model/);
    }
    flute.play('A4', { duration: 0.2 });
    expect(rms(synth.render(0.3).left)).toBeGreaterThan(1e-4);
    // a model shared with an instrument stays while it plays
    const organ = synth.add({ ...BUREA_ORGAN, id: 'with-flute', stops: [...BUREA_ORGAN.stops, { id: 'x', name: 'Flute', division: 'swell', family: 'flute', transpose: 0, model: 'flute' }] });
    synth.remove(organ);
    expect(synth._loadedModels()).toEqual(['flute']);
    const another = synth.add('burea');
    synth.close();
    await another.ready;
    expect(synth._loadedModels()).toEqual([]);
  });

  describe('a corrupt model', () => {
    let tmp: string;
    beforeEach(() => {
      tmp = mkdtempSync(path.join(tmpdir(), 'supersynth-loading-'));
    });
    afterEach(() => rmSync(tmp, { recursive: true, force: true }));

    /** The Bureå organ with one more stop, whose model file is `bytes`. */
    function broken(bytes: Uint8Array): OrganDefinition {
      const file = path.join(tmp, 'test', 'broken.ssm');
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, bytes);
      return { ...BUREA_ORGAN, id: 'broken', stops: [...BUREA_ORGAN.stops, { id: 'broken', name: 'Broken 8', division: 'swell', family: 'flute', transpose: 0, model: 'test/broken' }] };
    }

    test('loaded in the background: ready rejects, an error event, and the stop throws when drawn', async () => {
      const good = readFileSync(resolveModelFile('organ/great-gedackt-8'));
      const truncated = good.subarray(0, good.length >> 1);
      for (const bytes of [truncated, Buffer.from('not a model at all'), Buffer.from([0x1f, 0x8b, 8, 0, 1, 2, 3])]) {
        const synth = new Synth({ sampleRate: 22050, modelsDirectory: tmp });
        const errors: unknown[] = [];
        synth.on('error', (e) => errors.push(e));
        const organ = synth.add(broken(bytes), { preset: 'flutes' });
        await expect(organ.ready).rejects.toThrow(SupersynthError);
        await expect(organ.ready).rejects.toThrow(/broken\.ssm/);
        await expect(synth.ready()).rejects.toThrow(SupersynthError);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toBeInstanceOf(SupersynthError);
        // drawing it fails (every time) and changes nothing; the other stops play
        for (let i = 0; i < 2; i++) expect(() => organ.swell.pull('Broken 8')).toThrow(SupersynthError);
        expect(organ.swell.drawn()).toEqual([]);
        organ.swell.pull("Salicional 8'");
        organ.swell.play('C4', { duration: 0.3 });
        expect(rms(synth.render(0.4).left)).toBeGreaterThan(1e-4);
        synth.close();
      }
    }, 30_000); // loads a whole organ three times: seconds on a busy or small machine

    test('in the starting preset: add() throws and leaves nothing behind', () => {
      const synth = new Synth({ sampleRate: 22050, modelsDirectory: tmp });
      const def = broken(Buffer.from('garbage'));
      expect(() => synth.add(def, { preset: { swell: ['Broken 8'] } })).toThrow(SupersynthError);
      expect(synth._loadedModels()).toEqual([]);
      expect(synth.instruments()).toEqual([]);
    });

    test('not awaited and no error listener: no unhandled rejection', async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (e: unknown) => unhandled.push(e);
      process.on('unhandledRejection', onUnhandled);
      try {
        const synth = new Synth({ sampleRate: 22050, modelsDirectory: tmp });
        const organ = synth.add(broken(Buffer.from('garbage')), { preset: 'flutes' });
        // wait for the background loading to finish, without touching organ.ready
        for (let i = 0; i < 1000 && !organ['loading']!.settled; i++) await new Promise((r) => setTimeout(r, 10));
        expect(organ['loading']!.settled).toBe(true);
        await new Promise((r) => setTimeout(r, 20));
        expect(unhandled).toEqual([]);
        synth.close();
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });
  });
});
