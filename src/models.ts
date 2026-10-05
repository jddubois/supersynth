// Which `.ssm` models there are, and where they ship. The core instruments ship in
// `@supersynth/instruments` (a dependency of supersynth); each organ sample set ships in its own
// npm package (`@supersynth/organ-<id>`), with the same tree under the package's `models/`
// (`organ/<id>/<stop>.ssm`, the Bureå organ `organ/<stop>.ssm`). Finding them is the platform's: files in Node.js
// (`platform/node-models.ts`), URLs in a browser (`platform/browser.ts`).
import type { InstrumentDefinition } from './catalog/types.js';

/** @internal Organs whose models are in a package of their own (`@supersynth/organ-<id>`). */
export const ORGAN_MODEL_PACKAGES = [
  'burea',
  'azzio',
  'cracow',
  'dluga-koscielna',
  'friesach',
  'giubiasco',
  'green-positiv',
  'harmonium',
  'ledziny',
  'lipiny',
  'melcer',
  'raszczyce',
  'saint-jean-de-luz',
  'skrzatusz',
  'strassburg',
  'szczecinek',
] as const;

const PACKAGED = new Set<string>(ORGAN_MODEL_PACKAGES);

/** @internal The package of the core instruments' models (every model that is not an organ's). */
export const INSTRUMENTS_PACKAGE = '@supersynth/instruments';

/** @internal The organ and npm package a model ships in, or `undefined` for a core model
 *  (in {@link INSTRUMENTS_PACKAGE}). `organ/<id>/<stop>` is in `@supersynth/organ-<id>`, `organ/<stop>`
 *  (the Bureå organ) in `@supersynth/organ-burea`. */
export function modelPackage(name: string): { organ: string; pkg: string } | undefined {
  const parts = name.split('/');
  if (parts[0] !== 'organ') return undefined;
  const organ = parts.length === 2 ? 'burea' : parts.length === 3 ? parts[1]! : undefined;
  if (!organ || !PACKAGED.has(organ)) return undefined;
  return { organ, pkg: `@supersynth/organ-${organ}` };
}

/** The models an organ definition names besides its stops' own: Forte models and machinery
 *  noises. */
interface OrganModels {
  stops: readonly { id: string; model?: string; forte?: string }[];
  noises?: {
    keys?: Partial<Record<string, { down?: string; up?: string }>>;
    stops?: string;
    blower?: { model: string };
    ambient?: { model: string };
  };
}

/** @internal Every model an organ may load: each stop's (the same rule as `stopModel` in
 *  Organ.ts: `stop.model`, else `organ/<stop id>`), its Forte model, and the noise models. */
export function organModels(organ: OrganModels): string[] {
  const names = new Set<string>();
  for (const stop of organ.stops) {
    names.add(stop.model ?? `organ/${stop.id}`);
    if (stop.forte) names.add(stop.forte);
  }
  const nz = organ.noises;
  if (nz) {
    for (const k of Object.values(nz.keys ?? {})) for (const m of [k?.down, k?.up]) if (m) names.add(m);
    for (const m of [nz.stops, nz.blower?.model, nz.ambient?.model]) if (m) names.add(m);
  }
  return [...names];
}

/** @internal Every model an instrument may load: its layers' and its presets'. */
export function instrumentModels(def: Pick<InstrumentDefinition, 'layers' | 'presets'>): string[] {
  const names = new Set<string>();
  for (const l of def.layers) names.add(l.model);
  for (const p of Object.values(def.presets ?? {})) for (const l of p.layers ?? []) names.add(l.model);
  return [...names];
}
