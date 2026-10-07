#!/usr/bin/env node
// The models (`.ssm`) live on npm, not in git: each model package (packages/instruments,
// packages/organ-<id>) publishes its `models/` folder, and a clone downloads them back into the
// same place, at the version its package.json pins.
//
//   npm run models:fetch                  every model package (skips ones already fetched, and
//                                         ones not on npm yet)
//   npm run models:fetch -- organ-burea   only these (folder names under packages/)
//   npm run models:publish -- organ-burea publish these: bump the package's version first; a
//                                         version already on npm is skipped, never overwritten
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = path.join(root, 'packages');
/** Records which version a package's models/ holds (next to models/, so never published). */
const MARKER = '.models-version';

/** Model packages: workspace packages that publish a `models/` folder. */
function modelPackages() {
  return readdirSync(packagesDir)
    .map((dir) => ({ dir, file: path.join(packagesDir, dir, 'package.json') }))
    .filter(({ file }) => existsSync(file))
    .map(({ dir, file }) => ({ dir, ...JSON.parse(readFileSync(file, 'utf8')) }))
    .filter((p) => p.files?.includes('models'));
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})`);
  return r.stdout;
}

function select(names) {
  const all = modelPackages();
  if (!names.length) return all;
  return names.map((n) => {
    const p = all.find((x) => x.dir === n || x.name === n);
    if (!p) throw new Error(`no model package '${n}' (one of: ${all.map((x) => x.dir).join(', ')})`);
    return p;
  });
}

/** Whether a package version is on npm. */
function published(want) {
  return Boolean(spawnSync('npm', ['view', want, 'version'], { encoding: 'utf8', shell: process.platform === 'win32' }).stdout.trim());
}

function fetch(pkgs, named) {
  for (const p of pkgs) {
    const models = path.join(packagesDir, p.dir, 'models');
    const marker = path.join(packagesDir, p.dir, MARKER);
    const want = `${p.name}@${p.version}`;
    if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === want) {
      console.log(`${want}: already fetched`);
      continue;
    }
    if (!named && !published(want)) {
      // (a new model package, published later: its instrument is skipped by the tests until then)
      console.log(`${want}: not on npm yet, skipped`);
      continue;
    }
    const tmp = mkdtempSync(path.join(tmpdir(), 'supersynth-models-'));
    try {
      const [{ filename }] = JSON.parse(run('npm', ['pack', want, '--json', '--pack-destination', tmp]));
      run('tar', ['-xzf', path.join(tmp, filename), '-C', tmp]);
      rmSync(models, { recursive: true, force: true });
      cpSync(path.join(tmp, 'package', 'models'), models, { recursive: true });
      writeFileSync(marker, `${want}\n`);
      console.log(`${want}: fetched into packages/${p.dir}/models/`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
}

function publish(pkgs) {
  for (const p of pkgs) {
    const want = `${p.name}@${p.version}`;
    if (published(want)) {
      console.log(`${want} is already on npm: bump packages/${p.dir}/package.json's version to publish new models`);
      continue;
    }
    const models = path.join(packagesDir, p.dir, 'models');
    if (!existsSync(models) || !readdirSync(models).length) throw new Error(`packages/${p.dir}/models/ is empty`);
    run('npm', ['publish', path.join(packagesDir, p.dir), '--access', 'public'], { stdio: 'inherit' });
    writeFileSync(path.join(packagesDir, p.dir, MARKER), `${want}\n`);
  }
}

const [command, ...names] = process.argv.slice(2);
if (command === 'fetch') fetch(select(names), names.length > 0);
else if (command === 'publish') {
  if (!names.length) throw new Error('name the packages to publish (e.g. organ-burea); bump their versions first');
  publish(select(names));
} else {
  console.error('usage: node scripts/models.mjs fetch [package…] | publish <package…>');
  process.exit(1);
}
