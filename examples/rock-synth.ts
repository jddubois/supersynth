/**
 * The rock synth: a chord riff on the polysynth brass, the same riff in the hall with a mono
 * lead over it, held chords on the pad, and power chords from single keys.
 *
 *   npm run example:synth [-- out.wav]
 */
import { Synth } from '../src/index.ts';

const out = process.argv[2];
const synth = new Synth();
const keys = synth.add('rock-synth');
const lead = synth.add('rock-synth', { preset: 'lead', parameters: { volume: -2 } });

const beat = 60 / 126;
let t = 0.2;
// chords over a pedal bass: C, F/C, G/C, then Am, F, G
const riff: [number[], number, number][] = [
  [[60, 64, 67], 0, 0.75], [[60, 64, 67], 1, 0.4], [[60, 65, 69], 1.5, 1.2], [[62, 67, 71], 3, 0.4], [[62, 67, 71], 3.5, 0.45],
  [[60, 64, 67], 4, 0.75], [[60, 64, 67], 5, 0.4], [[60, 65, 69], 5.5, 1.2], [[62, 67, 71], 7, 0.9],
  [[57, 60, 64], 8, 0.75], [[57, 60, 64], 9, 0.4], [[57, 60, 65], 9.5, 1.2], [[59, 62, 67], 11, 0.4], [[59, 62, 67], 11.5, 0.45],
  [[60, 64, 67, 72], 12, 3.6],
];
const bass = [36, 36, 33, 36];
const playRiff = (velocity: number) => {
  for (const [notes, at, beats] of riff) keys.play(notes, { at: t + at * beat, duration: beats * beat, velocity });
  for (let bar = 0; bar < 4; bar++) {
    for (let eighth = 0; eighth < 8; eighth++) keys.play(bass[bar]!, { at: t + (bar * 4 + eighth / 2) * beat, duration: 0.4 * beat, velocity: 96 });
  }
};

// 1. The riff, polysynth brass
playRiff(104);
t += 16 * beat;

// 2. Again in the hall, played harder, with the lead on top (overlapping notes glide)
keys.preset('arena', { at: t });
playRiff(118);
const tune: [number, number, number][] = [
  [79, 0, 1.6], [76, 1.5, 0.6], [79, 2, 1.1], [84, 3, 1.1], [83, 4, 1.6], [79, 5.5, 0.6], [81, 6, 1.1], [79, 7, 1.1],
  [76, 8, 1.6], [72, 9.5, 0.6], [76, 10, 1.1], [77, 11, 0.6], [79, 11.5, 0.6], [84, 12, 3.5],
];
for (const [note, at, beats] of tune) lead.play(note, { at: t + at * beat, duration: beats * beat, velocity: 110 });
lead.modulation(0.6, { at: t + 13 * beat });
lead.modulation(0, { at: t + 16 * beat });
t += 16.5 * beat;

// 3. Held chords on the pad
keys.preset('pad', { at: t });
for (const [i, notes] of [[45, 57, 60, 64, 69], [41, 57, 60, 65, 69], [43, 55, 59, 62, 67], [48, 55, 60, 64, 72]].entries()) {
  keys.play(notes, { at: t + i * 4 * beat, duration: 4.1 * beat, velocity: 80 });
}
t += 18 * beat;

// 4. Power chords from single keys
keys.preset('power', { at: t });
for (const [note, at, beats] of [[45, 0, 1.4], [45, 1.5, 0.4], [48, 2, 0.9], [50, 3, 0.9], [45, 4, 1.4], [45, 5.5, 0.4], [43, 6, 0.9], [41, 7, 0.9], [45, 8, 4]] as const) {
  keys.play(note, { at: t + at * beat, duration: beats * beat, velocity: 112 });
}
t += 12 * beat;

if (out) {
  synth.renderToFile(out, t + 2.5);
  console.log(`wrote ${out}`);
} else {
  await synth.start();
  await new Promise((r) => setTimeout(r, (t + 2.5) * 1000));
  synth.close();
}
