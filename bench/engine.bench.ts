/**
 * Engine throughput: how many times faster than real time each scenario renders
 * (single core, offline). CPU % is the share of one core needed in real time.
 *
 *   npm run bench              (SUPERSYNTH_MODELS_DIR=<dir> to benchmark other models: looked up
 *                               there first, laid out like models/, e.g. <dir>/organ/<id>/<stop>.ssm)
 */
import { Synth } from '../src/index.ts';

interface Scenario {
  name: string;
  setup: (s: Synth) => number; // returns number of notes started
}

const SECONDS = 8;
const scenarios: Scenario[] = [
  { name: 'piano, 1 note', setup: (s) => { s.add('grand-piano').play('C4', { duration: 6 }); return 1; } },
  {
    name: 'piano, 16 held notes + pedal',
    setup: (s) => {
      const p = s.add('grand-piano');
      p.sustain(true);
      for (let i = 0; i < 16; i++) p.play(36 + i * 3, { duration: 6, velocity: 90 });
      return 16;
    },
  },
  {
    name: 'piano, 64 fast notes (arpeggios)',
    setup: (s) => {
      const p = s.add('grand-piano');
      for (let i = 0; i < 64; i++) p.play(40 + ((i * 7) % 48), { at: i * 0.1, duration: 1.5 });
      return 64;
    },
  },
  {
    name: 'string orchestra, 8-note chord',
    setup: (s) => { s.add('strings').play([36, 43, 48, 55, 60, 64, 67, 72], { duration: 6 }); return 8; },
  },
  {
    name: 'church organ plenum, 4 notes + pedal',
    setup: (s) => {
      const o = s.add('burea', { preset: 'plenum' });
      o.great.play(['C4', 'E4', 'G4', 'C5'], { duration: 6 });
      o.pedal.play('C2', { duration: 6 });
      return 5;
    },
  },
  {
    name: 'full organ, 6 notes + pedal, all couplers',
    setup: (s) => {
      const o = s.add('burea', { preset: 'full' });
      o.great.play(['C3', 'G3', 'C4', 'E4', 'G4', 'C5'], { duration: 6 });
      o.pedal.play('C2', { duration: 6 });
      return 7;
    },
  },
];

console.log(`render ${SECONDS}s @ 48 kHz, stereo, with reverb + limiter\n`);
for (const sc of scenarios) {
  const dir = process.env.SUPERSYNTH_MODELS_DIR;
  const synth = new Synth({ sampleRate: 48000, reverb: 'hall', ...(dir ? { modelsDirectory: dir } : {}) });
  const notes = sc.setup(synth);
  synth.render(0.01); // load models outside the timing
  const t0 = performance.now();
  let maxVoices = 0;
  for (let t = 0; t < SECONDS; t += 0.5) {
    synth.render(0.5);
    maxVoices = Math.max(maxVoices, synth.activeVoices);
  }
  const ms = performance.now() - t0;
  const rt = (SECONDS * 1000) / ms;
  console.log(
    `${sc.name.padEnd(44)} ${rt.toFixed(1).padStart(6)}× real time   CPU ${(100 / rt).toFixed(1).padStart(5)}%   ` +
      `voices ${String(maxVoices).padStart(3)} (${notes} notes)`,
  );
  synth.close();
}
