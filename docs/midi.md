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

Supported messages are note on/off, sustain (CC64), sostenuto (CC66), soft pedal (CC67),
modulation (CC1), volume (CC7), pan (CC10), expression (CC11), reverb send (CC91) and pitch bend.
Program changes and other controllers are ignored. On instruments with dampers (pianos,
harpsichords, vibraphone) CC64 is continuous: values between about 32 and 96 half-pedal; on
everything else it switches at 64. Sostenuto acts on instruments with dampers, the soft pedal
on pianos and harpsichords. Channel 10 (GM drums) is skipped unless you map it.

With `byTrack: true`, instruments are assigned per track instead of per channel, and the keys
of `channels` are 0-based track indices (`0` is the first track). Channel 10 isn't skipped in
this mode, so map or leave out drum tracks yourself. Channels or tracks without notes don't get
an instrument. A target can be an instrument id, an `Instrument` or a `Division`. Passing an
organ id throws; pass one of its divisions instead, such as `organ.great`.

An instrument or division you pass in is played as it is (an organ division with its couplers).
When the file ends or is aborted, its notes are released and the sustain pedal, modulation,
expression and pitch bend are reset, so nothing the file left on carries over. Volume, pan and
reverb send stay where the file left them. An instrument given by id is added for the file and
removed afterwards, so you can render the same file as many times as you like.

Events on the same tick are ordered the way a player would expect. A note-off for a note that
started earlier comes first, so a note re-struck on that tick isn't cut off, and a zero-length
note (one that starts and ends on the same tick) is still played and released.

`speed` must be above 0, `tail` 0 or more, and `transpose` a whole number of semitones;
anything else throws `SupersynthError`.

`playMidi()` resolves once the file and its tail have finished playing, or earlier if output
stops (`synth.stop()` or `synth.close()`). To stop it yourself, pass an `AbortSignal`. Aborting
releases the notes it was playing on every instrument and division it used, and rejects the
promise with an `AbortError` (a subclass of `SupersynthError`). Any error during playback also
rejects the promise.

```ts
const ac = new AbortController();
const playing = synth.playMidi('song.mid', { signal: ac.signal });
setTimeout(() => ac.abort(), 10_000);
await playing.catch((e) => { if (!(e instanceof AbortError)) throw e; });
```

Events are sent to the engine up to a second and a half ahead, never more than its queue can
hold (see [the event queue](synth.md#the-event-queue)), so files of any length or density will
play.

`parseMidiFile(bytes)` returns the file as data: `{ events, duration, tracks, trackNames,
ticksPerBeat }`. `events` are sorted by time, and each has a `time` in seconds (with the file's
tempo changes applied), a 0-based `track`, a `channel` from 1 to 16 and a `type`: `noteOn`
(with `note` and `velocity`), `noteOff` (`note`), `cc` (`controller`, `value`), `pitchBend`
(`value`, −1 … 1) or `program` (`program`). `duration` is the time of the last event. It reads
Standard MIDI Files of format 0 and 1 timed in ticks per beat. Format 2 files, SMPTE timing,
and files that are truncated, corrupt or not MIDI files at all throw `MidiError`.

## Hardware input

```ts
synth.add('grand-piano').midi(1);           // MIDI channel 1
synth.add('strings').midi(2);               // MIDI channel 2
await synth.start();                        // real-time output: the keys sound only while it runs
await synth.enableMidi('Arturia');          // substring of the device name; omit for the first device
synth.on('midi', (e) => console.log(e.type, e.channel, e.note, e.velocity));
```

While a MIDI input is enabled, Node.js keeps running until you call `disableMidi()` or
`synth.close()`.

Each `'midi'` event is a `MidiEvent` with a `type` (`'noteOn'`, `'noteOff'`, `'cc'`,
`'programChange'`, `'pitchBend'` or `'unknown'`), a `channel` (1–16) and the `raw` bytes. Depending
on the type it also has `note` and `velocity`, `controller` and `value` (0–127), `program`, or a
pitch-bend `value` from −1 to 1. A note-on with velocity 0 arrives as `'noteOff'`.

A MIDI keyboard doesn't play anything until you assign a channel: `instrument.midi(n)` (or
`instrument.midi()` for all channels) and `organ.midi({ great: 1, … })`. Each channel belongs to
one instrument or division at a time. Assigning it to another one moves it, and calling `midi()`
again replaces the channels an instrument or organ had before.

With `route: true` (the default), notes and controllers go straight to the engine without a
round trip through JavaScript, but only while real-time output is running (`synth.start()`).
When output is stopped, or when rendering offline with `render()`, the keyboard doesn't play
anything. Messages take effect at the start of the next audio buffer, so their timing can vary
by up to one buffer (`bufferSize`). Live input has its own space in the engine's queue, so
events a program schedules ahead of time can't crowd it out. Set `route: false` to handle
everything yourself in the `'midi'` event, which fires for every message either way.
`disableMidi()` disconnects the device.

To play an organ from MIDI, assign its divisions to channels with
`organ.midi({ great: 1, swell: 2, pedal: 3 })`. Couplers apply, and program changes select
presets; see [organ.md](organ.md#midi-keyboards).
