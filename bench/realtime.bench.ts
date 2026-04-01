/**
 * Real-time reliability benchmark.
 *
 * Simulates a real-time audio loop: a callback fires every INTERVAL_MS (matching
 * a 512-sample buffer at 48kHz ≈ 10.67ms). Under concurrent GC pressure, we
 * measure how many callbacks exceed their deadline — a "dropout" in real audio.
 *
 * This tests what the throughput benchmarks cannot: timing consistency.
 *
 * Run with: node --import tsx bench/realtime.bench.ts
 */

import { Synth } from '../src/Synth.js';
const { OfflineAudioContext: WebAudioOfflineContext } = await import('web-audio-api');

const SAMPLE_RATE = 48000;
const BUFFER_SIZE = 512;                             // samples per callback (typical hardware buffer)
const INTERVAL_MS = (BUFFER_SIZE / SAMPLE_RATE) * 1000; // ~10.67ms per callback
const TEST_DURATION_MS = 5000;                       // run each test for 5 seconds
const DROPOUT_THRESHOLD_MS = INTERVAL_MS * 1.5;     // >1.5× deadline = dropout

// ── GC pressure generator ─────────────────────────────────────────────────────
// Continuously allocates and discards objects to keep the GC busy.
// Mirrors what a real Node server does: handling requests, building responses, etc.

function startGcPressure(): () => void {
  let running = true;
  const arrays: number[][] = [];

  async function pressure() {
    while (running) {
      // Allocate ~1MB of short-lived objects
      for (let i = 0; i < 100; i++) {
        arrays.push(new Array(1000).fill(Math.random()));
      }
      arrays.splice(0, arrays.length); // drop them all → triggers GC
      await new Promise((r) => setImmediate(r)); // yield to event loop
    }
  }

  void pressure();
  return () => { running = false; };
}

// ── Simulate real-time loop ───────────────────────────────────────────────────

interface RealtimeResult {
  totalCallbacks: number;
  dropouts: number;
  dropoutRate: number;
  maxJitterMs: number;
  p99JitterMs: number;
  meanJitterMs: number;
}

async function runRealtimeLoop(
  label: string,
  fillCallback: () => Promise<void> | void,
  withGcPressure: boolean,
): Promise<RealtimeResult> {
  const jitters: number[] = [];
  let totalCallbacks = 0;
  let dropouts = 0;

  const stopGc = withGcPressure ? startGcPressure() : () => {};
  // Give GC pressure a moment to ramp up
  if (withGcPressure) await new Promise((r) => setTimeout(r, 200));

  const startTime = performance.now();
  let nextExpected = startTime;

  await new Promise<void>((resolve) => {
    async function tick() {
      const now = performance.now();
      const jitter = Math.max(0, now - nextExpected);
      jitters.push(jitter);
      totalCallbacks++;
      if (jitter > DROPOUT_THRESHOLD_MS) dropouts++;

      const callStart = performance.now();
      await fillCallback();
      const callDuration = performance.now() - callStart;

      nextExpected += INTERVAL_MS;
      const elapsed = performance.now() - startTime;

      if (elapsed >= TEST_DURATION_MS) {
        stopGc();
        resolve();
        return;
      }

      // Schedule next tick, accounting for call duration
      const delay = Math.max(0, nextExpected - performance.now());
      setTimeout(tick, delay);
    }

    setTimeout(tick, 0);
  });

  jitters.sort((a, b) => a - b);
  const p99 = jitters[Math.floor(jitters.length * 0.99)] ?? 0;
  const mean = jitters.reduce((a, b) => a + b, 0) / jitters.length;
  const max = jitters[jitters.length - 1] ?? 0;

  return {
    totalCallbacks,
    dropouts,
    dropoutRate: dropouts / totalCallbacks,
    maxJitterMs: max,
    p99JitterMs: p99,
    meanJitterMs: mean,
  };
}

// ── Test cases ────────────────────────────────────────────────────────────────

function printResult(label: string, r: RealtimeResult) {
  const dropoutPct = (r.dropoutRate * 100).toFixed(1);
  const status = r.dropouts === 0 ? '✓ no dropouts' : `✗ ${r.dropouts} dropouts (${dropoutPct}%)`;
  console.log(`  ${label.padEnd(45)} mean=${r.meanJitterMs.toFixed(2)}ms  p99=${r.p99JitterMs.toFixed(2)}ms  max=${r.maxJitterMs.toFixed(2)}ms  ${status}`);
}

async function runAll() {
  console.log('Real-time audio reliability benchmark');
  console.log(`Buffer: ${BUFFER_SIZE} samples @ ${SAMPLE_RATE}Hz = ${INTERVAL_MS.toFixed(2)}ms per callback`);
  console.log(`Dropout threshold: >${DROPOUT_THRESHOLD_MS.toFixed(2)}ms late`);
  console.log(`Test duration: ${TEST_DURATION_MS / 1000}s per scenario`);
  console.log('='.repeat(80));

  // Prepare engines once (not per-callback) to simulate a real server
  const synthReused = new Synth({ sampleRate: SAMPLE_RATE });
  synthReused.noteOn(69, 100);

  // ── Without GC pressure ────────────────────────────────────────────────────
  console.log('\nWithout GC pressure:');

  printResult(
    'supersynth (reused engine)',
    await runRealtimeLoop('supersynth', () => {
      synthReused.noteOn(69, 100);
      synthReused.render(BUFFER_SIZE);
    }, false),
  );

  printResult(
    'web-audio-api (new ctx each callback)',
    await runRealtimeLoop('web-audio-api', async () => {
      const ctx = new WebAudioOfflineContext(1, BUFFER_SIZE, SAMPLE_RATE);
      const osc = ctx.createOscillator();
      osc.frequency.value = 440;
      osc.connect(ctx.destination);
      osc.start(0);
      await ctx.startRendering();
    }, false),
  );

  // ── With concurrent GC pressure ────────────────────────────────────────────
  console.log('\nWith concurrent GC pressure (simulates real server load):');

  // Re-create to reset note state
  const synthGc = new Synth({ sampleRate: SAMPLE_RATE });
  synthGc.noteOn(69, 100);

  printResult(
    'supersynth (reused engine)',
    await runRealtimeLoop('supersynth+gc', () => {
      synthGc.noteOn(69, 100);
      synthGc.render(BUFFER_SIZE);
    }, true),
  );

  printResult(
    'web-audio-api (new ctx each callback)',
    await runRealtimeLoop('web-audio-api+gc', async () => {
      const ctx = new WebAudioOfflineContext(1, BUFFER_SIZE, SAMPLE_RATE);
      const osc = ctx.createOscillator();
      osc.frequency.value = 440;
      osc.connect(ctx.destination);
      osc.start(0);
      await ctx.startRendering();
    }, true),
  );

  // ── With GC pressure, higher polyphony ─────────────────────────────────────
  console.log('\nWith GC pressure, 16 simultaneous notes:');

  const synth16 = new Synth({ sampleRate: SAMPLE_RATE });
  for (let i = 0; i < 16; i++) synth16.noteOn(48 + i, 80);

  printResult(
    'supersynth 16 notes (reused engine)',
    await runRealtimeLoop('supersynth-16+gc', () => {
      synth16.render(BUFFER_SIZE);
    }, true),
  );

  printResult(
    'web-audio-api 16 oscs (new ctx)',
    await runRealtimeLoop('web-audio-api-16+gc', async () => {
      const ctx = new WebAudioOfflineContext(1, BUFFER_SIZE, SAMPLE_RATE);
      for (let i = 0; i < 16; i++) {
        const osc = ctx.createOscillator();
        osc.frequency.value = 220 * Math.pow(2, i / 12);
        osc.connect(ctx.destination);
        osc.start(0);
      }
      await ctx.startRendering();
    }, true),
  );

  console.log('\n' + '='.repeat(80));
  console.log(`Note: "dropout" = callback arrived >${DROPOUT_THRESHOLD_MS.toFixed(1)}ms late.`);
  console.log('In real audio this would be a glitch/pop audible to the listener.');
}

await runAll();
