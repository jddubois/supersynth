// Render organ registrations through the public API (used by organ_eval.py).
// usage: node --import tsx tools/ssm/organ_render.ts <json-spec> <out.wav>
import { readFileSync } from 'node:fs';
import { Synth } from '../../src/index.ts';
const spec = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as {
  sampleRate: number; layers: { model: string; transpose: number }[]; keys: number[]; hold: number; seconds: number;
};
// SSM_OUT_DIR: evaluate models built into a scratch directory
const synth = new Synth({ sampleRate: spec.sampleRate, reverb: false, volume: 1, modelsDirectory: process.env.SSM_OUT_DIR || undefined });
const part = synth.add({
  id: 'organ-test', name: 'test', family: 'organ', description: '', range: [0, 127], reverb: 'church',
  layers: spec.layers, presets: { default: { description: '' } },
});
part.set({ reverbSend: 0 });
for (const k of spec.keys) part.play(k, { at: 0.01, duration: spec.hold, velocity: 100 });
synth.renderToFile(process.argv[3]!, spec.seconds, { bitDepth: 32 });
