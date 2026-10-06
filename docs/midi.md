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
await synth.enableMidi('Arturia');          // part of the device name, any case; omit for the first device
synth.on('midi', (e) => console.log(e.type, e.channel, e.note, e.velocity));
```

While a MIDI input is enabled, Node.js keeps running until you call `disableMidi()` or
`synth.close()`.

Each `'midi'` event is a `MidiEvent` with a `type` (`'noteOn'`, `'noteOff'`, `'cc'`,
`'programChange'`, `'pitchBend'` or `'unknown'`), a `channel` (1–16), the `device` it came from
(what was passed to `enableMidi`, left out for the input opened without one) and the `raw`
bytes. Depending on the type it also has `note` and `velocity`, `controller` and `value`
(0–127), `program`, or a pitch-bend `value` from −1 to 1. A note-on with velocity 0 arrives as
`'noteOff'`.

A MIDI keyboard doesn't play anything until you assign a channel: `instrument.midi(n)` (or
`instrument.midi()` for all channels) and `organ.midi({ great: 1, … })`. Each channel belongs to
one instrument or division at a time. Assigning it to another one moves it, and calling `midi()`
again replaces the channels an instrument or organ had before; `midi(false)` takes them all away.

With `route: true` (the default), notes and controllers go straight to the engine without a
round trip through JavaScript, but only while real-time output is running (`synth.start()`).
When output is stopped, or when rendering offline with `render()`, the keyboard doesn't play
anything. Messages take effect at the start of the next audio buffer, so their timing can vary
by up to one buffer (`bufferSize`). Live input has its own space in the engine's queue, so
events a program schedules ahead of time can't crowd it out. Set `route: false` to handle
everything yourself in the `'midi'` event, which fires for every message either way.

### Several devices

Call `enableMidi()` once per device. Each input is named by the `device` string you pass, and
an instrument or division can listen to one device's input rather than to a channel of all of
them:

```ts
await synth.enableMidi('piano', { optional: true });     // a digital piano
await synth.enableMidi('teensy', { optional: true });    // a pedalboard
const piano = synth.add('grand-piano');
const organ = synth.add('friesach');

organ.midi({ great: { device: 'piano' }, pedal: { device: 'teensy' } });   // organ mode
piano.midi({ device: 'piano' }); organ.midi({});                         // piano mode: the
                                                                         // pedalboard is silent
```

A source is a channel (`1`: channel 1 of every input), `{ device }` (every channel of that
device's input), `{ device, channel }`, or an array of these. Routes that name a device come
first for that device's messages; its other channels follow the routes for all inputs. So two
devices that send on the same channel can still play different instruments, and a device that
other programs or a session manager also send to hears only itself (see below).

Moving a channel to another instrument while keys are held is safe: a key comes up on the
instrument it went down on, and a sustain pedal held down on the instrument the channel left is
let go there.

### Devices that come and go

An input stays with its device. When the device goes away (unplugged, switched off), the keys
and pedals it held are let go, so nothing hangs. When a device whose name contains `device`
appears again, the input connects to it, with the routes it had. Devices are checked twice a
second. The `'midiDevice'` event tells you both, with `{ device, name, connected }` (`name` is
the device's full name as the system lists it), and `synth.midiInputs()` lists the inputs and
whether their device is connected now.

`enableMidi()` fails with a `MidiError` when no such device is connected, unless you pass
`optional: true`: the input then connects when the device appears. Calling `enableMidi()` again
with the same `device` (in any case) replaces that input; `disableMidi(device)` closes it and
`disableMidi()` closes every input. Up to 15 devices can be named.

On Linux, supersynth is one ALSA sequencer client (named `supersynth`, or `clientName`) with a
port per input. Each port connects only to its own device, refuses connections made by other
programs, and drops messages from anything else. Session managers such as `amidiminder`, which
connect every device to every program's ports, can't make one device's notes arrive on another
device's input.

## Output

```ts
synth.listMidiOutputs();                                       // names of the output devices
// Local Control Off on all 16 channels: a digital piano's keys then only send MIDI
const localOff = Array.from({ length: 16 }, (_, ch) => [0xb0 | ch, 122, 0]).flat();
setInterval(() => synth.sendMidi('piano', localOff), 1000);    // (it forgets when switched off)
```

`sendMidi(device, bytes)` sends one or more whole MIDI messages, each starting with its status
byte (no running status), to the first output device whose name contains `device` (any case).
It returns `false` without sending when there is no such device, so it can be called whether the
device is on or not. Bytes that aren't whole messages throw a `MidiError`. Messages go out at
once, not at a scheduled time.
