/**
 * Play or render a Standard MIDI File.
 *
 *   node --import tsx examples/midi-file.ts song.mid                       # piano, real time
 *   node --import tsx examples/midi-file.ts song.mid --organ                # church organ (plenum)
 *   node --import tsx examples/midi-file.ts song.mid --instrument harpsichord --out song.wav
 */
import { Synth, writeWav, type InstrumentId, type MidiTarget } from '../src/index.ts';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
if (!file) {
  console.error('usage: midi-file.ts <file.mid> [--instrument id] [--organ [--preset name]] [--out file.wav]');
  process.exit(1);
}
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const outFile = opt('out');
const synth = new Synth();

let instrument: MidiTarget = (opt('instrument') ?? 'grand-piano') as InstrumentId;
if (args.includes('--organ')) {
  const organ = synth.addOrgan('burea', { preset: opt('preset') ?? 'plenum' });
  instrument = organ.great;
}

if (outFile) {
  const audio = synth.renderMidi(file, { instrument });
  writeWav(outFile, audio);
  console.log(`wrote ${outFile} (${audio.duration.toFixed(1)} s)`);
} else {
  await synth.start();
  await synth.playMidi(file, { instrument });
  synth.close();
}
