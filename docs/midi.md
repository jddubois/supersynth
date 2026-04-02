# MIDI

## Hardware input

```ts
await synth.start();

// List available devices
console.log(synth.listMidiDevices());
// e.g. ['Arturia KeyStep 37', 'IAC Driver Bus 1']

// Connect (substring match — omit for first available device)
await synth.enableMidi('Arturia');
```

`enableMidi` performs a case-insensitive substring match against device names. Throws `MidiError` if no matching device is found.

## Events

`Synth` extends `EventEmitter`. Register listeners before or after calling `enableMidi`.

```ts
synth.on('noteOn', ({ note, velocity, channel }) => {
  console.log(`Note on: ${note} vel=${velocity} ch=${channel}`);
  synth.noteOn(note, velocity);
});

synth.on('noteOff', ({ note, channel }) => {
  synth.noteOff(note);
});

synth.on('cc', ({ controller, value, channel }) => {
  // Control change — knobs, pedals, mod wheel, etc.
  if (controller === 64) console.log(`Sustain: ${value >= 64 ? 'on' : 'off'}`);
});

synth.on('programChange', ({ program, channel }) => {
  console.log(`Program change: ${program}`);
});

synth.on('midiMessage', (event: MidiEvent) => {
  // Fires for every incoming MIDI message
  console.log(event.type, event.raw);
});
```

### MidiEvent

```ts
interface MidiEvent {
  type: 'noteOn' | 'noteOff' | 'cc' | 'programChange' | 'unknown';
  channel: number;        // 1-indexed, 1–16
  note?: number;          // 0–127 (noteOn / noteOff)
  velocity?: number;      // 0–127 (noteOn / noteOff)
  controller?: number;    // 0–127 (cc)
  value?: number;         // 0–127 (cc)
  program?: number;       // 0–127 (programChange)
  raw: Buffer;            // raw 3-byte MIDI message
}
```

## Raw MIDI bytes

Feed MIDI bytes directly to the engine — useful when playing MIDI files:

```ts
// Note on: channel 1, A4, velocity 100
synth.sendMidiBytes(Buffer.from([0x90, 69, 100]));

// Note off: channel 1, A4
synth.sendMidiBytes(Buffer.from([0x80, 69, 0]));

// Control change: channel 1, CC 7 (volume), value 100
synth.sendMidiBytes(Buffer.from([0xB0, 7, 100]));
```

MIDI channel information in raw bytes is parsed but currently all channels drive the same synthesis engine (no per-channel voice mapping).

## Multi-department organ (manual + pedal)

For keyboard + pedalboard setups, create separate synth instances:

```ts
import { Organ } from 'supersynth';

const manual = new Organ({ masterVolume: 0.7 });
const pedal  = new Organ({ masterVolume: 0.9 });

await manual.start();
await pedal.start();

manual.activatePreset('principal');
pedal.activatePreset('pedalboard_default');

// Route MIDI channels to departments
synth.on('midiMessage', (event) => {
  if (event.channel === 1) manual.sendMidiBytes(event.raw);
  if (event.channel === 3) pedal.sendMidiBytes(event.raw);
});
```

See `examples/midi-organ.ts` for a full Bach MIDI file organ example.
