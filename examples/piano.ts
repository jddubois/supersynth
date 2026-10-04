/**
 * The grand piano: dynamics, sustain pedal, presets and live tweaks.
 *
 *   npm run example:piano [-- out.wav]
 */
import { chord, Synth } from '../src/index.ts';
import { BWV846, playSteps } from './util/music.ts';

const out = process.argv[2];
const synth = new Synth({ reverb: 'concert-hall' });
const piano = synth.add('grand-piano');

// 1. Bach, Prelude in C, with the sustain pedal changed every bar
let t = 0.2;
for (let bar = 0; bar < 4; bar++) {
  piano.sustain(true, { at: t + bar * 2.4 + 0.02 });
  piano.sustain(false, { at: t + (bar + 1) * 2.4 - 0.05 });
}
t += playSteps(piano, BWV846, { at: t, bpm: 100, velocity: 72 }) + 1;

// 2. The same chord at four dynamics: velocity changes tone, not just volume
for (const v of [30, 60, 90, 120]) {
  piano.play(chord('C3', 'maj7'), { at: t, velocity: v, duration: 1.6 });
  t += 2;
}

// 3. Presets: mellow and bright
piano.preset('mellow');
piano.play(chord('F3', 'add9'), { at: t, velocity: 85, duration: 2 });
t += 2.5;
piano.set({ brightness: 1.5 }, { at: t });
piano.play(chord('F3', 'add9'), { at: t, velocity: 85, duration: 2 });
t += 3;

if (out) {
  synth.renderToFile(out, t + 2);
  console.log(`wrote ${out}`);
} else {
  await synth.start();
  await new Promise((r) => setTimeout(r, (t + 2) * 1000));
  synth.close();
}
