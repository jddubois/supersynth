#!/usr/bin/env node
// Builds the browser engine (native/wasm, wasm-bindgen) into wasm/ (supersynth.js + its .wasm).
//
//   node scripts/build-wasm.mjs           release build
//   node scripts/build-wasm.mjs --debug   debug build
//
// The module uses threads on shared memory, which needs the standard library rebuilt with
// atomics: a nightly Rust with rust-src (`rustup toolchain install nightly --component rust-src
// --target wasm32-unknown-unknown`) and the wasm-bindgen CLI of the version native/wasm pins
// (`cargo install wasm-bindgen-cli --version <it>`).
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({ options: { debug: { type: 'boolean', default: false } } });
const native = path.join(root, 'native');

function run(cmd, argv, env = {}) {
  console.log(`${cmd} ${argv.join(' ')}`);
  const r = spawnSync(cmd, argv, { cwd: native, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.error) {
    console.error(`Could not run ${cmd} (${r.error.message}).`);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const pinned = /wasm-bindgen = "=([^"]+)"/.exec(readFileSync(path.join(native, 'wasm', 'Cargo.toml'), 'utf8'))?.[1];
const cli = spawnSync('wasm-bindgen', ['--version'], { encoding: 'utf8' });
const have = /([0-9]+\.[0-9]+\.[0-9]+)/.exec(cli.stdout ?? '')?.[1];
if (!have) {
  console.error(`The wasm-bindgen CLI is not installed: cargo install wasm-bindgen-cli --version ${pinned}`);
  process.exit(1);
}
if (pinned && have !== pinned) {
  console.error(`wasm-bindgen CLI ${have} does not match the crate's ${pinned}: cargo install wasm-bindgen-cli --version ${pinned}`);
  process.exit(1);
}

const profile = args.debug ? 'debug' : 'release';
run(
  'cargo',
  ['+nightly', 'build', '-p', 'supersynth-wasm', '--target', 'wasm32-unknown-unknown', '-Z', 'build-std=panic_abort,std', ...(args.debug ? [] : ['--release'])],
  {
    // threads (atomics, a shared memory the host passes to every thread, each thread's TLS
    // set up by wasm-bindgen), SIMD, and up to 4 GiB of memory (the largest organs decode to
    // several hundred MB)
    CARGO_ENCODED_RUSTFLAGS: [
      '-Ctarget-feature=+atomics,+bulk-memory,+mutable-globals,+simd128',
      ...['--shared-memory', '--import-memory', '--max-memory=4294967296', '--export=__wasm_init_tls', '--export=__tls_size', '--export=__tls_align', '--export=__tls_base'].map((a) => `-Clink-arg=${a}`),
    ].join('\x1f'),
  },
);

const targetDir = process.env.CARGO_TARGET_DIR ? path.resolve(native, process.env.CARGO_TARGET_DIR) : path.join(native, 'target');
const built = path.join(targetDir, 'wasm32-unknown-unknown', profile, 'supersynth_wasm.wasm');
const out = path.join(root, 'wasm');
mkdirSync(out, { recursive: true });
run('wasm-bindgen', ['--target', 'web', '--out-dir', out, '--out-name', 'supersynth', built]);
console.log(`${path.relative(root, built)} -> wasm/`);
