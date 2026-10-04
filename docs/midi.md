# MIDI

MIDI channels are numbered 1–16 everywhere in the API.

## Files

```ts
const audio = synth.renderMidi('song.mid', {
  channels: { 1: 'violin', 2: 'cellos', 3: organ.great },   // per MIDI channel: id, instrument or division
  instrument: 'grand-piano',                               // every other channel
  speed: 1, transpose: 0, tail: 3,
});
await synth.playMidi('song.mid', { instrument: 'harpsichord' }); // real time (starts output)
```

Note on/off, sustain (CC64), modulation (CC1), volume (CC7), pan (CC10), expression (CC11),
reverb send (CC91) and pitch bend are honoured. Channel 10 (GM drums) is skipped unless mapped.
`byTrack: true` maps by track index instead of channel. An instrument named by id is added for
the file; an instrument or division is played as it is (an organ division with its couplers).

`parseMidiFile(bytes)` gives the raw time-ordered events; a file that is not a Standard MIDI
File throws `MidiError`.

## Hardware input

```ts
synth.add('grand-piano').midi(1);           // MIDI channel 1
synth.add('strings').midi(2);               // MIDI channel 2
await synth.enableMidi('Arturia');          // substring of the device name; omit for the first device
synth.on('midi', (e) => console.log(e.type, e.channel, e.note, e.velocity));
```

Nothing plays from a MIDI keyboard until it is given a channel: `instrument.midi(n)` (or
`instrument.midi()` for every channel) and `organ.midi({ great: 1, … })`. A channel belongs to
one instrument or division at a time; giving it to another takes it over, and calling `midi()`
again replaces the channels an instrument or organ had.

With `route: true` (default) notes and controllers go straight to the engine, with no
JavaScript round trip. Set `route: false` to handle everything yourself in the `'midi'` event,
which is emitted for every message either way. `disableMidi()` disconnects.

An organ assigns its divisions to channels with `organ.midi({ great: 1, swell: 2, pedal: 3 })`
(couplers apply, program changes select presets; see [organ.md](organ.md#midi-keyboards)).
