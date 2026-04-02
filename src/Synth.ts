import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  MidiEvent,
  NativeEngine,
  NativeOscillatorTemplate,
  NoteOnOptions,
  SynthConfig,
  VelocityCurve,
  VoiceConfig,
} from './types.js';
import { AudioBackendError, MidiError } from './errors.js';

/** @internal Symbol used by the Organ class to access oscillator registration. Not part of the public API. */
export const kOrgan = Symbol('supersynth.organ');

function loadNative(): { SynthEngine: new (config: object) => NativeEngine } {
  const require = createRequire(import.meta.url);
  const dir = path.dirname(fileURLToPath(import.meta.url));
  // Try platform-specific binary first (e.g. supersynth.linux-arm64.node),
  // then fall back to the generic supersynth.node for backward compatibility.
  const platformName = `supersynth.${process.platform}-${process.arch}.node`;
  for (const name of [platformName, 'supersynth.node']) {
    try {
      return require(path.resolve(dir, '..', name));
    } catch {
      // try next
    }
  }
  throw new Error(`No supersynth native binary found for ${process.platform}-${process.arch}`);
}

let _native: ReturnType<typeof loadNative> | null = null;
function getNative() {
  if (!_native) _native = loadNative();
  return _native;
}

function flattenVelocityCurve(vc: VelocityCurve): { velocity_curve: string; velocity_curve_value?: number } {
  switch (vc.type) {
    case 'exponential': return { velocity_curve: 'exponential', velocity_curve_value: vc.exponent };
    case 'fixed':       return { velocity_curve: 'fixed', velocity_curve_value: vc.amplitude };
    default:            return { velocity_curve: 'linear' };
  }
}

function toNativeVoice(v: VoiceConfig): object {
  return {
    oscillators: v.oscillators?.map((o) => ({
      waveform: o.waveform,
      harmonic_ratio: o.harmonicRatio,
      amplitude: o.amplitude,
      detune_cents: o.detuneCents,
      attack_time: o.attackTime,
      decay_time: o.decayTime,
      sustain_level: o.sustainLevel,
      release_time: o.releaseTime,
      chiff_intensity: o.chiffIntensity,
      chiff_duration: o.chiffDuration,
      pulse_width: o.pulseWidth,
      eq_loudness_strength: o.eqLoudnessStrength,
    })),
    ...(v.velocityCurve ? flattenVelocityCurve(v.velocityCurve) : {}),
    headroom: v.headroom,
  };
}

/**
 * The main supersynth synthesis engine.
 *
 * Backed by a native Rust engine (via CPAL) that runs on a dedicated OS thread,
 * independent of Node's event loop and garbage collector. Suitable for real-time
 * audio servers, generative music, MIDI instruments, and offline rendering.
 *
 * @example Organ voice through speakers
 * ```ts
 * import { Synth, organVoice } from 'supersynth';
 *
 * const synth = new Synth({ voice: organVoice });
 * await synth.start();
 *
 * synth.noteOn(60, 100).noteOn(64, 100).noteOn(67, 100); // C major chord
 * await new Promise(r => setTimeout(r, 3000));
 * synth.noteOff(60); synth.noteOff(64); synth.noteOff(67);
 * synth.stop();
 * ```
 *
 * @example Piano voice with velocity sensitivity
 * ```ts
 * import { Synth, pianoVoice } from 'supersynth';
 * const synth = new Synth({ voice: pianoVoice });
 * await synth.start();
 * synth.noteOn(69, 80);  // soft
 * synth.noteOn(72, 127); // loud — very different amplitude (exponential curve)
 * ```
 *
 * @example Offline rendering (no audio hardware required)
 * ```ts
 * import { Synth, stringsVoice } from 'supersynth';
 * const synth = new Synth({ voice: stringsVoice });
 * synth.noteOn(60, 100);
 * const samples = synth.render(48000); // 1 second of audio
 * ```
 */
export declare interface Synth {
  on(event: 'noteOn' | 'noteOff' | 'cc' | 'programChange' | 'midiMessage', listener: (event: MidiEvent) => void): this;
  emit(event: 'noteOn' | 'noteOff' | 'cc' | 'programChange' | 'midiMessage', arg: MidiEvent): boolean;
}

export class Synth extends EventEmitter {
  private engine: NativeEngine;

  constructor(config: SynthConfig = {}) {
    super();
    const { SynthEngine } = getNative();

    const voice = config.voice ? toNativeVoice(config.voice) : undefined;

    this.engine = new SynthEngine({
      sampleRate: config.sampleRate,
      backend: config.backend,
      voice,
      masterVolume: config.masterVolume,
      ...(config.reverb
        ? {
            reverbRoomSize: config.reverb.roomSize,
            reverbDamping: config.reverb.damping,
            reverbWet: config.reverb.wet,
            reverbDry: config.reverb.dry,
            reverbPreDelayMs: config.reverb.preDelayMs,
          }
        : {}),
      keyClickIntensity: config.keyClickIntensity,
      keyClickDuration: config.keyClickDuration,
    });
  }

  /**
   * Start the audio output stream.
   *
   * Opens a connection to the audio backend (CoreAudio / WASAPI / ALSA / JACK)
   * and begins streaming audio. Must be called before notes will be heard through speakers.
   *
   * Not required for offline rendering via {@link render}.
   *
   * @throws {@link AudioBackendError} if no audio device is available or the backend fails to start.
   */
  async start(): Promise<void> {
    try {
      this.engine.start();
    } catch (err) {
      throw new AudioBackendError(`Failed to start audio: ${(err as Error).message}`);
    }
  }

  /**
   * Stop the audio output stream and disconnect any MIDI input.
   *
   * Safe to call even if {@link start} was never called.
   */
  stop(): void {
    this.engine.stop();
  }

  /**
   * Trigger a note-on event — start playing a note.
   *
   * If the same MIDI note number is already playing, the existing note is released
   * and a new one starts immediately.
   *
   * @param note - MIDI note number (0–127). Middle C = 60, A4 = 69.
   * @param velocity - Note velocity (0–127). Scales amplitude per the voice's velocity curve. Default: 100.
   * @param options - Optional per-note overrides such as a different voice.
   * @returns `this` for chaining.
   */
  noteOn(note: number, velocity = 100, options?: NoteOnOptions): this {
    const nativeOptions = options?.voice
      ? { voice: toNativeVoice(options.voice) }
      : undefined;
    this.engine.noteOn(note, velocity, nativeOptions);
    return this;
  }

  /**
   * Trigger a note-off event — begin the release phase of a playing note.
   *
   * The note does not stop immediately; it fades out according to the voice's
   * release time. The note is removed from the engine once fully silent.
   *
   * @param note - MIDI note number (0–127).
   * @returns `this` for chaining.
   */
  noteOff(note: number): this {
    this.engine.noteOff(note);
    return this;
  }

  /**
   * Set the instrument voice used for all subsequent {@link noteOn} calls.
   *
   * Does not affect notes that are already playing.
   *
   * @param config - A {@link VoiceConfig}. Use a preset from `supersynth` (e.g. `organVoice`) or build a custom one.
   * @returns `this` for chaining.
   */
  setVoice(config: VoiceConfig): this {
    this.engine.setVoice(toNativeVoice(config));
    return this;
  }

  /**
   * Set the master output volume.
   *
   * Applied after the effects chain, before the soft knee limiter.
   *
   * @param volume - Volume level from 0.0 (silent) to 1.0 (full).
   * @returns `this` for chaining.
   */
  setMasterVolume(volume: number): this {
    this.engine.setMasterVolume(volume);
    return this;
  }

  /**
   * The number of notes currently active in the engine — including notes in
   * their release phase that have not yet fully faded out.
   */
  get activeNoteCount(): number {
    return this.engine.activeNoteCount;
  }

  /**
   * Connect to a MIDI input device and start receiving events.
   *
   * Once connected, the synth emits the following events:
   * - `'noteOn'` — key pressed
   * - `'noteOff'` — key released
   * - `'cc'` — control change (knobs, pedals, etc.)
   * - `'programChange'` — program / patch change
   * - `'midiMessage'` — every MIDI message, regardless of type
   *
   * @param deviceName - A substring to match against available device names
   *   (e.g. `'Arturia'`). Omit to use the first available device.
   * @returns `this` for chaining.
   * @throws {@link MidiError} if no matching device is found or the connection fails.
   */
  async enableMidi(deviceName?: string): Promise<this> {
    try {
      this.engine.enableMidi(deviceName ?? null, (raw: Buffer) => {
        const event = this.parseMidiBytes(raw);
        this.emit('midiMessage', event);
        const knownTypes = ['noteOn', 'noteOff', 'cc', 'programChange'] as const;
        if ((knownTypes as readonly string[]).includes(event.type)) {
          this.emit(event.type as 'noteOn' | 'noteOff' | 'cc' | 'programChange', event);
        }
      });
    } catch (err) {
      throw new MidiError(`Failed to enable MIDI: ${(err as Error).message}`);
    }
    return this;
  }

  /**
   * List the names of available MIDI input devices on this machine.
   */
  listMidiDevices(): string[] {
    return this.engine.listMidiDevices();
  }

  /**
   * List the audio backends available on this platform.
   */
  listAudioBackends(): string[] {
    return this.engine.listAudioBackends();
  }

  /**
   * Render audio to a `Float32Array` without opening an audio device.
   *
   * @param numSamples - Number of samples to render. At 48kHz, 48000 = 1 second.
   * @returns A mono `Float32Array` of `numSamples` length, samples in [-1, 1].
   */
  render(numSamples: number): Float32Array {
    return this.engine.render(numSamples);
  }

  /**
   * Feed raw MIDI bytes directly into the engine.
   *
   * @param bytes - A 3-byte MIDI message buffer (status, data1, data2).
   * @returns `this` for chaining.
   */
  sendMidiBytes(bytes: Buffer): this {
    this.engine.sendMidiBytes(bytes);
    return this;
  }

  /** @internal */
  get [kOrgan]() {
    return {
      addOscillator: (template: NativeOscillatorTemplate): number => this.engine.addOscillator(template),
      removeOscillator: (id: number): void => this.engine.removeOscillator(id),
      updateOscillatorAmplitude: (id: number, amplitude: number): void =>
        this.engine.updateOscillatorAmplitude(id, amplitude),
    };
  }

  /**
   * Update the amplitude of a registered oscillator in real time.
   * Affects both the stored template (for future notes) and all currently playing notes.
   * Used for drawbar-style real-time level control — no note retrigger.
   */
  updateOscillatorAmplitude(id: number, amplitude: number): this {
    this.engine.updateOscillatorAmplitude(id, amplitude);
    return this;
  }

  /**
   * Set the global organ-mode key-click intensity and duration.
   *
   * @param intensity - 0.0 = off, 0.5 = typical organ key-click.
   * @param duration  - Transient duration in seconds. @default 0.003
   */
  setKeyClick(intensity: number, duration?: number): this {
    this.engine.setKeyClick(intensity, duration ?? null);
    return this;
  }

  private parseMidiBytes(raw: Buffer): MidiEvent {
    if (raw.length === 0) {
      return { type: 'unknown', channel: 0, raw };
    }
    const status = raw[0]!;
    const kind = status & 0xf0;
    const channel = (status & 0x0f) + 1;
    const b1 = raw[1] ?? 0;
    const b2 = raw[2] ?? 0;

    switch (kind) {
      case 0x80:
        return { type: 'noteOff', channel, note: b1, velocity: b2, raw };
      case 0x90:
        if (b2 === 0) return { type: 'noteOff', channel, note: b1, velocity: 0, raw };
        return { type: 'noteOn', channel, note: b1, velocity: b2, raw };
      case 0xb0:
        return { type: 'cc', channel, controller: b1, value: b2, raw };
      case 0xc0:
        return { type: 'programChange', channel, program: b1, raw };
      default:
        return { type: 'unknown', channel, raw };
    }
  }
}


