// Render a registration of a built-in organ through the public organ API (piotr_eval.py).
// usage: node --import tsx tools/ssm/piotr_render.ts <json-spec> <out.wav>
//        node --import tsx tools/ssm/piotr_render.ts --def <organ-id>     (prints the OrganDef)
import { readFileSync, writeFileSync } from 'node:fs';
import { ORGANS, Synth } from '../../src/index.ts';

if (process.argv[2] === '--def') {
  writeFileSync(1, JSON.stringify((ORGANS as Record<string, unknown>)[process.argv[3]!]));
  process.exit(0);
}
const spec = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as {
  organ: string; registration: string; play: Record<string, number[]>; hold: number; seconds: number; sampleRate: number;
};
const synth = new Synth({ sampleRate: spec.sampleRate, reverb: false, volume: 1 });
const organ = synth.organ({ instrument: spec.organ as never, registration: spec.registration, wind: 0 });
for (const [div, keys] of Object.entries(spec.play)) {
  organ.division(div as never).play(keys, { at: 0.01, duration: spec.hold });
}
synth.renderToFile(process.argv[3]!, spec.seconds, { bitDepth: 32 });
