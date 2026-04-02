# Effects

## Reverb

Freeverb-based reverb. Configured at construction time via `SynthConfig`:

```ts
const synth = new Synth({
  reverb: {
    roomSize: 0.85,      // 0.0–1.0. Room size / decay time. Default: 0.85
    damping: 0.5,        // 0.0–1.0. High-frequency absorption. Default: 0.5
    wet: 0.35,           // Reverb send level. Default: 0.35
    dry: 0.65,           // Direct signal level. Default: 0.65
    preDelayMs: 20,      // ms before reverb tail begins. Default: 20
  },
});
```

To disable reverb, set `wet: 0` (or omit the `reverb` field entirely).

## Overdrive

Tube-style soft-clip distortion. Call `setOverdrive()` at any time:

```ts
synth.setOverdrive(
  drive,    // 1.0–10.0. Gain before clipping. 1.0 = clean.
  bias,     // 0.0–0.3.  Even-harmonic asymmetry (tube warmth).
  level,    // 0.0–1.0.  Output level after clipping.
);
```

Or configure at construction:
```ts
const synth = new Synth({
  // These are passed through to the native engine config
});
// Then call:
synth.setOverdrive(3.0, 0.1, 0.7);
```

Overdrive works well with the organ for Hammond-style grit.

## Leslie rotary speaker / vibrato-chorus

Simulates a Hammond Leslie cabinet and the scanner vibrato/chorus circuit built into Hammond organs.

```ts
synth.setVibratoChorusMode(mode);
```

| Mode | Effect |
|------|--------|
| `'off'` | No modulation |
| `'v1'` | Vibrato 1 — subtle pitch modulation |
| `'v2'` | Vibrato 2 — moderate pitch modulation |
| `'v3'` | Vibrato 3 — deep pitch modulation |
| `'c1'` | Chorus 1 — pitch + amplitude modulation, subtle |
| `'c2'` | Chorus 2 — pitch + amplitude modulation, moderate (classic Hammond chorus) |
| `'c3'` | Chorus 3 — pitch + amplitude modulation, deep |

Also configurable at construction:

```ts
const organ = new Organ({
  // lesliEnabled / scannerMode are passed to the native engine
});
organ.setVibratoChorusMode('c2');
```

## Limiter

A look-ahead limiter prevents clipping when many voices are active. Configured at construction only:

```ts
const synth = new Synth({
  // Limiter parameters passed through SynthConfig to native engine:
  // limiterThreshold, limiterKneeWidth, limiterRatio,
  // limiterAttackMs, limiterReleaseMs
});
```

The limiter is enabled by default with conservative settings and generally does not need tuning.

## Low-pass filter

A simple low-pass filter is available via the native engine config. Not exposed as a TypeScript setter — configure at construction:

```ts
// Pass through SynthConfig:
// lowPassCutoff (normalized coefficient 0.0–1.0)
// lowPassStages (number of filter stages)
```
