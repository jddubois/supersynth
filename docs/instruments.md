# Instruments

Every instrument is a spectral model analysed from real recordings (see NOTICE.md).
Add one with `synth.add(id, { preset })`. Aliases are accepted wherever an id is.

## Keyboards

### `grand-piano` — Concert Grand Piano

Steinway model B, three dynamic layers, with real hammer attacks, string stiffness, damper and sympathetic resonances.

Aliases: `piano`, `grand`, `steinway`. Suggested room: `hall`.

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

Aliases: `upright`. Suggested room: `room`.

| Preset | Description |
|---|---|
| `default` | As recorded |
| `vintage` | Older instrument: duller, slightly out of tune |
| `honky-tonk` | Bar-room detuned upright |
| `dry` | Close-miked, almost no room |

### `harpsichord` — Harpsichord

French double-manual harpsichord, plucked attack transients from the real instrument.

Suggested room: `chamber`.

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

Aliases: `church-organ`. Suggested room: `church`.

| Preset | Description |
|---|---|
| `default` | Full swell |
| `soft` | Soft flutes |
| `with-pedal` | Manual plus 16' pedal below C3 |
| `cathedral` | In a vast cathedral |

### `chamber-organ` — Renaissance Chamber Organ

A small Renaissance-style positive organ: sweet wooden flutes.

Aliases: `positive-organ`. Suggested room: `chamber`.

| Preset | Description |
|---|---|
| `default` | 8' flute |
| `4ft` | 4' flute alone |
| `8-4` | 8' + 4' |
| `full` | Full organ |

## Strings

### `harp` — Concert Harp

Pedal harp with real pluck transients; notes ring until they decay.

Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |
| `warm` | Plucked closer to the middle of the string |
| `pres-de-la-table` | Plucked near the soundboard: metallic, guitar-like |
| `hall` | In a concert hall |

### `violin-pizzicato` — Violin Pizzicato

Plucked solo violin.

Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |
| `dry` | Close-miked, almost no room |

### `cello-pizzicato` — Cello Section Pizzicato

Plucked cello section.

Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |
| `dry` | Close-miked, almost no room |

### `contrabass-pizzicato` — Contrabass Pizzicato

Plucked double bass — also a lovely jazz walking bass.

Aliases: `upright-bass`, `jazz-bass`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |
| `jazz` | Dry jazz-club bass |

### `violin` — Solo Violin

Solo violin with natural vibrato.

Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |
| `senza-vibrato` | Straight tone, no vibrato (baroque style) |
| `expressive` | Wider romantic vibrato |
| `intimate` | Close and dry |

### `violins` — Violin Section

Orchestral first violins.

Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |
| `lush` | Bigger, wider section |
| `soft` | Gentle, slow bow attack |

### `violas` — Viola Section

Orchestral violas.

Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |
| `soft` | Slow bow attack |

### `cellos` — Cello Section

Orchestral cellos with vibrato.

Aliases: `cello`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |
| `soft` | Slow bow attack |

### `contrabass` — Contrabass

Double bass, bowed.

Aliases: `double-bass`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |

### `strings` — String Orchestra

Full string section split across the keyboard: basses, cellos, violas and violins.

Aliases: `string-ensemble`, `orchestra-strings`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | Divisi across the keyboard |
| `octaves` | Violins doubled by cellos an octave below (classic film voicing) |
| `lush` | Wider and softer |

## Woodwinds

### `flute` — Flute

Concert flute, straight tone.

Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | Straight tone |
| `vibrato` | With natural flute vibrato |
| `breathy` | More air in the tone |
| `piccolo` | Piccolo |

### `oboe` — Oboe

Oboe.

Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |
| `vibrato` | Light vibrato |

### `clarinet` — Clarinet

B♭ clarinet.

Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |
| `dark` | Dark, covered tone |

### `bassoon` — Bassoon

Bassoon.

Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |

### `tenor-sax` — Tenor Saxophone

Tenor saxophone, straight tone.

Aliases: `sax`, `saxophone`. Suggested room: `room`.

| Preset | Description |
|---|---|
| `default` | Straight tone |
| `jazz` | Jazz ballad: breathy with vibrato |
| `bright` | Edgy rock tone |

## Brass

### `trumpet` — Trumpet

B♭ trumpet.

Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | Open |
| `muted` | Straight mute |
| `vibrato` | Lyrical vibrato |

### `french-horn` — French Horn

Horn in F.

Aliases: `horn`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |
| `distant` | Distant, at the back of the hall |

### `trombone` — Trombone

Tenor trombone.

Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |

### `tuba` — Tuba

Tuba.

Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |

### `brass` — Brass Section

Tuba, trombone, horn and trumpet split across the keyboard.

Aliases: `brass-section`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |

## Mallets & bells

### `marimba` — Marimba

Rosewood marimba.

Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |
| `soft` | Yarn mallets |

### `vibraphone` — Vibraphone

Vibraphone with hard mallets; note-off engages the damper pedal behaviour.

Aliases: `vibes`. Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |
| `let-ring` | Pedal down: notes ring |

### `xylophone` — Xylophone

Xylophone.

Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |

### `glockenspiel` — Glockenspiel

Glockenspiel.

Suggested room: `hall`.

| Preset | Description |
|---|---|
| `default` | As recorded |

### `tubular-bells` — Tubular Bells

Orchestral chimes.

Aliases: `chimes`. Suggested room: `church`.

| Preset | Description |
|---|---|
| `default` | As recorded |

The full church organ is not a single instrument but an `Organ` with four divisions — see [organ.md](organ.md).
