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

These are all the organs Piotr Grabowski gives away for free at
[piotrgrabowski.pl](https://piotrgrabowski.pl/instruments/), analysed stop by stop in the same way
as the Bureå organ (see [models.md](models.md)). Each stop is analysed from the sample set's
recordings the way its organ definition plays them: every pipe's attack and sustain, its release
crossfaded in at key-up, the retuning and level the definition gives each pipe, borrowed,
extended and retuned ranks exactly where the sample set puts them, and the releases recorded
after short key presses. The stops keep the organ's own pitch and temperament (an organ at a
Baroque or historic pitch still sounds at that pitch), the balance between stops, and the room
the pipes were recorded in. Keys where a stop has no pipe, as on a treble-only Cornet, stay
silent. Swell boxes close as far as the organ definition says, and sampled tremulants are
measured from pipes recorded with the tremulant on. The machinery noises the sample sets
recorded (key and stop action, blower, room) play with \`noises: true\`.

\`\`\`ts
const organ = synth.add('szczecinek', { preset: 'celeste' });
organ.swell.play(['C4', 'E4', 'G4'], { duration: 4 });
organ.preset('full');
\`\`\`

Each organ is an \`OrganDefinition\` exported from \`supersynth\` and \`supersynth/organs\`, and
\`PIOTR_ORGANS\` collects all of them. The sample sets are © Piotr Grabowski. The models aren't
covered by the MIT license and can't be sold or built into products for sale; see NOTICE.md.

Each organ is a separate npm package, \`@supersynth/organ-<id>\`. Install the ones you play
(\`npm install @supersynth/organ-friesach\`), or all of them with \`npm install @supersynth/organs\`.
Adding an organ whose package isn't installed throws a \`SupersynthError\` that names the package.

| Id | Organ | Stops | Package | Models |
|---|---|---|---|---|
`;
for (const o of Object.values(PIOTR_ORGANS)) md += `| \`${o.id}\` | ${o.name} | ${o.stops.length} | \`@supersynth/organ-${o.id}\` | ${modelsMB(o.id)} MB |\n`;
for (const o of Object.values(PIOTR_ORGANS)) {
  md += `\n## \`${o.id}\` — ${o.name}\n\n${o.description}\n\nInstall: \`npm install @supersynth/organ-${o.id}\`. Config: \`${constName(o.id)}\`. Default preset: \`${o.defaultPreset}\`.`;
  const trems = o.tremulant === undefined ? [] : Array.isArray(o.tremulant) ? o.tremulant : [o.tremulant];
  for (const t of trems) md += ` Tremulant on the ${[t.division].flat().join(' and ')}.`;
  const boxed = Object.entries(o.divisions ?? {}).filter(([k, d]) => d?.swellBox && o.stops.some((s) => s.division === k));
  if (boxed.length) {
    const box = ([k, d]: [string, (typeof boxed)[number][1]]) =>
      typeof d?.swellBox === 'object' && d.swellBox.closed !== undefined ? `${k} (closes to ${d.swellBox.closed} dB)` : k;
    md += ` In a swell box: ${boxed.map(box).join(', ')}.`;
  }
  if (o.stops.some((s) => s.forte)) md += ' Each division has a Forte (`division.forte(true)`).';
  if (o.noises) md += ' Noises: ' + [o.noises.keys && 'key action', o.noises.stops && 'stop action', o.noises.blower && 'blower', o.noises.ambient && 'room'].filter(Boolean).join(', ') + '.';
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
