# Synth

The `Synth` class is the core synthesis engine. All instrument classes extend it.

```ts
import { Synth } from 'supersynth';
```

## Constructor

```ts
new Synth(config?: SynthConfig)
```

### SynthConfig

```ts
const synth = new Synth({
  sampleRate: 48000,          // Hz. Default: 48000
  backend: 'auto',            // Audio backend. Default: 'auto'
  voice: {                    // Default voice for new notes
    oscillators: [{ waveform: 'sine' }],
    velocityCurve: { type: 'linear' },
  },
  masterVolume: 0.5,          // 0.0–1.0. Default: 0.5
  reverb: {
    roomSize: 0.85,           // 0.0–1.0
    damping: 0.5,             // 0.0–1.0
    wet: 0.35,                // reverb send level
    dry: 0.65,                // direct signal level
    preDelayMs: 20,           // ms before reverb tail begins
  },
  keyClickIntensity: 0,       // organ key-click noise burst (0.0–1.0)
  keyClickDuration: 0.003,    // key-click duration in seconds
});
```

See [voice.md](voice.md) for `VoiceConfig` and oscillator options, and [effects.md](effects.md) for additional effect configuration available via `SynthConfig`.

## Methods

All methods except `start()` and `stop()` support method chaining.

### Playback

```ts
await synth.start(): Promise<void>
```
Opens a CPAL audio stream on a dedicated Rust thread. Must be called before audio is heard.

```ts
synth.stop(): void
```
Stops audio output and disconnects any active MIDI device.

### Notes

```ts
synth.noteOn(note: number, velocity?: number, options?: NoteOnOptions): this
```
Starts a note. `note` is a MIDI note number (0–127; C4 = 60, A4 = 69). `velocity` defaults to 100.

Override the voice for a single note:
```ts
synth.noteOn(60, 80, {
  voice: { oscillators: [{ waveform: 'trumpet' }] },
});
```

```ts
synth.noteOff(note: number): this
```
Releases a note, triggering its release envelope.

### Voice & volume

```ts
synth.setVoice(config: VoiceConfig): this
```
Changes the default voice for all subsequent notes. See [voice.md](voice.md).

```ts
synth.setMasterVolume(volume: number): this   // 0.0–1.0
```

### Rendering

```ts
synth.render(numSamples: number): Float32Array
```
Offline render — returns a mono `Float32Array` of `numSamples` samples in `[-1, 1]`. No audio hardware required.

```ts
const synth = new Synth({ sampleRate: 48000 });
synth.noteOn(69, 100);
const samples = synth.render(48000); // 1 second at 48 kHz
```

### Organ controls

```ts
synth.setKeyClick(intensity: number, duration?: number): this
```
Sets the organ key-click transient. `intensity` is 0.0–1.0; `duration` is in seconds (default 0.003).

```ts
synth.updateOscillatorAmplitude(id: number, amplitude: number): this
```
Real-time drawbar control — updates the amplitude of a registered oscillator template by ID. See [organ.md](organ.md).

### Effects

```ts
synth.setVibratoChorusMode(mode: 'off' | 'v1' | 'v2' | 'v3' | 'c1' | 'c2' | 'c3'): this
```
Sets the Leslie rotary speaker / scanner vibrato mode. See [effects.md](effects.md).

```ts
synth.setOverdrive(drive: number, bias: number, level: number): this
// drive: 1.0–10.0 | bias: 0.0–0.3 | level: 0.0–1.0
```

### MIDI

```ts
await synth.enableMidi(deviceName?: string): Promise<this>
synth.listMidiDevices(): string[]
synth.sendMidiBytes(bytes: Buffer): this
```
See [midi.md](midi.md).

### Backends

```ts
synth.listAudioBackends(): string[]
```

## Events

`Synth` extends `EventEmitter`. Events fire when MIDI input is active.

```ts
synth.on('noteOn',       ({ note, velocity, channel }) => { ... });
synth.on('noteOff',      ({ note, channel }) => { ... });
synth.on('cc',           ({ controller, value, channel }) => { ... });
synth.on('programChange',({ program, channel }) => { ... });
synth.on('midiMessage',  (event: MidiEvent) => { ... }); // all messages
```

## Properties

```ts
synth.activeNoteCount: number   // read-only, number of notes in their envelope
```
