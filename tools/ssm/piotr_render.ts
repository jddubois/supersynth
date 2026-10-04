// Render a preset of a built-in organ through the public organ API (piotr_eval.py).
// usage: node --import tsx tools/ssm/piotr_render.ts <json-spec> <out.wav>
//        node --import tsx tools/ssm/piotr_render.ts --def <organ-id>     (prints the OrganDefinition)
import { readFileSync, writeFileSync } from 'node:fs';
import { ORGANS, Synth, type OrganPreset } from '../../src/index.ts';

if (process.argv[2] === '--def') {
  writeFileSync(1, JSON.stringify((ORGANS as Record<string, unknown>)[process.argv[3]!]));
  process.exit(0);
}
const spec = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as {
  organ: string; preset?: string; draw?: OrganPreset; play: Record<string, number[]>; hold: number;
  seconds: number; sampleRate: number;
};
// well below the master limiter (a full registration would otherwise be compressed)
const synth = new Synth({ sampleRate: spec.sampleRate, reverb: false, volume: 0.1 });
// a named preset, or (single stops) nothing but the stops given
const organ = synth.add(spec.organ as never, { preset: spec.draw ?? spec.preset, wind: 0 });
for (const [div, keys] of Object.entries(spec.play)) {
  organ.division(div as never).play(keys, { at: 0.01, duration: spec.hold });
}
synth.renderToFile(process.argv[3]!, spec.seconds, { bitDepth: 32 });
