/**
 * Render a demo of every instrument and every preset (and every organ preset)
 * to WAV files, so they can all be auditioned.
 *
 *   npm run demos -- [out-dir]        (default ./demos)
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { BUREA_ORGAN, INSTRUMENTS, Synth } from '../src/index.ts';
import {
  AMAZING_GRACE, BWV846, CANON_CHORDS, fitToRange, GREENSLEEVES, ODE_TO_JOY, OLD_HUNDREDTH, playSteps,
  WESTMINSTER, type Step,
} from './util/music.ts';

const outDir = process.argv[2] ?? 'demos';
const only = process.argv[3];

function material(id: string, family: string): { steps: Step[]; bpm: number; chords?: boolean } {
  if (family === 'keyboard' || id === 'harp') return { steps: BWV846, bpm: 104 };
  if (id === 'tubular-bells') return { steps: WESTMINSTER, bpm: 66 };
  if (family === 'percussion') return { steps: ODE_TO_JOY, bpm: 132 };
  if (id === 'strings' || id === 'brass' || family === 'organ') return { steps: [], bpm: 60, chords: true };
  if (id.includes('pizzicato')) return { steps: ODE_TO_JOY, bpm: 120 };
  if (['cellos', 'contrabass', 'bassoon', 'tuba', 'trombone', 'french-horn', 'tenor-sax'].includes(id)) {
    return { steps: AMAZING_GRACE, bpm: 72 };
  }
  return { steps: GREENSLEEVES, bpm: 84 };
}

let count = 0;
for (const def of INSTRUMENTS) {
  if (only && def.id !== only) continue;
  for (const preset of Object.keys(def.presets)) {
    const synth = new Synth({ sampleRate: 48000 });
    const part = synth.add(def.id, { preset });
    const m = material(def.id, def.family);
    let dur: number;
    if (m.chords) {
      let t = 0.2;
      for (const c of CANON_CHORDS.slice(0, 4)) {
        const fitted = c.map((n) => n).filter(Boolean);
        part.play(fitted, { at: t, duration: 1.9, velocity: 80 });
        t += 2;
      }
      dur = t;
    } else {
      dur = 0.2 + playSteps(part, fitToRange(m.steps, def.range), { at: 0.2, bpm: m.bpm, velocity: 88 });
    }
    const file = path.join(outDir, def.id, `${preset}.wav`);
    mkdirSync(path.dirname(file), { recursive: true });
    synth.renderToFile(file, dur + 2.5);
    synth.close();
    count++;
    console.log(file);
  }
}

if (!only || only === 'organ') {
  for (const reg of Object.keys(BUREA_ORGAN.presets)) {
    const synth = new Synth({ sampleRate: 48000 });
    const organ = synth.organ({ preset: reg });
    const beat = 60 / 84;
    let t = 0.3;
    for (const [s, a, tn, b, beats] of OLD_HUNDREDTH.slice(0, 8)) {
      organ.great.play([s, a, tn], { at: t, duration: beats * beat * 0.97 });
      organ.swell.play([s, a, tn], { at: t, duration: beats * beat * 0.97 });
      organ.positive.play([s, a, tn], { at: t, duration: beats * beat * 0.97 });
      organ.pedal.play(b, { at: t, duration: beats * beat * 0.97 });
      t += beats * beat;
    }
    const file = path.join(outDir, 'organ', `${reg}.wav`);
    mkdirSync(path.dirname(file), { recursive: true });
    synth.renderToFile(file, t + 3);
    synth.close();
    count++;
    console.log(file);
  }
}
console.log(`${count} demos rendered to ${outDir}`);
