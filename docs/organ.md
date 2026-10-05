# The church organ

`synth.add('burea')` adds a model of a real church organ: the Bureå Church organ in Sweden
(Nils Hammarberg, 1967). Every pipe of its 40 stops is analysed from Lars Palo's GrandOrgue
sample set (CC BY-SA). Each pipe keeps its recorded tuning and level, and the church's acoustic
is part of the recordings.

Each organ comes as a separate npm package; only the VCSL organ is included with supersynth:

```bash
npm install @supersynth/organ-burea        # the Bureå organ (71 MB)
npm install @supersynth/organ-friesach     # one of Piotr Grabowski's organs
npm install @supersynth/organs             # every organ (about 900 MB)
```

If an organ's package isn't installed, adding it throws a `SupersynthError` that names the
package.

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
organ.set({ noises: true });                    // blower, room, key and stop action (organs that recorded them, see Noises)
```

Stops are named as on the stop knob (`"Trumpet 8'"`, case-insensitive) or by id
(`'great-trumpet-8'`). The divisions `great`, `swell`, `positive` and `pedal` are each a
`Division`, which is `Playable` like an instrument:

| Division | |
|---|---|
| `play`, `sequence`, `noteOn`, `noteOff`, `allNotesOff` | playing (organs are not velocity sensitive; a velocity is clamped to 1–127, so 0 is not a key release) |
| `expression(0–1)` | swell pedal (shutters on the swell, volume elsewhere) |
| `pull(stop \| stops)`, `push(stop \| stops)` | draw, retire |
| `couple(coupler \| couplers)`, `uncouple(coupler \| couplers)` | couplers to this keyboard: a division (`'swell'`), or `{ division, octave: 1 \| -1 }` for 4' and 16' couplers |
| `unison(on)` | unison off: the keys play only what is coupled to them |
| `forte(on)` | a harmonium's Forte: stops with a forte recording play it |
| `set({ stops, couple, unison, forte })` | replace the stops drawn and/or the couplers as a whole (`[]` for none) |
| `stops()`, `drawn()`, `coupled()`, `unisonOn()`, `forteIsOn()` | the division's stops, those drawn, its couplers |
| `name` | `'great'`, `'swell'`, `'positive'` or `'pedal'` |

| Organ | |
|---|---|
| `great`, `swell`, `positive`, `pedal`, `divisions()`, `division(name)` | the keyboards |
| `preset(name \| preset)`, `presets()`, `savePreset(name, preset?)`, `current()`, `activePreset()` | presets, as on an instrument |
| `set({ tremulant, wind, noises })` | the tremulants (`true`, or by division: `{ swell: true }`); how much the wind sags when many pipes start (0 … 4: 0 steady, 1 flexible); the machinery noises |
| `tremulants()`, `noisesOn()` | the tremulants and whether each is on; which noises are on (`{ blower, ambient, action }`) |
| `midi(channels, { presets })` | play it from MIDI keyboards |
| `allNotesOff()`, `stops()`, `definition`, `synth` | |
| `ready` | a promise: every model the organ loads in the background is loaded (see [Loading](#loading)) |

Like notes, every change takes `{ at }` or `{ delay }` as its last argument, so you can
schedule registration changes along with the music: `organ.preset('full', { at: 30 })`,
`organ.swell.pull("Schalmei 8'", { at: 12.5 })`.

Couplers are handled in the engine, so they apply to every note, whether it comes from the API,
a MIDI keyboard or a MIDI file. If a pipe is reached from two keyboards at once (or from two
keys through an octave coupler), it only sounds once, and keeps sounding until both keys are
released. As on a real organ, couplers aren't transitive: with Swell to Great and Great to
Pedal, the pedal plays the great's stops but not the swell's.

Each pipe starts with its recorded attack after a short random delay (`speech`, up to 10 ms,
different for every pipe and note), much like the tracker action and pipe feet of a real organ.
That way unison stops beat and blend instead of starting in lockstep. Most of Piotr Grabowski's
sample sets also record each pipe's release after a short key press (0.1–0.6 s). Where they
do, a staccato note ends with that shorter release, since the room hasn't filled yet and the
pipe hasn't reached full speech.

## Loading

Decoded, an organ's models take hundreds of megabytes, so `synth.add()` only loads what the
starting preset needs before returning (in parallel, on several cores), and that preset plays
right away. The models for the other stops, plus the Forte and noise models, then load in the
background off the JavaScript thread. Drawing stops or changing presets later is instant and
doesn't delay a key press or a MIDI clock:

```ts
const organ = synth.add('friesach', { preset: 'plenum' });   // ~0.1 s; the plenum plays now
organ.great.play('C4');
await organ.ready;               // optional: every stop is loaded (~0.5 s on a desktop)
```

Drawing a stop whose model hasn't loaded yet doesn't hold up playback either. With real-time
output running, the call returns immediately and the stop starts sounding once its model is
loaded; it's moved to the front of the queue, so that takes a few tens of milliseconds on a
desktop. In the meantime `drawn()` already lists it, and if you retire it before it loads, it
never sounds. Offline, the call waits for just that one model, loading it right away if no
background thread has picked it up yet. `render()` also waits for any stop drawn in real time
that's still loading, so a render always contains exactly the stops that were drawn.

The `preload` option of `synth.add()` controls what loads in the background:

| `preload` | |
|---|---|
| `'all'` | every model of the organ (the default when the organ's models take at most a quarter of the machine's memory decoded) |
| `'preset'` | only the starting preset's; another stop's model loads when the stop is first drawn, so memory grows only with the stops used (the default on smaller machines) |
| `false` | nothing in the background: each model, the preset's too, loads on the JavaScript thread when first needed |

Decoded, the largest organs take about 430 MB (Friesach, 44 stops), 280 MB (Cracow, 40) and
245 MB (Bureå, 40), about three times the size of the package; `npm run load-test` measures
this. If a model fails to load in the background (a damaged file, say), `organ.ready` rejects
with a `SupersynthError`, the synth emits it as an `'error'` event if anything is listening, and
drawing that stop throws the same error. The other stops still play. Removing the organ, or
calling `synth.close()`, stops the loading. Unloaded models are freed on a background thread
once the engine is done with them, never during a render or in the audio callback. The number
of background loading threads is the number of CPU cores minus two, between 1 and 6, and they
run at low priority so the audio and JavaScript threads come first. Set
`$SUPERSYNTH_LOAD_THREADS` to change it.

## Noises

```ts
const organ = synth.add('friesach', { preset: 'principal-chorus', noises: true });
organ.set({ noises: { blower: false, ambient: false } });   // the action only
organ.set({ noises: false });
```

For organs whose sample sets recorded the machinery, `noises: true` plays it: the blower and
the empty church while the organ is on, the key action going down and coming up (only on the
keyboard actually played, not through couplers), and the stop knobs, couplers and tremulants
as they're drawn and retired. The noises were recorded along with the pipes and play at their
real level. In some churches the blower and the room are louder than a key click;
`noises: { blower: false, ambient: false }` keeps just the action, and `noises.gain` in a copied
definition sets the overall level.

### CPU

Every sounding pipe is a voice, and a released pipe stays a voice until its recorded room tail
has died away. Fast passages on large registrations of the big organs (Friesach, Cracow) keep
hundreds of voices going at once. Render those offline, or raise `maxVoices` and use a fast
machine (not a Raspberry Pi) for live playing. Short-press releases don't cost anything extra,
since a staccato note just plays a shorter recorded tail. Noises add two voices for the blower
and room, plus a short voice for each key movement and stop change, so leave them off when CPU
is tight.

### Live playing

The speech delay puts each pipe up to 10 ms after its key, as on a real organ. If you're
playing live on a slow machine with audio buffering on top of that, set `speech: 0` in a copied
definition (`synth.add({ ...FRIESACH_ORGAN, speech: 0 })`) for the lowest latency and CPU use.
Each delayed pipe start currently also splits the engine's audio block.

## Presets

A preset (a registration) lists the stops drawn on each division and the couplers. It can
also include `unisonOff` (keyboards with unison off), `tremulant` (divisions with the tremulant
on; left unchanged if missing) and `forte` (a harmonium's divisions with the Forte on). Apply a
preset by name or as an object. It replaces everything that's drawn, and divisions it doesn't
mention go silent:

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

Each division's MIDI channel is played directly in the engine, couplers included, with no
JavaScript in the note path. CC 11 on a division's channel works as its swell pedal. A program
change on any of the organ's channels selects one of the `presets`: program 0 the first,
1 the second, and so on. By default that's every preset, in the order of `organ.presets()`;
pass `false` to ignore program changes. Preset names are checked when you call `midi()`. If a
preset can't be applied when its program change arrives, the synth emits an `'error'` event
when something is listening and otherwise ignores it; nothing is thrown from the MIDI callback.
Calling `midi()` again replaces the organ's channels. To play a MIDI file on an organ, map
channels to divisions: `synth.renderMidi(file, { channels: { 1: organ.great, 2: organ.pedal } })`.

## The VCSL church organ

```ts
const organ = synth.add('vcsl', { preset: 'full' });
organ.great.play(['C4', 'E4', 'G4'], { duration: 3 });
organ.preset('chamber');                         // the Renaissance chamber organ (8' + 4')
organ.positive.play(['G4', 'B4', 'D5'], { duration: 3 });
```

This is a church organ recorded in stereo with its room (Simon Dalzell / Ivy Audio, via the
Versilian Community Sample Library, CC0), with a Renaissance chamber organ as the positive. Its
stops are recorded registrations rather than single ranks, and only every third semitone was
recorded; the notes in between are blended from their neighbours.

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

There are fifteen more organs: all of the ones Piotr Grabowski gives away for free at
[piotrgrabowski.pl](https://piotrgrabowski.pl/instruments/). Each stop is analysed from his
sample set the way his organ definition plays it. They are Friesach (Eisenbarth 2000, 44 stops),
Cracow St. John Cantius (Siedlar 2004), Szczecinek (Voelkner 1908), Lipiny, Skrzatusz (Sauer
1876), Raszczyce (Vermeulen 1965), Długa Kościelna, Giubiasco and Azzio (Mascioni), Strassburg
(Werner 1743), Melcer Chamber Music Hall (Walcker 1993), Saint-Jean-de-Luz (Gonzalez 1931),
Lędziny, the Green Positiv, and a two-manual harmonium by Emil Müller.

Each organ keeps its own pitch (Azzio sounds at a ≈ 420 Hz, the Green Positiv a semitone low),
its borrowed and extended ranks, the balance between its stops, the releases recorded after
short key presses, the swell boxes and tremulants from its GrandOrgue definition, and its
recorded machinery noises. Each organ's models are in the package `@supersynth/organ-<id>`
(`npm install @supersynth/organ-friesach`). [piotr-organs.md](piotr-organs.md) lists the stops,
presets, ids and package sizes for each one. These models aren't covered by the MIT license;
see NOTICE.md.

## Organs are configuration

Each organ is a plain `OrganDefinition` object describing its stops, named presets, the layout of
its divisions (stereo position, which one has a swell box and how far it closes), tremulants,
wind, speech, noises and reverb. The built-in organs are `ORGANS.burea` (`BUREA_ORGAN`),
`ORGANS.vcsl` (`VCSL_ORGAN`) and Piotr Grabowski's organs (`ORGANS.friesach` /
`FRIESACH_ORGAN` and so on, all collected in `PIOTR_ORGANS`). They're exported from both
`supersynth` and `supersynth/organs`, and `synth.add` accepts an id or any `OrganDefinition`:

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

A stop plays the model `organ/<id>` (or the one named in `model`), transposed `transpose`
semitones from the key pressed. It sounds on the keys in `keys: [low, high]` (all keys by
default; a treble-only Cornet is one use), and plays its `forte` model when the division's Forte
is on. A model called `<name>` is the file `<name>.ssm`. It's looked up first in the Synth's
`modelsDirectory` (or `$SUPERSYNTH_MODELS_DIR`), then in supersynth's `models/`, then in the
organ's package (`organ/friesach/…` in `@supersynth/organ-friesach`, `organ/…` in
`@supersynth/organ-burea`). Forte and noise models are found the same way.

A division's `swellBox` is either `true` or something like `{ closed: -6, shelf: -9 }`: the level
and treble damping in dB with the shutters closed. The default box closes to −9 dB, and −14 dB
above about 700 Hz. `tremulant` is a single tremulant or a list of them, each acting on one
division or several (`{ division: ['great', 'pedal'], depth, pitch, rate }`). Optional fields
fall back to `CHURCH_DIVISIONS` (great in the centre, swell on the right in its swell box,
positive on the left, pedal in the centre), `SWELL_TREMULANT` and `ORGAN_DEFAULTS`.

Each stop also has a `family` (`'principal'`, `'flute'`, …), an optional `gain` in dB for stops
whose recordings were normalised separately, and an `actionNoise` pair `[on, off]` giving the
notes of its drawing and retiring sounds in the stop-action model. Tremulants can have a `name`
and `actionNoise` too. `noises` names the machinery models: `keys` (per division, `{ down, up }`
models with a zone per key), `stops` (the stop-action model), `coupler` (its `[on, off]` notes
in that model), `blower` and `ambient` (`{ model, note? }`), and `gain` in dB. `reverb` is the
room the synth uses for the organ when the reverb is automatic (`'church'` by default), and
`reverbSend` is each division's send into it (0.07 by default, because the pipes already carry
their church's acoustic).

The rest of this page covers the Bureå organ.

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
| `principal` | Principal 8' alone, the foundation tone of the organ |
| `principal-chorus` | Principal chorus 8' 4' 2' (Baroque plenum without mixture) |
| `plenum` | Organo pleno for Bach preludes and fugues: principals and mixtures |
| `full` | Full organ with reeds and all manuals coupled |
| `flutes` | Flutes 8' + 4', gentle, for chorale preludes |
| `flute-8` | Gedackt 8', soft stopped flute |
| `cornet` | Cornet (8' 4' 2 2/3' 2' 1 3/5'), solo voice for ornamented melodies |
| `trumpet` | Trumpet 8' with Principal as a festive solo |
| `krummhorn` | Krummhorn 8', nasal Renaissance reed solo |
| `celeste` | Salicional + Voix céleste, shimmering strings for romantic music |
| `quiet-strings` | Salicional 8' alone |
| `sesquialtera-solo` | Sesquialtera solo with flutes, the classic Dutch/Scandinavian chorale cantus |
