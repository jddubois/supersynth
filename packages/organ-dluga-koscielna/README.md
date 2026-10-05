# supersynth-organ-dluga-koscielna

The models of the **Długa Kościelna organ** for [supersynth](https://www.npmjs.com/package/supersynth):
every stop analysed from the recordings of its sample set. supersynth finds them by itself once
this package is installed next to it.

```bash
npm install supersynth supersynth-organ-dluga-koscielna
```

```ts
import { Synth } from 'supersynth';

const synth = new Synth();
const organ = synth.add('dluga-koscielna');
organ.great.play(['C4', 'E4', 'G4'], { duration: 4 });
synth.renderToFile('organ.wav', 5);
```

Stops and presets: [piotr-organs.md](https://github.com/jddubois/supersynth/blob/main/docs/piotr-organs.md).
All the organs at once: `npm install supersynth-organs`.

Sample set © Piotr Grabowski: these models are not under the MIT license and may not be sold or built into products for sale. See [NOTICE.md](NOTICE.md).
