/**
 * The rock organ: a riff with the rotary speaker fast, a held chord while it slows down and
 * speeds up again, and the amplifier driven hard.
 *
 *   npm run example:rock [-- out.wav]
 */
import { Synth } from '../src/index.ts';

const out = process.argv[2];
const synth = new Synth();
const organ = synth.add('rock-organ');

// 1. A riff in A minor, speaker fast: bass note, stabs, and a run
let t = 0.2;
const stab = (notes: number[], beats: number) => {
  organ.play(notes, { at: t, duration: beats * 0.46 });
  t += beats * 0.5;
};
for (const [root, third] of [[57, 60], [55, 59], [53, 57], [52, 56]] as const) {
  organ.play(root - 12, { at: t, duration: 1.9 });
  stab([root, third, root + 7], 1);
  stab([root, third, root + 7, root + 12], 0.5);
  t += 0.25;
  stab([root + 12, third + 12, root + 19], 1);
  stab([root, third, root + 7], 1);
}
for (const step of [0, 3, 5, 6, 7, 10, 12, 10, 7, 6, 5, 3]) stab([69 + step], 0.25);

// 2. One chord, eight seconds: the speaker brakes to slow and spins up again. The horn follows
//    within a second, the heavy bass rotor takes several.
organ.play([45, 57, 60, 64, 69, 72, 76], { at: t, duration: 8 });
organ.set({ leslie: 'slow' }, { at: t + 1.5 });
organ.set({ leslie: 'fast' }, { at: t + 5 });
t += 8.5;

// 3. The same riff's last bars, overdriven
organ.preset('overdrive', { at: t });
for (const [root, third] of [[53, 57], [52, 56]] as const) {
  organ.play(root - 12, { at: t, duration: 1.9 });
  stab([root, third, root + 7], 1);
  stab([root, third, root + 7, root + 12], 1);
  stab([root + 12, third + 12, root + 19], 2);
}

if (out) {
  synth.renderToFile(out, t + 2);
  console.log(`wrote ${out}`);
} else {
  await synth.start();
  await new Promise((r) => setTimeout(r, (t + 2) * 1000));
  synth.close();
}
