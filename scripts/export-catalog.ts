// Prints the instrument catalog and organ registrations as JSON (used by tools/ssm).
import { BUREA_ORGAN, INSTRUMENTS } from '../src/index.ts';
console.log(JSON.stringify({
  instruments: INSTRUMENTS.map((d) => ({
    id: d.id, name: d.name, family: d.family, description: d.description,
    presets: Object.fromEntries(Object.entries(d.presets).map(([k, p]) => [k, p.description])),
  })),
  registrations: Object.fromEntries(Object.entries(BUREA_ORGAN.registrations).map(([k, r]) => [k, r.description])),
}));
