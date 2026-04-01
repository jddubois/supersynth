/**
 * Offline MIDI renderer — renders a MIDI file through the organ synth without
 * opening any audio device or using setTimeout. Processes MIDI events at
 * sample-accurate positions between synth.render() chunk calls.
 *
 * Uses three separate Synth+Organ instances:
 *   - manual: soprano/alto tracks (median note >= manualBassThreshold)
 *   - bass:   left-hand bass tracks (median between pedalNoteThreshold and manualBassThreshold)
 *   - pedal:  pedalboard tracks (median note < pedalNoteThreshold)
 *
 * The three renders are mixed at the end, with pedal attenuated by pedalGain.
 */
import { readFileSync } from 'node:fs';
import { parseMidi } from 'midi-file';
import { Organ } from '../src/index.ts';
import type { SynthConfig } from '../src/types.ts';

export interface RenderOpts {
  midiPath: string;
  synthConfig?: Partial<SynthConfig>;
  presetName?: string;
  /** Override preset for tracks detected as pedalboard. Default: 'pedalboard_default'. */
  pedalPreset?: string;
  /**
   * MIDI note threshold below which a track is classified as "pedalboard".
   * Tracks whose median note is below this value use `pedalPreset`.
   * Default: 52 (E3).
   */
  pedalNoteThreshold?: number;
  /**
   * Preset for left-hand bass manual tracks (median between pedalNoteThreshold
   * and manualBassThreshold). If omitted, these tracks use `presetName`.
   */
  manualBassPreset?: string;
  /**
   * Median note threshold below which a manual track is classified as "bass manual"
   * and uses `manualBassPreset`. Default: 64 (E4) — captures tenor/bass voices.
   */
  manualBassThreshold?: number;
  sampleRate?: number;
  /** Extra tail to render after last note for reverb decay (seconds). Default 5. */
  tailSec?: number;
  /**
   * Multiply all MIDI tempos by this factor (>1 = faster playback, shorter render).
   * Use to match the render duration to a reference recording so spectral analysis
   * windows compare equivalent musical passages. Default: 1.0 (no scaling).
   */
  tempoScale?: number;
  /** Shift all MIDI note numbers by this many semitones (positive = up). Default: 0. */
  noteOffset?: number;
}

const enum TrackRole { Manual, Bass, Pedal }

interface TimedEvent {
  samplePos: number;
  type: 'noteOn' | 'noteOff';
  note: number;
  velocity: number;
  role: TrackRole;
}

/**
 * Compute the natural duration of a MIDI file in seconds (no tempo scaling).
 * Useful for determining the tempoScale needed to match a reference recording.
 */
export function getMidiDurationSec(midiPath: string): number {
  const midi = parseMidi(readFileSync(midiPath));
  const ticksPerBeat = midi.header.ticksPerBeat ?? 480;

  // Find all tempo events and the last tick across all tracks
  interface TempoEvt { absoluteTick: number; microsecondsPerBeat: number }
  const tempoEvents: TempoEvt[] = [];
  let lastTick = 0;

  for (const track of midi.tracks) {
    let abs = 0;
    for (const ev of track as { type: string; deltaTime: number; microsecondsPerBeat?: number }[]) {
      abs += ev.deltaTime;
      if (ev.type === 'setTempo' && ev.microsecondsPerBeat != null) {
        tempoEvents.push({ absoluteTick: abs, microsecondsPerBeat: ev.microsecondsPerBeat });
      }
      if (abs > lastTick) lastTick = abs;
    }
  }
  tempoEvents.sort((a, b) => a.absoluteTick - b.absoluteTick);

  // Build tempo map and convert lastTick to seconds
  interface TPoint { tick: number; ms: number; tempo: number }
  const map: TPoint[] = [{ tick: 0, ms: 0, tempo: 500000 }];
  for (const e of tempoEvents) {
    const last = map.at(-1)!;
    const ms = last.ms + (e.absoluteTick - last.tick) * (last.tempo / ticksPerBeat / 1000);
    map.push({ tick: e.absoluteTick, ms, tempo: e.microsecondsPerBeat });
  }

  let tc = map[0]!;
  for (const t of map) { if (t.tick <= lastTick) tc = t; else break; }
  const totalMs = tc.ms + (lastTick - tc.tick) * (tc.tempo / ticksPerBeat / 1000);
  return totalMs / 1000;
}

export function renderMidiOffline(opts: RenderOpts): Float32Array {
  const {
    midiPath,
    presetName = 'principal',
    pedalPreset = 'pedalboard_default',
    pedalNoteThreshold = 52,
    manualBassPreset,
    manualBassThreshold = 64,
    sampleRate = 48000,
    tailSec = 5,
  } = opts;

  const synthConfig: SynthConfig = {
    sampleRate,
    masterVolume: 0.5,
    // Cathedral acoustics: RT60 ~2.5s, medium damping, pre-delay for space.
    // roomSize reduced from 0.93 to avoid Freeverb comb resonance in sub-bass
    // (comb filter delay ~32ms at 48kHz → resonance at ~31 Hz with high feedback).
    reverb: { roomSize: 0.87, damping: 0.28, wet: 0.42, dry: 0.62, preDelayMs: 30 },
    // Subtle pipe speech click — present but not dominating
    keyClickIntensity: 0.12,
    ...opts.synthConfig,
  };

  // Parse MIDI file first so we can classify tracks
  const midi = parseMidi(readFileSync(midiPath));
  const ticksPerBeat = midi.header.ticksPerBeat ?? 480;

  // Classify tracks by median note
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

  const trackRoles: TrackRole[] = trackMedianNotes.map(median => {
    if (median < pedalNoteThreshold) return TrackRole.Pedal;
    if (manualBassPreset && median < manualBassThreshold) return TrackRole.Bass;
    return TrackRole.Manual;
  });

  // Determine which presets are actually needed
  const needsPedal = trackRoles.some(r => r === TrackRole.Pedal);
  const needsBass  = manualBassPreset != null && trackRoles.some(r => r === TrackRole.Bass);

  const effectivePedalPreset = needsPedal ? pedalPreset : presetName;
  const effectiveBassPreset  = needsBass && manualBassPreset ? manualBassPreset : presetName;

  // Create organ instances (each owns its audio engine)
  const manualOrgan = new Organ(synthConfig);
  manualOrgan.activatePreset(presetName);

  const bassOrgan = new Organ(synthConfig);
  bassOrgan.activatePreset(effectiveBassPreset);

  const pedalOrgan = new Organ(synthConfig);
  pedalOrgan.activatePreset(effectivePedalPreset);

  // Build raw event list with absolute ticks
  interface RawEvent {
    type: string;
    absoluteTick: number;
    deltaTime: number;
    noteNumber?: number;
    velocity?: number;
    microsecondsPerBeat?: number;
    trackIndex: number;
  }
  const rawEvents: RawEvent[] = [];

  for (let ti = 0; ti < midi.tracks.length; ti++) {
    const track = midi.tracks[ti]!;
    let abs = 0;
    for (const ev of track as RawEvent[]) {
      abs += ev.deltaTime;
      rawEvents.push({ ...ev, absoluteTick: abs, trackIndex: ti });
    }
  }
  rawEvents.sort((a, b) => a.absoluteTick - b.absoluteTick || (a.type === 'setTempo' ? -1 : 0));

  // Build tempo map (tick → ms), optionally scaled to match a target duration.
  // Dividing microsecondsPerBeat by tempoScale speeds up playback proportionally.
  const scale = opts.tempoScale ?? 1.0;
  interface TempoPoint { tick: number; ms: number; tempo: number }
  const tempoMap: TempoPoint[] = [{ tick: 0, ms: 0, tempo: 500000 / scale }];
  for (const e of rawEvents) {
    if (e.type === 'setTempo' && e.microsecondsPerBeat != null) {
      const last = tempoMap.at(-1)!;
      const ms = last.ms + (e.absoluteTick - last.tick) * (last.tempo / ticksPerBeat / 1000);
      tempoMap.push({ tick: e.absoluteTick, ms, tempo: e.microsecondsPerBeat / scale });
    }
  }

  function tickToMs(tick: number): number {
    let tc = tempoMap[0]!;
    for (const t of tempoMap) { if (t.tick <= tick) tc = t; else break; }
    return tc.ms + (tick - tc.tick) * (tc.tempo / ticksPerBeat / 1000);
  }

  // Build sample-accurate event list with role per track
  const events: TimedEvent[] = [];
  for (const e of rawEvents) {
    if (e.noteNumber == null) continue;
    const ms = tickToMs(e.absoluteTick);
    const samplePos = Math.floor((ms / 1000) * sampleRate);
    const role = trackRoles[e.trackIndex] ?? TrackRole.Manual;
    const noteShift = opts.noteOffset ?? 0;
    if (e.type === 'noteOn' && (e.velocity ?? 0) > 0) {
      events.push({ samplePos, type: 'noteOn', note: e.noteNumber + noteShift, velocity: e.velocity!, role });
    } else if (e.type === 'noteOff' || (e.type === 'noteOn' && e.velocity === 0)) {
      events.push({ samplePos, type: 'noteOff', note: e.noteNumber + noteShift, velocity: 0, role });
    }
  }
  events.sort((a, b) => a.samplePos - b.samplePos);

  // Pre-allocate output buffers based on known total length to avoid accumulating
  // thousands of chunk arrays (which caused peak memory ~430 MB and OOM kills).
  const tailSamples = Math.floor(tailSec * sampleRate);
  const totalLength = (events.at(-1)?.samplePos ?? 0) + tailSamples;
  const manualBuf = new Float32Array(totalLength);
  const bassBuf   = new Float32Array(totalLength);
  const pedalBuf  = new Float32Array(totalLength);

  // Render chunk-by-chunk — advance all organs together to keep reverb tails in sync.
  // Render results are written directly into pre-allocated buffers (no chunk arrays).
  let cursor = 0;

  for (const ev of events) {
    if (ev.samplePos > cursor) {
      const n = ev.samplePos - cursor;
      manualBuf.set(manualOrgan.render(n), cursor);
      bassBuf.set(bassOrgan.render(n), cursor);
      pedalBuf.set(pedalOrgan.render(n), cursor);
      cursor = ev.samplePos;
    }
    const targetOrgan = ev.role === TrackRole.Pedal ? pedalOrgan
                      : ev.role === TrackRole.Bass  ? bassOrgan
                      : manualOrgan;
    if (ev.type === 'noteOn') targetOrgan.noteOn(ev.note, ev.velocity);
    else targetOrgan.noteOff(ev.note);
  }

  // Render reverb tail directly into the end of the pre-allocated buffers
  manualBuf.set(manualOrgan.render(tailSamples), cursor);
  bassBuf.set(bassOrgan.render(tailSamples), cursor);
  pedalBuf.set(pedalOrgan.render(tailSamples), cursor);

  // Mix. Pedal provides bass foundation but shouldn't overpower manual voices.
  // Bass manual (left hand) plays at full volume — it's a manual voice, just
  // using a simpler preset without the sine mixture that would inflate high
  // frequencies from deep bass fundamentals.
  const pedalGain = needsPedal ? 0.20 : 1.0;
  const result = new Float32Array(totalLength);
  for (let i = 0; i < totalLength; i++) {
    result[i] = manualBuf[i]! + bassBuf[i]! + pedalBuf[i]! * pedalGain;
  }

  return result;
}
