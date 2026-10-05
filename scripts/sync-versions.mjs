#!/usr/bin/env node
// Gives the platform packages (npm/*) the root package's version and points supersynth's
// optionalDependencies at it; runs as the `version` lifecycle script of `npm version`.
// The model packages (packages/*) keep their own versions: they change only with their models.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

const rootFile = path.join(root, 'package.json');
const pkg = readJson(rootFile);
for (const triple of readdirSync(path.join(root, 'npm'))) {
  const file = path.join(root, 'npm', triple, 'package.json');
  const platform = readJson(file);
  platform.version = pkg.version;
  writeJson(file, platform);
  pkg.optionalDependencies[platform.name] = pkg.version;
}
writeJson(rootFile, pkg);
const npm = spawnSync('npm', ['install', '--package-lock-only', '--ignore-scripts'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(npm.status ?? 1);
