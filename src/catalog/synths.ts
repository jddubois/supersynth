// Synthesizers
import type { InstrumentDefinition, LayerDefinition } from './types.js';

/**
 * Oscillators of the rock synth: the model is one sawtooth oscillator through its filter, and a
 * layer is one oscillator. A few cents apart they beat against each other, which is the width
 * of an analog polysynth; `gain` keeps the sum at one oscillator's level.
 */
const oscillators = (cents: number[], extra: LayerDefinition = { model: 'rock-synth' }): LayerDefinition[] =>
  cents.map((detune, i) => ({
    ...extra,
    detune,
    pan: cents.length > 1 ? (i / (cents.length - 1) - 0.5) * 0.7 : 0,
    gain: (extra.gain ?? 0) - 10 * Math.log10(cents.length),
  }));

/** Rock Synth (analog-style polysynth). */
export const ROCK_SYNTH: InstrumentDefinition = {
  id: 'rock-synth',
  name: 'Rock Synth',
  family: 'synth',
  description: 'An analog-style polysynth: detuned sawtooth oscillators through a low-pass filter that opens at each key press and falls back, the brassy chord sound of arena-rock keyboard riffs. Playing harder opens the filter further. The model is computed, not recorded: one oscillator, which the layers play two or three times a few cents apart.',
  layers: oscillators([-6, 6]),
  // the model covers C1 to C8; the presets' layers an octave below and above stay within reach of it
  range: [31, 101],
  reverb: 'room',
  parameters: { humanize: 1.5, chorus: 0.25, chorusRate: 0.5, chorusDepth: 3 },
  presets: {
    default: { description: 'Polysynth brass: two detuned oscillators and a little chorus. Chords and riffs' },
    arena: {
      description: 'Brighter, three oscillators, in a big hall: the stadium riff',
      layers: oscillators([-9, 0, 9]),
      parameters: { humanize: 1.5, brightness: 1, chorus: 0.3, chorusRate: 0.5, chorusDepth: 3, reverbSend: 0.24 },
      reverb: 'concert-hall',
    },
    pad: {
      description: 'Slow and dark, three oscillators, long release: held chords under a band',
      layers: oscillators([-10, 0, 10]),
      parameters: { volume: 2, humanize: 2, attack: 20, release: 6, brightness: -1.5, velocitySensitivity: 0.5, chorus: 0.5, chorusRate: 0.4, chorusDepth: 5, reverbSend: 0.2 },
      reverb: 'hall',
    },
    strings: {
      description: 'String machine: an octave added above, heavy ensemble chorus, slow attack',
      layers: [...oscillators([-7, 7]), ...oscillators([-5, 5], { model: 'rock-synth', transpose: 12, gain: -5 })],
      parameters: { humanize: 2, attack: 14, release: 5, brightness: -0.5, velocitySensitivity: 0.4, chorus: 0.7, chorusRate: 0.8, chorusDepth: 6, reverbSend: 0.2 },
      reverb: 'hall',
    },
    lead: {
      description: 'Mono lead: overlapping notes glide into each other, the mod wheel adds vibrato; lightly driven',
      parameters: { volume: 4, legato: true, glide: 0.04, modDepth: 40, drive: 2.5, driveTone: 8000, driveLevel: 0.55, chorus: 0.15, chorusRate: 0.5, chorusDepth: 3, reverbSend: 0.18 },
      reverb: 'plate',
    },
    'square-lead': {
      description: 'Hollow square-wave mono lead (the even harmonics taken out), with a delayed vibrato',
      layers: oscillators([-4, 4]),
      parameters: { volume: 7, legato: true, glide: 0.05, evenHarmonics: -40, vibrato: 9, vibratoRate: 5.8, vibratoDelay: 0.35, modDepth: 40, chorus: 0, reverbSend: 0.2 },
      reverb: 'plate',
    },
    power: {
      description: 'Power chords from one key: a fifth and an octave above each note, the amplifier driven hard',
      layers: [...oscillators([-5, 5]), { model: 'rock-synth', transpose: 7, gain: -4, detune: 2 }, { model: 'rock-synth', transpose: 12, gain: -5, detune: -3 }],
      parameters: { drive: 4, driveTone: 6500, driveLevel: 0.42, brightness: -0.5, chorus: 0, reverbSend: 0.14 },
    },
    bass: {
      description: 'Mono synth bass: an oscillator an octave below added, no chorus',
      layers: [...oscillators([-4, 4]), { model: 'rock-synth', transpose: -12, gain: -3 }],
      parameters: { volume: 3, mono: true, chorus: 0, reverbSend: 0.04 },
    },
    single: { description: 'One oscillator, no chorus: the model as computed', layers: oscillators([0]), parameters: { volume: -3, humanize: 0, chorus: 0 } },
  },
};
