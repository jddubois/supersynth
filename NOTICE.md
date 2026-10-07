# Third-party material

The instrument models are spectral analyses (partial envelopes, noise spectra and short attack
excerpts) of the following recordings. The CC0 models ship in `@supersynth/instruments`
(`packages/instruments/`, installed with supersynth); each organ sample set ships in an npm
package of its own (`@supersynth/organ-<id>`, source in `packages/organ-<id>/`), which carries
its own NOTICE.md and license.

## Versilian Community Sample Library (VCSL)
Versilian Studios LLC — https://github.com/sgossner/VCSL — **CC0 1.0** (public domain).
Models: grand-piano, upright-piano, harpsichord, harpsichord-flemish (and their `*-release`
key-up models), pipe-organ, pipe-organ-soft, pipe-organ-pedal, pipe-organ-pedal-soft,
renaissance-organ-*, harp, tenor-sax, marimba, vibraphone, xylophone, glockenspiel, tubular-bells.

## VSCO 2 Community Edition
Versilian Studios LLC — https://github.com/sgossner/VSCO-2-CE — **CC0 1.0** (public domain).
Models: violin, violins, violas, cellos, contrabass, violin-pizzicato, cello-pizzicato,
contrabass-pizzicato, flute, flute-vibrato, piccolo, oboe, clarinet, bassoon, trumpet,
trumpet-muted, french-horn, trombone, tuba.

## Salamander Grand Piano V3
Yamaha C5 grand piano sampled by **Alexander Holm** — https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html —
licensed under **Creative Commons Attribution 3.0** (http://creativecommons.org/licenses/by/3.0/).
Models: grand-piano-salamander, grand-piano-salamander-release, grand-piano-salamander-pedal in
the package `@supersynth/piano-salamander` (`packages/piano-salamander/`), distributed under the
same license; none of them is in the `supersynth` package itself.

## Bureå Church organ
Organ by Nils Hammarberg (1967), Bureå Church, Sweden. GrandOrgue sample set recorded by
**Lars Palo** (2010, updated 2023) — https://familjenpalo.se/vpo/ — licensed under
**Creative Commons Attribution-ShareAlike 2.5 Sweden** (http://creativecommons.org/licenses/by-sa/2.5/se/).
Models: `models/organ/*` in the package `@supersynth/organ-burea` (`packages/organ-burea/`). These
models are an adaptation of that work and are distributed under the same license (CC BY-SA 2.5 SE).

## Piotr Grabowski's free organ sample sets
Sample sets recorded and produced by **Piotr Grabowski** (Piotr Grabowski Wirtualne Organy) —
https://piotrgrabowski.pl/instruments/ — distributed by him free of charge. Models:
`models/organ/<organ>/*` in the package `@supersynth/organ-<organ>` (`packages/organ-<organ>/`) for
the organs `azzio`, `cracow`, `dluga-koscielna`, `friesach`, `giubiasco`, `green-positiv`,
`harmonium`, `ledziny`, `lipiny`, `melcer`, `raszczyce`, `saint-jean-de-luz`, `skrzatusz`,
`strassburg`, `szczecinek`. Each stop was analysed from the sample set's recordings as its organ
definition plays them. None of them is in the `supersynth` package itself.

These models are **not** covered by supersynth's MIT license. The sample sets' terms
(https://piotrgrabowski.pl, Terms and Conditions → Licence) do not allow free sample sets, as a
whole or in part, to be sold, or to be included in computers or products intended for sale
(e.g. a MIDI console with a built-in system); the same restriction applies to these models.
Recordings made with them may be distributed, for commercial and non-commercial purposes; note
that such recordings were made on a virtual instrument, not on the real organ.
