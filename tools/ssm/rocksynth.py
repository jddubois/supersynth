"""The rock synth: an analog-style polysynth voice, computed here (no recordings, nothing to
license) and analysed into the model `rock-synth` like any recorded instrument.

  python rocksynth.py model    write the source tones and build `rock-synth` into its package
  python rocksynth.py tones    only write the tones (data/samples/rocksynth/<note>_v<layer>.wav),
                               which `python build.py rock-synth` analyses (instruments.py)
  python rocksynth.py eval     the engine against the source: on the tones the model was built
                               from, and on notes and velocities between them (needs `ssrender`)

The voice is one oscillator of the classic subtractive synthesizer: a sawtooth through a
resonant low-pass filter whose cutoff an envelope opens at the key press and lets fall back
while the key is held (the "brass" patch of the polysynths of around 1980), with an organ-like
amplitude envelope. Playing harder opens the filter further. It is computed additively: every
harmonic of the sawtooth (1/k) times the filter's gain at that harmonic's frequency at that
moment, so there is no aliasing and no filter to discretise.

What makes such a synth fat is two or three of these oscillators a few cents apart. Those are
not in the model: the instrument definition (src/catalog/synths.ts) plays the model in several
detuned, panned layers, so the oscillators beat freely against each other in the engine as
they do in the machine, at a rate that follows the pitch, instead of a recorded beat looping.
"""
from __future__ import annotations

import argparse
import math
import os

import numpy as np
import soundfile as sf
from scipy import signal

from analysis import midi_to_hz
from paths import DATA_ROOT, model_path

MODEL = 'rock-synth'
ROOT = os.path.join(DATA_ROOT, 'samples', 'rocksynth')
NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

SR = 48000
NOTES = list(range(24, 109, 3))     # C1 … C8, every minor third
# Dynamic layers and the velocity each is played at (build.py's spread for three layers):
# `hardness` 0 … 1 is the voice's own velocity control.
LAYERS = {'1': 0.0, '2': 0.5, '3': 1.0}
LAYER_VELOCITY = {'1': 50, '2': 85, '3': 118}
HOLD_S = 3.0
TAIL_S = 0.7

# The voice (times in seconds, cutoffs at middle C)
CUTOFF_HZ = (1100.0, 3200.0)        # filter cutoff while a key is held: softest, hardest
ENV_OCTAVES = (1.2, 2.0)            # how far the envelope opens the filter above that
KEY_TRACK = 0.6                     # octaves of cutoff per octave of pitch
RESONANCE_Q = 1.25                  # a 2 dB bump at the cutoff
LEVEL_DB = (-8.0, 0.0)              # softest, hardest
F_ATTACK = 0.015                    # filter envelope: linear rise
F_DECAY = 0.22                      # … then an exponential fall to the held cutoff (time constant)
F_RELEASE = 0.12                    # the filter closes after the key is released (time constant)
A_ATTACK = 0.004                    # amplitude: linear rise
A_RELEASE = 0.06                    # amplitude after the release (time constant: 145 dB/s)
EVAL_MAX_HZ = 16000.0               # `eval` compares the harmonics below this
FLOOR_DB = -72.0                    # harmonics that never get above this (re the strongest) are left out


def hardness_of(velocity: float) -> float:
    """The voice's hardness at a MIDI velocity: the layers' velocities, linear between."""
    names = sorted(LAYERS)
    return float(np.interp(velocity, [LAYER_VELOCITY[n] for n in names], [LAYERS[n] for n in names]))


def filter_gain(f: np.ndarray, fc: np.ndarray) -> np.ndarray:
    """Magnitude of the low-pass at frequencies f for cutoffs fc: a resonant two-pole
    (12 dB/octave) and one more pole an octave and a half above it."""
    r = f / fc
    return 1.0 / np.sqrt((1 - r * r) ** 2 + (r / RESONANCE_Q) ** 2) / np.sqrt(1 + (r / 3.0) ** 2)


def tone(note: float, hardness: float, hold_s: float = HOLD_S, tail_s: float = TAIL_S) -> np.ndarray:
    """One note of the voice: key down at 0, up at `hold_s`. Mono, full scale = 1 for the
    loudest layer's sawtooth (the caller scales)."""
    f0 = midi_to_hz(note)
    n = int((hold_s + tail_s) * SR)
    t = np.arange(n) / SR
    # control signals on a 0.5 ms grid
    tc = np.arange(0, hold_s + tail_s + 0.001, 0.0005)
    fenv = np.where(tc < F_ATTACK, tc / F_ATTACK, np.exp(-(tc - F_ATTACK) / F_DECAY))
    at_release = float(np.interp(hold_s, tc, fenv))
    held = np.interp(hardness, [0, 1], np.log2(CUTOFF_HZ)) + KEY_TRACK * (note - 60) / 12
    octaves = float(np.interp(hardness, [0, 1], ENV_OCTAVES))
    # after the release the cutoff falls on, two octaves below its held value
    rel = np.clip(tc - hold_s, 0, None)
    fenv = np.where(tc < hold_s, fenv, at_release * np.exp(-rel / F_RELEASE))
    close = -2.0 * (1 - np.exp(-rel / F_RELEASE))
    fc = 2.0 ** (held + octaves * fenv + close)
    aenv = np.clip(tc / A_ATTACK, 0, 1) * np.exp(-rel / A_RELEASE)
    K = int(0.45 * SR / f0)
    k = np.arange(1, K + 1)
    gains = filter_gain(k[None, :] * f0, fc[:, None]) / k[None, :] * aenv[:, None]      # (control, K)
    keep = gains.max(axis=0) > gains.max() * 10 ** (FLOOR_DB / 20)
    y = np.zeros(n)
    for i in np.where(keep)[0]:
        y += np.interp(t, tc, gains[:, i]) * np.sin(2 * math.pi * k[i] * f0 * t)
    return y * (2 / math.pi) * 10 ** (float(np.interp(hardness, [0, 1], LEVEL_DB)) / 20)


def file_name(note: int, layer: str) -> str:
    return f'{NOTE_NAMES[note % 12]}{note // 12 - 1}_v{layer}.wav'


def write_tones() -> int:
    os.makedirs(ROOT, exist_ok=True)
    for f in os.listdir(ROOT):
        if f.endswith('.wav'):
            os.remove(os.path.join(ROOT, f))
    for note in NOTES:
        for layer, hardness in LAYERS.items():
            sf.write(os.path.join(ROOT, file_name(note, layer)), 0.5 * tone(note, hardness), SR, subtype='PCM_24')
    return len(NOTES) * len(LAYERS)


def model():
    from build import build
    from instruments import INSTRUMENTS
    print(f'{write_tones()} tones → {ROOT}')
    build(MODEL, INSTRUMENTS[MODEL])


# ── evaluation ────────────────────────────────────────────────────────────────

def harmonic_tracks(y: np.ndarray, f0: float, K: int, step_s: float = 0.005) -> np.ndarray:
    """Level (dB) of the first K harmonics over time, in `step_s` steps: each harmonic is
    shifted to 0 Hz and low-passed below half the fundamental (at most 60 Hz, so the tracks
    follow changes down to about 10 ms)."""
    n = np.arange(len(y))
    sos = signal.butter(4, min(0.45 * f0, 60.0), fs=SR, output='sos')
    hop = int(step_s * SR)
    out = np.empty((len(y) // hop, K))
    for k in range(1, K + 1):
        z = signal.sosfiltfilt(sos, y * np.exp(-2j * math.pi * k * f0 * n / SR))
        out[:, k - 1] = 20 * np.log10(2 * np.abs(z[::hop][:out.shape[0]]) + 1e-12)
    return out


def level_track(y: np.ndarray, step_s: float = 0.001) -> np.ndarray:
    """Level (dB) in 1 ms steps, smoothed over 5 ms."""
    w = int(0.005 * SR)
    p = np.convolve(y * y, np.ones(w) / w, mode='same')[::int(step_s * SR)]
    return 10 * np.log10(p + 1e-20)


def compare(src: np.ndarray, eng: np.ndarray, f0: float, hold_s: float) -> dict:
    """Engine against source for one note: the differences in dB of every harmonic that is
    within 40 dB of the source's strongest at that moment (and below 16 kHz), with the common level of the note
    (the model's gain, the engine's velocity curve) removed; and the note's timing."""
    K = min(40, int(EVAL_MAX_HZ / f0))
    n = min(len(src), len(eng))
    a, b = harmonic_tracks(src[:n], f0, K), harmonic_tracks(eng[:n], f0, K)
    t = np.arange(a.shape[0]) * 0.005
    strong = a > a.max(axis=1, keepdims=True) - 40
    steady = (t >= 1.5) & (t < hold_s - 0.3)
    d = b - a
    offset = float(np.median(d[steady][strong[steady]]))
    d -= offset
    out = {'offset': offset}
    for name, sel in (('steady', steady), ('attack', (t >= 0.02) & (t < 0.1)), ('decay', (t >= 0.1) & (t < 1.0))):
        v = np.abs(d[sel][strong[sel]])
        out[name] = (float(v.mean()), float(np.percentile(v, 95)))
    # timing: the rise to 6 dB below the held level, and the fall by 20 dB after the release
    ls, le = level_track(src[:n]), level_track(eng[:n])
    for name, lv in (('src', ls), ('eng', le)):
        ms = np.arange(len(lv))
        held = float(np.median(lv[(ms >= 1500) & (ms < hold_s * 1000 - 300)]))
        out[f'rise_{name}'] = float(np.argmax(lv > held - 6))
        after = lv[int(hold_s * 1000):]
        out[f'fall_{name}'] = float(np.argmax(after < held - 20))
    return out


def evaluate(models_dir: str | None, wav_dir: str | None):
    from engine import ssrender
    path = os.path.join(models_dir, f'{MODEL}.ssm') if models_dir else model_path(MODEL)
    print(path)

    def run(cases: list[tuple[float, float]]) -> list[dict]:
        rows = []
        for note, vel in cases:
            src = 0.5 * tone(note, hardness_of(vel))
            y, _ = ssrender(path, [f'{note}:{vel}:0:{HOLD_S}'], sr=SR, tail=TAIL_S, mono=True)
            if wav_dir:
                os.makedirs(wav_dir, exist_ok=True)
                sf.write(os.path.join(wav_dir, f'{note}_{vel}.wav'), np.stack([src[:len(y)], y[:len(src)]], axis=1), SR)
            rows.append(compare(src, y, midi_to_hz(note), HOLD_S))
        return rows

    def report(title: str, rows: list[dict]):
        mean = lambda key, i: float(np.mean([r[key][i] for r in rows]))
        worst = lambda key: float(np.max([r[key][1] for r in rows]))
        print(f'\n{title} ({len(rows)} notes)')
        for key, label in (('steady', 'held tone (1.5 s on)'), ('attack', 'attack (20–100 ms)'), ('decay', 'filter decay (0.1–1 s)')):
            print(f'  {label:24s} mean |Δ| {mean(key, 0):.2f} dB, 95th percentile {mean(key, 1):.2f} dB (worst note {worst(key):.1f} dB)')
        rise = np.array([r['rise_eng'] - r['rise_src'] for r in rows])
        fall = np.array([r['fall_eng'] - r['fall_src'] for r in rows])
        print(f"  rise to −6 dB: source {np.mean([r['rise_src'] for r in rows]):.1f} ms, engine {rise.mean():+.1f} ms (worst {np.abs(rise).max():.0f} ms)")
        print(f"  fall by 20 dB after release: source {np.mean([r['fall_src'] for r in rows]):.0f} ms, engine {fall.mean():+.1f} ms (worst {np.abs(fall).max():.0f} ms)")
        off = np.array([r['offset'] for r in rows])
        print(f'  level (engine − source): {off.mean():+.1f} dB ± {off.std():.1f}')

    vels = [LAYER_VELOCITY[n] for n in sorted(LAYERS)]
    report('The tones the model was built from', run([(n, v) for n in NOTES[2:-4:3] for v in vels]))
    between = [n + d for n in NOTES[2:-4:3] for d in (1, 2)]
    report('Notes between them (same velocities)', run([(n, v) for n in between[::2] for v in vels]))
    mid = [(vels[0] + vels[1]) // 2, (vels[1] + vels[2]) // 2]
    report(f'Velocities between the layers ({mid[0]}, {mid[1]}), on built notes', run([(n, v) for n in NOTES[2:-4:3] for v in mid]))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('command', choices=['model', 'tones', 'eval'])
    ap.add_argument('--models', default=None, help='eval: directory of the model (<DIR>/rock-synth.ssm); default: the package')
    ap.add_argument('--wav', default=None, help='eval: write source (left) and engine (right) of every note here')
    a = ap.parse_args()
    if a.command == 'tones':
        print(f'{write_tones()} tones → {ROOT}')
    elif a.command == 'model':
        model()
    else:
        evaluate(a.models, a.wav)


if __name__ == '__main__':
    main()
