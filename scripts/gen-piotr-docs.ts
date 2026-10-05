// Generates docs/piotr-organs.md from the organ definitions of Piotr Grabowski's sample sets.
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PIOTR_ORGANS } from '../src/organs/index.ts';

const constName = (id: string) => `${id.toUpperCase().replace(/-/g, '_')}_ORGAN`;
/** Size of an organ's model package (its models/ folder), in MB. */
const modelsMB = (id: string): number => {
  const size = (p: string): number => (statSync(p).isDirectory() ? readdirSync(p).reduce((a, f) => a + size(path.join(p, f)), 0) : statSync(p).size);
  return Math.round(size(`packages/organ-${id}/models`) / 1e6);
};
const DIV: Record<string, string> = { great: 'Great', swell: 'Swell', positive: 'Positive', pedal: 'Pedal' };

let md = `# Piotr Grabowski's organs

Every organ that Piotr Grabowski gives away free at [piotrgrabowski.pl](https://piotrgrabowski.pl/instruments/),
analysed stop by stop like the Bureå organ (see [models.md](models.md)). Each stop is analysed from
the sample set's recordings **as its organ definition plays them**: each pipe's attack and sustain,
its release crossfaded in at key-up, the definition's retuning and level for every pipe, and
the borrowed, extended and retuned ranks exactly where the sample set places them. Stops keep the
organ's own pitch and temperament (an organ at Baroque or historic pitch sounds at that pitch),
the balance between stops, and the room the pipes were recorded in. Keys where a stop has no pipe
(a treble-only Cornet) stay silent. Sampled tremulants are measured from the pipes recorded with
the tremulant on.

\`\`\`ts
const organ = synth.add('szczecinek', { preset: 'celeste' });
organ.swell.play(['C4', 'E4', 'G4'], { duration: 4 });
organ.preset('full');
\`\`\`

Every organ is an \`OrganDefinition\` exported from \`supersynth\` and \`supersynth/organs\` (all of them also as
\`PIOTR_ORGANS\`). Sample sets © Piotr Grabowski; the models are not covered by the MIT license
and may not be sold or built into products for sale — see NOTICE.md.

Each organ's models are an npm package of their own, \`supersynth-organ-<id>\`: install the organs
you play (\`npm install supersynth-organ-friesach\`), or all of them with \`npm install supersynth-organs\`.
Adding an organ whose package is not installed throws a \`SupersynthError\` that names the package.

| Id | Organ | Stops | Package | Models |
|---|---|---|---|---|
`;
for (const o of Object.values(PIOTR_ORGANS)) md += `| \`${o.id}\` | ${o.name} | ${o.stops.length} | \`supersynth-organ-${o.id}\` | ${modelsMB(o.id)} MB |\n`;
for (const o of Object.values(PIOTR_ORGANS)) {
  md += `\n## \`${o.id}\` — ${o.name}\n\n${o.description}\n\nInstall: \`npm install supersynth-organ-${o.id}\`. Config: \`${constName(o.id)}\`. Default preset: \`${o.defaultPreset}\`.`;
  if (o.tremulant) md += ` Tremulant on the ${o.tremulant.division}.`;
  const boxed = Object.entries(o.divisions ?? {}).filter(([k, d]) => d?.swellBox && o.stops.some((s) => s.division === k)).map(([k]) => k);
  if (boxed.length) md += ` In a swell box: ${boxed.join(', ')}.`;
  md += '\n\n';
  for (const div of ['great', 'swell', 'positive', 'pedal']) {
    const stops = o.stops.filter((s) => s.division === div);
    if (stops.length) md += `**${DIV[div]}:** ${stops.map((s) => s.name).join(', ')}\n\n`;
  }
  md += '| Preset | Description |\n|---|---|\n';
  for (const [k, r] of Object.entries(o.presets)) md += `| \`${k}\` | ${r.description} |\n`;
}
writeFileSync('docs/piotr-organs.md', md);
console.log('docs/piotr-organs.md');
