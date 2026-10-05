# supersynth-organs

Every organ for [supersynth](https://www.npmjs.com/package/supersynth) in one install: the Bureå
Church organ and Piotr Grabowski's 15 organs (about 550 MB of models). It only depends on
the model packages `supersynth-organ-<id>`; install just the ones you play to save space
(`npm install supersynth-organ-friesach`).

```bash
npm install supersynth supersynth-organs
```

```ts
import { Synth } from 'supersynth';

const synth = new Synth();
const organ = synth.add('cracow', { preset: 'grand-choeur' });
```

The Piotr Grabowski organs may not be sold or built into products for sale; see
[NOTICE.md](NOTICE.md).
