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
reverb send (CC91) and pitch bend are honoured. Program changes and other controllers are
ignored. Channel 10 (GM drums) is skipped unless mapped; with `byTrack` it is not skipped, so
map or leave out drum tracks yourself. `byTrack: true` maps by track instead of channel: the
keys of `channels` are then 0-based track indices (`0` is the first track). A channel or track
without notes gets no instrument. A target is an instrument id, an `Instrument` or a
`Division`; an organ id throws (pass one of its divisions, `organ.great`).

An instrument or division you pass is played as it is (an organ division with its couplers).
When the file ends (or is aborted), its notes are released and its sustain pedal, modulation,
expression and pitch bend are reset, so nothing the file left on carries over; volume, pan and
reverb send stay as the file set them. An instrument named by id is added for the file and
removed when the file is done, so a file can be rendered any number of times.

Several events at the same tick are ordered as a player would expect: a note-off that ends a
note sounding before that tick comes first (a note re-struck at the same tick is not cut), and a
note that starts and ends at the same tick (a zero-length note) is played and released.

`speed` must be above 0, `tail` 0 or more, and `transpose` a whole number of semitones;
anything else throws `SupersynthError`.

`playMidi()` resolves when the file and its tail have played. It also resolves, early, when
output stops (`synth.stop()` or `synth.close()`). To stop it yourself, pass an `AbortSignal`:
aborting releases the notes it was playing (on every instrument and division it used) and
rejects the promise with an `AbortError` (a `SupersynthError`). An error while it plays rejects
the promise too.

```ts
const ac = new AbortController();
const playing = synth.playMidi('song.mid', { signal: ac.signal });
setTimeout(() => ac.abort(), 10_000);
await playing.catch((e) => { if (!(e instanceof AbortError)) throw e; });
```

Events are sent to the engine ahead of time, a second and a half at most and never more than
its queue holds (see [the event queue](synth.md#the-event-queue)), so files of any length and
density play.

`parseMidiFile(bytes)` gives the file as data, `{ events, duration, tracks, trackNames,
ticksPerBeat }`: `events` in time order, each with `time` (seconds, the file's tempo changes
applied), `track` (0-based), `channel` (1–16) and its `type` — `noteOn` (`note`, `velocity`),
`noteOff` (`note`), `cc` (`controller`, `value`), `pitchBend` (`value`, −1 … 1) or `program`
(`program`); `duration` is the time of the last event. It reads Standard MIDI Files of format 0
and 1 timed in ticks per beat; format 2, SMPTE timing, and a file that is not a Standard MIDI
File or is truncated or corrupt throw `MidiError`.

## Hardware input

```ts
synth.add('grand-piano').midi(1);           // MIDI channel 1
synth.add('strings').midi(2);               // MIDI channel 2
await synth.start();                        // real-time output: the keys sound only while it runs
await synth.enableMidi('Arturia');          // substring of the device name; omit for the first device
synth.on('midi', (e) => console.log(e.type, e.channel, e.note, e.velocity));
```

An enabled MIDI input keeps Node.js running until `disableMidi()` or `synth.close()`.

The `'midi'` event's `MidiEvent` has `type` (`'noteOn'`, `'noteOff'`, `'cc'`, `'programChange'`,
`'pitchBend'` or `'unknown'`), `channel` (1–16), `raw` (the bytes) and, as the type has them,
`note` and `velocity`, `controller` and `value` (0–127), `program`, or `value` (−1 … 1 for pitch
bend). A note-on with velocity 0 arrives as `'noteOff'`.

Nothing plays from a MIDI keyboard until it is given a channel: `instrument.midi(n)` (or
`instrument.midi()` for every channel) and `organ.midi({ great: 1, … })`. A channel belongs to
one instrument or division at a time; giving it to another takes it over, and calling `midi()`
again replaces the channels an instrument or organ had.

With `route: true` (default) notes and controllers go straight to the engine, with no
JavaScript round trip, while real-time output runs (`synth.start()`); stopped, nothing sounds.
Offline (`render()`) a MIDI keyboard plays nothing. Messages apply at the start of the next
audio buffer, so their timing varies by up to one buffer (`bufferSize`). Live input has room of
its own in the engine's queue: events scheduled ahead by a program never crowd it out. Set
`route: false` to handle everything yourself in the `'midi'` event, which is emitted for every
message either way. `disableMidi()` disconnects.

An organ assigns its divisions to channels with `organ.midi({ great: 1, swell: 2, pedal: 3 })`
(couplers apply, program changes select presets; see [organ.md](organ.md#midi-keyboards)).
