# Waveforms

`WaveformKind` is a union of all available waveform names:

```ts
type WaveformKind =
  | 'sine' | 'square' | 'sawtooth' | 'triangle'
  | 'principal' | 'trumpet' | 'flute'
  | 'pulse' | 'noise'
  | 'plucked' | 'struck' | 'electric';
```

## Overview

| Waveform | Character | Implementation | Best for |
|----------|-----------|----------------|----------|
| `sine` | Pure, smooth | Standard sine | Organ flue, test tones |
| `square` | Hollow, buzzy | PolyBLEP anti-aliased | Clarinets, retro synth |
| `sawtooth` | Bright, rich | PolyBLEP anti-aliased | Strings, brass, leads |
| `triangle` | Warm | Freq-dependent sine/triangle blend | Soft organ, flute |
| `principal` | Diapason pipe | 10-harmonic additive + inharmonic stretch | Organ principal stops |
| `trumpet` | Reed/brass | 16-harmonic additive | Organ reeds, brass |
| `flute` | Soft, breathy | 6-harmonic additive | Organ flue, soft leads |
| `pulse` | Nasal, reedy | Variable-duty PolyBLEP | Oboe, clarinet, synth |
| `noise` | White noise | XorShift32 RNG | Percussion, effects |
| `plucked` | Acoustic string | Karplus-Strong | Guitar, harp |
| `struck` | Piano-like | Karplus-Strong (hammer model) | Piano, mallet |
| `electric` | Electric guitar | Karplus-Strong + soft-clip | Electric guitar, bass |

## Waveform details

### sine
Pure sine wave. Full A-weighting correction by default (`eqLoudnessStrength: 1.0`). The cleanest, most organ-like tone.

### square
50% duty cycle square wave, anti-aliased with PolyBLEP. Generates odd harmonics only (1f, 3f, 5f…), giving it a hollow, woody character.

### sawtooth
Full harmonic spectrum (1f, 2f, 3f…), anti-aliased with PolyBLEP. Bright and rich. Good base for subtractive synthesis.

### triangle
Frequency-dependent blend of sine and triangle:
- Below 50 Hz: pure sine
- 50–250 Hz: interpolated blend
- Above 250 Hz: pure triangle

Gives warm, rounded character similar to soft organ flue pipes.

### principal
The organ Diapason/Prinzipal pipe. 10-harmonic additive synthesis with both even and odd harmonics present (unlike triangle which has only odd). Slight inharmonic stretch per partial models real pipe resonance behavior. Register-adaptive: darker in bass (0.7 brightness), more presence in treble (1.1 brightness). This is the core waveform for [organ stops](organ.md).

### trumpet
16-harmonic additive synthesis modeled on German baroque Schnitger reed pipes. Register-adaptive brightness (1.1 in bass, 0.9 in treble). Nyquist taper prevents aliasing in the upper register.

### flute
6-harmonic additive synthesis (pure sine fundamental + weak upper partials). Softer brightness curve than trumpet. Good for gentle organ flue stops and breathy leads.

### pulse
Variable duty-cycle pulse wave, PolyBLEP anti-aliased at both rising and falling edges. Duty cycle is set via `pulseWidth` in `OscillatorTemplate` (0.0–1.0; default 0.5 = square). Narrow pulses (0.1–0.3) give reedy, nasal character useful for oboe or clarinet voices.

```ts
// Clarinet-like narrow pulse
{ waveform: 'pulse', pulseWidth: 0.2 }
```

### noise
White noise via XorShift32. Output is uniform in `[-1, 1]`. Useful for percussion, breath transients, or effects layers.

### plucked
Karplus-Strong acoustic string model. Excitation is a full-buffer half-sine windowed noise burst, simulating a soft pluck. T60 decay: 1.5–5.5 seconds (frequency-dependent). Good for guitar, harp, pizzicato.

### struck
Karplus-Strong piano hammer model. Excitation is a short burst in the first 1/8 of the delay buffer, with a one-pole low-pass filter simulating hammer softness. T60 decay: 5–30 seconds (long piano-like sustain).

### electric
Karplus-Strong electric guitar model. Excitation in the first 1/7 of the delay buffer (bridge-position pickup). Tanh soft-clip (`drive: 1.5`) in the feedback loop adds electric character. T60 decay: 2–5 seconds.
