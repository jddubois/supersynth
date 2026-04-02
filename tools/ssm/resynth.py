"""Reference (slow, numpy) resynthesis of an analysed zone — used to validate analysis."""
from __future__ import annotations

import math

import numpy as np
from scipy import signal

from analysis import NOISE_EDGES, Zone


def resynth_zone(z: Zone, sr: int = 48000, duration: float | None = None, noise: bool = True,
                 seed: int = 1) -> np.ndarray:
    T = z.times
    dur = duration or float(T[-1])
    n = int(dur * sr)
    t = np.arange(n) / sr
    cents = np.interp(t, T, z.pitch_cents)
    inst = z.f0 * 2 ** (cents / 1200)
    psi = 2 * math.pi * np.cumsum(inst) / sr
    y = np.zeros(n)
    for k in range(len(z.ratios)):
        f = z.ratios[k] * z.f0
        if f >= sr / 2 * 0.98:
            continue
        adb = np.interp(t, T, z.amps_db[:, k])
        if adb.max() < -110:
            continue
        a = 10 ** (adb / 20)
        y += a * np.cos(z.ratios[k] * psi + z.phases[k])
    if noise:
        rng = np.random.default_rng(seed)
        w = rng.standard_normal(n)
        for b in range(len(NOISE_EDGES) - 1):
            lo, hi = NOISE_EDGES[b], min(NOISE_EDGES[b + 1], sr / 2 * 0.99)
            if lo >= hi:
                continue
            sos = signal.butter(4, [lo, hi], btype='band', fs=sr, output='sos')
            bn = signal.sosfilt(sos, w)
            bn /= max(1e-9, np.sqrt(np.mean(bn[sr // 10:] ** 2)))
            lev = np.interp(t, T, z.noise_db[:, b])
            y += bn * 10 ** (lev / 20)
    return y
