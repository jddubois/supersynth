# @supersynth/organ-burea

Spectral models of the **Bureå Church organ** for [supersynth](https://www.npmjs.com/package/supersynth),
with every stop analysed from its sample set's recordings. Install this package alongside
supersynth and it will be found automatically.

```bash
npm install supersynth @supersynth/organ-burea
```

```ts
import { Synth } from 'supersynth';

const synth = new Synth();
const organ = synth.add('burea');
organ.great.play(['C4', 'E4', 'G4'], { duration: 4 });
synth.renderToFile('organ.wav', 5);
```

The stops and presets are listed in [organ.md](https://github.com/jddubois/supersynth/blob/main/docs/organ.md).
To install every organ at once, use `npm install @supersynth/organs`.

License: CC BY-SA 2.5 SE (an adaptation of Lars Palo's sample set; attribution: Lars Palo). See [NOTICE.md](NOTICE.md).
