# Instrument Classes

> **Work in progress.** These instrument classes produce sound and are usable, but their voices have not been tuned to the same standard as the [organ engine](organ.md). Expect rough edges — the voices are reasonable starting points, not finished models.

All instrument classes extend `Synth` and accept an `InstrumentConfig` (which is `SynthConfig` without the `voice` field — the instrument provides its own voice). All `Synth` methods are available: `start()`, `stop()`, `noteOn()`, `noteOff()`, `render()`, `sendMidiBytes()`, `enableMidi()`, `listMidiDevices()`, `setMasterVolume()`, etc.

```ts
import { Piano, Flute, Guitar, /* ... */ } from 'supersynth';

const piano = new Piano({ masterVolume: 0.6 });
await piano.start();
piano.noteOn(60, 100);
```

## Strings

| Class | Character | Voice |
|-------|-----------|-------|
| `Strings` | Full string ensemble | 4 detuned sawtooth oscillators, slow attack |
| `Violin` | Solo violin | 2 sawtooth oscillators, expressive attack |
| `Cello` | Solo cello | 2 sawtooth oscillators, slower attack, fuller release |

## Keyboard / plucked strings

| Class | Character | Voice |
|-------|-----------|-------|
| `Piano` | Acoustic piano | Karplus-Strong (`struck`) — 3 detuned oscillators, exponential velocity curve |
| `Harpsichord` | Harpsichord | Karplus-Strong (`struck`) — velocity-insensitive, instant mute |
| `Harp` | Harp | Karplus-Strong (`plucked`) — long ring-out |

## Guitar family

| Class | Character | Voice |
|-------|-----------|-------|
| `Guitar` | Acoustic guitar | Karplus-Strong (`plucked`) |
| `ElectricGuitar` | Electric guitar | Karplus-Strong (`electric`) with bridge excitation and soft-clip |
| `BassGuitar` | Bass guitar | Karplus-Strong (`plucked`), lower register tuning |

## Woodwinds

| Class | Character | Voice |
|-------|-----------|-------|
| `Flute` | Soft, breathy | 6-harmonic additive flute with breath transient |
| `Clarinet` | Hollow, reedy | Narrow pulse (20% duty) with reed breath chiff |
| `Saxophone` | Reedy, bright | Pulse (35% duty) with strong chiff |
| `Oboe` | Nasal, penetrating | Narrow pulse (25% duty) with prominent chiff |

## Brass

| Class | Character | Voice |
|-------|-----------|-------|
| `Trumpet` | Bright, piercing | 16-harmonic additive with sharp attack |
| `FrenchHorn` | Mellow, round | Trumpet-like with slower attack |
| `Trombone` | Full-bodied | Sawtooth-based brass |

## Percussion / mallet

| Class | Character | Voice |
|-------|-----------|-------|
| `Marimba` | Wooden, resonant | Three sine partials at inharmonic ratios (1 : 3.93 : 9.76) |
| `HiHat` | Metallic noise | White noise burst with fast decay |

## Electronic

| Class | Character | Voice |
|-------|-----------|-------|
| `SynthLead` | 80s polysynth | Detuned sawtooth pair + sub-octave square |

## Organ

`Organ` is its own full-featured class. See [organ.md](organ.md).
