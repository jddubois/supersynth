# @supersynth/organ-dluga-koscielna

Spectral models of the **Długa Kościelna organ** for [supersynth](https://www.npmjs.com/package/supersynth),
with every stop analysed from its sample set's recordings. Install this package alongside
supersynth and it will be found automatically.

```bash
npm install supersynth @supersynth/organ-dluga-koscielna
```

```ts
import { Synth } from 'supersynth';

const synth = new Synth();
const organ = synth.add('dluga-koscielna');
organ.great.play(['C4', 'E4', 'G4'], { duration: 4 });
synth.renderToFile('organ.wav', 5);
```

The stops and presets are listed in [piotr-organs.md](https://github.com/jddubois/supersynth/blob/main/docs/piotr-organs.md).
To install every organ at once, use `npm install @supersynth/organs`.

Sample set © Piotr Grabowski: these models are not under the MIT license and may not be sold or built into products for sale. See [NOTICE.md](NOTICE.md).
