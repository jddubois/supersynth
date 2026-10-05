# Piotr Grabowski's organs

Every organ that Piotr Grabowski gives away free at [piotrgrabowski.pl](https://piotrgrabowski.pl/instruments/),
analysed stop by stop like the Bureå organ (see [models.md](models.md)). Each stop is analysed from
the sample set's recordings **as its organ definition plays them**: each pipe's attack and sustain,
its release crossfaded in at key-up, the definition's retuning and level for every pipe, and
the borrowed, extended and retuned ranks exactly where the sample set places them. Stops keep the
organ's own pitch and temperament (an organ at Baroque or historic pitch sounds at that pitch),
the balance between stops, and the room the pipes were recorded in. Keys where a stop has no pipe
(a treble-only Cornet) stay silent. Sampled tremulants are measured from the pipes recorded with
the tremulant on.

```ts
const organ = synth.add('szczecinek', { preset: 'celeste' });
organ.swell.play(['C4', 'E4', 'G4'], { duration: 4 });
organ.preset('full');
```

Every organ is an `OrganDefinition` exported from `supersynth` and `supersynth/organs` (all of them also as
`PIOTR_ORGANS`). Sample sets © Piotr Grabowski; the models are not covered by the MIT license
and may not be sold or built into products for sale — see NOTICE.md.

| Id | Organ | Stops |
|---|---|---|
| `azzio` | Azzio | 12 |
| `cracow` | Cracow, St. John Cantius | 40 |
| `dluga-koscielna` | Długa Kościelna | 22 |
| `friesach` | Friesach, St. Bartholomäus | 44 |
| `giubiasco` | Giubiasco | 22 |
| `green-positiv` | Green Positiv | 5 |
| `harmonium` | Harmonium Emil Müller | 16 |
| `ledziny` | Lędziny, St. Clement | 11 |
| `lipiny` | Lipiny | 25 |
| `melcer` | Melcer Chamber Music Hall | 18 |
| `raszczyce` | Raszczyce | 21 |
| `saint-jean-de-luz` | Saint-Jean-de-Luz (chœur) | 16 |
| `skrzatusz` | Skrzatusz sanctuary | 19 |
| `strassburg` | Strassburg | 20 |
| `szczecinek` | Szczecinek | 35 |

## `azzio` — Azzio

Mascioni 2016, Azzio (Italy): 11 stops on two manuals and pedal in the Italian style, at a ≈ 420 Hz.

Config: `AZZIO_ORGAN`. Default preset: `ripieno`. Tremulant on the great.

**Great:** Principale 8', Flauto camino 8', Ottava 4', Sesquialtera 2 2/3', Sesquialtera II, Ripieno 3-4 file

**Positive:** Bordone 8', Flauto conico 4', Nazardo 3', Quintadecima 2'

**Pedal:** Subbasso 16', Trombone 16'

| Preset | Description |
|---|---|
| `principale` | Principale 8' alone |
| `ripieno` | Ripieno: Principale 8', Ottava 4' and the Ripieno |
| `full` | Full organ with both manuals coupled and the Trombone |
| `flutes` | Flauto camino 8' on the great, Bordone 8' + Flauto conico 4' on the positive |
| `flute-8` | Bordone 8' — soft stopped flute |
| `cornetto` | Cornet from the positive's flutes and mutations (8' 4' 2 2/3' 2') |
| `sesquialtera` | Sesquialtera solo on the great against the Bordone on the positive |

## `cracow` — Cracow, St. John Cantius

Jacek Siedlar 2004, St. John Cantius, Cracow (Poland): a French-symphonic organ, 40 stops on three manuals (the Récit enclosed) and pedal.

Config: `CRACOW_ORGAN`. Default preset: `fonds`. Tremulant on the swell. In a swell box: swell.

**Great:** Bourdon 16', Montre 8', Flûte Harmonique 8', Bourdon 8', Viole de Gambe 8', Prestant 4', Flûte douce 4', Doublette 2', Cornet 5x, Plein Jeu 5x, Trompette 8', Clairon 4'

**Swell:** Flûte Traversière 8', Bourdon 8', Aeoline 8', Voix Céleste 8', Flûte Octaviante 4', Fugara 4', Doublette 2', Harmonia Aethera 4x, Basson 16', Trompette Harmonique 8', Hautbois 8', Clairon 4'

**Positive:** Cor de Nuit 8', Salicional 8', Unda Maris 8', Clarinette 8', Prestant 4', Dolce 4', Nazard 2 2/3', Octavin 2', Tierce 1 3/5', Cromorne 8'

**Pedal:** Contrebasse 16', Soubasse 16', Octave 8', Violoncelle 8', Flûte 4', Bombarde 16'

| Preset | Description |
|---|---|
| `principal` | Montre 8' alone |
| `fonds` | Fonds de 8': the 8' foundations of all three manuals coupled |
| `plein-jeu` | Plein jeu: principals and Plein Jeu with the positive and récit coupled |
| `grand-choeur` | Grand chœur: full organ with the French reeds, Cornet and Bombarde |
| `flute-harmonique` | Flûte Harmonique 8' solo on the great against the positive's Cor de Nuit |
| `flutes` | Flûte Traversière 8' + Flûte Octaviante 4' on the récit |
| `cornet` | Cornet 5x solo on the great against the récit foundations |
| `jeu-de-tierce` | Jeu de tierce on the positive: Cor de Nuit 8', Dolce 4', Nazard, Octavin and Tierce |
| `celeste` | Aeoline + Voix Céleste — the récit's undulating strings |
| `hautbois` | Hautbois 8' solo on the récit against the great's Bourdon |
| `clarinette` | Clarinette 8' solo on the positive against the récit strings |
| `trompette` | Trompette Harmonique 8' solo on the récit with the great's foundations |

## `dluga-koscielna` — Długa Kościelna

Kamiński 2012, Długa Kościelna (Poland): 22 stops on two manuals and pedal, a principal chorus with Mixtura on the great and a flute-and-mutation positive with Krumhorn.

Config: `DLUGA_KOSCIELNA_ORGAN`. Default preset: `principal-chorus`. Tremulant on the positive.

**Great:** Pryncypał 8', Flet kryty 8', Viola di Gamba 8', Oktawa 4', Flet rurkowy 4', Oktawa 2', Mixtura 1 1/3'

**Positive:** Flauto amabile 8', Gemshorn 8', Flet otwarty 8', Pryncypał 4', Flet kryty 4', Nasard 2 2/3', Szpicflet 2', Tercja 1 3/5', Kwinta 1 1/3', Krumhorn 8'

**Pedal:** Subbass 16', Oktawbas 8', Flet kryty 8', Chorałbas 4', Fagot 16'

| Preset | Description |
|---|---|
| `principal` | Pryncypał 8' alone |
| `principal-chorus` | Principal chorus 8' 4' 2' on manual I |
| `plenum` | Plenum: principals and Mixtura with manual II coupled |
| `full` | Full organ with Krumhorn and Fagot |
| `foundations` | The 8' stops of both manuals coupled |
| `flutes` | Flet kryty 8' + Flet rurkowy 4' on manual I |
| `flute-8` | Flauto amabile 8' — the softest flute |
| `cornet` | Cornet from manual II's flutes and mutations (8' 4' 2 2/3' 2' 1 3/5') against manual I |
| `nasard` | Flet otwarty 8', Flet kryty 4' and Nasard 2 2/3' |
| `gamba` | Viola di Gamba 8' with the Flet kryty |
| `krumhorn` | Krumhorn 8' solo on manual II against manual I's flutes |

## `friesach` — Friesach, St. Bartholomäus

Eisenbarth 2000, St. Bartholomäus, Friesach (Austria): 44 stops on three manuals (Hauptwerk, Schwellwerk, a French Solowerk with Trompete en chamade) and pedal with Untersatz 32'.

Config: `FRIESACH_ORGAN`. Default preset: `principal-chorus`. Tremulant on the swell. In a swell box: swell.

**Great:** Praestant 16', Principal 8', Holzflöte 8', Röhrflöte 8', Gambe 8', Octave 4', Spitzflöte 4', Quinte 2 2/3', Octave 2', Mixtur major 4-5f. 2 2/3', Mixtur minor 4f. 1 1/3', Trompete 16', Trompete 8'

**Swell:** Bourdon 16', Principal 8', Nachthorn Gedackt 8', Corno dolce 8', Viola 8', Vox celeste 8', Geigenprincipal 4', Querflöte 4', Nazard 2 2/3', Flageolett 2', Tierce 1 3/5', Larigot 1 1/3', Plein Jeu 4-5f. 2', Scharff 4f. 1', Trompete harmonique 8', Hautbois 8', Clairon 4'

**Positive:** Jubalflöte 8', Trichterflöte 4', Cornet à pavillon 8', Trompete en chamade 8', Englischhorn 8'

**Pedal:** Untersatz 32', Contrabaß 16', Subbaß 16', Octavbaß 8', Gedackt 8', Choralbaß 4', Posaune 32', Posaune 16', Trompete 8'

| Preset | Description |
|---|---|
| `principal` | Principal 8' alone |
| `principal-chorus` | Principal chorus 16' 8' 4' 2' on the Hauptwerk |
| `plenum` | Organo pleno for Bach: Hauptwerk with both Mixturen, the Schwellwerk plenum coupled |
| `grand-choeur` | Grand chœur: reeds and mixtures of all manuals coupled (French Romantic tutti) |
| `fonds` | Fonds de 8': the 8' foundations of Hauptwerk and Schwellwerk coupled (Franck, Widor) |
| `flutes` | Nachthorn Gedackt 8' + Querflöte 4' on the Schwellwerk |
| `flute-8` | Nachthorn Gedackt 8' — soft stopped flute |
| `flute-harmonique` | Jubalflöte 8' + Trichterflöte 4' — the Solowerk's big flutes, accompanied by the Schwellwerk |
| `celeste` | Viola + Vox celeste 8' (from c) — the swell strings for Romantic music |
| `cornet-decompose` | Cornet décomposé on the Schwellwerk (8' 4' 2 2/3' 2' 1 3/5') against the Hauptwerk flutes |
| `cornet` | Cornet à pavillon solo (from g) against the Schwellwerk |
| `hautbois` | Hautbois 8' solo with Bourdon and Gedackt, against the Hauptwerk Holzflöte |
| `englischhorn` | Englischhorn 8' solo on the Solowerk against the Schwellwerk |
| `chamade` | Trompete en chamade 8' — the horizontal trumpet in fanfare against the full Hauptwerk |

## `giubiasco` — Giubiasco

Mascioni 2008, Giubiasco (Switzerland): 22 stops in the Italian style on Grande organo, Positivo tergale and pedal with Ripieno, Voce umana and Cornetto.

Config: `GIUBIASCO_ORGAN`. Default preset: `ripieno`. Tremulant on the positive.

**Great:** Principale 8', Viola da Gamba 8', Flauto a camino 8', Voce umana 8', Ottava 4', Flauto conico 4', Quintadecima 2', Cornetto 2 2/3', Ripieno 4 file, Violoncello 8'

**Positive:** Bordone 8', Flauto 4', Quinta 2 2/3', Principale 2', Terza 1 3/5', Larigot 1 1/3', Cimbalo 2 file, Regale 8'

**Pedal:** Subbasso 16', Flauto 8', Ottava 4', Contro Fagotto 16'

| Preset | Description |
|---|---|
| `principale` | Principale 8' alone |
| `ripieno` | Ripieno: Principale 8', Ottava 4', Quintadecima 2' and the Ripieno |
| `pleno` | Organo pleno: Ripieno on the great, Cimbalo on the positive, both coupled |
| `full` | Full organ with Cornetto, Regale and Contro Fagotto |
| `voce-umana` | Voce umana with the Principale 8' — the Italian beating principal |
| `strings` | Viola da Gamba 8' and Violoncello 8' with the Flauto a camino |
| `flutes` | Flauto a camino 8' + Flauto conico 4' on the great |
| `flute-8` | Bordone 8' — soft stopped flute |
| `cornetto` | Cornetto solo on the great (Flauto a camino 8', Flauto conico 4') against the positive's Bordone |
| `terza` | Positive flutes with Quinta and Terza (8' 4' 2 2/3' 2' 1 3/5') |
| `regale` | Regale 8' solo on the positive against the great's flutes |

## `green-positiv` — Green Positiv

Stanisław Pielczyk 2008, Katowice (Poland): a continuo positive, one manual, 5 stops from 3 ranks, at Baroque pitch (a semitone below A440).

Config: `GREEN_POSITIV_ORGAN`. Default preset: `continuo`.

**Great:** Flet kryty 8', Flet kryty 4', Pryncypał 4', Pryncypał 2', Kwinta 1 1/3'

| Preset | Description |
|---|---|
| `flute-8` | Flet kryty 8' alone — the soft stopped flute for continuo |
| `continuo` | Flet kryty 8' + 4' — continuo for a choir or an ensemble |
| `flute-2` | Flet kryty 8' with Pryncypał 2' — bright solo or continuo for a larger ensemble |
| `principal` | Flet kryty 8' with the principals 4' + 2' |
| `plenum` | The small plenum: 8' 4' 2' 1 1/3' |
| `full` | Every stop drawn |

## `harmonium` — Harmonium Emil Müller

Emil Müller, about 1920, Diocesan Music School, Gliwice (Poland): a two-manual harmonium with pedal; 5 registers, divided into bass and treble, each also with its forte.

Config: `HARMONIUM_ORGAN`. Default preset: `diapason`. Tremulant on the swell. In a swell box: great, swell, pedal.

**Great:** Diapason 8', Melodia 8', Diapason 8' Forte, Melodia 8' Forte, Viola 4', Flöte 4', Viola 4' Forte, Flöte 4' Forte

**Swell:** Dulcet 8', Flöte 8', Dulcet 8' Forte, Flöte 8' Forte, Vox Jubilante 8', Vox Jubilante 8' Forte

**Pedal:** Diapason 16', Diapason 16' Forte

| Preset | Description |
|---|---|
| `diapason` | Diapason + Melodia 8' — the full 8' voice of manual I |
| `soft` | Dulcet + Flöte 8' — the soft 8' of manual II |
| `celeste` | Flöte 8' with Vox Jubilante — the beating treble celeste |
| `8-4` | Manual I at 8' and 4' |
| `solo` | Melodia 8' Forte melody (treble) against the soft manual II |
| `full` | Every register, manual II coupled |
| `forte` | Every register with the forte mutes open |

## `ledziny` — Lędziny, St. Clement

Carl Volkmann 1888, St. Clement, Lędziny (Poland): a one-manual Romantic organ, 11 stops on manual and pedal.

Config: `LEDZINY_ORGAN`. Default preset: `foundations`.

**Great:** Principal 8', Salicet 8', Portunal-Flöte 8', Flaut major 8', Principal 4', Flauto traverse 4', Quinte 2 2/3' Octave 2', Mixtur 2 fach

**Pedal:** Subbaß 16', Principal baß 8', Violon Cello 8'

| Preset | Description |
|---|---|
| `principal` | Principal 8' alone |
| `foundations` | All the 8' stops — the warm Romantic foundation |
| `principal-chorus` | Principals 8' 4' with Quinte and Octave |
| `full` | Full organ: principals, flutes, Quinte, Octave and Mixtur |
| `flutes` | Flaut major 8' + Flauto traverse 4' |
| `flute-8` | Portunal-Flöte 8' — soft, for quiet accompaniment |
| `strings` | Salicet 8' with Violon Cello in the pedal |

## `lipiny` — Lipiny

Adolf Volkmann 1898, Lipiny, Świętochłowice (Poland): a Romantic organ, 25 stops on two manuals and pedal.

Config: `LIPINY_ORGAN`. Default preset: `foundations`.

**Great:** Bordun 16', Principal 8', Viola di Gamba 8', Gemshorn 8', Doppelröhrflöte 8', Octave 4', Doppelröhrflöte 4', Quinte 2 2/3', Octave 2', Cornett 3 Fach, Mixtur 4 Fach, Trompete 8'

**Positive:** Geigenprincipal 8', Salicet 8', Flaut Major 8', Portunal Flaut 8', Viol-Principal 4', Portunal Flaut 4'

**Pedal:** Principalbaß 16', Violonbaß 16', Subbaß 16', Octavbaß 8', Flautbaß 8', Octave 4', Posaune 16'

| Preset | Description |
|---|---|
| `principal` | Principal 8' alone |
| `foundations` | The 8' stops of both manuals coupled — the Romantic fonds |
| `principal-chorus` | Principal chorus 8' 4' 2' |
| `plenum` | Plenum: principals, Quinte and Mixtur on Bordun 16' |
| `full` | Full organ with Cornett, Trompete and Posaune |
| `flutes` | Doppelröhrflöte 8' + 4' on the great |
| `flute-8` | Portunal Flaut 8' — soft flute on the positive |
| `soft-flutes` | Portunal Flaut 8' + 4' on the positive |
| `strings` | Salicet 8' with Flaut Major — the soft strings of the positive |
| `cornet` | Cornett solo on the great against the positive |
| `trumpet` | Trompete 8' with Principal 8' — festive solo |

## `melcer` — Melcer Chamber Music Hall

Walcker 1993, Melcer Chamber Music Hall, Warsaw (Poland): 18 stops on two manuals (the Brustwerk enclosed) and pedal, in a concert hall.

Config: `MELCER_ORGAN`. Default preset: `principal-chorus`. Tremulant on the swell. In a swell box: swell.

**Great:** Nachthorn 8', Prinzipal 4', Nasard 2 2/3', Oktave 2', Mixtur 1 1/3' 4f, Trompete 8'

**Swell:** Gedackt 8', Quintatön 8', Rohrflöte 4', Prinzipal 2', Quinte 1 1/3', Sifflöte 1', Krumhorn 8'

**Pedal:** Subbass 16', Gedacktbass 8', Choralbas 4', Oktave 2', Trompete 8'

| Preset | Description |
|---|---|
| `principal-chorus` | Nachthorn 8' with the principals 4' + 2' |
| `plenum` | Organo pleno: the Hauptwerk chorus with Mixtur, the Brustwerk coupled |
| `full` | Full organ with the Trompeten and Krumhorn |
| `flutes` | Gedackt 8' + Rohrflöte 4' on the Brustwerk |
| `flute-8` | Gedackt 8' — soft stopped flute |
| `nasard` | Nachthorn 8', Prinzipal 4' and Nasard 2 2/3' — a solo voice against the Gedackt |
| `sifflote` | Gedackt 8' + Sifflöte 1' — the gapped Baroque registration |
| `krumhorn` | Krumhorn 8' solo on the Brustwerk against the Nachthorn |
| `trumpet` | Trompete 8' with Prinzipal 4' — festive solo |

## `raszczyce` — Raszczyce

Vermeulen (Alkmaar) 1965, Raszczyce (Poland): a Dutch neo-Baroque organ, 21 stops on Hoofdwerk, Rugwerk and pedal.

Config: `RASZCZYCE_ORGAN`. Default preset: `principal-chorus`.

**Great:** Prestant 8', Roerfluit 8', Octaaf 4', Gedekt fluit 4', Nasard 2 2/3', Woudfluit 2', Sesquialter II, Mixtuur IV, Trompet 8'

**Positive:** Holpijp 8', Prestant 4', Roerfluit 4', Octaaf 2', Scherp IV, Cymbel III, Kromhoorn 8'

**Pedal:** Subbas 16', Prestant 8', Gedekt 8', Octaaf 4', Fagot 16'

| Preset | Description |
|---|---|
| `prestant` | Prestant 8' alone |
| `principal-chorus` | Principal chorus 8' 4' on the Hoofdwerk, 4' 2' on the Rugwerk |
| `plenum` | Organo pleno: Hoofdwerk Mixtuur, Rugwerk Scherp, both coupled |
| `full` | Full organ with Trompet, Kromhoorn, Cymbel and Fagot |
| `flutes` | Roerfluit 8' + Gedekt fluit 4' on the Hoofdwerk |
| `flute-8` | Holpijp 8' — the Rugwerk's soft flute |
| `cornet` | Sesquialter with flutes (8' 4' 2 2/3' 2' 1 3/5') against the Rugwerk |
| `nasard` | Roerfluit 8', Gedekt fluit 4' and Nasard 2 2/3' |
| `kromhoorn` | Kromhoorn 8' solo on the Rugwerk against the Hoofdwerk flutes |
| `trumpet` | Trompet 8' with Prestant 8' — festive solo |

## `saint-jean-de-luz` — Saint-Jean-de-Luz (chœur)

Victor Gonzalez 1931, choir organ of Saint-Jean-Baptiste, Saint-Jean-de-Luz (France): 16 stops on two manuals (both enclosed) and pedal.

Config: `SAINT_JEAN_DE_LUZ_ORGAN`. Default preset: `fonds`. Tremulant on the great. In a swell box: great, swell.

**Great:** Bourdon 16', Flûte harmonique 8', Bourdon 8', Prestant 4', Quinte 2 2/3', Doublette 2', Tierce 1 3/5'

**Swell:** Flûte 8', Flûte 4', Plein-jeu III, Trompette 8'

**Pedal:** Soubasse 16', Bourdon 8', Flûte 8', Flûte 4', Flûte 2'

| Preset | Description |
|---|---|
| `fonds` | Fonds de 8': Flûte harmonique and Bourdon with the Récit Flûte coupled |
| `jeux-doux` | Bourdon 8' — the softest registration, for accompanying |
| `fonds-8-4` | Fonds 8' and 4' on both manuals |
| `plein-jeu` | Plein jeu: the Grand Orgue chorus with the Récit Plein-jeu coupled |
| `grand-choeur` | Grand chœur: every stop, the Récit coupled |
| `cornet` | Cornet décomposé on the Grand Orgue (8' 4' 2 2/3' 2' 1 3/5') against the Récit flutes |
| `nazard` | Bourdon 8' with Quinte 2 2/3' — a gentle solo against the Récit |
| `flute-harmonique` | Flûte harmonique 8' solo against the Récit Flûte |
| `trompette` | Trompette 8' solo on the Récit against the Grand Orgue fonds |

## `skrzatusz` — Skrzatusz sanctuary

Wilhelm Sauer 1876, sanctuary of Skrzatusz (Poland): 19 stops on two manuals and pedal.

Config: `SKRZATUSZ_ORGAN`. Default preset: `principal-chorus`. Tremulant on the positive.

**Great:** Bordun 16', Principal 8', Fugara 8', Flûte harmonique 8', Octave 4', Quinte 2 2/3', Octave 2', Cornett 4f, Mixtur 3f

**Positive:** Geigenprincipal 8', Gedact 8', Viola di Gamba 8', Praestant 4', Flauto dolce 4'

**Pedal:** Violon 16', Subbass 16', Octavbass 8', Bassflöte 8', Posaune 16'

| Preset | Description |
|---|---|
| `principal` | Principal 8' alone |
| `principal-chorus` | Principal chorus 8' 4' 2' |
| `plenum` | Plenum: principals, Quinte and Mixtur on Bordun 16' |
| `full` | Full organ with Cornett and Posaune |
| `foundations` | The 8' stops of the great — Sauer's Romantic fonds |
| `flutes` | Gedact 8' + Flauto dolce 4' on the positive |
| `flute-8` | Gedact 8' — soft stopped flute |
| `flute-solo` | Flûte harmonique 8' solo on the great, accompanied by the Gedact on the positive |
| `strings` | Viola di Gamba 8' with Gedact — the Romantic string sound |
| `cornet` | Cornett solo (from middle C) on the great against the positive |

## `strassburg` — Strassburg

Cyriach Werner 1743, Strassburg (Carinthia, Austria): a Baroque organ, 20 stops on Hauptwerk, Positiv and pedal.

Config: `STRASSBURG_ORGAN`. Default preset: `principal-chorus`.

**Great:** Prinzipal 8', Gedeckt 8', Gemshorn 8', Oktav 4', Flöte 4', Quint 2 2/3', Oktav 2', Oktav 1', Mixtur 1 1/3'

**Positive:** Gedackt 8', Prinzipal 4', Flöte 4', Oktav 2', Mixtur 1'

**Pedal:** Kontrabaß 16', Subbaß 16', Oktavbaß 8', Gedacktbaß 8', Oktave 4', Posaun 16'

| Preset | Description |
|---|---|
| `principal` | Prinzipal 8' alone |
| `principal-chorus` | Principal chorus 8' 4' 2' |
| `plenum` | Organo pleno for the Baroque repertoire: principals, Quint and Mixtur, the Positiv coupled |
| `full` | Every stop, the Positiv coupled |
| `flutes` | Gedeckt 8' + Flöte 4' on the Hauptwerk |
| `flute-8` | Gedackt 8' — the Positiv's soft stopped flute |
| `positive-chorus` | The Positiv's small chorus: Gedackt 8', Prinzipal 4', Oktav 2' |
| `gemshorn` | Gemshorn 8' with Flöte 4' — the gentle colour of the Hauptwerk |
| `cornet-decompose` | Gedeckt 8', Flöte 4' and Quint 2 2/3' — a gapped solo against the Positiv Gedackt |

## `szczecinek` — Szczecinek

P. B. Voelkner (Bromberg) 1908, Szczecinek (Poland): a late-Romantic organ, 35 stops on two manuals (the second enclosed) and pedal.

Config: `SZCZECINEK_ORGAN`. Default preset: `foundations`. Tremulant on the swell. In a swell box: swell.

**Great:** Principal 16', Bordun 16', Principal 8', Gambe 8', Salicional 8', Röhrflöte 8', Flûte harmonique 8', Octave 4', Hohlflöte 4', Piccolo 2', Rauschquinte 2 2/3' u. 2', Cornett 2-4 fach, Mixtur 5 fach, Trompete 8'

**Swell:** Lieblich Gedackt 16', Geigenprincipal 8', Gedackt 8', Konzertfloete 8', Gemshorn 8', Schalmeÿ 8', Aeoline 8', Vox coelestis 8', Fugara 4', Traversfloete 4', Progressio 2-4 fach

**Pedal:** Principalbass 16', Violon 16', Subbass 16', Echobass 16', Quintbass 10 2/3', Octavbass 8', Violoncello 8', Bassflöte 8', Octave 4', Posaune 16'

| Preset | Description |
|---|---|
| `principal` | Principal 8' alone |
| `foundations` | The 8' stops of both manuals coupled — Voelkner's Romantic fonds |
| `principal-chorus` | Principals 16' 8' 4' with the Rauschquinte |
| `plenum` | Plenum: principals, Rauschquinte and Mixtur with the swell coupled |
| `full` | Full organ with Cornett, Trompete, Schalmey and Posaune |
| `flutes` | Konzertflöte 8' + Traversflöte 4' on the swell |
| `flute-8` | Gedackt 8' — soft stopped flute |
| `flute-solo` | Flûte harmonique 8' solo on the great against the swell's Gedackt and Aeoline |
| `celeste` | Aeoline + Vox coelestis — the shimmering Romantic strings |
| `strings` | Gambe 8' and Salicional 8' on the great with Violon and Violoncello |
| `quiet` | Lieblich Gedackt 16' with Aeoline 8' — the softest registration |
| `schalmey` | Schalmey 8' solo on the swell against the great's Röhrflöte |
| `trumpet` | Trompete 8' with Principal 8' — festive solo |
