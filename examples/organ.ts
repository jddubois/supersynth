/**
 * The Bureå church organ: a hymn in four parts with pedal, then several presets.
 *
 *   npm run example:organ [-- out.wav]
 */
import { Synth, writeWav, type AudioBuffer } from '../src/index.ts';
import { OLD_HUNDREDTH } from './util/music.ts';

const out = process.argv[2];
const synth = new Synth();            // reverb: the organ picks 'church'
const organ = synth.organ({ preset: 'plenum' });

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

// Preset changes take effect when they are made, so offline each verse is rendered
// right after its change (in real time, the change waits until the previous verse is over).
const parts: AudioBuffer[] = [];
let t = 0.3;
for (const reg of ['plenum', 'flutes', 'principal-chorus', 'full']) {
  if (!out) await new Promise((r) => setTimeout(r, Math.max(0, (t - synth.currentTime - 0.2) * 1000)));
  organ.preset(reg);
  console.log(`${t.toFixed(1)}s  ${reg}: ${organ.great.drawn().join(', ') || '(great silent)'}`);
  t += hymn(t, reg === 'full' ? 76 : 88) + 1.5;
  if (out) parts.push(synth.render(t - synth.currentTime));
}

// a solo stop over flutes, the classic chorale-prelude texture
organ.preset('cornet');
organ.great.play(['G4'], { at: t, duration: 1 });
organ.great.play(['A4'], { at: t + 1, duration: 1 });
organ.great.play(['B4'], { at: t + 2, duration: 2 });
organ.swell.play(['D4', 'G3'], { at: t, duration: 4 });
organ.pedal.play('G2', { at: t, duration: 4 });
t += 5;

if (out) {
  parts.push(synth.render(t + 3 - synth.currentTime));
  const n = parts.reduce((a, p) => a + p.left.length, 0);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  let o = 0;
  for (const p of parts) {
    left.set(p.left, o);
    right.set(p.right, o);
    o += p.left.length;
  }
  writeWav(out, { ...parts[0]!, left, right, duration: n / parts[0]!.sampleRate } as AudioBuffer);
  console.log(`wrote ${out}`);
} else {
  await synth.start();
  await new Promise((r) => setTimeout(r, (t + 3) * 1000));
  synth.close();
}
