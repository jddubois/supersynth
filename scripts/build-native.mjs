#!/usr/bin/env node
// Builds the native engine (native/, napi-rs) and copies it where supersynth loads it from.
//
//   node scripts/build-native.mjs                     -> ./supersynth.node (development)
//   node scripts/build-native.mjs --target <triple>   -> npm/<triple>/supersynth.<triple>.node
//        [--rust-target <rust triple>]                   cross-compile (e.g. x86_64-apple-darwin)
//        [--out <dir>]                                   another directory for the binary
//        [--debug]                                       debug build
//
// <triple> is one of the platform packages in npm/ (linux-x64-gnu, darwin-arm64, …).
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({
  options: {
    target: { type: 'string' },
    'rust-target': { type: 'string' },
    out: { type: 'string' },
    debug: { type: 'boolean', default: false },
  },
});

const triples = readdirSync(path.join(root, 'npm'));
if (args.target && !triples.includes(args.target)) {
  console.error(`Unknown target '${args.target}'. Targets: ${triples.join(', ')}`);
  process.exit(1);
}

const profile = args.debug ? 'debug' : 'release';
const cargo = ['build', '-p', 'supersynth-native', ...(args.debug ? [] : ['--release'])];
if (args['rust-target']) cargo.push('--target', args['rust-target']);
console.log(`cargo ${cargo.join(' ')}`);
const run = spawnSync('cargo', cargo, { cwd: path.join(root, 'native'), stdio: 'inherit' });
if (run.error) {
  console.error(`Could not run cargo (${run.error.message}). Building the engine needs Rust: https://rustup.rs`);
  process.exit(1);
}
if (run.status !== 0) process.exit(run.status ?? 1);

// cargo names the cdylib libsupersynth_native.so / .dylib, or supersynth_native.dll
const targetDir = process.env.CARGO_TARGET_DIR ? path.resolve(path.join(root, 'native'), process.env.CARGO_TARGET_DIR) : path.join(root, 'native', 'target');
const outDir = path.join(targetDir, ...(args['rust-target'] ? [args['rust-target']] : []), profile);
const built = ['libsupersynth_native.so', 'libsupersynth_native.dylib', 'supersynth_native.dll'].map((f) => path.join(outDir, f)).filter((f) => existsSync(f));
if (built.length !== 1) {
  console.error(`Expected one native library in ${outDir}, found: ${built.map((f) => path.basename(f)).join(', ') || 'none'}`);
  process.exit(1);
}

let dest;
if (args.target) {
  const dir = path.resolve(root, args.out ?? path.join('npm', args.target));
  mkdirSync(dir, { recursive: true });
  dest = path.join(dir, `supersynth.${args.target}.node`);
} else {
  dest = args.out ? path.join(path.resolve(root, args.out), 'supersynth.node') : path.join(root, 'supersynth.node');
}
copyFileSync(built[0], dest);
console.log(`${path.relative(root, built[0])} -> ${path.relative(root, dest) || dest}`);
