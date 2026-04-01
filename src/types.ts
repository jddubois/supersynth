/**
 * The waveform shape used by an oscillator.
 *
 * - `sine` — Pure sine wave. Smooth and clean.
 * - `square` — Square wave with PolyBLEP anti-aliasing. Hollow, buzzy tone.
 * - `sawtooth` — Sawtooth wave with PolyBLEP anti-aliasing. Bright and rich in harmonics.
 * - `triangle` — Frequency-dependent sine/triangle blend. Warm organ principal tone.
 * - `trumpet` — 16-harmonic additive synthesis. Reed pipe / brass character.
 * - `flute` — 6-harmonic additive synthesis with Nyquist taper. Soft, breathy flute tone.
 * - `principal` — Organ Diapason/Prinzipal pipe. All harmonics with ~1/n² rolloff, both even and odd
 *   partials present. Models historic German baroque flue pipe character: round, full, with present
 *   2nd and 3rd harmonics and register-adaptive brightness.
 * - `plucked` — Karplus-Strong plucked string (acoustic guitar, harp). Half-sine noise burst over full delay buffer.
 * - `struck` — Karplus-Strong struck string (piano). Short hammer-strike burst, long sustain.
 * - `electric` — Karplus-Strong electric guitar. Bridge-position burst + tanh soft-clip in feedback.
 * - `pulse` — Variable duty-cycle pulse wave with PolyBLEP anti-aliasing. Default duty cycle 50% (= square).
 * - `noise` — White noise via XorShift32.
 */
export type WaveformKind = 'sine' | 'square' | 'sawtooth' | 'triangle' | 'trumpet' | 'flute' | 'principal' | 'plucked' | 'struck' | 'electric' | 'pulse' | 'noise';

/**
 * The audio backend used for output.
 *
 * - `auto` — Use the platform default (CoreAudio on macOS, WASAPI on Windows, ALSA on Linux).
 * - `jack` — JACK Audio Connection Kit (Linux). Requires a running JACK server.
 *   Use this to connect supersynth into a JACK graph alongside other pro-audio tools.
 * - Other values select a specific CPAL host when available on the platform.
 */
export type BackendKind =
  | 'auto'
  | 'coreaudio'
  | 'wasapi'
  | 'alsa'
  | 'jack'
  | 'pulseaudio'
  | 'pipewire';

/**
 * Template for a single oscillator within a {@link VoiceConfig}.
 * Frequency is expressed as a ratio relative to the MIDI note's fundamental.
 */
export interface OscillatorTemplate {
  /** Waveform shape. @default 'sine' */
  waveform?: WaveformKind;
  /** Frequency multiplier relative to the note fundamental. 1.0 = fundamental, 2.0 = one octave up. @default 1.0 */
  harmonicRatio?: number;
  /** Oscillator amplitude, multiplied by the velocity curve result. @default 1.0 */
  amplitude?: number;
  /** Static detune in cents. @default 0 */
  detuneCents?: number;
  /** Envelope attack time in seconds. @default 0.03 */
  attackTime?: number;
  /** Envelope decay time in seconds. 0 = no decay (skip to sustain). @default 0 */
  decayTime?: number;
  /** Envelope sustain level (0.0–1.0). Ignored if decayTime is 0. @default 1.0 */
  sustainLevel?: number;
  /** Envelope release time in seconds. @default 0.1 */
  releaseTime?: number;
  /** Chiff (breath) transient intensity at note start. 0 = none. @default 0 */
  chiffIntensity?: number;
  /** Duration of the chiff transient in seconds. @default 0.04 */
  chiffDuration?: number;
  /** Duty cycle for the `pulse` waveform (0.0–1.0). 0.5 = square wave. Ignored for other waveforms. @default 0.5 */
  pulseWidth?: number;
  /**
   * A-weighting (Fletcher-Munson equal loudness) correction strength (0.0–1.0).
   * Omit to use the waveform-dependent default:
   *   - `sine` / `triangle`: 1.0 — full correction, correct for organ pipe tones
   *   - `plucked` / `struck` / `electric`: 0.1 — gentle, avoids over-boosting harmonically rich strings
   *   - all others: 0.5
   */
  eqLoudnessStrength?: number;
}

/**
 * How MIDI velocity (0–127) is mapped to oscillator amplitude (0.0–1.0).
 *
 * - `linear` — amplitude = velocity / 127
 * - `exponential` — amplitude = (velocity / 127) ^ exponent. Exponent > 1 compresses soft dynamics.
 * - `fixed` — amplitude is always the given value, regardless of velocity (organ-style).
 */
export type VelocityCurve =
  | { type: 'linear' }
  | { type: 'exponential'; exponent: number }
  | { type: 'fixed'; amplitude: number };

/**
 * Instrument voice definition — controls how a MIDI note is synthesised.
 *
 * Specify `oscillators`, `velocityCurve`, and `headroom` to define a voice.
 * Import pre-built voices from `supersynth/presets` (e.g. `organVoice`, `pianoVoice`).
 *
 * @example Custom two-oscillator unison
 * ```ts
 * new Synth({
 *   voice: {
 *     oscillators: [
 *       { waveform: 'sawtooth', harmonicRatio: 1.0, detuneCents: -8 },
 *       { waveform: 'sawtooth', harmonicRatio: 1.0, detuneCents:  8 },
 *     ],
 *     velocityCurve: { type: 'linear' },
 *     headroom: 2.0,
 *   },
 * })
 * ```
 */
export interface VoiceConfig {
  /** Oscillator templates composing this voice. */
  oscillators?: OscillatorTemplate[];
  /** How velocity is mapped to amplitude. @default linear */
  velocityCurve?: VelocityCurve;
  /**
   * Static gain divisor applied to the summed note signal before master volume.
   * Set this to the approximate sum of oscillator amplitudes to keep per-note
   * output normalised (e.g. `headroom: 4.0` for 8 drawbars summing to ~3.5).
   * @default 1.0
   */
  headroom?: number;
}

/** Configuration passed to the {@link Synth} constructor. */
export interface SynthConfig {
  /**
   * Audio sample rate in Hz.
   * @default 48000
   */
  sampleRate?: number;

  /**
   * Audio output backend. Use `'jack'` to connect to a running JACK server on Linux.
   * @default 'auto'
   */
  backend?: BackendKind;

  /**
   * Instrument voice definition. Controls waveform, oscillator count, ADSR, and
   * velocity sensitivity. Import a preset (e.g. `organVoice`, `pianoVoice`) or
   * pass a custom {@link VoiceConfig}.
   */
  voice?: VoiceConfig;

  /**
   * Master output volume, applied after the effects chain.
   * @default 0.5
   */
  masterVolume?: number;

  /**
   * Enable the Freeverb reverb effect. Omit to disable reverb entirely.
   * Freeverb is a Schroeder-Moorer reverb — 8 parallel comb filters into 4 series all-pass filters.
   */
  reverb?: ReverbConfig;

  /**
   * Global organ-mode key-click intensity (0.0 = off, 0.5 = typical organ key-click).
   * Applied to all organ-mode oscillators at note-on.
   * @default 0
   */
  keyClickIntensity?: number;

  /**
   * Key-click transient duration in seconds.
   * @default 0.003
   */
  keyClickDuration?: number;
}

/**
 * Audio configuration for instrument constructors.
 * Equivalent to {@link SynthConfig} without the `voice` field, which is pre-configured by the instrument.
 */
export type InstrumentConfig = Omit<SynthConfig, 'voice'>;

/** Parameters for the Freeverb reverb effect. */
export interface ReverbConfig {
  /**
   * Controls the size of the simulated room. Higher values = longer reverb tail.
   * @default 0.85
   */
  roomSize?: number;

  /**
   * High-frequency damping in the reverb feedback path. Higher = duller tail.
   * @default 0.5
   */
  damping?: number;

  /**
   * Wet (reverb) signal level in the output mix.
   * @default 0.35
   */
  wet?: number;

  /**
   * Dry (direct) signal level in the output mix.
   * @default 0.65
   */
  dry?: number;

  /**
   * Pre-delay before the reverb tail begins, in milliseconds.
   * Adds a sense of physical space between the direct sound and reflections.
   * @default 20
   */
  preDelayMs?: number;
}

/**
 * Minimal interface for objects that can receive MIDI-style note events.
 * Satisfied structurally by {@link Synth} and all instrument classes ({@link Organ}, {@link Piano}, etc.).
 * Use this type in utilities like `playMidiFile` to accept any instrument.
 */
export interface NotePlayer {
  noteOn(note: number, velocity: number): unknown;
  noteOff(note: number): unknown;
}

/** Options for a single {@link Synth.noteOn} call. */
export interface NoteOnOptions {
  /**
   * Override the instrument voice for this note only.
   * Useful for layering different timbres in a chord.
   */
  voice?: VoiceConfig;
}

/** A parsed MIDI event emitted by {@link Synth} when a MIDI device is connected. */
export interface MidiEvent {
  /** The type of MIDI message. */
  type: 'noteOn' | 'noteOff' | 'cc' | 'programChange' | 'unknown';
  /** MIDI channel, 1-indexed (1–16). */
  channel: number;
  /** MIDI note number (0–127). Present on `noteOn` and `noteOff` events. */
  note?: number;
  /** Note velocity (0–127). Present on `noteOn` and `noteOff` events. */
  velocity?: number;
  /** CC controller number (0–127). Present on `cc` events. */
  controller?: number;
  /** CC value (0–127). Present on `cc` events. */
  value?: number;
  /** Program number (0–127). Present on `programChange` events. */
  program?: number;
  /** Raw MIDI bytes for this message. */
  raw: Buffer;
}

// ── Organ types ───────────────────────────────────────────────────────────────

/** A frequency break point for a mixture-rank organ stop. */
export interface OrganBreakPoint {
  /** MIDI note number at which this ratio begins (0–127). */
  note: number;
  /** Frequency ratio relative to the note fundamental for notes >= this break point. */
  frequencyRatio: number;
}

/** A simple organ stop with a fixed frequency ratio. */
export interface OrganSimpleStop {
  waveform?: WaveformKind;
  /** Frequency ratio relative to the note fundamental (e.g. 1.0 = 8', 2.0 = 4', 0.5 = 16'). */
  frequencyRatio: number;
  /** Oscillator amplitude. @default 1.0 */
  amplitudeRatio?: number;
  chiffIntensity?: number;
  chiffDuration?: number;
  attackTime?: number;
  releaseTime?: number;
}

/** A mixture-rank organ stop whose frequency ratio changes at specific MIDI note thresholds. */
export interface OrganBreakingStop {
  waveform?: WaveformKind;
  /** Oscillator amplitude. @default 1.0 */
  amplitudeRatio?: number;
  /** Break points sorted ascending by note. Each entry overrides frequency ratio for notes >= note. */
  breaks: OrganBreakPoint[];
  chiffIntensity?: number;
  chiffDuration?: number;
  attackTime?: number;
  releaseTime?: number;
}

export type OrganStop = OrganSimpleStop | OrganBreakingStop;

/** Type guard: true when a stop has break points (mixture rank). */
export function isBreakingStop(s: OrganStop): s is OrganBreakingStop {
  return Array.isArray((s as OrganBreakingStop).breaks);
}

/** A named preset: an ordered list of stop names or inline stop definitions. */
export interface OrganPreset {
  stops: Array<string | OrganStop>;
  displayName?: string;
}

/** Top-level organ configuration: named stops and named presets. */
export interface OrganConfig {
  stops: Record<string, OrganStop>;
  presets: Record<string, OrganPreset>;
}

/** @internal — the flat camelCase shape passed to the native engine's addOscillator. */
export interface NativeOscillatorTemplate {
  waveform?: string;
  harmonicRatio?: number;
  amplitude?: number;
  attackTime?: number;
  decayTime?: number;
  sustainLevel?: number;
  releaseTime?: number;
  chiffIntensity?: number;
  chiffDuration?: number;
  breaks?: Array<{ note: number; frequencyRatio: number }>;
  eqLoudnessStrength?: number;
}

/** @internal — the native Rust engine interface, not part of the public API. */
export interface NativeEngine {
  start(): void;
  stop(): void;
  noteOn(note: number, velocity: number, options?: { voice?: object }): void;
  noteOff(note: number): void;
  setVoice(config: object): void;
  setMasterVolume(volume: number): void;
  readonly activeNoteCount: number;
  enableMidi(deviceName: string | null | undefined, callback: (bytes: Buffer) => void): void;
  listMidiDevices(): string[];
  listAudioBackends(): string[];
  render(numSamples: number): Float32Array;
  sendMidiBytes(bytes: Buffer): void;
  addOscillator(template: NativeOscillatorTemplate): number;
  removeOscillator(oscillatorId: number): void;
  updateOscillatorAmplitude(oscillatorId: number, amplitude: number): void;
  setKeyClick(intensity: number, duration: number | null): void;
}
