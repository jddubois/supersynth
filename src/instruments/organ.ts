import type {
  InstrumentConfig,
  NativeOscillatorTemplate,
  OrganBreakPoint,
  OrganConfig,
  OrganStop,
} from '../types.js';
import { isBreakingStop } from '../types.js';
import { Synth, kOrgan } from '../Synth.js';

const organConfig: OrganConfig = {
  stops: {
    // ── Principal (Diapason) ranks — use new 'principal' waveform ─────────────
    // principal waveform has all harmonics (odd + even) with ~1/n² rolloff,
    // accurately modelling historic German baroque Prinzipal flue pipes.
    // amplitudeRatios calibrated so 8' is loudest, 4' adds presence, 2' sparkle.
    "16' Subbass":      { waveform: 'principal', frequencyRatio: 0.5, amplitudeRatio: 0.70 },
    "8' Principal":     { waveform: 'principal', frequencyRatio: 1.0, amplitudeRatio: 1.00,
                          chiffIntensity: 0.42, chiffDuration: 0.035, attackTime: 0.020, releaseTime: 0.08 },
    "4' Octave":        { waveform: 'principal', frequencyRatio: 2.0, amplitudeRatio: 0.65,
                          chiffIntensity: 0.12, chiffDuration: 0.04, attackTime: 0.012, releaseTime: 0.07 },
    "2' Super Octave":  { waveform: 'principal', frequencyRatio: 4.0, amplitudeRatio: 0.18,
                          chiffIntensity: 0.10, chiffDuration: 0.03, attackTime: 0.010, releaseTime: 0.06 },
    "2 2/3' Fifth":     { waveform: 'principal', frequencyRatio: 3.0, amplitudeRatio: 0.42 },
    "1 3/5' Tierce":    { waveform: 'principal', frequencyRatio: 5.0, amplitudeRatio: 0.28 },
    "1 1/3' Larigot":   { waveform: 'principal', frequencyRatio: 6.0, amplitudeRatio: 0.22 },

    // ── Flute ranks ───────────────────────────────────────────────────────────
    "16' Flute":        { waveform: 'flute', frequencyRatio: 0.5, amplitudeRatio: 0.75,
                          chiffIntensity: 0.12, chiffDuration: 0.06, attackTime: 0.08, releaseTime: 0.15 },
    "8' Flute":         { waveform: 'flute', frequencyRatio: 1.0, amplitudeRatio: 1.10,
                          chiffIntensity: 0.10, chiffDuration: 0.055, attackTime: 0.06, releaseTime: 0.12 },
    "4' Flute":         { waveform: 'flute', frequencyRatio: 2.0, amplitudeRatio: 0.80,
                          chiffIntensity: 0.08, chiffDuration: 0.04, attackTime: 0.05, releaseTime: 0.10 },

    // ── Reed ranks ────────────────────────────────────────────────────────────
    "16' Trumpet":      { waveform: 'trumpet', frequencyRatio: 0.5, amplitudeRatio: 0.32,
                          chiffIntensity: 0.28, chiffDuration: 0.03, attackTime: 0.012, releaseTime: 0.15 },
    "8' Trumpet":       { waveform: 'trumpet', frequencyRatio: 1.0, amplitudeRatio: 0.52,
                          chiffIntensity: 0.20, chiffDuration: 0.025, attackTime: 0.012, releaseTime: 0.12 },
    "4' Trumpet":       { waveform: 'trumpet', frequencyRatio: 2.0, amplitudeRatio: 0.68,
                          chiffIntensity: 0.15, chiffDuration: 0.02, attackTime: 0.010, releaseTime: 0.10 },

    // ── Mixture ranks (breaking stops) — use principal waveform ──────────────
    // Break points chosen to keep mixture frequencies in a useful range (avoid
    // both extremely low and aliasing-prone extremely high pitches).
    "Mixture III Rank 1": { waveform: 'principal', amplitudeRatio: 0.55, breaks: [
      { note:  0, frequencyRatio: 6.0 },
      { note: 48, frequencyRatio: 4.0 },
      { note: 60, frequencyRatio: 3.0 },
      { note: 72, frequencyRatio: 2.0 },
    ]},
    "Mixture III Rank 2": { waveform: 'principal', amplitudeRatio: 0.50, breaks: [
      { note:  0, frequencyRatio:  8.0 },
      { note: 48, frequencyRatio:  6.0 },
      { note: 60, frequencyRatio:  4.0 },
      { note: 72, frequencyRatio:  3.0 },
    ]},
    "Mixture III Rank 3": { waveform: 'principal', amplitudeRatio: 0.45, breaks: [
      { note:  0, frequencyRatio: 12.0 },
      { note: 48, frequencyRatio:  8.0 },
      { note: 60, frequencyRatio:  6.0 },
      { note: 72, frequencyRatio:  4.0 },
    ]},

    "Fourniture IV Rank 1": { waveform: 'principal', amplitudeRatio: 0.22, breaks: [
      { note:  0, frequencyRatio: 4.0 },
      { note: 48, frequencyRatio: 3.0 },
      { note: 60, frequencyRatio: 2.0 },
      { note: 72, frequencyRatio: 1.0 },
    ]},
    "Fourniture IV Rank 2": { waveform: 'principal', amplitudeRatio: 0.20, breaks: [
      { note:  0, frequencyRatio: 6.0 },
      { note: 48, frequencyRatio: 4.0 },
      { note: 60, frequencyRatio: 3.0 },
      { note: 72, frequencyRatio: 2.0 },
    ]},
    "Fourniture IV Rank 3": { waveform: 'principal', amplitudeRatio: 0.18, breaks: [
      { note:  0, frequencyRatio:  8.0 },
      { note: 48, frequencyRatio:  6.0 },
      { note: 60, frequencyRatio:  4.0 },
      { note: 72, frequencyRatio:  3.0 },
    ]},
    "Fourniture IV Rank 4": { waveform: 'principal', amplitudeRatio: 0.15, breaks: [
      { note:  0, frequencyRatio: 12.0 },
      { note: 48, frequencyRatio:  8.0 },
      { note: 60, frequencyRatio:  6.0 },
      { note: 72, frequencyRatio:  4.0 },
    ]},

    "Cymbale III Rank 1": { waveform: 'principal', amplitudeRatio: 0.32, breaks: [
      { note:  0, frequencyRatio: 8.0 },
      { note: 36, frequencyRatio: 6.0 },
      { note: 48, frequencyRatio: 4.0 },
      { note: 60, frequencyRatio: 3.0 },
      { note: 72, frequencyRatio: 2.0 },
    ]},
    "Cymbale III Rank 2": { waveform: 'principal', amplitudeRatio: 0.30, breaks: [
      { note:  0, frequencyRatio: 12.0 },
      { note: 36, frequencyRatio:  8.0 },
      { note: 48, frequencyRatio:  6.0 },
      { note: 60, frequencyRatio:  4.0 },
      { note: 72, frequencyRatio:  3.0 },
    ]},
    "Cymbale III Rank 3": { waveform: 'principal', amplitudeRatio: 0.28, breaks: [
      { note:  0, frequencyRatio: 16.0 },
      { note: 36, frequencyRatio: 12.0 },
      { note: 48, frequencyRatio:  8.0 },
      { note: 60, frequencyRatio:  6.0 },
      { note: 72, frequencyRatio:  4.0 },
    ]},
  },

  presets: {
    principal: {
      displayName: `Principal 8' + flute 4' + sine mixture`,
      stops: [
        "8' Principal",
        // Flute 4': minimal presence stop — contributes at 2×f without adding strong
        // harmonics. Amplitude 0.12 keeps its 800 Hz contribution (880 Hz for A4)
        // below the level that would over-drive the 1008 Hz reverb EQ.
        { waveform: 'flute', frequencyRatio: 2.0, amplitudeRatio: 0.05,
          chiffIntensity: 0.05, chiffDuration: 0.02, attackTime: 0.015, releaseTime: 0.10 },
        // Sine mixture: fills 1008 Hz via reverb EQ boost. Break points keep the sine
        // partial near 1008 Hz for the main playing range (notes 60-72, C5-C6).
        { waveform: 'sine', amplitudeRatio: 0.09, breaks: [
          { note:  0, frequencyRatio: 14.0 },
          { note: 44, frequencyRatio:  9.0 },  // A2(110Hz): 9×110=990Hz  — in 1008Hz EQ zone
          { note: 47, frequencyRatio:  8.0 },  // B2(124Hz): 8×124=992Hz  — in 1008Hz EQ zone
          { note: 48, frequencyRatio:  7.0 },
          { note: 56, frequencyRatio:  5.0 },
          { note: 60, frequencyRatio:  4.0 },
          { note: 64, frequencyRatio:  3.0 },
          { note: 67, frequencyRatio:  3.0 },
        ]},
      ],
    },
    cornet: {
      displayName: 'Cornet',
      stops: ["8' Principal", "4' Octave", "2 2/3' Fifth", "1 3/5' Tierce"],
    },
    mixture: {
      displayName: 'Mixture',
      stops: ["8' Principal", "4' Octave", "Mixture III Rank 1", "Mixture III Rank 2", "Mixture III Rank 3"],
    },
    flute: {
      displayName: `Flute 8' + 4'`,
      stops: ["8' Flute", "4' Flute"],
    },
    trumpet: {
      displayName: `Trumpet 8'`,
      stops: ["8' Trumpet"],
    },
    grand_jeu: {
      displayName: 'Grand Jeu',
      stops: [
        "8' Principal", "4' Octave",
        "8' Trumpet", "4' Trumpet",
      ],
    },
    plein_jeu: {
      displayName: 'Plein Jeu',
      stops: [
        "8' Principal", "4' Octave", "2' Super Octave",
        "Fourniture IV Rank 1", "Fourniture IV Rank 2", "Fourniture IV Rank 3", "Fourniture IV Rank 4",
      ],
    },
    pedalboard_default: {
      displayName: 'Pedalboard Principal',
      stops: [
        // 16' Subbass — provides the characteristic depth and growl of a Baroque pedal.
        // Lower amplitude (0.35) so it supports rather than dominates the 8'.
        { waveform: 'principal', frequencyRatio: 0.5, amplitudeRatio: 0.40,
          chiffIntensity: 0.06, chiffDuration: 0.08, attackTime: 0.040, releaseTime: 0.12 },
        // 8' Principal — clarity and definition for the pedal line.
        { waveform: 'principal', frequencyRatio: 1.0, amplitudeRatio: 0.55,
          chiffIntensity: 0.10, chiffDuration: 0.06, attackTime: 0.025, releaseTime: 0.10 },
      ],
    },
    pedalboard_reed: {
      displayName: 'Pedalboard Reed',
      stops: [
        { waveform: 'principal', frequencyRatio: 0.5, amplitudeRatio: 5.25 },
        { waveform: 'principal', frequencyRatio: 1.0, amplitudeRatio: 4.00 },
        { waveform: 'trumpet',   frequencyRatio: 1.0, amplitudeRatio: 1.20 },
      ],
    },
    pedalboard_flute: {
      displayName: 'Pedalboard Flute',
      stops: [
        { waveform: 'flute', frequencyRatio: 0.5, amplitudeRatio: 0.90 },
        { waveform: 'flute', frequencyRatio: 1.0, amplitudeRatio: 1.10 },
      ],
    },
    pedalboard_trumpet: {
      displayName: 'Pedalboard Trumpet',
      stops: ["16' Trumpet", "8' Trumpet"],
    },
  },
};

/**
 * Baroque pipe organ with stop/preset management.
 *
 * Creates and owns its audio engine internally — no `Synth` required.
 * Stops are registered oscillator templates; presets are named collections.
 * Multiple presets can be active simultaneously; shared stops are reference-counted.
 *
 * @example
 * ```ts
 * import { Organ } from 'supersynth';
 *
 * const organ = new Organ({ reverb: { roomSize: 0.87, wet: 0.42, dry: 0.62 }, keyClickIntensity: 0.12 });
 * await organ.start();
 *
 * organ.activatePreset('principal');
 * organ.noteOn(60, 100).noteOn(64, 100).noteOn(67, 100);
 *
 * // Change preset while notes are held — live timbre change:
 * organ.deactivatePreset('principal').activatePreset('mixture');
 * ```
 */
export class Organ {
  private readonly synth: Synth;
  private readonly organConfig: OrganConfig;

  private activeOscillatorIds = new Map<string, number>();
  private stopRefCounts = new Map<string, number>();
  private activePresetStops = new Map<string, Array<string | OrganStop>>();

  constructor(config: InstrumentConfig = {}) {
    this.synth = new Synth(config);
    this.organConfig = organConfig;
  }

  // ── Audio engine delegation ────────────────────────────────────────────────

  /** Start the audio output stream. Must be called before notes will be heard through speakers. */
  async start(): Promise<void> { return this.synth.start(); }

  /** Stop the audio output stream. Safe to call even if start() was never called. */
  stop(): void { this.synth.stop(); }

  /** Trigger a note-on event. Returns `this` for chaining. */
  noteOn(note: number, velocity = 100): this { this.synth.noteOn(note, velocity); return this; }

  /** Trigger a note-off event — begin the release phase. Returns `this` for chaining. */
  noteOff(note: number): this { this.synth.noteOff(note); return this; }

  /** Render audio to a Float32Array without opening an audio device. */
  render(numSamples: number): Float32Array { return this.synth.render(numSamples); }

  /** Feed raw MIDI bytes directly into the engine. Returns `this` for chaining. */
  sendMidiBytes(bytes: Buffer): this { this.synth.sendMidiBytes(bytes); return this; }

  /** Connect to a MIDI input device and start receiving events. */
  async enableMidi(deviceName?: string): Promise<this> { await this.synth.enableMidi(deviceName); return this; }

  /** List available MIDI input devices. */
  listMidiDevices(): string[] { return this.synth.listMidiDevices(); }

  /** List available audio backends on this platform. */
  listAudioBackends(): string[] { return this.synth.listAudioBackends(); }

  /** Set the master output volume (0.0–1.0). */
  setMasterVolume(volume: number): this { this.synth.setMasterVolume(volume); return this; }

  /** Number of notes currently active, including those in their release phase. */
  get activeNoteCount(): number { return this.synth.activeNoteCount; }

  // ── Organ control ──────────────────────────────────────────────────────────

  get config(): OrganConfig { return this.organConfig; }

  get activeStops(): string[] { return Array.from(this.activeOscillatorIds.keys()); }

  /**
   * Activate a stop by name (looked up in the config) or by passing an inline `OrganStop`.
   * Reference-counted: calling this twice for the same stop name adds only one oscillator.
   */
  activateStop(nameOrStop: string | OrganStop): this {
    const { key, stop } = this.resolveStop(nameOrStop);
    const refCount = (this.stopRefCounts.get(key) ?? 0) + 1;
    this.stopRefCounts.set(key, refCount);
    if (refCount === 1) {
      const id = this.synth[kOrgan].addOscillator(organStopToNativeTemplate(stop));
      this.activeOscillatorIds.set(key, id);
    }
    return this;
  }

  /**
   * Deactivate a stop by name or inline definition.
   * The oscillator is only removed from the engine when the refcount reaches 0.
   */
  deactivateStop(nameOrStop: string | OrganStop): this {
    const { key } = this.resolveStop(nameOrStop);
    const refCount = (this.stopRefCounts.get(key) ?? 1) - 1;
    if (refCount <= 0) {
      this.stopRefCounts.delete(key);
      const id = this.activeOscillatorIds.get(key);
      if (id !== undefined) {
        this.synth[kOrgan].removeOscillator(id);
        this.activeOscillatorIds.delete(key);
      }
    } else {
      this.stopRefCounts.set(key, refCount);
    }
    return this;
  }

  /**
   * Activate a named preset. Each stop in the preset is activated (reference-counted).
   * Multiple presets can be active simultaneously.
   */
  activatePreset(presetName: string): this {
    const preset = this.organConfig.presets[presetName];
    if (!preset) throw new Error(`Unknown organ preset: "${presetName}"`);
    const entries: Array<string | OrganStop> = [];
    for (const entry of preset.stops) {
      entries.push(entry);
      this.activateStop(entry);
    }
    this.activePresetStops.set(presetName, entries);
    return this;
  }

  /**
   * Deactivate a named preset. Reference counts are decremented; stops shared with
   * other active presets remain active.
   */
  deactivatePreset(presetName: string): this {
    if (!this.organConfig.presets[presetName]) return this;
    const entries = this.activePresetStops.get(presetName) ?? [];
    for (const entry of entries) {
      this.deactivateStop(entry);
    }
    this.activePresetStops.delete(presetName);
    return this;
  }

  /**
   * Adjust a drawbar level in real time (0–8), without retriggering any notes.
   *
   * Level 0 = silent, level 8 = full amplitude. The amplitude is scaled linearly
   * as `level / 8`. Only effective while the stop is active.
   *
   * @param stopName - The stop name as registered in the organ config.
   * @param level    - Drawbar position from 0 (off) to 8 (full).
   */
  setDrawbarLevel(stopName: string, level: number): this {
    if (level < 0 || level > 8) throw new RangeError('Drawbar level must be 0–8');
    const id = this.activeOscillatorIds.get(stopName);
    if (id !== undefined) {
      this.synth[kOrgan].updateOscillatorAmplitude(id, level / 8);
    }
    return this;
  }

  /**
   * Set the organ key-click intensity and duration.
   *
   * @param intensity - 0.0 = off, 0.5 = typical organ key-click.
   * @param duration  - Transient duration in seconds. @default 0.003
   */
  setKeyClick(intensity: number, duration?: number): this {
    this.synth.setKeyClick(intensity, duration);
    return this;
  }

  reset(): this {
    for (const presetName of Array.from(this.activePresetStops.keys())) {
      this.deactivatePreset(presetName);
    }
    for (const [key, id] of Array.from(this.activeOscillatorIds.entries())) {
      this.synth[kOrgan].removeOscillator(id);
      this.activeOscillatorIds.delete(key);
      this.stopRefCounts.delete(key);
    }
    return this;
  }

  private resolveStop(nameOrStop: string | OrganStop): { key: string; stop: OrganStop } {
    if (typeof nameOrStop === 'string') {
      const stop = this.organConfig.stops[nameOrStop];
      if (!stop) throw new Error(`Unknown organ stop: "${nameOrStop}"`);
      return { key: nameOrStop, stop };
    }
    // Inline stop: use JSON as the canonical key
    const key = JSON.stringify(nameOrStop);
    return { key, stop: nameOrStop };
  }
}

function organStopToNativeTemplate(stop: OrganStop): NativeOscillatorTemplate {
  if (isBreakingStop(stop)) {
    return {
      waveform: stop.waveform ?? 'triangle',
      harmonicRatio: 1.0,
      amplitude: stop.amplitudeRatio ?? 1.0,
      attackTime: stop.attackTime ?? 0.03,
      decayTime: 0.0,
      sustainLevel: 1.0,
      releaseTime: stop.releaseTime ?? 0.1,
      chiffIntensity: stop.chiffIntensity ?? 0.0,
      chiffDuration: stop.chiffDuration ?? 0.04,
      breaks: stop.breaks.map((b: OrganBreakPoint) => ({
        note: b.note,
        frequencyRatio: b.frequencyRatio,
      })),
    };
  }
  return {
    waveform: stop.waveform ?? 'triangle',
    harmonicRatio: stop.frequencyRatio,
    amplitude: stop.amplitudeRatio ?? 1.0,
    attackTime: stop.attackTime ?? 0.03,
    decayTime: 0.0,
    sustainLevel: 1.0,
    releaseTime: stop.releaseTime ?? 0.1,
    chiffIntensity: stop.chiffIntensity ?? 0.0,
    chiffDuration: stop.chiffDuration ?? 0.04,
    breaks: [],
  };
}
