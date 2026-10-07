# @supersynth/piano-salamander

Spectral models of the **Salamander Grand Piano** (a Yamaha C5, sampled by Alexander Holm) for
[supersynth](https://www.npmjs.com/package/@supersynth/core): sixteen dynamic layers in stereo,
the damper release noise of every key and the sound of the sustain pedal. Install this package
alongside supersynth and it will be found automatically.

```bash
npm install @supersynth/core @supersynth/piano-salamander
```

```ts
import { Synth } from '@supersynth/core';

const synth = new Synth();
const piano = synth.add('salamander-grand');
piano.sustain(true).play(['C3', 'G3', 'E4'], { duration: 4 });
synth.renderToFile('piano.wav', 5);
```

License: CC BY 3.0 (attribution: Alexander Holm, Salamander Grand Piano). See [NOTICE.md](NOTICE.md).
