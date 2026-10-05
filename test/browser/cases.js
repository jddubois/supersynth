// Run in the page by scripts/test-browser.mjs: each case returns measurements, which the runner
// checks.
import { encodeWav, Synth } from 'supersynth';

const peak = (a) => {
  let p = 0;
  for (const x of a.left) p = Math.max(p, Math.abs(x));
  for (const x of a.right) p = Math.max(p, Math.abs(x));
  return p;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Add `id`, play a chord, render offline: how long it took. */
async function offline({ id, preset, threads, notes, seconds = 2 }) {
  const synth = await Synth.create({ threads });
  await synth.load(id);
  const it = synth.add(id, preset ? { preset } : {});
  const kb = it.great ?? it;
  kb.play(notes, { velocity: 90, duration: 1.5 });
  it.pedal?.play('C2', { velocity: 90, duration: 1.5 });
  const t = performance.now();
  const audio = synth.render(seconds);
  const ms = performance.now() - t;
  const r = { threads: synth.threads, realTime: ms / 1000 / seconds, peak: peak(audio), wavBytes: encodeWav(audio).length, error: synth.engineError };
  synth.close();
  return r;
}

/** Add `id`, start real-time output, play a chord for 2 s: how the engine kept up. */
async function live({ id, preset, threads, notes }) {
  const synth = await Synth.create({ threads });
  await synth.load(id);
  const it = synth.add(id, preset ? { preset } : {});
  await synth.start();
  const kb = it.great ?? it;
  const t0 = synth.currentTime;
  const w0 = performance.now();
  kb.play(notes, { velocity: 90, duration: 2 });
  await sleep(1000);
  const voices = synth.activeVoices;
  await sleep(1000);
  const r = {
    threads: synth.threads,
    running: synth.isRunning,
    voices,
    // engine seconds rendered per second: below 1, the audio thread could not keep up
    pace: (synth.currentTime - t0) / ((performance.now() - w0) / 1000),
    cpuLoad: synth.cpuLoad,
    error: synth.engineError,
  };
  synth.stop();
  r.stopped = !synth.isRunning;
  r.peakAfterStop = peak(synth.render(0.25)); // offline again, the chord still sounding
  synth.close();
  return r;
}

/** What a page without the headers gets. */
async function create() {
  try {
    await Synth.create();
    return { ok: true };
  } catch (e) {
    return { ok: false, message: String(e.message ?? e) };
  }
}

window.cases = { offline, live, create };
window.ready = true;
