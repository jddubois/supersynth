# Instruments

Every instrument is a spectral model analysed from real recordings (see NOTICE.md).
Add one with `synth.add(id, { preset })`; `INSTRUMENTS` holds them all, by id.

Every instrument is also a plain configuration object (`InstrumentDefinition`) exported under the name
shown with it, from `supersynth` and from `supersynth/instruments`. Pass it to `synth.add`, or
copy and change it:

```ts
import { GRAND_PIANO } from 'supersynth/instruments';
synth.add({ ...GRAND_PIANO, id: 'dark-piano', parameters: { brightness: -1.5 } });
```

## Keyboards

### `grand-piano` — Concert Grand Piano

Steinway model B, three dynamic layers, with real hammer attacks, string stiffness, damper and sympathetic resonances.

Config: `GRAND_PIANO`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |
| `bright` | Harder hammers, pop/rock piano |
| `mellow` | Soft hammers, warm and dark |
| `felt` | Felt-muffled "una corda" intimate piano |
| `concert` | Concert hall perspective |
| `studio` | Close studio miking |
| `honky-tonk` | Detuned saloon piano (two mistuned strings) |
| `long-sustain` | Longer ringing notes |

### `upright-piano` — Upright Piano

Yamaha upright: intimate, a little brighter and boxier than the grand.

Config: `UPRIGHT_PIANO`. Suggested room: `room`.

| Preset | Description |
|---|---|
| `default` | As recorded |
| `vintage` | Older instrument: duller, slightly out of tune |
| `honky-tonk` | Bar-room detuned upright |
| `dry` | Close-miked, almost no room |

### `harpsichord` — Harpsichord

French double-manual harpsichord, plucked attack transients from the real instrument.

Config: `HARPSICHORD`. Suggested room: `chamber`.

| Preset | Description |
|---|---|
| `default` | Single 8' choir |
| `8-4` | 8' + 4' (brilliant, octave coupled) |
| `lute` | Buff/lute stop: muted, short and soft |
| `flemish` | Flemish harpsichord (8') |
| `hall` | In a concert hall |

## Organs

### `pipe-organ` — Pipe Organ (full)

A church organ with a full registration, recorded in its building.

Config: `PIPE_ORGAN`. Suggested room: `church`.

| Preset | Description |
|---|---|
| `default` | Full swell |
| `soft` | Soft flutes |
| `with-pedal` | Manual plus 16' pedal below C3 |
| `cathedral` | In a vast cathedral |

### `chamber-organ` — Renaissance Chamber Organ

A small Renaissance-style positive organ: sweet wooden flutes.

Config: `CHAMBER_ORGAN`. Suggested room: `chamber`.

| Preset | Description |
|---|---|
| `default` | 8' flute |
| `4ft` | 4' flute alone |
| `8-4` | 8' + 4' |
| `full` | Full organ |

## Strings

### `harp` — Concert Harp

Pedal harp with real pluck transients; notes ring until they decay.

Config: `HARP`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |
| `warm` | Plucked closer to the middle of the string |
| `pres-de-la-table` | Plucked near the soundboard: metallic, guitar-like |
| `hall` | In a concert hall |

### `violin-pizzicato` — Violin Pizzicato

Plucked solo violin.

Config: `VIOLIN_PIZZICATO`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |
| `dry` | Close-miked, almost no room |

### `cello-pizzicato` — Cello Section Pizzicato

Plucked cello section.

Config: `CELLO_PIZZICATO`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |
| `dry` | Close-miked, almost no room |

### `contrabass-pizzicato` — Contrabass Pizzicato

Plucked double bass — also a lovely jazz walking bass.

Config: `CONTRABASS_PIZZICATO`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |
| `jazz` | Dry jazz-club bass |

### `violin` — Solo Violin

Solo violin with natural vibrato.

Config: `VIOLIN`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `legato` | Slurred melody: notes connect without re-attacking |
| `default` | As recorded |
| `senza-vibrato` | Straight tone, no vibrato (baroque style) |
| `expressive` | Wider romantic vibrato |
| `intimate` | Close and dry |

### `violins` — Violin Section

Orchestral first violins.

Config: `VIOLINS`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `legato` | Slurred melody: notes connect without re-attacking |
| `default` | As recorded |
| `lush` | Bigger, wider section |
| `soft` | Gentle, slow bow attack |

### `violas` — Viola Section

Orchestral violas.

Config: `VIOLAS`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `legato` | Slurred melody: notes connect without re-attacking |
| `default` | As recorded |
| `soft` | Slow bow attack |

### `cellos` — Cello Section

Orchestral cellos with vibrato.

Config: `CELLOS`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `legato` | Slurred melody: notes connect without re-attacking |
| `default` | As recorded |
| `soft` | Slow bow attack |

### `contrabass` — Contrabass

Double bass, bowed.

Config: `CONTRABASS`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `legato` | Slurred melody: notes connect without re-attacking |
| `default` | As recorded |

### `strings` — String Orchestra

Full string section split across the keyboard: basses, cellos, violas and violins.

Config: `STRINGS`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | Divisi across the keyboard |
| `octaves` | Violins doubled by cellos an octave below (classic film voicing) |
| `lush` | Wider and softer |

## Woodwinds

### `flute` — Flute

Concert flute, straight tone.

Config: `FLUTE`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `legato` | Slurred melody: notes connect without re-attacking |
| `default` | Straight tone |
| `vibrato` | With natural flute vibrato |
| `breathy` | More air in the tone |
| `piccolo` | Piccolo |

### `oboe` — Oboe

Oboe.

Config: `OBOE`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `legato` | Slurred melody: notes connect without re-attacking |
| `default` | As recorded |
| `vibrato` | Light vibrato |

### `clarinet` — Clarinet

B♭ clarinet.

Config: `CLARINET`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `legato` | Slurred melody: notes connect without re-attacking |
| `default` | As recorded |
| `dark` | Dark, covered tone |

### `bassoon` — Bassoon

Bassoon.

Config: `BASSOON`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `legato` | Slurred melody: notes connect without re-attacking |
| `default` | As recorded |

### `tenor-sax` — Tenor Saxophone

Tenor saxophone, straight tone.

Config: `TENOR_SAX`. Suggested room: `room`.

| Preset | Description |
|---|---|
| `legato` | Slurred melody: notes connect without re-attacking |
| `default` | Straight tone |
| `jazz` | Jazz ballad: breathy with vibrato |
| `bright` | Edgy rock tone |

## Brass

### `trumpet` — Trumpet

B♭ trumpet.

Config: `TRUMPET`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `legato` | Slurred melody: notes connect without re-attacking |
| `default` | Open |
| `muted` | Straight mute |
| `vibrato` | Lyrical vibrato |

### `french-horn` — French Horn

Horn in F.

Config: `FRENCH_HORN`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `legato` | Slurred melody: notes connect without re-attacking |
| `default` | As recorded |
| `distant` | Distant, at the back of the hall |

### `trombone` — Trombone

Tenor trombone.

Config: `TROMBONE`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `legato` | Slurred melody: notes connect without re-attacking |
| `default` | As recorded |

### `tuba` — Tuba

Tuba.

Config: `TUBA`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `legato` | Slurred melody: notes connect without re-attacking |
| `default` | As recorded |

### `brass` — Brass Section

Tuba, trombone, horn and trumpet split across the keyboard.

Config: `BRASS`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |

## Mallets & bells

### `marimba` — Marimba

Rosewood marimba.

Config: `MARIMBA`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |
| `soft` | Yarn mallets |

### `vibraphone` — Vibraphone

Vibraphone with hard mallets; note-off engages the damper pedal behaviour.

Config: `VIBRAPHONE`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |
| `let-ring` | Pedal down: notes ring |
| `motor` | Motor on: the classic vibraphone pulse |

### `xylophone` — Xylophone

Xylophone.

Config: `XYLOPHONE`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |

### `glockenspiel` — Glockenspiel

Glockenspiel.

Config: `GLOCKENSPIEL`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |

### `tubular-bells` — Tubular Bells

Orchestral chimes.

Config: `TUBULAR_BELLS`. Suggested room: `church`.

| Preset | Description |
|---|---|
| `default` | As recorded |

The church organs (`synth.add('burea')`, …) have four divisions with drawable stops — see [organ.md](organ.md).
