# @supersynth/organs

All the organs for [supersynth](https://www.npmjs.com/package/@supersynth/core) in one install: the
Bureå Church organ and Piotr Grabowski's 15 organs, about 900 MB of models in total. This package
just depends on the individual `@supersynth/organ-<id>` packages, so to save space you can
install only the ones you play instead (`npm install @supersynth/organ-friesach`).

```bash
npm install @supersynth/core @supersynth/organs
```

```ts
import { Synth } from '@supersynth/core';

const synth = new Synth();
const organ = synth.add('cracow', { preset: 'grand-choeur' });
```

Piotr Grabowski's organs can't be sold or built into products for sale; see
[NOTICE.md](NOTICE.md).
