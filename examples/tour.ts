/**
 * A short tour through the instruments, in real time.
 *
 *   npm run example:tour            # through your speakers
 *   npm run example:tour -- out.wav # or render to a file
 */
import { Synth, type InstrumentId } from '../src/index.ts';
import { AMAZING_GRACE, BWV846, fitToRange, GREENSLEEVES, ODE_TO_JOY, playSteps, WESTMINSTER } from './util/music.ts';

const out = process.argv[2];
const synth = new Synth({ reverb: 'hall' });

const program: Array<[InstrumentId, typeof ODE_TO_JOY, number]> = [
  ['grand-piano', BWV846, 110],
  ['harpsichord', BWV846, 110],
  ['violin', GREENSLEEVES, 80],
  ['cellos', AMAZING_GRACE, 70],
  ['flute', ODE_TO_JOY, 100],
  ['clarinet', GREENSLEEVES, 80],
  ['tenor-sax', AMAZING_GRACE, 70],
  ['trumpet', ODE_TO_JOY, 100],
  ['french-horn', AMAZING_GRACE, 70],
  ['harp', BWV846, 110],
  ['marimba', ODE_TO_JOY, 120],
  ['tubular-bells', WESTMINSTER, 70],
];

let t = 0.2;
for (const [id, steps, bpm] of program) {
  const instrument = synth.add(id);
  const fitted = fitToRange(steps, instrument.definition.range);
  console.log(`${t.toFixed(1).padStart(5)}s  ${instrument.definition.name}`);
  t += playSteps(instrument, fitted, { at: t, bpm, velocity: 90 }) + 1.5;
}

if (out) {
  synth.renderToFile(out, t + 2);
  console.log(`wrote ${out}`);
} else {
  await synth.start();
  await new Promise((r) => setTimeout(r, (t + 2) * 1000));
  synth.close();
}
