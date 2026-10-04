# The church organ

`synth.organ()` gives a real church organ: the **Bureå Church organ** (Nils Hammarberg, 1967,
Sweden), every pipe of 40 stops analysed from Lars Palo's GrandOrgue sample set (CC BY-SA). Pipes
keep their own tuning and voicing, stops keep their natural balance, and the pipes carry the
church acoustic they were recorded in.

```ts
const organ = synth.organ({ preset: 'plenum' });

organ.great.play(['C4', 'E4', 'G4'], { duration: 4 });
organ.pedal.play('C2', { duration: 4 });
organ.swell.noteOn('G4'); organ.swell.noteOff('G4', { delay: 1 });

organ.great.pull("Trumpet 8'");     // works while notes are held
organ.great.push('Mixture V');
organ.great.set("Principal 8'", "Octave 4'");   // exactly these stops
organ.great.drawn();                // stops currently drawn
organ.great.couple('swell');        // Swell to Great: the great also plays the swell
organ.pedal.uncouple('great');
organ.swell.expression(0.5);        // swell pedal
organ.tremulant(true);
```

Stops are named as on the stop knob (`"Trumpet 8'"`, case-insensitive) or by id
(`'great-trumpet-8'`). Divisions: `great`, `swell`, `positive`, `pedal`, each a `Division`:

| | |
|---|---|
| `play`, `sequence`, `noteOn`, `noteOff` | playing (organs are not velocity sensitive) |
| `pull(...stops)`, `push(...stops)`, `set(...stops)` | draw, retire, draw exactly these (`set()` silences) |
| `couple(...divisions)`, `uncouple(...divisions)` | couplers to this keyboard (`uncouple()` releases all) |
| `stops()`, `drawn()`, `coupled()` | the division's stops, those drawn, the divisions coupled to it |
| `expression(0–1)` | swell pedal (shutters on the swell, volume elsewhere) |

Couplers live in the engine, so they act on every note: from the API, a MIDI keyboard or a MIDI
file. A pipe reached from two keyboards at once sounds once, until both keys are up. As on a
real organ they are not transitive: with Swell to Great and Great to Pedal, the pedal plays the
great's stops but not the swell's.

## Presets

A preset (registration) is the stops of each division and the couplers. Apply one by name or
as an object; it replaces everything drawn, and divisions it leaves out fall silent:

```ts
organ.preset('celeste');
organ.preset({
  great: ["Principal 8'", "Trumpet 8'"],
  swell: ["Rohrflöte 8'", "Hohlflöte 4'"],
  pedal: ["Subbass 16'"],
  couple: { pedal: ['swell'] },     // keyboard played → divisions it also sounds
});

organ.savePreset('solo');           // remember what is drawn now (like a combination piston)
organ.preset('plenum').preset('solo');
organ.current();                    // what is drawn now, as a preset object
organ.presets();                    // all presets by name: the organ's own and yours
organ.activePreset();               // 'solo', or undefined once a stop was changed by hand

// presets of your own from the start
synth.organ({ presets: { solo: { great: ["Trumpet 8'"], pedal: ["Subbass 16'"] } }, preset: 'solo' });
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
of `organ.presets()`; `false` ignores program changes). MIDI files play an organ with
`synth.renderMidi(file, { channels: { 1: organ.great, 2: organ.pedal } })`.

`new ChurchOrgan({ preset })` creates an organ with its own engine.

## A second organ: the VCSL church organ

```ts
const organ = synth.organ('vcsl');                  // or { instrument: 'vcsl', preset: 'full' }
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

## Organs are configuration

Each organ is a plain `OrganDef` object: its stops, named presets, the placement of its
divisions (stereo position, which one stands in a swell box), its tremulant, wind and reverb.
The built-in organs are exported as `BUREA_ORGAN` and `VCSL_ORGAN` (from `supersynth` and from
`supersynth/organs`), and `instrument` accepts an id or any `OrganDef`:

```ts
import { BUREA_ORGAN, type OrganDef } from 'supersynth/organs';

synth.organ({ instrument: BUREA_ORGAN });          // same as instrument: 'burea'

// your own presets, a tremulant on the positive, a steadier wind
const mine: OrganDef = {
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
const organ = synth.organ({ instrument: mine, preset: 'flute-solo' });

// or a small organ from a few of the recorded stops
const box: OrganDef = {
  id: 'box', name: 'Box organ', description: 'Two Bureå flutes',
  stops: BUREA_ORGAN.stops.filter((s) => ['great-gedackt-8', 'pedal-subbass-16'].includes(s.id)),
  presets: { soft: { description: 'Gedackt and Subbass', great: ["Gedackt 8'"], pedal: ["Subbass 16'"] } },
  defaultPreset: 'soft',
};
```

A stop plays the model `organ/<id>` (or its `model`), transposed by `transpose` semitones from
the key. Optional fields default to `CHURCH_DIVISIONS` (great centre, swell right in its swell
box, positive left, pedal centre), `SWELL_TREMULANT` and `ORGAN_DEFAULTS`. The rest of this page
describes the Bureå organ (the default).

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
