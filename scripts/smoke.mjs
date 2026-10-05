#!/usr/bin/env node
// Quick end-to-end check of a build (CI): loads supersynth the way users do — by its package
// name, through its exports — renders a piano note and, if an organ package is installed, an
// organ chord, and checks the audio is not silent. Needs `npm run build:ts` and a native engine.
//
//   node scripts/smoke.mjs [organ id]      (default organ: green-positiv, the smallest)
import { createRequire } from 'node:module';

const { Synth } = await import('supersynth');
const organId = process.argv[2] ?? 'green-positiv';

const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const synth = new Synth({ sampleRate: 22050, reverb: false });
synth.add('grand-piano').play(['C4', 'E4', 'G4'], { duration: 0.4 });
let organ = 'not installed';
try {
  synth.add(organId).great.play(['C4', 'G4'], { duration: 0.4 });
  organ = organId;
} catch (e) {
  if (!/npm install @supersynth\/organ-/.test(e.message)) throw e;
}
const audio = synth.render(0.8);
const level = peak(audio.left);
console.log(`Node ${process.version} ${process.platform}-${process.arch}: rendered ${audio.duration.toFixed(2)} s, peak ${level.toFixed(3)}, organ ${organ}`);
if (!(level > 1e-3 && level < 4)) throw new Error(`unexpected peak level ${level}`);

// require() of the ES module, where Node supports it (20.19+, 22.12+)
const [major, minor] = process.versions.node.split('.').map(Number);
if (major >= 23 || (major === 22 && minor >= 12) || (major === 20 && minor >= 19)) {
  const { Synth: RequiredSynth } = createRequire(import.meta.url)('supersynth');
  if (RequiredSynth !== Synth) throw new Error('require("supersynth") gave another module');
  console.log('require("supersynth") ok');
}
