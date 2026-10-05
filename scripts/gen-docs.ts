// Generates docs/instruments.md and the stop/preset tables of docs/organ.md from the catalog.
import { writeFileSync } from 'node:fs';
import { BUREA_ORGAN, INSTRUMENTS, type InstrumentDefinition } from '../src/index.ts';
import * as configs from '../src/catalog/index.ts';

// the exported name of each instrument config (GRAND_PIANO, …)
const constName = new Map<InstrumentDefinition, string>(
  Object.entries(configs).filter(([, v]) => typeof v === 'object' && v !== null && 'layers' in v).map(([k, v]) => [v as InstrumentDefinition, k]),
);

const fam: Record<string, string> = { keyboard: 'Keyboards', organ: 'Organs', strings: 'Strings', woodwind: 'Woodwinds', brass: 'Brass', percussion: 'Mallets & bells' };
let md = '# Instruments\n\nEvery instrument is a spectral model analysed from real recordings (see NOTICE.md).\n' +
  'Add one with `synth.add(id, { preset })`; `INSTRUMENTS` holds them all, by id.\n\n' +
  'Every instrument is also a plain configuration object (`InstrumentDefinition`) exported under the name\n' +
  'shown with it, from `supersynth` and from `supersynth/instruments`. Pass it to `synth.add`, or\n' +
  'copy and change it:\n\n' +
  '```ts\nimport { GRAND_PIANO } from \'supersynth/instruments\';\n' +
  'synth.add({ ...GRAND_PIANO, id: \'dark-piano\', parameters: { brightness: -1.5 } });\n```\n\n' +
  'An `InstrumentDefinition` has an `id`, `name`, `family` (`\'keyboard\'`, `\'strings\'`, …) and `description`;\n' +
  'its `layers`, the models it plays; the `range` of keys `[low, high]` they cover; a suggested `reverb` room;\n' +
  '`parameters` (see [parameters.md](parameters.md)) and its `presets` (`{ description, parameters, layers, reverb }`).\n' +
  'A layer plays the model `<model>.ssm` (in `@supersynth/instruments`) with optional `transpose` (semitones), `gain` (dB), `pan`,\n' +
  '`detune` (cents), `keyLow`/`keyHigh` (the keys it plays) and `trigger: \'release\'` (it sounds at key-up:\n' +
  'damper and jack noise).\n';
for (const f of Object.keys(fam)) {
  md += `\n## ${fam[f]}\n`;
  for (const d of Object.values(INSTRUMENTS).filter((x) => x.family === f)) {
    md += `\n### \`${d.id}\` — ${d.name}\n\n${d.description}\n\n`;
    md += `Config: \`${constName.get(d)}\`. `;
    md += `Suggested room: \`${d.reverb}\`.\n\n| Preset | Description |\n|---|---|\n`;
    for (const [k, p] of Object.entries(d.presets)) md += `| \`${k}\` | ${p.description} |\n`;
  }
}
md += '\nThe church organs (`synth.add(\'burea\')`, …) have four divisions with drawable stops, and their models come in separate packages (`npm install @supersynth/organ-burea`); see [organ.md](organ.md).\n';
writeFileSync('docs/instruments.md', md);

let org = '';
for (const div of ['great', 'swell', 'positive', 'pedal']) {
  org += `\n### ${div[0]!.toUpperCase() + div.slice(1)}\n\n| Stop | Family |\n|---|---|\n`;
  for (const s of BUREA_ORGAN.stops.filter((x) => x.division === div)) org += `| ${s.name} | ${s.family} |\n`;
}
org += '\n## Bureå presets\n\n| Name | Description |\n|---|---|\n';
for (const [k, r] of Object.entries(BUREA_ORGAN.presets)) org += `| \`${k}\` | ${r.description ?? ''} |\n`;
writeFileSync('docs/organ-stops.generated.md', org); // spliced into organ.md
console.log('docs generated');
