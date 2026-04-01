/**
 * Play a MIDI file through supersynth (flute voice).
 * Run with: node --import tsx examples/midi-file.ts [path-to-midi-file]
 *
 * Default: plays examples/jsbwv532.mid (Bach BWV 532 — Prelude & Fugue in D major)
 *
 * See also: midi-piano.ts, midi-organ.ts
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Synth } from '../src/index.ts';
import { playMidiFile } from './util/midi-player.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const midiPath = process.argv[2] ?? path.resolve(__dirname, 'jsbwv532.mid');

const synth = new Synth({
  sampleRate: 48000,
  masterVolume: 0.5,
  voice: { oscillators: [{ waveform: 'flute' }] },
  reverb: { roomSize: 0.8, damping: 0.5, wet: 0.3, dry: 0.7, preDelayMs: 15 },
});
await synth.start();

await playMidiFile(midiPath, synth, {
  onInfo: ({ path: p, tracks, ticksPerBeat, durationSec, noteCount }) => {
    console.log(`Playing (flute): ${path.basename(p)}`);
    console.log(`Tracks: ${tracks}  |  Ticks/beat: ${ticksPerBeat}  |  Duration: ${durationSec.toFixed(1)}s`);
    console.log(`Scheduled ${noteCount} notes. Press Ctrl+C to stop.\n`);
  },
});

synth.stop();
console.log('Done.');
