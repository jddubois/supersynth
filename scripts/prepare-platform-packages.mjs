#!/usr/bin/env node
// Readies the platform packages (npm/<triple>) for publishing: checks that each has its binary
// and the root package's version, and adds the `os`, `cpu` and `libc` fields that make npm install
// only the one matching the machine.
//
// The fields are not in the repository's npm/*/package.json because npm/* are workspaces:
// `npm install`/`npm ci` refuse (EBADPLATFORM) a workspace whose os/cpu do not match.
//
//   node scripts/prepare-platform-packages.mjs [--check]   (--check: verify only, write nothing)
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const { version, optionalDependencies = {} } = readJson(path.join(root, 'package.json'));

let failed = false;
const fail = (msg) => {
  console.error(msg);
  failed = true;
};

for (const triple of readdirSync(path.join(root, 'npm'))) {
  const dir = path.join(root, 'npm', triple);
  const file = path.join(dir, 'package.json');
  const pkg = readJson(file);
  const [os, cpu, abi] = triple.split('-');
  if (pkg.name !== `@supersynth/${triple}`) fail(`${file}: name should be @supersynth/${triple}`);
  if (pkg.version !== version) fail(`${pkg.name}: version ${pkg.version}, root ${version} (run node scripts/sync-versions.mjs)`);
  if (optionalDependencies[pkg.name] !== version) fail(`package.json: optionalDependencies["${pkg.name}"] should be ${version}`);
  if (!existsSync(path.join(dir, pkg.main))) fail(`${pkg.name}: ${pkg.main} is missing (node scripts/build-native.mjs --target ${triple})`);
  if (check) continue;
  pkg.os = [os];
  pkg.cpu = [cpu];
  if (os === 'linux') pkg.libc = [abi === 'musl' ? 'musl' : 'glibc'];
  writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`${pkg.name}@${pkg.version}: os ${pkg.os}, cpu ${pkg.cpu}${pkg.libc ? `, libc ${pkg.libc}` : ''}`);
}
for (const name of Object.keys(optionalDependencies)) {
  if (name.startsWith('@supersynth/') && !name.startsWith('@supersynth/organ') && !existsSync(path.join(root, 'npm', name.slice('@supersynth/'.length)))) fail(`package.json: optional dependency ${name} has no npm/ folder`);
}
process.exit(failed ? 1 : 0);
