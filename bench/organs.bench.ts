/**
 * Organ benchmark: every organ with its heaviest preset and with every stop drawn plus couplers
 * (great ← swell, positive; pedal ← great, swell), playing a 6-note chord on the great and 2
 * pedal notes, then letting them go (the pipes' recorded release and the room); and BWV 532 on
 * the Friesach and Cracow plena, where hundreds of pipes sound in their release at once.
 *
 * Rendered live-style, one 128-frame buffer at a time, each timed against its 2.67 ms deadline:
 *
 *   npm run bench:organs                      all organs, default threads
 *   npm run bench:organs -- --only friesach   one organ
 *   npm run bench:organs -- --threads 1       the Synth `threads` option
 *   npm run bench:organs -- --slowdown 1.7    also count dropouts for a CPU 1.7× slower
 *   npm run bench:organs -- --max-voices 512  the Synth `maxVoices` option
 *   npm run bench:organs -- --no-bach         skip the BWV 532 runs
 *   npm run bench:organs -- --json out.json   machine-readable results
 *   npm run bench:organs -- --repeat 3        each buffer's fastest of 3 runs (drops the stalls a
 *                                             busy or virtual machine adds at random)
 *
 * load: wall-clock render time / buffer duration (> 100 % is a dropout); cpu: CPU time of all
 * threads / real time (100 % = one core busy).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMidiFile, Synth } from '../src/index.ts';
import { ORGANS, type OrganId } from '../src/organs/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : dflt;
};
const SR = 48000;
const BUFFER = Number(opt('buffer', '128'));
const ONLY = opt('only', '');
const SLOWDOWN = Number(opt('slowdown', '1'));
const THREADS = args.includes('--threads') ? opt('threads', 'auto') : undefined;
const MAX_VOICES = args.includes('--max-voices') ? Number(opt('max-voices', '0')) : undefined;
const JSON_OUT = opt('json', '');
const REPEAT = Math.max(1, Number(opt('repeat', '1')));
const HOLD = 3;
const TAIL = 2;
const BACH_SECONDS = Number(opt('bach-seconds', '20'));
const budgetMs = (BUFFER / SR) * 1000;
const divisions = ['great', 'swell', 'positive', 'pedal'] as const;

type Ev = { time: number; run: () => void };
interface Row {
  organ: string;
  preset: string;
  mean: number;
  p999: number;
  max: number;
  cpu: number;
  voices: number;
  dropouts: number;
  dropoutsSlow: number;
}

function synthOptions() {
  return {
    sampleRate: SR,
    ...(MAX_VOICES ? { maxVoices: MAX_VOICES } : {}),
    ...(THREADS ? { threads: THREADS === 'auto' ? ('auto' as const) : Number(THREADS) } : {}),
  };
}

/** Play `make()` `REPEAT` times; each buffer's fastest time counts (the render is deterministic). */
async function run(organ: string, preset: string, make: () => [Synth, Ev[]], seconds: number): Promise<Row> {
  let best: { loads: Float64Array; cpuUs: number; voices: number } | undefined;
  for (let r = 0; r < REPEAT; r++) {
    const [synth, events] = make();
    const one = await playOnce(synth, events, seconds);
    if (!best) best = one;
    else {
      for (let b = 0; b < one.loads.length; b++) best.loads[b] = Math.min(best.loads[b]!, one.loads[b]!);
      best.cpuUs = Math.min(best.cpuUs, one.cpuUs);
    }
  }
  const { loads, cpuUs, voices } = best!;
  const n = loads.length;
  const sorted = Float64Array.from(loads).sort();
  const mean = loads.reduce((a, b) => a + b, 0) / n;
  return {
    organ,
    preset,
    mean,
    p999: sorted[Math.min(n - 1, Math.floor(0.999 * n))]!,
    max: sorted[n - 1]!,
    cpu: cpuUs / 1000 / (n * budgetMs),
    voices,
    dropouts: loads.filter((l) => l > 1).length,
    dropoutsSlow: loads.filter((l) => l * SLOWDOWN > 1).length,
  };
}

/** Render `seconds` buffer by buffer, applying `events` at buffer boundaries (as live input). */
async function playOnce(synth: Synth, events: Ev[], seconds: number) {
  const nat = synth._native();
  events.sort((a, b) => a.time - b.time);
  // every model loaded before the clock starts (background loading would compete for the CPU)
  await synth.ready();
  nat.render(SR / 2); // settle
  const n = Math.ceil((seconds * SR) / BUFFER);
  const loads = new Float64Array(n);
  let next = 0;
  let voices = 0;
  let cpuUs = 0;
  for (let b = 0; b < n; b++) {
    const end = ((b + 1) * BUFFER) / SR;
    while (next < events.length && events[next]!.time < end) events[next++]!.run();
    const c0 = process.cpuUsage();
    const t0 = process.hrtime.bigint();
    nat.render(BUFFER);
    const t1 = process.hrtime.bigint();
    const c1 = process.cpuUsage(c0);
    cpuUs += c1.user + c1.system;
    loads[b] = Number(t1 - t0) / 1e6 / budgetMs;
    if ((b & 15) === 0) voices = Math.max(voices, nat.activeVoices);
  }
  synth.close();
  return { loads, cpuUs, voices };
}

function chord(id: string, preset: unknown, label: string): Promise<Row> {
  return run(id, label, () => chordSetup(id, preset), HOLD + TAIL);
}

function chordSetup(id: string, preset: unknown): [Synth, Ev[]] {
  const synth = new Synth(synthOptions());
  synth['emulateRealtime'] = true; // the engine is driven here as by real-time output
  const o = synth.add(id as OrganId, { preset: preset as never });
  const great = ['C3', 'G3', 'C4', 'E4', 'G4', 'C5'];
  const pedal = ['C2', 'G2'];
  const ev: Ev[] = [
    { time: 0.05, run: () => { great.forEach((n) => o.great.noteOn(n)); pedal.forEach((n) => o.pedal.noteOn(n)); } },
    { time: 0.05 + HOLD, run: () => { great.forEach((n) => o.great.noteOff(n)); pedal.forEach((n) => o.pedal.noteOff(n)); } },
  ];
  return [synth, ev];
}

const bach = parseMidiFile(readFileSync(path.join(here, '../examples/jsbwv532.mid')));
function bachRun(id: string, preset: string): Promise<Row> {
  return run(id, `${preset} BWV 532`, () => bachSetup(id, preset), BACH_SECONDS + 1);
}

function bachSetup(id: string, preset: string): [Synth, Ev[]] {
  const synth = new Synth(synthOptions());
  synth['emulateRealtime'] = true;
  const o = synth.add(id as OrganId, { preset: preset as never });
  const kb = [o.great, o.swell, o.pedal];
  const ev: Ev[] = [];
  for (const e of bach.events) {
    if (e.time > BACH_SECONDS) break;
    const k = kb[e.channel - 1] ?? o.great;
    if (e.type === 'noteOn') ev.push({ time: e.time, run: () => k.noteOn(e.note, e.velocity) });
    else if (e.type === 'noteOff') ev.push({ time: e.time, run: () => k.noteOff(e.note) });
  }
  return [synth, ev];
}

const pct = (x: number) => `${(x * 100).toFixed(0).padStart(5)}%`;
const probe = new Synth({ sampleRate: SR, ...(THREADS ? { threads: THREADS === 'auto' ? ('auto' as const) : Number(THREADS) } : {}) });
console.log(
  `organs: ${BUFFER}-frame buffers @ ${SR} Hz (deadline ${budgetMs.toFixed(2)} ms), ${probe.threads} rendering thread(s)` +
    (SLOWDOWN !== 1 ? `, dropouts also counted for a CPU ${SLOWDOWN}× slower` : '') +
    (REPEAT > 1 ? `, each buffer's fastest of ${REPEAT} runs` : '') +
    `\nchord: 6 great + 2 pedal notes held ${HOLD} s, then ${TAIL} s of release\n`,
);
probe.close();
console.log('organ'.padEnd(20) + 'preset'.padEnd(26) + '  mean  p99.9    max    cpu  voices  dropouts' + (SLOWDOWN !== 1 ? `  @${SLOWDOWN}×` : ''));
const rows: Row[] = [];
const print = (r: Row) => {
  rows.push(r);
  console.log(
    r.organ.padEnd(20) + r.preset.padEnd(26) + `${pct(r.mean)} ${pct(r.p999)} ${pct(r.max)} ${pct(r.cpu)}${String(r.voices).padStart(8)}${String(r.dropouts).padStart(10)}` +
      (SLOWDOWN !== 1 ? String(r.dropoutsSlow).padStart(7) : ''),
  );
};
for (const [id, def] of Object.entries(ORGANS)) {
  if (ONLY && id !== ONLY) continue;
  const tutti: Record<string, unknown> = { couple: { great: ['swell', 'positive'], pedal: ['great', 'swell'] } };
  for (const d of divisions) tutti[d] = def.stops.filter((s) => s.division === d).map((s) => s.id);
  // the named preset drawing the most stops
  const [heaviest] = Object.entries(def.presets)
    .map(([name, p]) => [name, divisions.reduce((k, d) => k + (((p as Record<string, unknown[]>)[d]?.length) ?? 0), 0)] as const)
    .sort((a, b) => b[1] - a[1])[0]!;
  print(await chord(id, heaviest, heaviest));
  print(await chord(id, tutti, 'tutti + couplers'));
}
if (!args.includes('--no-bach')) {
  for (const [id, preset] of [['friesach', 'plenum'], ['cracow', 'plein-jeu']] as const) {
    if (ONLY && id !== ONLY) continue;
    print(await bachRun(id, preset));
  }
}
const worst = rows.reduce((a, b) => (b.p999 > a.p999 ? b : a), rows[0]!);
console.log(`\nworst p99.9: ${worst.organ} ${worst.preset} ${pct(worst.p999)}`);
const rss = process.memoryUsage().rss / 1048576;
console.log(`peak resident memory of this process: ${rss.toFixed(0)} MB`);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ buffer: BUFFER, slowdown: SLOWDOWN, threads: THREADS ?? 'auto', repeat: REPEAT, rows, rssMb: rss }, null, 2));
