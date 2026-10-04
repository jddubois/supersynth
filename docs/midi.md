# MIDI

MIDI channels are numbered 1–16 everywhere in the API.

## Files

```ts
const audio = synth.renderMidi('song.mid', {
  channels: { 1: 'violin', 2: 'cellos', 3: organ.great },   // per MIDI channel: id, part or division
  instrument: 'grand-piano',                               // every other channel
  speed: 1, transpose: 0, tail: 3,
});
await synth.playMidi('song.mid', { instrument: 'harpsichord' }); // real time (starts output)
```

Note on/off, sustain (CC64), modulation (CC1), volume (CC7), pan (CC10), expression (CC11),
reverb send (CC91) and pitch bend are honoured. Channel 10 (GM drums) is skipped unless mapped.
`byTrack: true` maps by track index instead of channel. An instrument named by id is added as a
new part; a part or division is played as it is (an organ division with its couplers).

`parseMidiFile(bytes)` gives the raw time-ordered events; a file that is not a Standard MIDI
File throws `MidiError`.

## Hardware input

```ts
synth.add('grand-piano').midi(1);           // MIDI channel 1
synth.add('strings').midi(2);               // MIDI channel 2
await synth.enableMidi('Arturia');          // substring of the device name; omit for the first device
synth.on('midi', (e) => console.log(e.type, e.channel, e.note, e.velocity));
```

With `route: true` (default) notes and controllers go straight to the engine, with no
JavaScript round trip: channel N plays the part or division given it with `part.midi(N)` or
`organ.midi()`; otherwise channels 1–9 play the first nine parts and organ divisions created,
and channels 11–16 the next six. Set
`route: false` to handle everything yourself in the `'midi'` event. `disableMidi()`
disconnects.

An organ assigns its divisions to channels with `organ.midi({ great: 1, swell: 2, pedal: 3 })`
(couplers apply, program changes select presets; see [organ.md](organ.md#midi-keyboards)).
