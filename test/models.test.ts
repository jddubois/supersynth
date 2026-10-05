// Model resolution: pure TypeScript, no native addon.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SupersynthError } from '../src/errors.js';
import { assertOrganModels, findPackageDir, modelPackage, ORGAN_MODEL_PACKAGES, resolveModelFile } from '../src/models.js';
import { PIOTR_ORGANS } from '../src/organs/piotr/index.js';
import { BUREA_ORGAN } from '../src/organs/burea.js';
import { VCSL_ORGAN } from '../src/organs/vcsl.js';

const root = process.cwd();
const none = () => undefined;

describe('model packages', () => {
  test('every organ with models of its own has a package', () => {
    expect([...ORGAN_MODEL_PACKAGES].sort()).toEqual(['burea', ...Object.keys(PIOTR_ORGANS)].sort());
  });

  test('which package a model is in', () => {
    expect(modelPackage('grand-piano')).toBeUndefined();
    expect(modelPackage('pipe-organ-soft')).toBeUndefined();
    expect(modelPackage('organ/great-principal-8')).toEqual({ organ: 'burea', pkg: 'supersynth-organ-burea' });
    expect(modelPackage('organ/friesach/great-principal-8')).toEqual({ organ: 'friesach', pkg: 'supersynth-organ-friesach' });
    expect(modelPackage('organ/saint-jean-de-luz/x')).toEqual({ organ: 'saint-jean-de-luz', pkg: 'supersynth-organ-saint-jean-de-luz' });
    expect(modelPackage('organ/unknown/x')).toBeUndefined();
  });
});

describe('resolveModelFile', () => {
  let tmp: string;
  const saved = process.env.SUPERSYNTH_MODELS_DIR;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'supersynth-models-'));
    delete process.env.SUPERSYNTH_MODELS_DIR;
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    if (saved === undefined) delete process.env.SUPERSYNTH_MODELS_DIR;
    else process.env.SUPERSYNTH_MODELS_DIR = saved;
  });
  const put = (dir: string, name: string) => {
    const file = path.join(dir, `${name}.ssm`);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '');
    return file;
  };

  test('core models ship with supersynth', () => {
    expect(resolveModelFile('grand-piano')).toBe(path.join(root, 'models', 'grand-piano.ssm'));
  });

  test("organ models come from the organ's package", () => {
    const friesach = findPackageDir('supersynth-organ-friesach');
    expect(friesach).toBeDefined();
    expect(resolveModelFile('organ/friesach/great-principal-8')).toBe(path.join(friesach!, 'models', 'organ', 'friesach', 'great-principal-8.ssm'));
    expect(resolveModelFile('organ/great-principal-8')).toBe(path.join(findPackageDir('supersynth-organ-burea')!, 'models', 'organ', 'great-principal-8.ssm'));
  });

  test('modelsDirectory, then $SUPERSYNTH_MODELS_DIR, come first (the whole tree)', () => {
    const mine = put(path.join(tmp, 'a'), 'organ/friesach/great-principal-8');
    const env = put(path.join(tmp, 'b'), 'organ/friesach/great-principal-8');
    process.env.SUPERSYNTH_MODELS_DIR = path.join(tmp, 'b');
    expect(resolveModelFile('organ/friesach/great-principal-8', path.join(tmp, 'a'))).toBe(mine);
    expect(resolveModelFile('organ/friesach/great-principal-8')).toBe(env);
    // anything not there falls back to the installed models
    expect(resolveModelFile('grand-piano', path.join(tmp, 'a'))).toBe(path.join(root, 'models', 'grand-piano.ssm'));
  });

  test('a missing organ package names the package to install', () => {
    expect(() => resolveModelFile('organ/friesach/great-principal-8', undefined, none)).toThrow(SupersynthError);
    expect(() => resolveModelFile('organ/friesach/great-principal-8', undefined, none)).toThrow(
      "The organ 'friesach' needs its models: npm install supersynth-organ-friesach",
    );
    expect(() => resolveModelFile('organ/great-principal-8', undefined, none)).toThrow('npm install supersynth-organ-burea');
    // a models directory that has them is enough
    put(tmp, 'organ/friesach/great-principal-8');
    expect(resolveModelFile('organ/friesach/great-principal-8', tmp, none)).toBe(path.join(tmp, 'organ', 'friesach', 'great-principal-8.ssm'));
  });

  test('a package without the model, and unknown models, say where they looked', () => {
    put(path.join(tmp, 'models'), 'organ/friesach/other');
    expect(() => resolveModelFile('organ/friesach/great-principal-8', undefined, () => tmp)).toThrow(/not in supersynth-organ-friesach/);
    expect(() => resolveModelFile('no-such-instrument')).toThrow(/Instrument model 'no-such-instrument' not found/);
  });

  test('every organ resolves all its stops', () => {
    for (const organ of [BUREA_ORGAN, VCSL_ORGAN, ...Object.values(PIOTR_ORGANS)]) expect(() => assertOrganModels(organ)).not.toThrow();
  });
});
