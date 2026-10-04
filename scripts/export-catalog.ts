// Prints the instrument catalog and organ presets as JSON (used by tools/ssm).
import { BUREA_ORGAN, INSTRUMENTS } from '../src/index.ts';
console.log(JSON.stringify({
  instruments: INSTRUMENTS.map((d) => ({
    id: d.id, name: d.name, family: d.family, description: d.description,
    presets: Object.fromEntries(Object.entries(d.presets).map(([k, p]) => [k, p.description])),
  })),
  organPresets: Object.fromEntries(Object.entries(BUREA_ORGAN.presets).map(([k, r]) => [k, r.description ?? ''])),
}));
