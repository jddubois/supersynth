/**
 * Several instruments together: strings pad, a woodwind melody, horn, harp and bass.
 *
 *   npm run example:orchestra [-- out.wav]
 */
import { Synth } from '../src/index.ts';
import { CANON_CHORDS, GREENSLEEVES, playSteps } from './util/music.ts';

const out = process.argv[2];
const synth = new Synth({ reverb: 'concert-hall' });
const strings = synth.add('strings', { preset: 'lush' });
const bass = synth.add('contrabass-pizzicato');
const harp = synth.add('harp');
const oboe = synth.add('oboe', { preset: 'vibrato' });
const horn = synth.add('french-horn', { parameters: { volume: -4 } });

const bar = 2.2;
let t = 0.3;
for (let rep = 0; rep < 2; rep++) {
  for (const c of CANON_CHORDS) {
    const [b, ...upper] = c;
    strings.play(upper, { at: t, duration: bar * 0.98, velocity: 70 });
    bass.play(b!, { at: t, velocity: 90, duration: 0.6 });
    upper.forEach((n, i) => harp.play(n, { at: t + i * 0.12 + bar / 2, velocity: 60, duration: 1 }));
    if (rep === 1) horn.play(upper[0]!, { at: t, duration: bar * 0.95, velocity: 60 });
    t += bar;
  }
}
playSteps(oboe, GREENSLEEVES, { at: 0.3 + 8 * bar, tempo: 82, velocity: 85 });

if (out) {
  synth.renderToFile(out, t + 3);
  console.log(`wrote ${out}`);
} else {
  await synth.start();
  await new Promise((r) => setTimeout(r, (t + 3) * 1000));
  synth.close();
}
