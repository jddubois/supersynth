# The church organ

`synth.add('burea')` adds a real church organ: the **Bureå Church organ** (Nils Hammarberg,
1967, Sweden), every pipe of 40 stops analysed from Lars Palo's GrandOrgue sample set (CC BY-SA).
Pipes keep their own tuning and voicing, stops keep their natural balance, and the pipes carry
the church acoustic they were recorded in.

```ts
const organ = synth.add('burea', { preset: 'plenum' });

organ.great.play(['C4', 'E4', 'G4'], { duration: 4 });
organ.pedal.play('C2', { duration: 4 });
organ.swell.noteOn('G4'); organ.swell.noteOff('G4', { delay: 1 });

organ.great.pull("Trumpet 8'");                 // works while notes are held
organ.great.push(['Mixture V', "Octave 2'"]);
organ.great.set({ stops: ["Principal 8'", "Octave 4'"] });   // exactly these stops
organ.great.drawn();                            // the stops drawn
organ.great.couple('swell');                    // Swell to Great: the great also plays the swell
organ.great.couple({ division: 'swell', octave: 1 });   // Swell to Great 4' (an octave up)
organ.swell.couple({ division: 'swell', octave: -1 });  // the swell's sub octave
organ.swell.unison(false);                      // unison off: only the octave couplers sound
organ.pedal.uncouple('great');
organ.swell.expression(0.5);                    // swell pedal
organ.set({ tremulant: true });                 // every tremulant; or { swell: true }
organ.set({ noises: true });                    // blower, room, key and stop action
```

Stops are named as on the stop knob (`"Trumpet 8'"`, case-insensitive) or by id
(`'great-trumpet-8'`). The divisions `great`, `swell`, `positive` and `pedal` are each a
`Division`, which is `Playable` like an instrument:

| Division | |
|---|---|
| `play`, `sequence`, `noteOn`, `noteOff`, `allNotesOff` | playing (organs are not velocity sensitive) |
| `expression(0–1)` | swell pedal (shutters on the swell, volume elsewhere) |
| `pull(stop \| stops)`, `push(stop \| stops)` | draw, retire |
| `couple(coupler \| couplers)`, `uncouple(coupler \| couplers)` | couplers to this keyboard: a division (`'swell'`), or `{ division, octave: 1 \| -1 }` for 4' and 16' couplers |
| `unison(on)` | unison off: the keys play only what is coupled to them |
| `forte(on)` | a harmonium's Forte: stops with a forte recording play it |
| `set({ stops, couple, unison, forte })` | replace the stops drawn and/or the couplers as a whole (`[]` for none) |
| `stops()`, `drawn()`, `coupled()`, `unisonOn()`, `forteIsOn()` | the division's stops, those drawn, its couplers |

| Organ | |
|---|---|
| `great`, `swell`, `positive`, `pedal`, `divisions()`, `division(name)` | the keyboards |
| `preset(name \| preset)`, `presets()`, `savePreset(name, preset?)`, `current()`, `activePreset()` | presets, as on an instrument |
| `set({ tremulant, wind, noises })` | the tremulants (`true`, or by division: `{ swell: true }`); how much the wind sags when many pipes start (0 steady – 1 flexible); the machinery noises |
| `tremulants()`, `noisesOn()` | the tremulants and whether each is on; which noises are on (`{ blower, ambient, action }`) |
| `midi(channels, { presets })` | play it from MIDI keyboards |
| `allNotesOff()`, `stops()`, `definition` | |

Every change takes `{ at }` or `{ delay }` last, like a note, so registration changes can be
scheduled with the music: `organ.preset('full', { at: 30 })`, `organ.swell.pull("Schalmei 8'", { at: 12.5 })`.

Couplers live in the engine, so they act on every note: from the API, a MIDI keyboard or a MIDI
file. A pipe reached from two keyboards (or, through an octave coupler, two keys) at once sounds
once, until both keys are up. As on a real organ they are not transitive: with Swell to Great
and Great to Pedal, the pedal plays the great's stops but not the swell's.

Pipes speak as recorded: each key's pipes start after a short random delay (`speech`, up to
10 ms, different for every pipe and note, as the tracker action and the pipe feet of a real
organ make them), so unison stops beat and blend instead of starting in lockstep. Where a sample
set recorded a pipe's release after short key presses too (most of Piotr Grabowski's do, after
0.1–0.6 s), a staccato note ends with that release: the room has not filled yet and the pipe
had not reached full speech.

## Noises

```ts
const organ = synth.add('friesach', { preset: 'principal-chorus', noises: true });
organ.set({ noises: { blower: false, ambient: false } });   // the action only
organ.set({ noises: false });
```

The organs whose sample sets recorded their machinery play it with `noises: true`: the blower
and the empty church while the organ is on, each key's action going down and coming up (on its
own keyboard only, not through couplers), and the stop knobs, couplers and tremulants as they
are drawn and retired. The noises are recorded with the pipes, at their real level (in some
churches the blower and the room are louder than a key's click: `noises: { blower: false,
ambient: false }` keeps only the action; `noises.gain` in a copied definition sets their level).

**CPU.** Each pipe sounding is a voice, and a released pipe stays a voice while its recorded
room tail dies away. Fast passages on large registrations of the big organs (Friesach,
Cracow) hold hundreds of voices at once: render them offline, or raise `maxVoices` and expect
to need a fast machine (not a Raspberry Pi) for live play. Short-press releases cost nothing
extra (a staccato note plays a shorter recorded tail instead of the long one). Noises add two
voices for the blower and the room and a short voice per key movement and stop change: leave
them off where CPU is tight.

**Live play.** The speech delay puts each pipe up to 10 ms after its key, as on a real organ:
playing live on a slow machine with audio buffering on top, set `speech: 0` (a copied
definition: `synth.add({ ...FRIESACH_ORGAN, speech: 0 })`) for the lowest latency and CPU (at
present each delayed pipe start also splits the engine's audio block).

## Presets

A preset (registration) is the stops of each division and the couplers (also: `unisonOff`, the
keyboards whose unison is off; `tremulant`, the divisions whose tremulant is on, left as they are
when absent; `forte`, a harmonium's divisions with the Forte on). Apply one by name or as an
object; it replaces everything drawn, and divisions it leaves out fall silent:

```ts
organ.preset('celeste');
organ.preset({
  great: ["Principal 8'", "Trumpet 8'"],
  swell: ["Rohrflöte 8'", "Hohlflöte 4'"],
  pedal: ["Subbass 16'"],
  couple: { pedal: ['swell'] },     // keyboard played → divisions it also sounds
});

organ.savePreset('solo');           // remember what is drawn now (like a combination piston)
organ.preset('plenum').preset('solo', { at: 20 });
organ.current();                    // what is drawn now, as a preset object
organ.presets();                    // all presets by name: the organ's own and yours
organ.activePreset();               // 'solo', or undefined once a stop was changed by hand

// presets of your own from the start
synth.add('burea', { presets: { solo: { great: ["Trumpet 8'"], pedal: ["Subbass 16'"] } }, preset: 'solo' });
```

## MIDI keyboards

```ts
await synth.enableMidi();
organ.midi();                                    // great 1, swell 2, positive 3, pedal 4
organ.midi({ great: 1, swell: 2, pedal: 3 }, { presets: ['flutes', 'principal-chorus', 'plenum', 'full'] });
```

Each division plays its MIDI channel straight in the engine (no JavaScript in the note path),
couplers included; CC 11 on a division's channel is its swell pedal. Program change *n* on any of
the organ's channels selects the *n*-th preset of `presets` (default: all presets, in the order
of `organ.presets()`; `false` ignores program changes). Calling `midi()` again replaces the
organ's channels. MIDI files play an organ with
`synth.renderMidi(file, { channels: { 1: organ.great, 2: organ.pedal } })`.

## A second organ: the VCSL church organ

```ts
const organ = synth.add('vcsl', { preset: 'full' });
organ.great.play(['C4', 'E4', 'G4'], { duration: 3 });
organ.preset('chamber');                         // the Renaissance chamber organ (8' + 4')
organ.positive.play(['G4', 'B4', 'D5'], { duration: 3 });
```

A church organ recorded in stereo with its room (Simon Dalzell / Ivy Audio, through the
Versilian Community Sample Library, CC0), with a Renaissance chamber organ as positive. Its
stops are recorded registrations rather than single ranks, and every third semitone is recorded
(the notes between are morphed from their neighbours).

| Division | Stops |
|---|---|
| great, swell | Full Organ, Flutes |
| positive | Gedackt 8', Principal 4', Chorus (Renaissance chamber organ) |
| pedal | Pedal 16' + 8', Soft Bass 16' |

Presets: `full`, `flutes`, `chamber`, `chamber-8`, `dialogue` (full great against
flutes on the swell).

## Piotr Grabowski's organs

```ts
const organ = synth.add('friesach', { preset: 'grand-choeur' });
organ.great.play(['C4', 'E4', 'G4'], { duration: 4 });
organ.preset('cornet');
```

Fifteen more organs, every one Piotr Grabowski gives away free at
[piotrgrabowski.pl](https://piotrgrabowski.pl/instruments/), each stop analysed from his sample
set as his organ definition plays it: Friesach (Eisenbarth 2000, 44 stops), Cracow St. John
Cantius (Siedlar 2004), Szczecinek (Voelkner 1908), Lipiny, Skrzatusz (Sauer 1876), Raszczyce
(Vermeulen 1965), Długa Kościelna, Giubiasco and Azzio (Mascioni), Strassburg (Werner 1743),
Melcer Chamber Music Hall (Walcker 1993), Saint-Jean-de-Luz (Gonzalez 1931), Lędziny, the Green
Positiv and a two-manual Harmonium (Emil Müller). They keep their own pitch (Azzio sounds at
a ≈ 420 Hz, the Green Positiv a semitone low), their borrowed and extended ranks, and the
balance between their stops, their releases after short key presses, their swell boxes and
tremulants as defined for GrandOrgue, and their recorded machinery noises. Stops, presets and
ids of every organ:
[piotr-organs.md](piotr-organs.md). These models are not covered by the MIT license — see
NOTICE.md.

## Organs are configuration

Each organ is a plain `OrganDefinition` object: its stops, named presets, the placement of its
divisions (stereo position, which one stands in a swell box and how far it closes), its
tremulants, wind, speech, noises and reverb.
The built-in organs are `ORGANS.burea` (`BUREA_ORGAN`) and `ORGANS.vcsl` (`VCSL_ORGAN`), exported
from `supersynth` and from `supersynth/organs`; `synth.add` takes an id or any `OrganDefinition`:

```ts
import { BUREA_ORGAN, type OrganDefinition } from 'supersynth/organs';

synth.add(BUREA_ORGAN);                          // same as synth.add('burea')

// your own presets, a tremulant on the positive, a steadier wind
const mine: OrganDefinition = {
  ...BUREA_ORGAN,
  id: 'burea-mine',
  presets: {
    ...BUREA_ORGAN.presets,
    'flute-solo': {
      description: 'Rohrflöte 8 + Waldflöte 2 against soft flutes',
      swell: ["Rohrflöte 8'", "Waldflöte 2'"],
      great: ["Gedackt 8'"],
      pedal: ["Subbass 16'"],
    },
  },
  tremulant: { division: 'positive', depth: 2, pitch: 6, rate: 5.5 },
  wind: 0.2,
};
const organ = synth.add(mine, { preset: 'flute-solo' });

// or a small organ from a few of the recorded stops
const box: OrganDefinition = {
  id: 'box', name: 'Box organ', description: 'Two Bureå flutes',
  stops: BUREA_ORGAN.stops.filter((s) => ['great-gedackt-8', 'pedal-subbass-16'].includes(s.id)),
  presets: { soft: { description: 'Gedackt and Subbass', great: ["Gedackt 8'"], pedal: ["Subbass 16'"] } },
  defaultPreset: 'soft',
};
```

A stop plays the model `organ/<id>` (or its `model`), transposed by `transpose` semitones from
the key, on the keys `keys: [low, high]` (default: all; e.g. a treble Cornet), and with the
division's Forte on its `forte` model. A division's `swellBox` is `true` or
`{ closed: -6, shelf: -9 }` (level and treble damping in dB with the shutters closed; the
default box closes to −9 dB and −14 dB above ~700 Hz). `tremulant` is one tremulant or a list,
each on a division or several (`{ division: ['great', 'pedal'], depth, pitch, rate }`).
Optional fields default to `CHURCH_DIVISIONS` (great centre, swell right in its swell box,
positive left, pedal centre), `SWELL_TREMULANT` and `ORGAN_DEFAULTS`. The rest of this page
describes the Bureå organ.

## Stops

### Great

| Stop | Family |
|---|---|
| Principal 8' | principal |
| Gedackt 8' | flute |
| Hohlflöte 8' | flute |
| Octave 4' | principal |
| Rohrflöte 4' | flute |
| Octave 2' | principal |
| Sesquialtera II | mixture |
| Mixture V | mixture |
| Trumpet 8' | reed |

### Swell

| Stop | Family |
|---|---|
| Rohrflöte 8' | flute |
| Salicional 8' | string |
| Voix céleste 8' | string |
| Principal 4' | principal |
| Hohlflöte 4' | flute |
| Gemshorn 4' | principal |
| Waldflöte 2' | flute |
| Terz 1 3/5' | mutation |
| Nasat 1 1/3' | mutation |
| Septime 1 1/7' | mutation |
| Scharf III | mixture |
| Schalmei 8' | reed |

### Positive

| Stop | Family |
|---|---|
| Gedackt 8' | flute |
| Quintadena 8' | flute |
| Koppelflöte 4' | flute |
| Rohrquinte 2 2/3' | mutation |
| Principal 2' | principal |
| Flötlein 2' | flute |
| Octave 1' | principal |
| Sifflöte 1' | flute |
| Cymbel II | mixture |
| Krummhorn 8' | reed |

### Pedal

| Stop | Family |
|---|---|
| Subbass 16' | flute |
| Violon 16' | string |
| Principal 8' | principal |
| Gedackt 8' | flute |
| Octave 4' | principal |
| Nachthorn 2' | flute |
| Rauschpfeife IV | mixture |
| Fagott 16' | reed |
| Trumpet 4' | reed |

## Bureå presets

| Name | Description |
|---|---|
| `principal` | Principal 8' alone — the foundation tone of the organ |
| `principal-chorus` | Principal chorus 8' 4' 2' (Baroque plenum without mixture) |
| `plenum` | Organo pleno for Bach preludes and fugues: principals and mixtures |
| `full` | Full organ with reeds and all manuals coupled |
| `flutes` | Flutes 8' + 4' — gentle, for chorale preludes |
| `flute-8` | Gedackt 8' — soft stopped flute |
| `cornet` | Cornet (8' 4' 2 2/3' 2' 1 3/5') — solo voice for ornamented melodies |
| `trumpet` | Trumpet 8' with Principal — festive solo |
| `krummhorn` | Krummhorn 8' — nasal Renaissance reed solo |
| `celeste` | Salicional + Voix céleste — shimmering strings for romantic music |
| `quiet-strings` | Salicional 8' alone |
| `sesquialtera-solo` | Sesquialtera solo with flutes — the classic Dutch/Scandinavian chorale cantus |
