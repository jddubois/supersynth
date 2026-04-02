// Generates docs/instruments.md and the stop/registration tables of docs/organ.md from the catalog.
import { writeFileSync } from 'node:fs';
import { BUREA_STOPS, INSTRUMENTS, REGISTRATIONS } from '../src/index.ts';

const fam: Record<string, string> = { keyboard: 'Keyboards', organ: 'Organs', strings: 'Strings', woodwind: 'Woodwinds', brass: 'Brass', percussion: 'Mallets & bells' };
let md = '# Instruments\n\nEvery instrument is a spectral model analysed from real recordings (see NOTICE.md).\n' +
  'Add one with `synth.add(id, { preset })`. Aliases are accepted wherever an id is.\n';
for (const f of Object.keys(fam)) {
  md += `\n## ${fam[f]}\n`;
  for (const d of INSTRUMENTS.filter((x) => x.family === f)) {
    md += `\n### \`${d.id}\` — ${d.name}\n\n${d.description}\n\n`;
    if (d.aliases?.length) md += `Aliases: ${d.aliases.map((a) => `\`${a}\``).join(', ')}. `;
    md += `Suggested room: \`${d.reverb}\`.\n\n| Preset | Description |\n|---|---|\n`;
    for (const [k, p] of Object.entries(d.presets)) md += `| \`${k}\` | ${p.description} |\n`;
  }
}
md += '\nThe full church organ is not a single instrument but an `Organ` with four divisions — see [organ.md](organ.md).\n';
writeFileSync('docs/instruments.md', md);

let org = '';
for (const div of ['great', 'swell', 'positive', 'pedal']) {
  org += `\n### ${div[0]!.toUpperCase() + div.slice(1)}\n\n| Stop | Family |\n|---|---|\n`;
  for (const s of BUREA_STOPS.filter((x) => x.division === div)) org += `| ${s.name} | ${s.family} |\n`;
}
org += '\n## Registrations\n\n| Name | Description |\n|---|---|\n';
for (const [k, r] of Object.entries(REGISTRATIONS)) org += `| \`${k}\` | ${r.description} |\n`;
writeFileSync('docs/organ-stops.generated.md', org); // spliced into organ.md
console.log('docs generated');
