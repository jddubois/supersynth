/**
 * Performance benchmarks: supersynth vs node-web-audio-api (Rust+NAPI) vs web-audio-api (pure JS)
 *
 * All three use offline rendering so no audio hardware is required.
 * Measurements are wall-clock time to render a fixed number of audio samples.
 *
 * Run with: npm run bench
 */
import { Bench } from 'tinybench';
import { Synth } from '../src/Synth.js';

// Lazy imports for competitors — they may take time to initialize
const { AudioContext: NodeWebAudioContext, OfflineAudioContext: NodeOfflineAudioContext } =
  await import('node-web-audio-api');
const { OfflineAudioContext: WebAudioOfflineContext } = await import('web-audio-api');

const SAMPLE_RATE = 48000;
const BUFFER_4096 = 4096;       // ~85ms of audio
const BUFFER_48000 = 48000;     // 1 second of audio

// ── Helpers ────────────────────────────────────────────────────────────────────

function printResults(bench: Bench) {
  const name = bench.name ?? 'Benchmark';
  const width = 70;
  console.log(`\n${name}`);
  console.log('─'.repeat(width));

  const tasks = bench.tasks.filter((t) => t.result);
  if (!tasks.length) return;

  // Find fastest for relative comparison
  const fastest = Math.max(...tasks.map((t) => t.result!.hz));

  for (const task of tasks) {
    const r = task.result!;
    const hz = r.hz.toLocaleString('en', { maximumFractionDigits: 0 });
    const meanUs = (r.mean * 1000).toFixed(0);
    const ratio = (fastest / r.hz).toFixed(1);
    const tag = r.hz === fastest ? ' ◀ fastest' : ` ${ratio}× slower`;
    console.log(
      `  ${task.name.padEnd(40)} ${hz.padStart(9)} ops/s  ${meanUs.padStart(6)}µs/op${tag}`,
    );
  }
}

// ── Bench 1: Single oscillator, 4096 samples ──────────────────────────────────

async function benchSingleOscillator4096() {
  const bench = new Bench({ time: 3000, name: 'Single sine oscillator — render 4096 samples (~85ms audio @ 48kHz)' });

  bench.add('supersynth', () => {
    const synth = new Synth({ sampleRate: SAMPLE_RATE });
    synth.noteOn(69, 100);
    synth.render(BUFFER_4096);
  });

  bench.add('node-web-audio-api', async () => {
    const ctx = new NodeOfflineAudioContext(1, BUFFER_4096, SAMPLE_RATE);
    const osc = ctx.createOscillator();
    osc.frequency.value = 440;
    osc.connect(ctx.destination);
    osc.start(0);
    await ctx.startRendering();
  });

  bench.add('web-audio-api (pure JS)', async () => {
    const ctx = new WebAudioOfflineContext(1, BUFFER_4096, SAMPLE_RATE);
    const osc = ctx.createOscillator();
    osc.frequency.value = 440;
    osc.connect(ctx.destination);
    osc.start(0);
    await ctx.startRendering();
  });

  await bench.run();
  printResults(bench);
}

// ── Bench 2: Single oscillator, 1 second of audio ─────────────────────────────

async function benchSingleOscillator1s() {
  const bench = new Bench({ time: 3000, name: 'Single sine oscillator — render 1 second of audio (48000 samples)' });

  bench.add('supersynth', () => {
    const synth = new Synth({ sampleRate: SAMPLE_RATE });
    synth.noteOn(69, 100);
    synth.render(BUFFER_48000);
  });

  bench.add('node-web-audio-api', async () => {
    const ctx = new NodeOfflineAudioContext(1, BUFFER_48000, SAMPLE_RATE);
    const osc = ctx.createOscillator();
    osc.frequency.value = 440;
    osc.connect(ctx.destination);
    osc.start(0);
    await ctx.startRendering();
  });

  bench.add('web-audio-api (pure JS)', async () => {
    const ctx = new WebAudioOfflineContext(1, BUFFER_48000, SAMPLE_RATE);
    const osc = ctx.createOscillator();
    osc.frequency.value = 440;
    osc.connect(ctx.destination);
    osc.start(0);
    await ctx.startRendering();
  });

  await bench.run();
  printResults(bench);
}

// ── Bench 3: Polyphony — N simultaneous oscillators ───────────────────────────

async function benchPolyphony(n: number) {
  const bench = new Bench({ time: 3000, name: `${n} simultaneous oscillators — render 4096 samples` });

  bench.add('supersynth', () => {
    const synth = new Synth({ sampleRate: SAMPLE_RATE });
    for (let i = 0; i < n; i++) synth.noteOn(48 + i, 80);
    synth.render(BUFFER_4096);
  });

  bench.add('node-web-audio-api', async () => {
    const ctx = new NodeOfflineAudioContext(1, BUFFER_4096, SAMPLE_RATE);
    for (let i = 0; i < n; i++) {
      const osc = ctx.createOscillator();
      osc.frequency.value = 220 * Math.pow(2, i / 12);
      osc.connect(ctx.destination);
      osc.start(0);
    }
    await ctx.startRendering();
  });

  bench.add('web-audio-api (pure JS)', async () => {
    const ctx = new WebAudioOfflineContext(1, BUFFER_4096, SAMPLE_RATE);
    for (let i = 0; i < n; i++) {
      const osc = ctx.createOscillator();
      osc.frequency.value = 220 * Math.pow(2, i / 12);
      osc.connect(ctx.destination);
      osc.start(0);
    }
    await ctx.startRendering();
  });

  await bench.run();
  printResults(bench);
}

// ── Bench 4: Reverb (FIR/IIR effect cost) ─────────────────────────────────────

async function benchReverb() {
  const bench = new Bench({ time: 3000, name: 'Reverb/convolution — 1 oscillator + effects, 4096 samples' });

  bench.add('supersynth (Freeverb)', () => {
    const synth = new Synth({
      sampleRate: SAMPLE_RATE,
      reverb: { roomSize: 0.85, damping: 0.5, wet: 0.35, dry: 0.65, preDelayMs: 20 },
    });
    synth.noteOn(69, 100);
    synth.render(BUFFER_4096);
  });

  bench.add('node-web-audio-api (BiquadFilter)', async () => {
    const ctx = new NodeOfflineAudioContext(1, BUFFER_4096, SAMPLE_RATE);
    const osc = ctx.createOscillator();
    osc.frequency.value = 440;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    osc.connect(filter);
    filter.connect(ctx.destination);
    osc.start(0);
    await ctx.startRendering();
  });

  bench.add('web-audio-api (BiquadFilter)', async () => {
    const ctx = new WebAudioOfflineContext(1, BUFFER_4096, SAMPLE_RATE);
    const osc = ctx.createOscillator();
    osc.frequency.value = 440;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    osc.connect(filter);
    filter.connect(ctx.destination);
    osc.start(0);
    await ctx.startRendering();
  });

  await bench.run();
  printResults(bench);
}

// ── Bench 5: Reused context — raw render throughput (no allocation overhead) ──
//
// node-web-audio-api's OfflineAudioContext cannot be reused after startRendering().
// supersynth and web-audio-api can reuse their engine/context.
// This bench isolates the DSP cost from context-creation cost.

async function benchRenderThroughput() {
  const bench = new Bench({ time: 3000, name: 'Raw DSP throughput — reused context, render 4096 samples repeatedly' });

  // supersynth: reuse engine, re-trigger note each iteration
  {
    const synth = new Synth({ sampleRate: SAMPLE_RATE });
    bench.add('supersynth (reused engine)', () => {
      synth.noteOn(69, 100);
      synth.render(BUFFER_4096);
    });
  }

  // web-audio-api: OfflineAudioContext can only render once, so we must recreate —
  // but we can at least move the import out of the loop
  bench.add('web-audio-api (recreated ctx)', async () => {
    const ctx = new WebAudioOfflineContext(1, BUFFER_4096, SAMPLE_RATE);
    const osc = ctx.createOscillator();
    osc.frequency.value = 440;
    osc.connect(ctx.destination);
    osc.start(0);
    await ctx.startRendering();
  });

  // node-web-audio-api: same constraint — must recreate per render
  bench.add('node-web-audio-api (recreated ctx)', async () => {
    const ctx = new NodeOfflineAudioContext(1, BUFFER_4096, SAMPLE_RATE);
    const osc = ctx.createOscillator();
    osc.frequency.value = 440;
    osc.connect(ctx.destination);
    osc.start(0);
    await ctx.startRendering();
  });

  await bench.run();
  printResults(bench);
}

// ── Bench 6: Polyphony throughput — reused supersynth engine ─────────────────

async function benchPolyphonyReused(n: number) {
  const bench = new Bench({ time: 3000, name: `${n} oscillators — reused supersynth engine vs recreated contexts` });

  {
    const synth = new Synth({ sampleRate: SAMPLE_RATE });
    bench.add('supersynth (reused engine)', () => {
      for (let i = 0; i < n; i++) synth.noteOn(48 + i, 80);
      synth.render(BUFFER_4096);
    });
  }

  bench.add('web-audio-api (recreated ctx)', async () => {
    const ctx = new WebAudioOfflineContext(1, BUFFER_4096, SAMPLE_RATE);
    for (let i = 0; i < n; i++) {
      const osc = ctx.createOscillator();
      osc.frequency.value = 220 * Math.pow(2, i / 12);
      osc.connect(ctx.destination);
      osc.start(0);
    }
    await ctx.startRendering();
  });

  bench.add('node-web-audio-api (recreated ctx)', async () => {
    const ctx = new NodeOfflineAudioContext(1, BUFFER_4096, SAMPLE_RATE);
    for (let i = 0; i < n; i++) {
      const osc = ctx.createOscillator();
      osc.frequency.value = 220 * Math.pow(2, i / 12);
      osc.connect(ctx.destination);
      osc.start(0);
    }
    await ctx.startRendering();
  });

  await bench.run();
  printResults(bench);
}

// ── Main ───────────────────────────────────────────────────────────────────────

console.log('supersynth vs node-web-audio-api vs web-audio-api');
console.log('Offline rendering benchmarks — no audio hardware required');
console.log('='.repeat(70));
console.log(`  Node.js ${process.version} | Platform: ${process.platform} ${process.arch}`);

console.log('\n── SECTION 1: Full lifecycle (context creation + render) ──');
console.log('   Measures real-world cost of: create context → add note → render');
await benchSingleOscillator4096();
await benchSingleOscillator1s();
await benchPolyphony(1);
await benchPolyphony(8);
await benchPolyphony(16);
await benchPolyphony(32);
await benchReverb();

console.log('\n── SECTION 2: Raw DSP throughput (context reuse where possible) ──');
console.log('   Isolates the cost of rendering itself from context allocation');
await benchRenderThroughput();
await benchPolyphonyReused(8);
await benchPolyphonyReused(32);

console.log('\n' + '='.repeat(70));
console.log('Done.');
