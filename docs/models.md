# How the instruments are made

Instruments are `.ssm` **spectral models** analysed from real recordings by `tools/ssm/`.

## Analysis (`analysis.py`)

For every recording (one note at one dynamic):

1. **Onset, pitch and string stiffness.** f0 and the stiffness coefficient *B* in
   f_k = k·f0·√(1 + B k²) are fitted from the low partials outwards (strongly stretched piano
   partials are found iteratively).
2. **Pitch track.** The common frequency deviation of the strongest partials gives vibrato, glides
   and drift.
3. **Partials.** Every partial is demodulated with a Blackman window of 3–4 fundamental periods
   following the pitch track (pitch-synchronous, so neighbours fall in the window's nulls).
   Trajectories are smoothed to the model's time grid; faster fluctuations are stochastic and go
   to the residual.
4. **Free partials.** Stable spectral peaks in the residual — sympathetic and duplex resonances,
   bell and bar modes — become extra, inharmonic oscillators.
5. **Noise.** The residual's power in 30 bands, over time (breath, bow, hammer, key and wind noise).
   For sustained tones the level is set by the residual's density *between* the harmonics;
   leftover energy right at the harmonics is partial fluctuation (rendered as shimmer).
6. **Attack.** For struck and plucked instruments the first 20–100 ms of the recording are kept and
   cross-faded phase-coherently into the model (a windowed analysis would smear a hammer click).
7. **Stereo image.** For stereo recordings (organ pipes in a church, room microphones) both
   channels are demodulated. Every harmonic within 40 dB of the strongest keeps its image as a
   trajectory — left/right level difference, inter-channel phase and the left channel's own
   phase wander — because in a room the image of each partial drifts as the pitch wanders through
   the room's modes. (A static image leaves that drift in the residual, where the noise model
   mistakes it for 30 dB of extra wind noise.)
8. **Loops and release.** A steady region for sustained sounds (played forwards and backwards in
   parameter space, so there are no loop clicks) and per-partial release rates. Loops start only
   once the phases have settled after the attack; each harmonic's mean phase drift over the loop
   is folded into its frequency, so reversing the loop never flips it. Note-off continues with
   the recording's own release from where its level starts to fall — measured on the signal
   near the release marker (GrandOrgue cue points sit up to 200 ms before the pipe stops
   speaking) — and the frames between the loop and the release, never played, are dropped.

All on a non-uniform time grid (2 ms steps during the attack, up to 80 ms in long decays).
A zone can carry its own frame times: organ pipes get 5 ms frames over the first 0.35 s of
their release (a pipe falls 10 dB within ~20 ms of the pallet closing, which 40 ms frames
smeared into a late, soft release).
Partial envelopes are stored with 1/16 dB resolution (0.5 dB steps were audible as a faint
flutter on steady organ tones).

## Playback (`native/core/src/voice/spectral.rs`)

Up to four zones (two pitches × two dynamics) are morphed every 64-sample block, partial
amplitudes interpolated in dB (optionally formant-preserving), oscillators run as vectorised
complex rotators, and the noise of all voices of a part is synthesised together in the frequency
domain (cost independent of polyphony). Envelopes, pitch and stereo image are interpolated
between analysis frames with clamped Catmull-Rom splines (linear interpolation's corners at the
frame rate are a faint 50–100 Hz flutter). The sustain loop's turning points are re-drawn at
random on every pass, so a held chord never repeats with a fixed period.

## Validation (`fidelity.py`, `discriminate.py`, `evaluate.py`, `blind.py`, `organ_eval.py`)

- `fidelity.py <id>` measures what is audible in a sustained tone — per-harmonic level, amplitude
  flutter and its modulation spectrum, frequency wander, stereo level difference and coherence,
  the noise floor between the harmonics, attack and release — and reports the engine's distance
  to the recording next to the *real-vs-real floor*: the distance between two halves of the same
  recording. Frame-by-frame spectral distance would penalise a synthetic sustain for not
  reproducing one take's exact random fluctuations, which a second take would not either.
- `discriminate.py <id>` is a classifier two-sample test: a gradient-boosted classifier tries to
  tell real from synthetic windows of notes it was not trained on (AUC 0.5 = indistinguishable)
  and reports the features it relies on — the remaining tells. Sustain windows, attacks and
  releases (octave-band decay after note-off) are tested separately.

- `evaluate.py <id> --holdout` builds a model without every other recorded pitch and compares the
  synthesis of the missing notes with their recordings — and with a sampler pitch-shifting the
  nearest recording.
- `organ_eval.py` sums the real recorded pipes of a registration and compares with the engine.
- `organ_hymn.py` plays a hymn through the public organ API and, from the same note list, on
  the real pipes (each pipe's recorded attack and sustain, crossfaded at note-off into its
  recorded release, as a sampler would), and compares the two.
- `blind.py make/score` creates loudness-matched, randomised A/B pairs (real vs synthesised
  held-out notes) for blind discrimination tests.

## Rebuilding

```bash
cd tools/ssm
python build.py grand-piano          # one instrument
python build_all.py                  # everything (see instruments.py for sources)
```
