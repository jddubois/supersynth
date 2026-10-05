# @supersynth/organ-burea

The models of the **Bureå Church organ** for [supersynth](https://www.npmjs.com/package/supersynth):
every stop analysed from the recordings of its sample set. supersynth finds them by itself once
this package is installed next to it.

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

Stops and presets: [organ.md](https://github.com/jddubois/supersynth/blob/main/docs/organ.md).
All the organs at once: `npm install @supersynth/organs`.

License: CC BY-SA 2.5 SE (an adaptation of Lars Palo's sample set; attribution: Lars Palo). See [NOTICE.md](NOTICE.md).
