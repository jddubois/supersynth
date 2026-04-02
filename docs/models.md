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
5. **Noise.** The residual's power in 28 bands, over time (breath, bow, hammer, key and wind noise).
6. **Attack.** For struck and plucked instruments the first 20–100 ms of the recording are kept and
   cross-faded phase-coherently into the model (a windowed analysis would smear a hammer click).
7. **Loops and release.** A steady region for sustained sounds (played forwards and backwards in
   parameter space, so there are no loop clicks) and per-partial release rates.

All on a non-uniform time grid (2 ms steps during the attack, up to 80 ms in long decays).

## Playback (`native/core/src/voice/spectral.rs`)

Up to four zones (two pitches × two dynamics) are morphed every 64-sample block, partial
amplitudes interpolated in dB (optionally formant-preserving), oscillators run as vectorised
complex rotators, and the noise of all voices of a part is synthesised together in the frequency
domain (cost independent of polyphony).

## Validation (`evaluate.py`, `blind.py`, `organ_eval.py`)

- `evaluate.py <id> --holdout` builds a model without every other recorded pitch and compares the
  synthesis of the missing notes with their recordings — and with a sampler pitch-shifting the
  nearest recording.
- `organ_eval.py` sums the real recorded pipes of a registration and compares with the engine.
- `blind.py make/score` creates loudness-matched, randomised A/B pairs (real vs synthesised
  held-out notes) for blind discrimination tests.

## Rebuilding

```bash
cd tools/ssm
python build.py grand-piano          # one instrument
python build_all.py                  # everything (see instruments.py for sources)
```
