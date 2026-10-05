/**
 * Live-instrument test: plays the engine the way a performer does and checks every audio
 * buffer against its real-time deadline.
 *
 * Events are not scheduled ahead (as `renderMidi` does). Each one arrives "now", at the start
 * of the buffer in which a key would have been pressed, exactly like MIDI input. The engine
 * then renders one buffer at a time and each buffer's render time is compared with its
 * duration (128 frames at 48 kHz = 2.67 ms). A buffer that takes longer is an audible dropout.
 * Averages hide dropouts, so this reports the worst buffers.
 *
 *   npm run live-test                          all scenarios, 128-frame buffers
 *   npm run live-test -- --buffer 64           smaller buffers (lower latency, harder)
 *   npm run live-test -- --slowdown 1.7        also count dropouts for a CPU 1.7× slower
 *   npm run live-test -- --only organ          scenarios whose name contains "organ"
 *   npm run live-test -- --seconds 30          length of each performance
 *   npm run live-test -- --quality balanced    the Synth `quality` option
 *   npm run live-test -- --json out.json       machine-readable results
 *   npm run live-test -- --threads 1           the Synth `threads` option (default: 'auto')
 *
 * Run it on the target machine (e.g. a Raspberry Pi 5) with nothing else busy; exit code 1
 * when any scenario drops out.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMidiFile, Synth, type Playable } from '../src/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : dflt;
};
const SR = Number(opt('rate', '48000'));
const BUFFER = Number(opt('buffer', '128'));
const SECONDS = Number(opt('seconds', '45'));
const SLOWDOWN = Number(opt('slowdown', '1'));
const ONLY = opt('only', '');
const QUALITY = opt('quality', 'high') as 'high' | 'balanced' | 'eco';
const JSON_OUT = opt('json', '');
const MAX_VOICES = args.includes('--max-voices') ? Number(opt('max-voices', '192')) : undefined;
const THREADS = args.includes('--threads') ? opt('threads', 'auto') : undefined;
const budgetMs = (BUFFER / SR) * 1000;

/** A timed key event, delivered live. */
type Live = { time: number; run: () => void };

interface Scenario {
  name: string;
  what: string;
  setup: (s: Synth) => Live[];
}

const bach = parseMidiFile(readFileSync(path.join(here, '../examples/jsbwv532.mid')));
/** BWV 532 (Prelude and Fugue in D) notes up to `seconds`, routed by MIDI channel. */
function bachEvents(seconds: number, target: (channel: number) => Playable /* channel 1–16 */, velocityScale = 1): Live[] {
  const out: Live[] = [];
  for (const e of bach.events) {
    if (e.time > seconds) break;
    if (e.type === 'noteOn') {
      const kb = target(e.channel);
      const v = Math.max(1, Math.min(127, Math.round(e.velocity * velocityScale)));
      out.push({ time: e.time, run: () => kb.noteOn(e.note, v) });
    } else if (e.type === 'noteOff') {
      const kb = target(e.channel);
      out.push({ time: e.time, run: () => kb.noteOff(e.note) });
    }
  }
  return out;
}

function every(seconds: number, step: number, f: (i: number) => void): Live[] {
  const out: Live[] = [];
  for (let i = 0, t = step; t < seconds; i++, t += step) out.push({ time: t, run: () => f(i) });
  return out;
}

const scenarios: Scenario[] = [
  {
    name: 'piano: Bach with pedalling',
    what: 'grand piano, BWV 532 at its own tempo, sustain pedal changed every bar',
    setup: (s) => {
      const p = s.add('grand-piano');
      return [
        ...bachEvents(SECONDS, () => p),
        ...every(SECONDS, 1.1, (i) => p.sustain(i % 2 === 0)),
      ];
    },
  },
  {
    name: 'piano: fortissimo chords',
    what: 'ten-finger chords, 6 per second, pedal down: the worst burst of note starts',
    setup: (s) => {
      const p = s.add('grand-piano');
      const chords = [
        [36, 43, 48, 52, 55, 60, 64, 67, 72, 76],
        [38, 45, 50, 53, 57, 62, 65, 69, 74, 77],
        [41, 48, 53, 57, 60, 65, 69, 72, 77, 81],
      ];
      const ev: Live[] = [{ time: 0.05, run: () => p.sustain(true) }];
      for (let i = 0, t = 0.1; t < SECONDS; i++, t += 1 / 6) {
        const c = chords[i % chords.length]!;
        ev.push({ time: t, run: () => c.forEach((n) => p.noteOn(n, 120)) });
        ev.push({ time: t + 0.12, run: () => c.forEach((n) => p.noteOff(n)) });
        if (i % 12 === 11) ev.push({ time: t + 0.13, run: () => p.sustain(false) }, { time: t + 0.15, run: () => p.sustain(true) });
      }
      return ev;
    },
  },
  {
    name: 'organ: Bach on the plenum',
    what: 'Bureå organ, plenum, great + swell + pedal from BWV 532',
    setup: (s) => {
      const o = s.add('burea', { preset: 'plenum' });
      const kb = [o.great, o.swell, o.pedal];
      return bachEvents(SECONDS, (ch) => kb[ch - 1] ?? o.great);
    },
  },
  {
    name: 'organ: registration changes while playing',
    what: 'Bureå, BWV 532, a different preset every 3 s with keys held (stops added to sounding notes)',
    setup: (s) => {
      const o = s.add('burea', { preset: 'principal' });
      const kb = [o.great, o.swell, o.pedal];
      const presets = ['plenum', 'flutes', 'full', 'principal-chorus', 'cornet', 'trumpet', 'plenum'];
      return [
        ...bachEvents(SECONDS, (ch) => kb[ch - 1] ?? o.great),
        ...every(SECONDS, 3, (i) => o.preset(presets[i % presets.length]!)),
      ];
    },
  },
  {
    name: 'organ: full organ chords',
    what: 'Bureå tutti with couplers, 6-note chords + pedal, a new chord twice per second',
    setup: (s) => {
      const o = s.add('burea', { preset: 'full' });
      const chords = [
        [50, 57, 62, 66, 69, 74],
        [47, 55, 62, 67, 71, 74],
        [45, 52, 57, 61, 64, 69],
      ];
      const pedal = [38, 31, 33];
      const ev: Live[] = [];
      for (let i = 0, t = 0.1; t < SECONDS; i++, t += 0.5) {
        const c = chords[i % 3]!;
        const p = pedal[i % 3]!;
        ev.push({ time: t, run: () => { c.forEach((n) => o.great.noteOn(n)); o.pedal.noteOn(p); } });
        ev.push({ time: t + 0.45, run: () => { c.forEach((n) => o.great.noteOff(n)); o.pedal.noteOff(p); } });
      }
      return ev;
    },
  },
  {
    name: 'organ: Bach on the Friesach plenum',
    what: 'Friesach (44 stops), plenum, BWV 532 at its own tempo: hundreds of pipes in their release',
    setup: (s) => {
      const o = s.add('friesach', { preset: 'plenum' });
      const kb = [o.great, o.swell, o.pedal];
      return bachEvents(SECONDS, (ch) => kb[ch - 1] ?? o.great);
    },
  },
  {
    name: 'organ: Bach on the Cracow plein-jeu',
    what: 'Cracow (40 stops), plein-jeu, BWV 532',
    setup: (s) => {
      const o = s.add('cracow', { preset: 'plein-jeu' });
      const kb = [o.great, o.swell, o.pedal];
      return bachEvents(SECONDS, (ch) => kb[ch - 1] ?? o.great);
    },
  },
  {
    name: 'strings: sustained section',
    what: 'string section, BWV 532 played legato as an orchestral texture',
    setup: (s) => {
      const st = s.add('strings');
      return bachEvents(SECONDS, () => st, 0.9);
    },
  },
];

interface Result {
  name: string;
  buffers: number;
  meanLoad: number;
  /** Process CPU time (all threads) / real time, averaged over the run. */
  cpuLoad: number;
  p99Load: number;
  p999Load: number;
  maxLoad: number;
  maxAt: number;
  over: number;
  overSlow: number;
  maxVoices: number;
  /** Longest the JavaScript thread took to handle one buffer's key events (a late key or stop). */
  maxEventMs: number;
}

function quantile(sorted: Float64Array, q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

function runScenario(sc: Scenario): Result {
  const synth = new Synth({
    sampleRate: SR,
    quality: QUALITY,
    ...(MAX_VOICES ? { maxVoices: MAX_VOICES } : {}),
    ...(THREADS ? { threads: THREADS === 'auto' ? 'auto' : Number(THREADS) } : {}),
  });
  const native = synth._native();
  const events = sc.setup(synth).sort((a, b) => a.time - b.time);
  native.render(SR / 2); // settle: setup commands, reverb buffers
  const n = Math.ceil((SECONDS * SR) / BUFFER);
  const loads = new Float64Array(n);
  let next = 0;
  let maxVoices = 0;
  let maxEventMs = 0;
  let cpuUs = 0;
  for (let b = 0; b < n; b++) {
    const bufferEnd = ((b + 1) * BUFFER) / SR;
    // keys pressed during the previous buffer reach the engine at the start of this one
    // key handling runs on the JavaScript thread, rendering on the audio thread: time both
    const t0 = process.hrtime.bigint();
    while (next < events.length && events[next]!.time < bufferEnd) events[next++]!.run();
    const c0 = process.cpuUsage();
    const t1 = process.hrtime.bigint();
    native.render(BUFFER);
    const t2 = process.hrtime.bigint();
    const c1 = process.cpuUsage(c0);
    cpuUs += c1.user + c1.system;
    loads[b] = Number(t2 - t1) / 1e6 / budgetMs;
    maxEventMs = Math.max(maxEventMs, Number(t1 - t0) / 1e6);
    if ((b & 63) === 0) maxVoices = Math.max(maxVoices, native.activeVoices);
  }
  synth.close();
  let maxAt = 0;
  for (let i = 1; i < n; i++) if (loads[i]! > loads[maxAt]!) maxAt = i;
  const sorted = Float64Array.from(loads).sort();
  let sum = 0;
  let over = 0;
  let overSlow = 0;
  for (const l of loads) {
    sum += l;
    if (l > 1) over++;
    if (l * SLOWDOWN > 1) overSlow++;
  }
  return {
    name: sc.name,
    buffers: n,
    meanLoad: sum / n,
    cpuLoad: cpuUs / 1000 / (n * budgetMs),
    p99Load: quantile(sorted, 0.99),
    p999Load: quantile(sorted, 0.999),
    maxLoad: sorted[n - 1]!,
    maxAt: (maxAt * BUFFER) / SR,
    over,
    overSlow,
    maxVoices,
    maxEventMs,
  };
}

/** Time from a key press (at a buffer boundary) to the sound reaching -40 dB of its peak. */
function onsetLatency(setup: (s: Synth) => Playable, note: number): number {
  const synth = new Synth({ sampleRate: SR, reverb: false });
  const kb = setup(synth);
  synth._native().render(SR / 4);
  kb.noteOn(note, 100);
  const buf = synth._native().render(SR / 2);
  synth.close();
  let peak = 0;
  for (const x of buf) peak = Math.max(peak, Math.abs(x));
  const th = peak * 0.01;
  for (let i = 0; i < buf.length; i += 2) if (Math.abs(buf[i]!) > th || Math.abs(buf[i + 1]!) > th) return (i / 2 / SR) * 1000;
  return NaN;
}

const pct = (x: number) => `${(x * 100).toFixed(0).padStart(4)}%`;
console.log(
  `live test: ${BUFFER}-frame buffers @ ${SR} Hz (deadline ${budgetMs.toFixed(2)} ms), ${SECONDS} s each, quality ${QUALITY}` +
    (SLOWDOWN !== 1 ? `, dropouts also counted for a CPU ${SLOWDOWN}× slower` : '') +
    '\nload = wall-clock render time / buffer duration (all render threads at work); > 100% is a dropout' +
    '\ncpu = CPU time of all threads / real time (100% = one core busy)\n',
);
console.log(
  'scenario'.padEnd(42) + 'mean   p99  p99.9   max  (at)     cpu  voices  dropouts' + (SLOWDOWN !== 1 ? `  @${SLOWDOWN}×` : '') + '  slowest key event',
);
const results: Result[] = [];
for (const sc of scenarios) {
  if (ONLY && !sc.name.includes(ONLY)) continue;
  const r = runScenario(sc);
  results.push(r);
  console.log(
    r.name.padEnd(40) +
      `${pct(r.meanLoad)} ${pct(r.p99Load)} ${pct(r.p999Load)} ${pct(r.maxLoad)} ${r.maxAt.toFixed(1).padStart(5)}s ${pct(r.cpuLoad)}` +
      `${String(r.maxVoices).padStart(8)}${String(r.over).padStart(10)}` +
      (SLOWDOWN !== 1 ? `${String(r.overSlow).padStart(7)}` : '') +
      `${r.maxEventMs.toFixed(1).padStart(10)} ms`,
  );
}

const latencies: Record<string, number> = {
  'grand-piano C4': onsetLatency((s) => s.add('grand-piano'), 60),
  'harpsichord C4': onsetLatency((s) => s.add('harpsichord'), 60),
  'burea principal C4': onsetLatency((s) => s.add('burea', { preset: 'principal' }).great, 60),
  'violin A4': onsetLatency((s) => s.add('violin'), 69),
};
console.log(`\nsound onset after the key (engine only; add ${budgetMs.toFixed(1)}–${(2 * budgetMs).toFixed(1)} ms of buffering + the device's own latency):`);
for (const [k, v] of Object.entries(latencies)) console.log(`  ${k.padEnd(22)} ${v.toFixed(1)} ms`);

const rss = process.memoryUsage().rss / 1048576;
console.log(`\npeak resident memory of this process: ${rss.toFixed(0)} MB`);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ sampleRate: SR, buffer: BUFFER, seconds: SECONDS, slowdown: SLOWDOWN, quality: QUALITY, threads: THREADS ?? 'auto', results, latencies, rssMb: rss }, null, 2));
const failed = results.filter((r) => (SLOWDOWN !== 1 ? r.overSlow : r.over) > 0);
if (failed.length) {
  console.log(`\nFAIL: dropouts in ${failed.map((r) => r.name).join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('\nPASS: no buffer missed its deadline');
}
