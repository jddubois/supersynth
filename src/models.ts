// Where `.ssm` models are found. The core instruments ship in supersynth's own `models/`; each
// organ sample set ships in its own npm package (`@supersynth/organ-<id>`), with the same tree
// under the package's `models/` (`organ/<id>/<stop>.ssm`, the Bureå organ `organ/<stop>.ssm`).
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { SupersynthError } from './errors.js';
import { packageRoot } from './native.js';

/** @internal Organs whose models are in a package of their own (`@supersynth/organ-<id>`). */
export const ORGAN_MODEL_PACKAGES = [
  'burea',
  'azzio',
  'cracow',
  'dluga-koscielna',
  'friesach',
  'giubiasco',
  'green-positiv',
  'harmonium',
  'ledziny',
  'lipiny',
  'melcer',
  'raszczyce',
  'saint-jean-de-luz',
  'skrzatusz',
  'strassburg',
  'szczecinek',
] as const;

const PACKAGED = new Set<string>(ORGAN_MODEL_PACKAGES);

/** @internal The organ and npm package a model ships in, or `undefined` for a core model
 *  (shipped with supersynth). `organ/<id>/<stop>` is in `@supersynth/organ-<id>`, `organ/<stop>`
 *  (the Bureå organ) in `@supersynth/organ-burea`. */
export function modelPackage(name: string): { organ: string; pkg: string } | undefined {
  const parts = name.split('/');
  if (parts[0] !== 'organ') return undefined;
  const organ = parts.length === 2 ? 'burea' : parts.length === 3 ? parts[1]! : undefined;
  if (!organ || !PACKAGED.has(organ)) return undefined;
  return { organ, pkg: `@supersynth/organ-${organ}` };
}

/** @internal Finds the directory of an installed package, or `undefined`. */
export type PackageFinder = (pkg: string) => string | undefined;

const packageDirs = new Map<string, string>();

/** @internal The directory of an installed model package: resolved from supersynth itself, then
 *  from the working directory (linked or global installs), then — in a git clone — from the
 *  workspace folder `packages/organ-<id>`. */
export const findPackageDir: PackageFinder = (pkg) => {
  const cached = packageDirs.get(pkg);
  if (cached) return cached;
  const from = [import.meta.url, path.join(process.cwd(), 'index.js')];
  let dir: string | undefined;
  for (const base of from) {
    try {
      dir = path.dirname(createRequire(base).resolve(`${pkg}/package.json`));
      break;
    } catch {
      // not resolvable from there
    }
  }
  if (!dir) {
    const workspace = path.join(packageRoot(), 'packages', pkg.replace(/^@supersynth\//, ''));
    if (existsSync(path.join(workspace, 'package.json'))) dir = workspace;
  }
  if (dir) packageDirs.set(pkg, dir);
  return dir;
};

/**
 * @internal The file of a model (`grand-piano`, `organ/friesach/great-principal-8`, …). Searched
 * in order: `modelsDirectory` and `$SUPERSYNTH_MODELS_DIR` (each the whole tree:
 * `<dir>/organ/friesach/great-principal-8.ssm`), supersynth's own `models/`, then the
 * organ's package. Throws a {@link SupersynthError} naming the package to install when an organ's
 * package is missing.
 */
export function resolveModelFile(name: string, modelsDirectory?: string, findPackage: PackageFinder = findPackageDir): string {
  const file = `${name}.ssm`;
  const dirs = [modelsDirectory, process.env.SUPERSYNTH_MODELS_DIR, path.join(packageRoot(), 'models')];
  const tried: string[] = [];
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.resolve(dir, file);
    if (existsSync(candidate)) return candidate;
    tried.push(candidate);
  }
  const owner = modelPackage(name);
  if (owner) {
    const dir = findPackage(owner.pkg);
    if (!dir) throw new SupersynthError(`The organ '${owner.organ}' needs its models: npm install ${owner.pkg}`);
    const candidate = path.join(dir, 'models', file);
    if (existsSync(candidate)) return candidate;
    tried.push(candidate);
    throw new SupersynthError(
      `Model '${name}' is not in ${owner.pkg} (${dir}); install the version of ${owner.pkg} that matches supersynth. Looked in:\n  ${tried.join('\n  ')}`,
    );
  }
  throw new SupersynthError(`Instrument model '${name}' not found. Looked in:\n  ${tried.join('\n  ')}`);
}

/** The models an organ definition names besides its stops' own: Forte models and machinery
 *  noises. */
interface OrganModels {
  stops: readonly { id: string; model?: string; forte?: string }[];
  noises?: {
    keys?: Partial<Record<string, { down?: string; up?: string }>>;
    stops?: string;
    blower?: { model: string };
    ambient?: { model: string };
  };
}

/** @internal Every model an organ may load: each stop's (the same rule as `stopModel` in
 *  Organ.ts: `stop.model`, else `organ/<stop id>`), its Forte model, and the noise models. */
export function organModels(organ: OrganModels): string[] {
  const names = new Set<string>();
  for (const stop of organ.stops) {
    names.add(stop.model ?? `organ/${stop.id}`);
    if (stop.forte) names.add(stop.forte);
  }
  const nz = organ.noises;
  if (nz) {
    for (const k of Object.values(nz.keys ?? {})) for (const m of [k?.down, k?.up]) if (m) names.add(m);
    for (const m of [nz.stops, nz.blower?.model, nz.ambient?.model]) if (m) names.add(m);
  }
  return [...names];
}

/**
 * @internal Checks that every model of an organ (stops, Forte, noises) is there, so a missing
 * organ package is reported by `synth.add()` before any channel is taken.
 */
export function assertOrganModels(organ: OrganModels, modelsDirectory?: string): void {
  for (const name of organModels(organ)) resolveModelFile(name, modelsDirectory);
}
