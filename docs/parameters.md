# Parameters, reverb and effects

`part.set({...})` changes any of these at any time, also while notes sound (changes are smoothed;
`{ at }` schedules them). All are relative to the instrument as recorded: the defaults reproduce
the recording, and are exported as `PARAM_DEFAULTS`. `part.get(name)` reads one value,
`part.params()` the ones that differ from the defaults, `part.reset()` restores them all.

| Parameter | Default | Range / unit | |
|---|---|---|---|
| `volume` | 0 | dB | part level |
| `pan` | 0 | −1 … 1 | |
| `reverbSend` | per instrument | 0 … 1 | |
| `spread` | per instrument | 0 … 1 | stereo spread of the partials |
| `brightness` | 0 | dB/octave | + brighter, − darker |
| `evenHarmonics` | 0 | dB | − hollow (clarinet-like), + full |
| `noise` | 0 | dB | breath, bow, hammer, wind |
| `formant` | per instrument | 0 … 1 | keep body resonances fixed when interpolating pitches |
| `inharmonicity` | 1 | × | string stiffness; 0 = harmonic |
| `maxPartials` | 512 | count | CPU/quality trade-off |
| `attack` | 1 | × | onset speed (2 = slower) |
| `decay` | 1 | × | free-decay time of piano, harp, mallets |
| `release` | 1 | × | after note-off |
| `vibrato` | 0 | cents | added vibrato |
| `vibratoRate` | 5.5 | Hz | |
| `vibratoDelay` | 0.3 | s | |
| `naturalVibrato` | 1 | 0 … 2 | how much recorded pitch movement to keep |
| `humanize` | 0 | ± cents | random per-note detune |
| `transpose` | 0 | semitones | |
| `tune` | 0 | cents | |
| `bendRange` | 2 | semitones | |
| `modDepth` | 25 | cents | mod-wheel vibrato |
| `velocitySensitivity` | 1 | 0 … 1 | |
| `mono` | false | | each note releases the previous |
| `legato` | false | | overlapping notes slur into each other without re-attacking (implies mono) |
| `glide` | 0.06 | s | legato pitch-glide time constant |
| `tremolo`, `tremoloPitch`, `tremoloRate` | off | dB / cents / Hz | synchronous pulsation of the whole part (organ tremulant, vibraphone motor) |
| `jitter` | 1 | × | independent micro-fluctuation of each partial, as recorded (0 = lockstep) |
| `shimmer` | 1 | × | fast amplitude/phase fluctuation spreading each partial's energy around its line, as recorded (0 = clean lines) |
| `gain` | 0 | dB | voice gain before effects |
| `eqLowGain/eqLowFreq`, `eqMidGain/eqMidFreq/eqMidQ`, `eqHighGain/eqHighFreq` | flat | dB / Hz | 3-band EQ |
| `lowCut`, `highCut` | off | Hz | 12 dB/oct filters |
| `chorus`, `chorusRate`, `chorusDepth` | off | mix / Hz / ms | ensemble |
| `drive`, `driveTone`, `driveLevel` | off | 1–20 / Hz / × | 4× oversampled tube drive |
| `leslie` | `'off'` | `'stop' \| 'slow' \| 'fast'` | rotary speaker |

## Velocity

Velocity selects and morphs between the recorded dynamic layers (timbre) and sets the loudness
through a per-instrument curve (pianos ≈ 20 dB between velocity 40 and 118; organs are not
touch-sensitive).

## Reverb

The room is chosen with `new Synth({ reverb })` and changed with `synth.reverb()`. By default
(`'auto'`) it is the suggested room of the first instrument or organ added. A 16-line feedback-delay-network reverb with frequency-dependent decay, early reflections and
modulation. Presets: `room`, `studio`, `chamber`, `hall`, `concert-hall`, `church`, `cathedral`,
`plate`.

```ts
synth.reverb('cathedral');
synth.reverb({ preset: 'hall', decay: 3.2, predelay: 30, highDecay: 0.4, level: -2 });
synth.reverb(false);
```

| `ReverbOptions` | |
|---|---|
| `decay` | mid-frequency RT60, s |
| `lowDecay`, `highDecay` | RT60 multipliers below 250 Hz / above 4 kHz |
| `size`, `predelay` (ms), `diffusion`, `early`, `width`, `modulation` | |
| `lowCut`, `highCut` | Hz, on the reverb return |
| `level` | dB |

The master bus ends with a transparent look-ahead limiter (ceiling −0.3 dBFS).
