/**
 * Model loading benchmark: how long `synth.add()` of an organ blocks JavaScript, how long until
 * all its models are loaded (`await organ.ready`), and the memory they take: with every stop
 * drawn ("tutti"), and with the organ's default preset (the other stops load in the background).
 *
 *   npm run load-test                       Friesach, Cracow and Bureå
 *   npm run load-test -- friesach           one organ (or several)
 *   npm run load-test -- --preload preset   the `preload` option of synth.add
 *
 * Each measurement runs in a fresh process (memory figures are per organ).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Synth, type OrganPreset } from '../src/index.ts';
import { resolveOrgan } from '../src/Organ.ts';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const preload = opt('preload');
const child = opt('child');
const preset = opt('preset') ?? 'tutti';

if (child) {
  const def = resolveOrgan(child as never);
  const tutti: OrganPreset = {};
  for (const s of def.stops) (tutti[s.division] ??= []).push(s.name);
  const registration = preset === 'tutti' ? tutti : preset === 'default' ? def.defaultPreset : preset;
  const rss0 = process.memoryUsage().rss;
  const synth = new Synth({ sampleRate: 48000 });
  const t0 = performance.now();
  const organ = synth.add(child as never, { preset: registration, ...(preload ? { preload: preload === 'false' ? false : preload } : {}) } as never);
  const t1 = performance.now();
  await (organ as unknown as { ready?: Promise<unknown> }).ready;
  const t2 = performance.now();
  synth.render(0.1);
  const rss = process.memoryUsage().rss;
  const decodedMb = synth._modelBytes() / 1048576;
  console.log(
    JSON.stringify({ organ: child, stops: def.stops.length, addMs: t1 - t0, readyMs: t2 - t0, rssMb: (rss - rss0) / 1048576, decodedMb }),
  );
  synth.close();
} else {
  const organs = args.length ? args : ['friesach', 'cracow', 'burea'];
  console.log('organ'.padEnd(12) + 'preset    stops  add() blocks  all loaded   decoded   RSS growth');
  for (const o of organs) {
    for (const p of ['tutti', 'default']) {
      const r = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--child', o, '--preset', p, ...(preload ? ['--preload', preload] : [])], {
        encoding: 'utf8',
      });
      const line = r.stdout.trim().split('\n').pop() ?? '';
      if (r.status !== 0 || !line.startsWith('{')) {
        console.log(`${o}: failed\n${r.stderr}`);
        continue;
      }
      const x = JSON.parse(line) as { stops: number; addMs: number; readyMs: number; rssMb: number; decodedMb: number };
      console.log(
        o.padEnd(12) + p.padEnd(8) + String(x.stops).padStart(7) + `${x.addMs.toFixed(0).padStart(10)} ms` + `${x.readyMs.toFixed(0).padStart(9)} ms` +
          `${x.decodedMb.toFixed(0).padStart(7)} MB` + `${x.rssMb.toFixed(0).padStart(8)} MB`,
      );
    }
  }
}
