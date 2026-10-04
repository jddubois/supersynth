// The Bureå hymn (Old Hundredth, four parts with pedal) through the public organ API, for one
// preset. Writes the engine's rendering and the list of sounding pipes (stop folder,
// key, start, duration) that organ_hymn.py plays back from the real recordings.
// usage: node --import tsx tools/ssm/organ_hymn.ts <preset> <out.wav> <events.json> [--dry]
//   --dry: no added reverb (the pipes carry the church's own acoustic, like the recordings)
//   SSM_OUT_DIR: models directory (default: the package's)
import { writeFileSync } from 'node:fs';
import { Synth, noteNumber } from '../../src/index.ts';
import { OLD_HUNDREDTH } from '../../examples/util/music.ts';

const [reg, out, eventsPath] = process.argv.slice(2) as [string, string, string];
const dry = process.argv.includes('--dry');
const synth = new Synth({ sampleRate: 44100, modelsDir: process.env.SSM_OUT_DIR || undefined, ...(dry ? { reverb: false } : {}) });
const organ = synth.addOrgan('burea', { preset: reg });
const bpm = reg === 'full' ? 76 : 88;
const beat = 60 / bpm;
const events: { stop: string; key: number; at: number; dur: number }[] = [];

function sounding(division: 'great' | 'pedal'): string[] {
  const d = organ.division(division);
  const ids: string[] = [];
  for (const dd of [d, ...d.coupled().map((n) => organ.division(n))]) {
    for (const name of dd.drawn()) ids.push(dd.stops().find((s) => s.name === name)!.id);
  }
  return ids;
}

let t = 0.3;
for (const [s, a, tn, b, beats] of OLD_HUNDREDTH) {
  const d = beats * beat * 0.97;
  organ.great.play([s, a, tn], { at: t, duration: d });
  organ.pedal.play(b, { at: t, duration: d });
  // a pipe reached from two keyboards at once sounds once
  const pipes = new Set<string>();
  const add = (stop: string, key: number) => {
    if (!pipes.has(`${stop}/${key}`)) events.push({ stop, key, at: t, dur: d });
    pipes.add(`${stop}/${key}`);
  };
  for (const n of [s, a, tn]) for (const stop of sounding('great')) add(stop, noteNumber(n));
  for (const stop of sounding('pedal')) add(stop, noteNumber(b));
  t += beats * beat;
}
synth.renderToFile(out, t + 3, { bitDepth: 32 });
writeFileSync(eventsPath, JSON.stringify({ preset: reg, seconds: t + 3, events }));
