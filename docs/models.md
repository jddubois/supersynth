# How the instruments are made

Each instrument is an `.ssm` spectral model, analysed from recordings by the Python tools in
`tools/ssm/`.

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
`SUPERSYNTH_DATA_ROOT`); `instruments.py` gives the folder each model reads.
