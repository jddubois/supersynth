# The church organ

`synth.organ()` gives a real church organ: the **Bureå Church organ** (Nils Hammarberg, 1967,
Sweden), every pipe of 40 stops analysed from Lars Palo's GrandOrgue sample set (CC BY-SA). Pipes
keep their own tuning and voicing, stops keep their natural balance, and the pipes carry the
church acoustic they were recorded in.

```ts
const organ = synth.organ({ registration: 'plenum', tremulant: false });

organ.great.play(['C4', 'E4', 'G4'], { duration: 4 });
organ.pedal.play('C2', { duration: 4 });
organ.swell.noteOn('G4'); organ.swell.noteOff('G4', { delay: 1 });

organ.great.pull("Trumpet 8'");     // works while notes are held
organ.great.push("Mixture V");
organ.great.drawn;                  // stops currently drawn
organ.couple('swell>great');        // play the swell from the great
organ.couple('great>pedal', false);
organ.swell.expression(0.5);        // swell pedal
organ.tremulant(true);
organ.useRegistration('celeste');
```

Divisions: `great`, `swell`, `positive`, `pedal` (each a `Division` with `play`, `noteOn`,
`noteOff`, `pull`, `push`, `clear`, `stops`, `drawn`, `expression`). `new ChurchOrgan()` creates
an organ with its own engine.

## A second organ: the VCSL church organ

```ts
const organ = synth.organ({ instrument: 'vcsl', registration: 'full' });
organ.great.play(['C4', 'E4', 'G4'], { duration: 3 });
organ.useRegistration('chamber');            // the Renaissance chamber organ (8' + 4')
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

Registrations: `full`, `flutes`, `chamber`, `chamber-8`, `dialogue` (full great against
flutes on the swell). The rest of this page describes the Bureå organ (the default).

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

## Registrations

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
