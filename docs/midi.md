# MIDI

## Files

```ts
const audio = synth.renderMidi('song.mid', {
  channels: { 1: 'violin', 2: 'cellos', 3: organ.great },   // per MIDI channel (1–16)
  instrument: 'grand-piano',                               // everything else
  speed: 1, transpose: 0, tail: 3,
});
await synth.playMidi('song.mid', { instrument: 'harpsichord' }); // real time
```

Note on/off, sustain (CC64), modulation (CC1), volume (CC7), pan (CC10), expression (CC11),
reverb send (CC91) and pitch bend are honoured. Channel 10 (GM drums) is skipped unless mapped.
`byTrack: true` maps by track index instead of channel. `parseMidiFile(bytes)` gives the raw
time-ordered events.

## Hardware input

```ts
synth.add('grand-piano', { channel: 0 });    // receives MIDI channel 1
synth.add('strings', { channel: 1 });        // MIDI channel 2
await synth.enableMidi('Arturia');          // substring of the device name; omit for the first device
synth.on('midi', (e) => console.log(e.type, e.note, e.velocity));
```

With `route: true` (default) messages are applied inside the engine without a JavaScript round
trip; set `route: false` to handle everything yourself in the `'midi'` event.

An organ assigns its divisions to channels with `organ.midi({ great: 1, swell: 2, pedal: 3 })`
(couplers apply, program changes select presets; see [organ.md](organ.md#midi-keyboards)).
