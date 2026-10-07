"""Objective comparison between a reference recording and a synthesized rendition."""
from __future__ import annotations

import math

import numpy as np
from scipy import signal


def _mel_fb(sr, nfft, nmels=80, fmin=30.0, fmax=None):
    fmax = fmax or sr / 2
    def hz2mel(f): return 2595 * np.log10(1 + f / 700)
    def mel2hz(m): return 700 * (10 ** (m / 2595) - 1)
    mpts = np.linspace(hz2mel(fmin), hz2mel(fmax), nmels + 2)
    hz = mel2hz(mpts)
    bins = np.fft.rfftfreq(nfft, 1 / sr)
    fb = np.zeros((nmels, len(bins)))
    for i in range(nmels):
        l, c, r = hz[i], hz[i + 1], hz[i + 2]
        fb[i] = np.clip(np.minimum((bins - l) / (c - l), (r - bins) / (r - c)), 0, None)
    return fb


def logmel(x, sr, nfft=2048, hop=256, nmels=80):
    f, t, Z = signal.stft(x, fs=sr, nperseg=nfft, noverlap=nfft - hop)
    P = np.abs(Z) ** 2
    M = _mel_fb(sr, nfft, nmels) @ P
    return t, 10 * np.log10(M + 1e-12)


def align(ref, syn, sr):
    """Trim both to their onsets and to a common length."""
    from analysis import find_onset
    a = ref[find_onset(ref, sr):]
    b = syn[find_onset(syn, sr):]
    n = min(len(a), len(b))
    return a[:n], b[:n]


def metrics(ref, syn, sr, seconds=None, noise=None):
    """`noise`: a stretch of the reference recording with no note in it (its room tone). With
    it, `lsd_floor_db` and `env_floor_db` also compare the two only above that noise floor (per
    mel band, and broadband): what the recording's room adds (rumble, hiss) is not the note's."""
    ref, syn = align(ref, syn, sr)
    if seconds:
        n = int(seconds * sr)
        ref, syn = ref[:n], syn[:n]
    # level-match: global gain is a free parameter (velocity curve / normalisation)
    g = np.sqrt(np.mean(ref ** 2) / max(np.mean(syn ** 2), 1e-20))
    syn = syn * g
    gain_db = float(20 * np.log10(g + 1e-12))
    _, A = logmel(ref, sr)
    _, B = logmel(syn, sr)
    top = max(A.max(), B.max())
    floor = top - 80
    A2, B2 = np.maximum(A, floor), np.maximum(B, floor)
    mask = (A > floor) | (B > floor)
    lsd = float(np.mean(np.abs(A2 - B2)[mask]))
    # attack-only distance (first 150 ms)
    na = max(1, int(0.15 * sr / 256))
    lsd_attack = float(np.mean(np.abs(A2[:, :na] - B2[:, :na])))
    # envelope correlation
    ea = 10 * np.log10(np.convolve(ref ** 2, np.ones(480) / 480, 'same') + 1e-12)[::240]
    eb = 10 * np.log10(np.convolve(syn ** 2, np.ones(480) / 480, 'same') + 1e-12)[::240]
    env_err = float(np.mean(np.abs(np.maximum(ea, ea.max() - 60) - np.maximum(eb, ea.max() - 60))))
    # spectral centroid trajectories
    def centroid(x):
        f, t, Z = signal.stft(x, fs=sr, nperseg=2048, noverlap=2048 - 512)
        P = np.abs(Z)
        c = (f[:, None] * P).sum(0) / (P.sum(0) + 1e-12)
        e = P.sum(0)
        return c, e
    ca, wa = centroid(ref)
    cb, _ = centroid(syn)
    w = wa / wa.sum()
    cent_err = float(np.sum(w * np.abs(np.log2((cb + 1) / (ca + 1)))) * 1200)  # cents
    out = {'gain_db': gain_db, 'lsd_db': lsd, 'lsd_attack_db': lsd_attack, 'env_err_db': env_err,
           'centroid_err_cents': cent_err}
    if noise is not None and len(noise) >= 4096:
        _, N = logmel(noise, sr)
        nf = np.median(N, axis=1, keepdims=True) + 3.0        # per band, 3 dB above the room
        A3, B3 = np.maximum(A2, nf), np.maximum(B2, nf)
        m3 = (A2 > nf) | (B2 > nf)
        out['lsd_floor_db'] = float(np.mean(np.abs(A3 - B3)[m3])) if m3.any() else 0.0
        out['attack_floor_db'] = float(np.mean(np.abs(A3[:, :na] - B3[:, :na])))
        en = 10 * np.log10(np.mean(noise ** 2) + 1e-20) + 3.0
        ka = ea > en
        out['env_floor_db'] = float(np.mean(np.abs(np.maximum(ea, en) - np.maximum(eb, en)))) if ka.any() else 0.0
    return out


def plot_pair(ref, syn, sr, path, title='', labels=('A', 'B'), seconds=None):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    ref, syn = align(ref, syn, sr)
    if seconds:
        ref, syn = ref[:int(seconds * sr)], syn[:int(seconds * sr)]
    fig, axes = plt.subplots(2, 2, figsize=(14, 7), gridspec_kw={'width_ratios': [3, 1]})
    for row, (x, lab) in enumerate(zip((ref, syn), labels)):
        f, t, Z = signal.stft(x, fs=sr, nperseg=2048, noverlap=2048 - 256)
        S = 20 * np.log10(np.abs(Z) + 1e-9)
        vmax = S.max()
        ax = axes[row, 0]
        ax.pcolormesh(t, f, S, vmin=vmax - 90, vmax=vmax, shading='auto', cmap='magma')
        ax.set_yscale('symlog', linthresh=500)
        ax.set_ylim(30, sr / 2)
        ax.set_title(f'{lab} spectrogram')
        # zoomed waveform of the attack
        ax2 = axes[row, 1]
        n = int(0.08 * sr)
        ax2.plot(np.arange(n) / sr * 1000, x[:n], lw=0.6)
        ax2.set_title(f'{lab} first 80 ms')
        ax2.set_xlabel('ms')
    fig.suptitle(title)
    fig.tight_layout()
    fig.savefig(path, dpi=80)
    plt.close(fig)
