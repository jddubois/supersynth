# Voice & Oscillators

Voices define how notes are synthesized. A voice is a collection of oscillator templates, each describing one layer of sound.

## VoiceConfig

```ts
interface VoiceConfig {
  oscillators?: OscillatorTemplate[];   // Default: [{ waveform: 'sine' }]
  velocityCurve?: VelocityCurve;        // Default: { type: 'linear' }
  headroom?: number;                    // Gain divisor for normalization. Default: 1.0
}
```

When multiple oscillators are listed, all play simultaneously on each note — enabling detuned unisons, layered waveforms, additive harmony, etc.

## OscillatorTemplate

```ts
interface OscillatorTemplate {
  waveform?: WaveformKind;       // Default: 'sine'
  harmonicRatio?: number;        // Frequency multiplier. Default: 1.0 (fundamental)
  amplitude?: number;            // Oscillator level. Default: 1.0
  detuneCents?: number;          // Static pitch offset in cents. Default: 0
  attackTime?: number;           // ADSR attack, seconds. Default: 0.03
  decayTime?: number;            // ADSR decay, seconds. Default: 0 (skip decay)
  sustainLevel?: number;         // ADSR sustain level 0.0–1.0. Default: 1.0
  releaseTime?: number;          // ADSR release, seconds. Default: 0.1
  chiffIntensity?: number;       // Pipe organ breath transient 0.0–1.0. Default: 0
  chiffDuration?: number;        // Chiff duration, seconds. Default: 0.04
  pulseWidth?: number;           // Duty cycle for 'pulse' waveform 0.0–1.0. Default: 0.5
  eqLoudnessStrength?: number;   // A-weighting correction 0.0–1.0 (waveform-dependent default)
}
```

### harmonicRatio

Multiplies the note's fundamental frequency. Use this to build additive synthesis or organ-style stops:

```ts
// Octave above (2:1)
{ waveform: 'sine', harmonicRatio: 2.0 }

// Perfect fifth above (3:2)
{ waveform: 'sine', harmonicRatio: 1.5 }
```

### ADSR envelope

Each oscillator has its own independent ADSR envelope:

```
amplitude
  |      /‾‾‾‾‾‾‾\___________
  |     /  A   D  S           \  R
  |____/                       \___
                                   time
```

- **attackTime** — ramp from 0 to 1 on note-on
- **decayTime** — ramp from 1 to `sustainLevel` (skipped if 0)
- **sustainLevel** — held while key is pressed
- **releaseTime** — ramp from `sustainLevel` to 0 on note-off

### eqLoudnessStrength

A-weighting correction to equalize perceived volume across the keyboard. High notes otherwise sound much louder than low ones. Defaults vary by waveform:

| Waveform | Default strength |
|----------|-----------------|
| `sine`, `triangle` | 1.0 (full correction) |
| `plucked`, `struck`, `electric` | 0.1 (gentle) |
| all others | 0.5 |

## VelocityCurve

Controls how MIDI velocity (0–127) maps to oscillator amplitude.

```ts
// Linear: amplitude = velocity / 127
{ type: 'linear' }

// Exponential: compresses or expands velocity dynamics
{ type: 'exponential', exponent: 2.0 }

// Fixed: ignores velocity — organ-style constant amplitude
{ type: 'fixed', amplitude: 0.8 }
```

## Examples

### Detuned unison (chorus effect)

```ts
const synth = new Synth({
  voice: {
    oscillators: [
      { waveform: 'sawtooth', detuneCents: -8 },
      { waveform: 'sawtooth', detuneCents:  0 },
      { waveform: 'sawtooth', detuneCents: +8 },
    ],
    headroom: 3,
  },
});
```

### Layered octaves

```ts
const synth = new Synth({
  voice: {
    oscillators: [
      { waveform: 'sine', harmonicRatio: 1.0, amplitude: 1.0 },
      { waveform: 'sine', harmonicRatio: 2.0, amplitude: 0.5 },
      { waveform: 'sine', harmonicRatio: 4.0, amplitude: 0.25 },
    ],
  },
});
```

### Organ-style fixed velocity

```ts
const synth = new Synth({
  voice: {
    oscillators: [{ waveform: 'principal' }],
    velocityCurve: { type: 'fixed', amplitude: 0.9 },
  },
});
```

### Per-note voice override

```ts
synth.noteOn(60, 100, {
  voice: {
    oscillators: [{ waveform: 'trumpet', attackTime: 0.05 }],
  },
});
```
