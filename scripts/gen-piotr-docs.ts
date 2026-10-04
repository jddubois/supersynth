// Generates docs/piotr-organs.md from the organ definitions of Piotr Grabowski's sample sets.
import { writeFileSync } from 'node:fs';
import { PIOTR_ORGANS } from '../src/organs/index.ts';

const constName = (id: string) => `${id.toUpperCase().replace(/-/g, '_')}_ORGAN`;
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
const organ = synth.organ({ instrument: 'szczecinek', registration: 'celeste' });
organ.swell.play(['C4', 'E4', 'G4'], { duration: 4 });
organ.useRegistration('full');
\`\`\`

Every organ is an \`OrganDef\` exported from \`supersynth\` and \`supersynth/organs\` (all of them also as
\`PIOTR_ORGANS\`). Sample sets © Piotr Grabowski; the models are not covered by the MIT license
and may not be sold or built into products for sale — see NOTICE.md.

| Id | Organ | Stops |
|---|---|---|
`;
for (const o of Object.values(PIOTR_ORGANS)) md += `| \`${o.id}\` | ${o.name} | ${o.stops.length} |\n`;
for (const o of Object.values(PIOTR_ORGANS)) {
  md += `\n## \`${o.id}\` — ${o.name}\n\n${o.description}\n\nConfig: \`${constName(o.id)}\`. Default registration: \`${o.defaultRegistration}\`.`;
  if (o.tremulant) md += ` Tremulant on the ${o.tremulant.division}.`;
  const boxed = Object.entries(o.divisions ?? {}).filter(([k, d]) => d?.swellBox && o.stops.some((s) => s.division === k)).map(([k]) => k);
  if (boxed.length) md += ` In a swell box: ${boxed.join(', ')}.`;
  md += '\n\n';
  for (const div of ['great', 'swell', 'positive', 'pedal']) {
    const stops = o.stops.filter((s) => s.division === div);
    if (stops.length) md += `**${DIV[div]}:** ${stops.map((s) => s.name).join(', ')}\n\n`;
  }
  md += '| Registration | Description |\n|---|---|\n';
  for (const [k, r] of Object.entries(o.registrations)) md += `| \`${k}\` | ${r.description} |\n`;
}
writeFileSync('docs/piotr-organs.md', md);
console.log('docs/piotr-organs.md');
