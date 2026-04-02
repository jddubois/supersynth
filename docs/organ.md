# Organ

The `Organ` class is the flagship feature of supersynth — a baroque pipe organ simulation with stops, presets, mixture ranks, drawbar control, and key-click.

```ts
import { Organ } from 'supersynth';

const organ = new Organ({ masterVolume: 0.7 });
await organ.start();

organ.activatePreset('principal');
organ.noteOn(60, 100).noteOn(64, 100).noteOn(67, 100);
```

## Constructor

```ts
new Organ(config?: InstrumentConfig)
```

`InstrumentConfig` is `SynthConfig` without `voice` — the organ manages its own oscillator templates via stops.

An `OrganConfig` (stops + presets) can optionally be passed to the underlying constructor if you need a custom stop list. By default the built-in config is used.

## Methods

### Presets

```ts
organ.activatePreset(presetName: string): this
organ.deactivatePreset(presetName: string): this
```

Multiple presets can be active simultaneously. Stops shared between presets are reference-counted — a shared stop stays active until the last preset using it is deactivated.

```ts
organ.activatePreset('principal');
organ.activatePreset('trumpet');    // trumpet stop layered on top
organ.deactivatePreset('trumpet');  // back to principal only
```

### Stops

```ts
organ.activateStop(nameOrStop: string | OrganStop): this
organ.deactivateStop(nameOrStop: string | OrganStop): this
```

Activate/deactivate a stop by name (referencing the built-in stop list) or by passing an inline `OrganStop` object.

```ts
organ.activateStop('principal_8');
organ.activateStop({ waveform: 'flute', frequencyRatio: 2.0, amplitudeRatio: 0.7 });
```

### Drawbars

```ts
organ.setDrawbarLevel(stopName: string, level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8): this
```

Real-time amplitude control (0 = silent, 8 = full). Models the drawbar registers on a Hammond-style organ. Can be called while notes are playing.

```ts
organ.activateStop('principal_8');
organ.setDrawbarLevel('principal_8', 6);  // pull it back
```

### Key-click

```ts
organ.setKeyClick(intensity: number, duration?: number): this
// intensity: 0.0–1.0  |  duration: seconds (default 0.003)
```

Simulates the mechanical click of organ pipe speech — a short noise burst at each note onset.

### Other

```ts
organ.reset(): this           // deactivate all stops and presets
organ.activeStops: string[]   // read-only list of currently active stop names
organ.config: OrganConfig     // read-only organ configuration
```

## Built-in stops

| Name | Pitch | Waveform | Description |
|------|-------|----------|-------------|
| `subbass_16` | 16′ | principal | Sub-bass principal |
| `principal_8` | 8′ | principal | Main diapason |
| `principal_4` | 4′ | principal | Octave principal |
| `super_octave_2` | 2′ | principal | Two-foot octave |
| `flute_16` | 16′ | flute | Soft sub-bass flute |
| `flute_8` | 8′ | flute | Open flute |
| `flute_4` | 4′ | flute | Nazard / chimney flute |
| `trumpet_16` | 16′ | trumpet | Pedal reed |
| `trumpet_8` | 8′ | trumpet | Chorus reed |
| `trumpet_4` | 4′ | trumpet | Clarion reed |
| `fifth_2_2_3` | 2⅔′ | principal | Nazard interval stop |
| `tierce_1_3_5` | 1⅗′ | principal | Tierce interval stop |
| `larigot_1_1_3` | 1⅓′ | principal | Larigot interval stop |
| `mixture_iii` | — | principal | 3-rank mixture (breaking) |
| `fourniture_iv` | — | principal | 4-rank Fourniture (breaking) |
| `cymbale_iii` | — | principal | 5-rank Cymbale (breaking) |

**Breaking stops** (`mixture_iii`, `fourniture_iv`, `cymbale_iii`) are mixture ranks — their frequency ratios change across the keyboard at defined break points, keeping the mixture pitches in a playable range. See `OrganBreakingStop` in the type definitions.

## Built-in presets

| Name | Stops included | Character |
|------|---------------|-----------|
| `principal` | `principal_8`, `flute_4`, sine mixture | Warm, full diapason |
| `cornet` | `principal_8`, `principal_4`, `fifth_2_2_3`, `tierce_1_3_5` | Cornet registration |
| `mixture` | `principal_8`, `principal_4`, `mixture_iii` | Bright, full principal chorus |
| `flute` | `flute_8`, `flute_4` | Soft, breathy flute combination |
| `trumpet` | `trumpet_8` | Solo reed |
| `grand_jeu` | `principal_8`, `trumpet_8` | Full German baroque principal + reed |
| `plein_jeu` | `principal_8`, `principal_4`, `fourniture_iv` | Classical French Plein Jeu |
| `pedalboard_default` | `subbass_16`, `principal_8` | Standard pedal registration |
| `pedalboard_reed` | `trumpet_16`, `trumpet_8` | Pedal reeds |
| `pedalboard_flute` | `flute_16`, `flute_8` | Pedal flutes |
| `pedalboard_trumpet` | `trumpet_8` | Single pedal trumpet |

## Custom organ configuration

You can define your own stops and presets using `OrganConfig`:

```ts
import { Organ, OrganConfig } from 'supersynth';

const config: OrganConfig = {
  stops: {
    my_stop: {
      waveform: 'principal',
      frequencyRatio: 1.0,
      amplitudeRatio: 1.0,
      chiffIntensity: 0.15,
      attackTime: 0.008,
    },
    mixture_stop: {
      waveform: 'principal',
      frequencyRatio: 2.0,
      breaks: [
        { note: 0,  frequencyRatio: 2.0 },
        { note: 48, frequencyRatio: 4.0 },
        { note: 60, frequencyRatio: 8.0 },
      ],
    },
  },
  presets: {
    my_preset: {
      stops: ['my_stop', 'mixture_stop'],
      displayName: 'My Registration',
    },
  },
};

const organ = new Organ({ masterVolume: 0.7 }, config);
```

## Effects with organ

The Leslie rotary speaker and overdrive work particularly well with the organ:

```ts
const organ = new Organ({
  masterVolume: 0.7,
  reverb: { roomSize: 0.6, wet: 0.2 },
});
await organ.start();
organ.setVibratoChorusMode('c2');     // chorus
organ.setKeyClick(0.4);
organ.activatePreset('grand_jeu');
```

See [effects.md](effects.md) for the full effects API.

## MIDI with organ

```ts
await organ.start();
await organ.enableMidi('Arturia');

organ.on('noteOn',  ({ note, velocity }) => organ.noteOn(note, velocity));
organ.on('noteOff', ({ note }) => organ.noteOff(note));
organ.on('cc',      ({ controller, value }) => {
  // Map CC to drawbar
  if (controller === 16) organ.setDrawbarLevel('principal_8', Math.round(value / 16));
});
```
