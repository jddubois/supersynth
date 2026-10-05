// Where `.ssm` models are in Node.js: files, in supersynth's own `models/`, a directory given,
// or the organ's npm package.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { SupersynthError } from '../errors.js';
import { modelPackage, organModels } from '../models.js';
import { packageRoot } from '../native.js';

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

/**
 * @internal Checks that every model of an organ (stops, Forte, noises) is there, so a missing
 * organ package is reported by `synth.add()` before any channel is taken.
 */
export function assertOrganModels(organ: Parameters<typeof organModels>[0], modelsDirectory?: string): void {
  for (const name of organModels(organ)) resolveModelFile(name, modelsDirectory);
}
