/**
 * The Bureå church organ: a hymn in four parts with pedal, then several registrations.
 *
 *   npm run example:organ [-- out.wav]
 */
import { Synth } from '../src/index.ts';
import { OLD_HUNDREDTH } from './util/music.ts';

const out = process.argv[2];
const synth = new Synth();            // reverb: the organ picks 'church'
const organ = synth.organ({ registration: 'plenum' });

function hymn(t0: number, bpm: number): number {
  const beat = 60 / bpm;
  let t = t0;
  for (const [s, a, tn, b, beats] of OLD_HUNDREDTH) {
    const d = beats * beat * 0.97;
    organ.great.play([s, a, tn], { at: t, duration: d });
    organ.pedal.play(b, { at: t, duration: d });
    t += beats * beat;
  }
  return t - t0;
}

let t = 0.3;
for (const reg of ['plenum', 'flutes', 'principal-chorus', 'full']) {
  organ.useRegistration(reg);
  console.log(`${t.toFixed(1)}s  ${reg}: ${organ.great.drawn.join(', ') || '(great silent)'}`);
  // registrations change between verses; schedule the verse after the change
  t += hymn(t, reg === 'full' ? 76 : 88) + 1.5;
  if (!out) await new Promise((r) => setTimeout(r, 0));
}

// a solo stop over flutes, the classic chorale-prelude texture
organ.useRegistration('cornet');
organ.great.play(['G4'], { at: t, duration: 1 });
organ.great.play(['A4'], { at: t + 1, duration: 1 });
organ.great.play(['B4'], { at: t + 2, duration: 2 });
organ.swell.play(['D4', 'G3'], { at: t, duration: 4 });
organ.pedal.play('G2', { at: t, duration: 4 });
t += 5;

if (out) {
  synth.renderToFile(out, t + 3);
  console.log(`wrote ${out}`);
} else {
  await synth.start();
  await new Promise((r) => setTimeout(r, (t + 3) * 1000));
  synth.close();
}
