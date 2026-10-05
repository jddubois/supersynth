#!/usr/bin/env node
// The browser engine in a real browser (headless Chromium, via playwright-core): offline
// rendering, real-time output through the AudioWorklet, and the render workers on the other
// cores keeping a full organ in real time where one thread cannot.
//
//   npm run build:wasm && npm run build:ts && npm run test:browser
//
// Chromium: playwright-core's (`npx playwright-core install chromium`), or $CHROMIUM_PATH.
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

import { serve } from '../examples/browser/serve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'browser');
const launch = { args: ['--autoplay-policy=no-user-gesture-required'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) };

async function page(isolate = true) {
  const server = await serve({ root, port: 0, isolate });
  const browser = await chromium.launch(launch);
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`http://127.0.0.1:${server.address().port}/`);
  await p.waitForFunction(() => window.ready === true, null, { timeout: 30_000 });
  const run = (name, args) => p.evaluate(([n, a]) => window.cases[n](a), [name, args]);
  const close = async () => {
    await browser.close();
    server.close();
    assert.deepEqual(errors, [], 'no errors in the page');
  };
  return { run, close };
}

let failed = 0;
async function test(name, fn) {
  const t = performance.now();
  try {
    await fn();
    console.log(`✓ ${name} (${Math.round(performance.now() - t)} ms)`);
  } catch (e) {
    failed++;
    console.log(`✕ ${name}\n  ${String(e.stack ?? e).split('\n').slice(0, 8).join('\n  ')}`);
  }
}

const CHORD = ['C4', 'E4', 'G4'];
const PLENUM = ['C3', 'G3', 'C4', 'E4', 'G4', 'C5'];
const cores = os.availableParallelism?.() ?? os.cpus().length;

const { run, close } = await page();

await test('a piano renders offline', async () => {
  const r = await run('offline', { id: 'grand-piano', threads: 1, notes: CHORD });
  assert.equal(r.error, null);
  assert.ok(r.peak > 0.05 && r.peak <= 1, `peak ${r.peak}`);
  assert.equal(r.wavBytes, 44 + 2 * 48000 * 2 * 2);
});

await test('a piano plays in real time through the AudioWorklet', async () => {
  const r = await run('live', { id: 'grand-piano', threads: 1, notes: CHORD });
  assert.equal(r.error, null);
  assert.ok(r.running && r.stopped);
  assert.ok(r.voices >= 3, `voices ${r.voices}`);
  assert.ok(r.pace > 0.95, `rendered ${r.pace.toFixed(2)} s per second`);
  assert.ok(r.cpuLoad > 0 && r.cpuLoad < 0.9, `CPU ${r.cpuLoad}`);
  assert.ok(r.peakAfterStop > 1e-3, 'offline rendering works again after stop()');
});

await test('the render workers share out a full organ', async () => {
  const one = await run('offline', { id: 'burea', preset: 'full', threads: 1, notes: PLENUM, seconds: 3 });
  const many = await run('offline', { id: 'burea', preset: 'full', threads: Math.min(4, cores), notes: PLENUM, seconds: 3 });
  console.log(`  Bureå full organ, offline: ${(100 * one.realTime).toFixed(0)} % of real time on 1 thread, ${(100 * many.realTime).toFixed(0)} % on ${many.threads}`);
  assert.equal(many.peak, one.peak, 'the same sound on any number of threads');
  if (cores >= 4) assert.ok(many.realTime < one.realTime * 0.6, 'faster on several threads');
});

await test('a full organ plays in real time on several threads', async () => {
  const r = await run('live', { id: 'burea', preset: 'full', threads: Math.min(4, cores), notes: PLENUM });
  console.log(`  Bureå full organ, live on ${r.threads} threads: ${r.voices} voices, CPU ${(100 * r.cpuLoad).toFixed(0)} %, ${r.pace.toFixed(2)} s rendered per second`);
  assert.equal(r.error, null);
  if (cores >= 4) assert.ok(r.pace > 0.95, `rendered ${r.pace.toFixed(2)} s per second`);
});

await close();

await test('a page without cross-origin isolation is told what to do', async () => {
  const bare = await page(false);
  const r = await bare.run('create');
  await bare.close();
  assert.equal(r.ok, false);
  assert.match(r.message, /Cross-Origin-Opener-Policy/);
});

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
