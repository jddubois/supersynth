# How the instruments are made

Each instrument is an `.ssm` spectral model, analysed from recordings by the Python tools in
`tools/ssm/` (the rock synth's from computed tones, [below](#the-rock-synth)).

## Analysis (`analysis.py`)

Each recording (one note at one dynamic level) goes through these steps:

1. **Onset, pitch and string stiffness.** f0 and the stiffness coefficient *B* in
   f_k = k·f0·√(1 + B k²) are fitted from the low partials outwards (strongly stretched piano
   partials are found iteratively).
2. **Pitch track.** The common frequency deviation of the strongest partials gives vibrato, glides
   and drift.
3. **Partials.** Every partial is demodulated with a Blackman window of 3–4 fundamental periods
   following the pitch track (pitch-synchronous, so neighbours fall in the window's nulls).
   Trajectories are smoothed to the model's time grid; faster fluctuations are stochastic and go
   to the residual.
4. **Free partials.** Stable spectral peaks in the residual, such as sympathetic and duplex
   resonances or the modes of a bell or bar, become extra inharmonic oscillators.
5. **Noise.** The residual's power in 30 bands, over time (breath, bow, hammer, key and wind noise).
   For sustained tones the level is set by the residual's density *between* the harmonics;
   leftover energy right at the harmonics is partial fluctuation (rendered as shimmer).
6. **Attack.** For nearly every instrument the first 40–250 ms of the recording are kept and
   cross-faded into the model (a windowed analysis would smear a hammer click or a pipe's
   speech). A note between recorded pitches plays the attack of the nearest recording,
   resampled by linear interpolation to its pitch.
7. **Stereo image.** For stereo recordings (organ pipes in a church, room microphones) both
   channels are demodulated. Every harmonic within 40 dB of the strongest keeps its stereo image
   as a trajectory: the left/right level difference, the inter-channel phase, and the phase
   wander of the left channel. In a room, each partial's image drifts as the pitch moves through
   the room's modes. With a static image that drift ends up in the residual, and the noise model
   reads it as 30 dB of extra wind noise.
8. **Loops and release.** A steady region for sustained sounds (played forwards and backwards in
   parameter space, so there are no loop clicks) and per-partial release rates. Loops start only
   once the phases have settled after the attack; each harmonic's mean phase drift over the loop
   is folded into its frequency, so reversing the loop never flips it. At note-off, playback
   continues with the recording's own release, starting where its level begins to fall. That
   point is measured on the signal near the release marker, because GrandOrgue cue points can
   sit up to 200 ms before the pipe actually stops speaking. The frames between the loop and the
   release are never played, so they're dropped.

Everything is stored on a non-uniform time grid, with 2 ms steps during the attack and up to
80 ms in long decays. A zone can have its own frame times: organ pipes get 5 ms frames over the
first 0.35 s of their release, since a pipe drops 10 dB within about 20 ms of the pallet
closing, and 40 ms frames smeared that into a late, soft release. Partial envelopes are stored
in 1/16 dB steps; 0.5 dB steps were audible as a faint flutter on steady organ tones.

## Playback (`native/core/src/voice/spectral.rs`)

Every 64-sample block, up to four zones (two pitches × two dynamics) are blended, with partial
amplitudes interpolated in dB and optionally formant-preserving. The envelope timing, pitch
curve and attack come from whichever zone has the most weight, so they switch from one
recording to the other halfway between them. The oscillators are vectorised complex rotators.
The noise for all voices of a part is synthesised together in the frequency domain, so its cost
doesn't grow with polyphony. Envelopes, pitch and stereo image are interpolated between analysis
frames with clamped Catmull-Rom splines; with linear interpolation, the corners at the frame
rate came through as a faint 50–100 Hz flutter. The turning points of the sustain loop are
picked at random on every pass, so a held chord never repeats with a fixed period.

## The rock organ

`rock-organ` is built differently (`tools/ssm/freepats.py`). Its recordings, the FreePats rock
organ (CC0; 16 notes in stereo, recorded from the setBfree synthesizer), are a tonewheel organ
through its rotary speaker at the fast speed. The organ's own tone is steady, a fixed set of sine
waves per note, and all the movement is the speaker's. So the two are separated:

1. **The tone.** For each recorded note, the long-term power of every harmonic of the 16'
   drawbar, over both channels and whole rotations (the speaker spreads a harmonic over up to
   ±100 Hz and moves its level by 20 dB, but its power over a turn stays). Harmonics within
   42 dB of the strongest are kept. The partials are tuned as tonewheels are, in equal
   temperament: the 5 1/3', 2 2/3' and 1 1/3' drawbars 2 cents above the harmonic, the 1 3/5'
   14 cents. The tone is written as a recording without the speaker and analysed like any
   other.
2. **The speaker.** The engine's rotary speaker (`leslie`, `native/core/src/fx/leslie.rs`): two
   rotors, each heard by two microphones along a direct path and a reflection. Its rotor
   speeds, path lengths, gains and microphone angles were fitted to the recordings: per
   harmonic, how far the level swings, how fast, how far the pitch swings, and how alike the
   two channels are.
3. **Calibration.** Each recorded note is rendered through the engine with the speaker
   running, and every harmonic of the tone is moved by the difference between recording and
   render, three times over. The model therefore holds the tone that, through the engine's
   speaker, has the recordings' long-term spectrum.

A model with the rotation in it would play each note of a chord through a speaker of its own,
at whatever position that note's recording started in, and could not change speed. This way
every note goes through the one speaker, and `leslie` switches it between fast, slow and
stopped with the rotors' inertia.

`rotary_eval.py` measures the result on the 16 recorded notes, engine against recording:

| | recording | engine |
|---|---|---|
| Long-term level of each harmonic within 25 dB of the strongest | | within 0.1 dB (mean 0.02 dB) |
| Level swing of a harmonic, 5th to 95th percentile: below 200 Hz / 200–800 Hz / 0.8–2 kHz / above 2 kHz | 12.5 / 16.2 / 17.5 / 16.2 dB | 12.9 / 16.2 / 14.8 / 15.2 dB |
| Pitch swing of a harmonic (level-weighted), same bands | 39 / 34 / 32 / 32 cents | 32 / 28 / 33 / 32 cents |
| Correlation of the left and right level swings, same bands | −0.70 / 0.03 / 0.00 / −0.07 | −0.38 / 0.08 / −0.15 / −0.01 |
| Rotor speeds | 5.95 and 7.05 turns a second | the same |

These are medians over the harmonics in each band. What they don't show:

- The first row is what the calibration matches, on the notes it was calibrated with: it says
  the fit converged, not how the 45 notes between the recordings sound (their tone is blended
  from the two nearest recorded notes).
- The other rows are statistics. The rotors' positions when a note starts are arbitrary, in
  the recordings and in the engine, so the waveforms can't be compared, and two speakers with
  the same statistics need not sound the same. The strongest modulation rate of a harmonic
  (which multiple of the rotor speed) often differs between the two.
- Only the fast speed was recorded. The slow and stopped speaker, and the time the rotors take
  to change speed, are the engine's own.
- No listening test has been recorded.

## The rock synth

`rock-synth` has no recordings (`tools/ssm/rocksynth.py`). Its source is computed: one
oscillator of an analog-style polysynth, a sawtooth through a resonant low-pass filter
(12 dB/octave, one more pole an octave and a half higher) whose cutoff an envelope opens in
15 ms at the key press and lets fall back with a 0.22 s time constant while the key is held.
Playing harder opens the filter further (held cutoff 1.1 to 3.2 kHz at middle C, 1.2 to 2
octaves more at the peak) and is louder. The tones are computed additively, each harmonic of the
sawtooth times the filter's gain at its frequency at that moment, so they have no aliasing.
29 notes (every minor third, C1 to C8) at three hardnesses are written as 3.7 s recordings and
analysed like any other, without a stored attack: the whole note is partial envelopes, so
`brightness`, `evenHarmonics` and the like act on the attack as well.

The detuned oscillators that make such a synth fat are not in the model. The instrument
definition (`src/catalog/synths.ts`) plays the model in two or three layers a few cents apart,
panned left and right, so they beat in the engine as oscillators do, at a rate that follows
the pitch, and no recorded beat loops. The presets differ in those layers and in the engine's
effects (chorus, drive, legato, vibrato).

`rocksynth.py eval` compares the engine (one layer, no effects) with the source. Because the
source is computed, it can be computed for notes and velocities that are not in the model as
well, which recorded instruments don't allow. Per note, the level of every harmonic below
16 kHz and within 40 dB of the strongest is followed in 5 ms steps, and the common level of
the note is removed:

| Engine − source | the notes in the model (24) | notes between them (24) | velocities between the layers (16) |
|---|---|---|---|
| Held tone, 1.5 s on: mean, 95th percentile | 0.02 dB, 0.04 dB | 0.02 dB, 0.04 dB | 0.4 dB, 1.5 dB |
| Filter decay, 0.1–1 s | 0.02 dB, 0.04 dB | 0.07 dB, 0.3 dB | 0.6 dB, 2.1 dB |
| Attack, 20–100 ms | 0.2 dB, 1.0 dB | 0.4 dB, 1.3 dB | 2.5 dB, 6.0 dB |
| Rise to 6 dB below the held level (source 2 ms) | 3 ms later (worst 9 ms) | 3 ms later (worst 8 ms) | 3 ms later (worst 9 ms) |
| Fall by 20 dB after the release (source 120 ms) | 11 ms later (worst 43 ms) | 11 ms later (worst 41 ms) | 10 ms later (worst 43 ms) |

(The percentiles are means over the notes of each note's 95th percentile.) What this shows and
what it doesn't:

- The engine reproduces the computed voice closely at the three velocities in the model, also
  between the notes. Between those velocities it blends two layers' levels in dB and takes
  the envelope's timing from the nearer one, where the source moves its filter: the attack is
  off by a few dB there, as a difference in how far the filter has opened at a given moment.
- The attack is softened, most in the bass: the analysis window is 3 to 4 periods long, so the
  4 ms rise takes up to 9 ms longer, and the release starts late by up to 40 ms.
- It says nothing about any real synthesizer. The source is this script's idea of one: no
  oscillator drift but the layers' detuning and `humanize`, an idealised filter, no noise.
- It measures one layer without effects. The presets' sound (detuned layers, chorus, drive)
  is the engine's own and has nothing to be compared with.
- No listening test has been recorded.

## Evaluation

The scripts below compare the engine's output with the recordings. They write their results to
`data/eval`, which is git-ignored, so no results are included in the repository, and no listening
tests have been recorded either. They're development tools, not evidence of how close the
instruments sound to the originals. Each one's known limitations are noted below.

- `fidelity.py <id>` measures properties of a sustained tone (level of each harmonic, amplitude
  flutter, frequency wander, stereo level difference and coherence, the noise floor between the
  harmonics, attack and release). It reports the engine's distance to the recording next to the
  distance between two halves of the same recording. By default it resynthesises notes the
  model was built from, which says how well the model fits its own data, not how well it plays
  other notes.
- `discriminate.py <id>` trains a classifier to tell real from synthetic windows (AUC 0.5: it
  cannot tell them apart) and lists the features it relies on. Its features are largely the
  statistics the analysis was tuned to reproduce, and it runs on the notes the model was built
  from. It is an automated test, not a listening test. It needs scikit-learn.
- `evaluate.py <id> --holdout` builds a model without every other recorded pitch and compares the
  synthesis of the missing notes with their recordings, and with a simple sampler: the nearest
  kept recording, resampled by the semitone ratio (no loop, no blending of neighbours). The
  comparison has biases:
  - the metric is a smoothed log-mel spectral distance, which favours a smooth model over
    another real recording with its own fluctuations;
  - the model is released at the held-out recording's own length, while the sampler is not;
  - `eval_all.py` tests at most 8 notes per instrument, and reports means only.
- `organ_eval.py` sums the real recorded pipes of a registration and compares them with the
  engine. `organ_hymn.py` plays a hymn through the organ API and, from the same note list, on
  the recorded pipes, and compares the two. Every pipe is in the model, so neither tests notes
  the model has not seen.
- `blind.py make` writes loudness-matched, randomised A/B pairs (a real held-out note and its
  synthesis, mono, cut to 3.5 s) and an answer key. `blind.py score` scores answer files
  against the key. No answers are stored in the repository. Cutting to 3.5 s removes most
  releases, and mono removes stereo cues.
- `listening_page.py` collects pairs and demos for a web page. Its data includes the answer key,
  so the page shows the pairs but cannot serve as a blind test.

## Rebuilding

```bash
cd tools/ssm
python build.py grand-piano          # one instrument
python build_all.py                  # everything (see instruments.py for sources)
```

The recordings are not in the repository and no script downloads them: get the sample
libraries named in [NOTICE.md](../NOTICE.md) and place them under `data/samples` (or set
`SUPERSYNTH_DATA_ROOT`); `instruments.py` gives the folder each model reads. The rock organ is
the exception: `python freepats.py model` downloads its recordings and builds it (after
`cargo build --release` in `native/`, for the calibration renders). The rock synth needs no
recordings: `python rocksynth.py model` computes its tones and builds it.
