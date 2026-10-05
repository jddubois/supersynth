# Parameters, reverb and effects

`instrument.set({...})` changes any of these at any time, also while notes sound (changes are
smoothed; `{ at }` schedules them). All are relative to the model as analysed: the defaults
change nothing, and are exported as `PARAMETER_DEFAULTS` (`reverbSend`, `spread` and `formant`
default to each instrument's own value). `instrument.get(name)` reads one value,
`instrument.parameters()` the ones that differ from the defaults, and `instrument.preset('default')`
restores the defaults. A value outside its range (`PARAMETER_RANGES`, below) throws a
`SupersynthError` and changes nothing.

| Parameter | Default | Range, unit | |
|---|---|---|---|
| `volume` | 0 | −120 … 24 dB | part level |
| `pan` | 0 | −1 … 1 | |
| `reverbSend` | per instrument | 0 … 1 | |
| `spread` | per instrument | 0 … 1 | stereo spread of the partials |
| `brightness` | 0 | −24 … 24 dB/octave | + brighter, − darker |
| `evenHarmonics` | 0 | −60 … 24 dB | − hollow (clarinet-like), + full |
| `noise` | 0 | −120 … 40 dB | breath, bow, hammer, wind |
| `formant` | per instrument | 0 … 1 | keep body resonances fixed when interpolating pitches |
| `inharmonicity` | 1 | 0 … 10 × | string stiffness; 0 = harmonic |
| `maxPartials` | 512 | 1 … 512 | CPU/quality trade-off |
| `attack` | 1 | 0.05 … 20 × | onset speed (2 = slower) |
| `decay` | 1 | 0.05 … 20 × | free-decay time of piano, harp, mallets |
| `release` | 1 | 0.01 … 20 × | after note-off |
| `vibrato` | 0 | 0 … 1200 cents | added vibrato |
| `vibratoRate` | 5.5 | 0 … 40 Hz | |
| `vibratoDelay` | 0.3 | 0 … 60 s | |
| `naturalVibrato` | 1 | 0 … 2 | how much recorded pitch movement to keep |
| `humanize` | 0 | 0 … 100 ± cents | random per-note detune |
| `transpose` | 0 | −96 … 96 semitones | |
| `tune` | 0 | −1200 … 1200 cents | |
| `bendRange` | 2 | −48 … 48 semitones | |
| `modDepth` | 25 | −1200 … 1200 cents | mod-wheel vibrato |
| `velocitySensitivity` | 1 | 0 … 1 | |
| `mono` | false | `true`, `false` | each note releases the previous |
| `legato` | false | `true`, `false` | overlapping notes glide into each other without a new attack (implies mono) |
| `glide` | 0.06 | 0 … 10 s | legato pitch-glide time constant |
| `tremolo`, `tremoloPitch`, `tremoloRate` | off | 0 … 24 dB, 0 … 200 cents, 0 … 40 Hz | synchronous pulsation of the whole part (organ tremulant, vibraphone motor) |
| `jitter` | 1 | 0 … 10 × | independent micro-fluctuation of each partial, as analysed (0 = lockstep) |
| `shimmer` | 1 | 0 … 10 × | fast amplitude/phase fluctuation spreading each partial's energy around its line, as analysed (0 = clean lines) |
| `gain` | 0 | −120 … 48 dB | voice gain before effects |
| `eqLowGain/eqLowFreq`, `eqMidGain/eqMidFreq/eqMidQ`, `eqHighGain/eqHighFreq` | flat | gains −24 … 24 dB, frequencies 10 … 100000 Hz, Q 0.1 … 10 | 3-band EQ |
| `lowCut`, `highCut` | off | 0 (off) … 100000 Hz | 12 dB/oct filters |
| `chorus`, `chorusRate`, `chorusDepth` | off | mix 0 … 1, 0 … 20 Hz, 0 … 50 ms | ensemble |
| `drive`, `driveTone`, `driveLevel` | off | 1 (off) … 20, 0 … 100000 Hz, 0 … 4 × | 4× oversampled tube drive |
| `leslie` | `'off'` | `'off'`, `'stop'`, `'slow'`, `'fast'` | rotary speaker |

## Velocity

Velocity selects and morphs between the recorded dynamic layers (timbre) and sets the loudness
through a per-instrument curve (pianos ≈ 20 dB between velocity 40 and 118; organs are not
touch-sensitive).

## Reverb

The room is chosen with `new Synth({ reverb })` and changed with `synth.set({ reverb })`. By default
(`'auto'`) it is the suggested room of the first instrument or organ added, and follows that
instrument's presets until the room is set by hand. A 16-line feedback-delay-network reverb with frequency-dependent decay, early reflections and
modulation. Presets: `room`, `studio`, `chamber`, `hall`, `concert-hall`, `church`, `cathedral`,
`plate`.

```ts
synth.set({ reverb: 'cathedral' });
synth.set({ reverb: { preset: 'hall', decay: 3.2, predelay: 30, highDecay: 0.4, level: -2 } });
synth.set({ reverb: false });
```

| `ReverbOptions` | |
|---|---|
| `decay` | mid-frequency RT60, s |
| `lowDecay`, `highDecay` | RT60 multipliers below 250 Hz / above 4 kHz |
| `size`, `predelay` (ms), `diffusion`, `early`, `width`, `modulation` | |
| `lowCut`, `highCut` | Hz, on the reverb return |
| `level` | return level, dB (0 at first). It stays as set when other fields or the preset change, and `reverb: false` then back on restores it |

The master bus ends with a transparent look-ahead limiter (ceiling −0.3 dBFS).
