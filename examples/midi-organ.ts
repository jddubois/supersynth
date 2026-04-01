/**
 * Play a MIDI file through the organ synth, matching the render-offline sound exactly.
 * Uses separate manual and pedalboard synth instances with cathedral acoustics.
 * Run with: node --import tsx examples/midi-organ.ts [path-to-midi-file]
 *
 * Default: plays examples/jsbwv532.mid (Bach BWV 532 — Prelude & Fugue in D major)
 */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMidi } from 'midi-file';
import { Organ } from '../src/index.ts';
import { playMidiFile } from './util/midi-player.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function namedArg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

// MIDI file: first positional arg that doesn't start with '--', or default
const positional = process.argv.slice(2).find(a => !a.startsWith('--'));
const midiPath = positional ?? namedArg('midi') ?? path.resolve(__dirname, 'jsbwv532.mid');
const manualPreset = namedArg('preset') ?? 'principal';
const pedalPresetArg = namedArg('pedal-preset') ?? 'pedalboard_default';

const PEDAL_NOTE_THRESHOLD = 52;  // E3 — same as render-offline default
const MANUAL_BASS_THRESHOLD = 64; // E4 — same as render-offline default

// Pre-classify tracks by median note into three roles (matching render-offline)
const midi = parseMidi(readFileSync(midiPath));
const trackMedianNotes: number[] = midi.tracks.map(track => {
  const notes: number[] = [];
  for (const ev of track as { type: string; noteNumber?: number; velocity?: number }[]) {
    if (ev.type === 'noteOn' && (ev.velocity ?? 0) > 0 && ev.noteNumber != null) {
      notes.push(ev.noteNumber);
    }
  }
  if (notes.length === 0) return 64;
  notes.sort((a, b) => a - b);
  return notes[Math.floor(notes.length / 2)]!;
});

type TrackRole = 'manual' | 'bass' | 'pedal';
const trackRoles: TrackRole[] = trackMedianNotes.map(median => {
  if (median < PEDAL_NOTE_THRESHOLD) return 'pedal';
  if (median < MANUAL_BASS_THRESHOLD) return 'bass';
  return 'manual';
});

const needsPedal = trackRoles.some(r => r === 'pedal');
const needsBass  = trackRoles.some(r => r === 'bass');
const effectivePedalPreset = needsPedal ? pedalPresetArg : manualPreset;

// Cathedral acoustics matching render-offline exactly
const synthConfig = {
  sampleRate: 48000,
  masterVolume: 0.5,
  // Cathedral acoustics: RT60 ~2.5s, medium damping, pre-delay for space.
  // roomSize reduced from 0.93 to avoid Freeverb comb resonance in sub-bass
  // (comb filter delay ~32ms at 48kHz → resonance at ~31 Hz with high feedback).
  reverb: { roomSize: 0.93, damping: 0.22, wet: 0.48, dry: 0.62, preDelayMs: 38 },
  // Subtle pipe speech click — present but not dominating
  keyClickIntensity: 0.12,
};

const organ = new Organ(synthConfig);
organ.activatePreset(manualPreset);

// Bass manual at full volume, same preset as manual
const bassOrgan = new Organ(synthConfig);
bassOrgan.activatePreset(manualPreset);

// Pedal at 0.20 gain relative to manual, matching render-offline mix ratio
const pedalOrgan = new Organ({ ...synthConfig, masterVolume: synthConfig.masterVolume * 0.20 });
pedalOrgan.activatePreset(effectivePedalPreset);

await organ.start();
await bassOrgan.start();
await pedalOrgan.start();

await playMidiFile(midiPath, organ, {
  synthForTrack: (trackIndex) => {
    const role = trackRoles[trackIndex];
    if (role === 'pedal') return pedalOrgan;
    if (role === 'bass')  return bassOrgan;
    return organ;
  },
  onInfo: ({ path: p, tracks, ticksPerBeat, durationSec, noteCount }) => {
    console.log(`Playing (organ): ${path.basename(p)}`);
    console.log(`Tracks: ${tracks}  |  Ticks/beat: ${ticksPerBeat}  |  Duration: ${durationSec.toFixed(1)}s`);
    console.log(`Manual preset: ${manualPreset}`);
    const bassCount  = trackRoles.filter(r => r === 'bass').length;
    const pedalCount = trackRoles.filter(r => r === 'pedal').length;
    if (needsBass)  console.log(`Bass manual tracks: ${bassCount} (preset: ${manualPreset}, gain: 1.00)`);
    if (needsPedal) console.log(`Pedal tracks: ${pedalCount} (preset: ${effectivePedalPreset}, gain: 0.20)`);
    console.log(`Scheduled ${noteCount} notes. Press Ctrl+C to stop.\n`);
  },
});

organ.stop();
bassOrgan.stop();
pedalOrgan.stop();
console.log('Done.');
