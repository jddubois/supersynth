"""
Spectral-model analysis: real instrument recording -> sinusoids + noise model.

Each recording (one note at one dynamic) becomes a *zone*:

  - partial frequency ratios  r_k  (inharmonicity is measured, not assumed)
  - partial amplitude envelopes  A_k(t)  on a shared, non-uniform time grid
  - a pitch-deviation track  (cents, captures vibrato / attack glides / drift)
  - start phases of every partial (keeps the attack waveform shape)
  - residual noise envelopes in fixed bands  N_b(t)  (breath, bow, hammer, wind)
  - a loop region for sustained sounds and per-partial release decay rates

The analysis is pitch-synchronous: every partial is demodulated with a window
spanning a fixed number of fundamental periods, using a phase reference that
follows the measured pitch track. This keeps each partial in the window's main
lobe through vibrato and keeps neighbouring partials out of it.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

import numpy as np
import soundfile as sf
from numba import njit, prange
from scipy import ndimage, signal

NOTE_RE = re.compile(r'(?<![A-Za-z])([A-Ga-g])([#b]?)(-?\d)(?![0-9])')
NOTE_OFFSETS = {'c': 0, 'd': 2, 'e': 4, 'f': 5, 'g': 7, 'a': 9, 'b': 11}

# Shared noise band edges (Hz). 28 bands, roughly third-octave above 200 Hz.
NOISE_EDGES = np.array([
    20, 60, 100, 150, 200, 260, 330, 420, 530, 670, 840, 1060, 1330, 1680,
    2120, 2660, 3350, 4220, 5310, 6680, 8410, 10000, 11900, 13500, 15000,
    16500, 18000, 19500, 20500, 21300, 22050,
], dtype=np.float64)


def note_name_to_midi(name: str) -> int | None:
    m = NOTE_RE.search(name)
    if not m:
        return None
    letter, acc, octv = m.groups()
    n = NOTE_OFFSETS[letter.lower()] + (1 if acc == '#' else -1 if acc == 'b' else 0)
    return 12 * (int(octv) + 1) + n


def midi_to_hz(m: float) -> float:
    return 440.0 * 2.0 ** ((m - 69.0) / 12.0)


def hz_to_midi(f: float) -> float:
    return 69.0 + 12.0 * math.log2(f / 440.0)


GRID_SEGS = [(0.0, 0.08, 0.002), (0.08, 0.3, 0.005), (0.3, 1.0, 0.01),
             (1.0, 3.0, 0.02), (3.0, 8.0, 0.04), (8.0, 60.0, 0.08)]


def grid_spacing(t: np.ndarray) -> np.ndarray:
    out = np.full(t.shape, GRID_SEGS[-1][2])
    for a, b, h in GRID_SEGS:
        out[(t >= a) & (t < b)] = h
    return out


def smooth_to_grid(amps_c: np.ndarray, frame_t: np.ndarray, scale: float = 1.0,
                   mode: str = 'complex') -> np.ndarray:
    """Moving-average partial amplitudes with a window ~ the local grid spacing.

    mode='complex' averages the complex amplitude: fast phase/amplitude turbulence
    (breath, bow, wind) cancels out and is left for the noise model.
    mode='magnitude' averages only the magnitude and keeps the phase: right for free
    vibrations (strings, bars) whose beating partials flip phase at beat minima.
    """
    if scale <= 0 or len(frame_t) < 3:
        return amps_c
    if mode == 'magnitude':
        mag = smooth_to_grid(np.abs(amps_c).astype(np.complex128), frame_t, scale, 'complex').real
        ph = np.exp(1j * np.angle(amps_c))
        return mag * ph
    hop = frame_t[1] - frame_t[0]
    half = np.maximum(0, np.round(grid_spacing(frame_t) * scale / hop / 2)).astype(np.int64)
    n = len(frame_t)
    cs = np.vstack([np.zeros((1, amps_c.shape[1]), amps_c.dtype), np.cumsum(amps_c, axis=0)])
    i = np.arange(n)
    lo = np.clip(i - half, 0, n - 1)
    hi = np.clip(i + half, 0, n - 1)
    return (cs[hi + 1] - cs[lo]) / (hi - lo + 1)[:, None]


def steady_mask(frame_t: np.ndarray, level_db: np.ndarray, t_from: float, edge_s: float) -> np.ndarray:
    """Weight 0..1 of the steady sustain: after `t_from`, while the (150 ms-smoothed) total level
    stays within 3 dB of its median, ramped over `edge_s` at both ends."""
    n = len(frame_t)
    if n < 8:
        return np.zeros(n)
    hop = frame_t[1] - frame_t[0]
    w = max(1, int(round(0.15 / hop)))
    lin = np.convolve(10 ** (level_db / 10), np.ones(w) / w, mode='same')
    sm = 10 * np.log10(lin + 1e-30)
    body = frame_t > t_from
    if body.sum() < 4:
        return np.zeros(n)
    med = np.median(sm[body & (sm > sm.max() - 25)])
    ok = body & (sm > med - 3) & (sm < med + 3)
    idx = np.where(ok)[0]
    if len(idx) < 4:
        return np.zeros(n)
    a, b = frame_t[idx[0]], frame_t[idx[-1]]
    # stop before the level starts to fall: the release must keep its own shape
    return np.clip(np.minimum((frame_t - a) / edge_s, (b - edge_s - frame_t) / edge_s), 0, 1)


def steady_smooth(x: np.ndarray, frame_t: np.ndarray, wmask: np.ndarray, win_s: float, mode: str) -> np.ndarray:
    """Blend frame-domain trajectories (frames × K) towards a `win_s` moving average where
    `wmask` > 0. mode 'mag' averages magnitudes (phase kept), 'db' plain values, 'phase'
    unit vectors (angles in, angles out)."""
    if win_s <= 0 or not wmask.any():
        return x
    hop = frame_t[1] - frame_t[0]
    w = max(1, int(round(win_s / hop)) | 1)
    def ma(v):
        pad = np.pad(v, ((w // 2, w // 2), (0, 0)), mode='edge')
        cs = np.vstack([np.zeros((1, v.shape[1]), v.dtype), np.cumsum(pad, axis=0)])
        return (cs[w:] - cs[:-w]) / w
    m = wmask[:, None]
    if mode == 'mag':
        mag = np.abs(x)
        sm = ma(mag)
        return (mag * (1 - m) + sm * m) * np.exp(1j * np.angle(x))
    if mode == 'phase':
        u = np.exp(1j * x)
        su = ma(u)
        return np.angle(u * (1 - m) + su * m)
    return x * (1 - m) + ma(x) * m


def make_time_grid(duration: float) -> np.ndarray:
    """Non-uniform grid: dense during the attack, sparse in the decay tail."""
    out = []
    for a, b, h in GRID_SEGS:
        if a >= duration:
            break
        out.append(np.arange(a, min(b, duration), h))
    return np.concatenate(out)


def load_mono(path: str, channel_mix: str = 'mean') -> tuple[np.ndarray, int]:
    x, sr = sf.read(path, dtype='float64', always_2d=True)
    if channel_mix == 'left':
        y = x[:, 0]
    elif channel_mix == 'right':
        y = x[:, -1]
    else:
        y = x.mean(axis=1)
    return y, sr


def find_onset(x: np.ndarray, sr: int, rel_db: float = -30.0) -> int:
    win = max(8, int(sr * 0.001))
    env = np.sqrt(np.convolve(x * x, np.ones(win) / win, mode='same'))
    pk = env.max()
    if pk <= 0:
        return 0
    thr = pk * 10 ** (rel_db / 20)
    idx = int(np.argmax(env > thr))
    # walk back to where the envelope stops falling (start of the rise)
    floor = pk * 10 ** ((rel_db - 20) / 20)
    j = idx
    while j > 0 and env[j] > floor and env[j - 1] <= env[j] * 1.05:
        j -= 1
    return max(0, j - int(0.0005 * sr))


# ── numba kernels ──────────────────────────────────────────────────────────────

@njit(parallel=True, cache=True)
def _demod(x, centers, half, win, dwin, psi, ratios, mode_track):
    """Windowed DFT of every partial at every frame.

    psi:  per-sample phase reference (radians of the fundamental)
    returns complex amps (F,K) and frequency offsets (F,K) in cycles/sample
    computed by reassignment with the window derivative.
    """
    F = centers.shape[0]
    K = ratios.shape[0]
    n = x.shape[0]
    L = win.shape[0]
    out = np.zeros((F, K), dtype=np.complex128)
    dev = np.zeros((F, K), dtype=np.float64)
    wsum = win.sum()
    for fi in prange(F):
        c = centers[fi]
        for k in range(K):
            r = ratios[k]
            acc_re = 0.0
            acc_im = 0.0
            dacc_re = 0.0
            dacc_im = 0.0
            for j in range(L):
                idx = c - half + j
                if idx < 0 or idx >= n:
                    continue
                v = x[idx]
                ph = -r * psi[idx]
                cr = math.cos(ph)
                ci = math.sin(ph)
                acc_re += win[j] * v * cr
                acc_im += win[j] * v * ci
                dacc_re += dwin[j] * v * cr
                dacc_im += dwin[j] * v * ci
            a = complex(acc_re, acc_im)
            out[fi, k] = 2.0 * a / wsum
            if abs(a) > 1e-12:
                q = complex(dacc_re, dacc_im) / a
                dev[fi, k] = -q.imag / (2.0 * math.pi)
    return out, dev


@njit(cache=True)
def _resynth(n, frame_pos, amps_c, psi, ratios):
    """Rebuild the harmonic part from complex frame amplitudes (linear interp)."""
    F, K = amps_c.shape
    y = np.zeros(n)
    for fi in range(F - 1):
        a = frame_pos[fi]
        b = frame_pos[fi + 1]
        if b <= a:
            continue
        for i in range(max(a, 0), min(b, n)):
            t = (i - a) / (b - a)
            s = 0.0
            for k in range(K):
                z = amps_c[fi, k] * (1 - t) + amps_c[fi + 1, k] * t
                ph = ratios[k] * psi[i]
                s += z.real * math.cos(ph) - z.imag * math.sin(ph)
            y[i] = s
    return y


# ── analysis ──────────────────────────────────────────────────────────────────

@dataclass
class Zone:
    source: str
    nominal_note: int
    layer: str
    f0: float
    ratios: np.ndarray            # (K,)
    times: np.ndarray             # (T,) seconds (prefix of the model grid)
    amps_db: np.ndarray           # (T,K)
    phases: np.ndarray            # (K,) radians at t=0
    pitch_cents: np.ndarray       # (T,)
    noise_db: np.ndarray          # (T,B)
    loop: tuple[int, int] | None
    release_db_per_s: np.ndarray  # (K,) decay rate after note-off (positive = decays)
    release_noise_db_per_s: float
    peak_db: float
    rms_db: float
    meta: dict = field(default_factory=dict)
    transient: np.ndarray | None = None      # first samples of the real recording
    transient_fade: tuple[float, float] = (0.0, 0.0)  # (start, end) of the crossfade, s
    transient_r: np.ndarray | None = None    # right channel of a stereo zone's onset


def estimate_f0(x: np.ndarray, sr: int, nominal_hz: float, t0: float, t1: float,
                octave_search: bool = True) -> float:
    a, b = int(t0 * sr), int(t1 * sr)
    seg = x[a:b]
    if len(seg) < 2048:
        seg = x[:max(len(x), 2048)]
    nfft = 1 << int(math.ceil(math.log2(max(len(seg) * 4, 1 << 16))))
    w = np.blackman(len(seg))
    mag = np.abs(np.fft.rfft(seg * w, nfft))
    freqs = np.arange(len(mag)) * sr / nfft

    def mag_at(f):
        if f <= 0 or f >= sr / 2:
            return 1e-12
        i = f * nfft / sr
        lo, hi = int(max(0, i * 0.985)), int(min(len(mag) - 1, i * 1.015 + 1))
        return mag[lo:hi + 1].max() + 1e-12

    best = nominal_hz
    if octave_search:
        cands = [nominal_hz * 2 ** (o) for o in (-1, 0, 1)]
        scores = []
        for c in cands:
            s = 0.0
            for k in range(1, 7):
                s += math.log(mag_at(k * c)) - math.log(mag_at((k - 0.5) * c))
            scores.append(s)
        best = cands[int(np.argmax(scores))]

    # refine: find peaks near k*best for the strongest harmonics, fit f0 (+ stiffness B)
    ks, fs, ws = [], [], []
    for k in range(1, 25):
        target = k * best
        if target > sr / 2 * 0.9:
            break
        i = int(round(target * nfft / sr))
        span = int(max(3, 0.03 * target * nfft / sr))
        lo, hi = max(1, i - span), min(len(mag) - 2, i + span)
        j = lo + int(np.argmax(mag[lo:hi]))
        # parabolic interpolation in log magnitude
        al, be, ga = np.log(mag[j - 1:j + 2] + 1e-12)
        p = 0.5 * (al - ga) / (al - 2 * be + ga) if (al - 2 * be + ga) != 0 else 0.0
        ks.append(k)
        fs.append((j + p) * sr / nfft)
        ws.append(mag[j])
    ks, fs, ws = np.array(ks), np.array(fs), np.array(ws)
    strong = ws > ws.max() * 10 ** (-40 / 20)
    if strong.sum() >= 1:
        # weighted estimate of f0 from the low strong partials (inharmonicity handled later)
        sel = strong & (ks <= 6)
        if sel.sum() == 0:
            sel = strong
        est = np.sum(ws[sel] * fs[sel] / ks[sel]) / np.sum(ws[sel])
        if est > 0 and best > 0 and abs(1200 * math.log2(est / best)) < 80:
            best = est
    return float(best)


def comb_fit(x, sr, f0, t0, t1, K, max_B):
    """(f0, B, per-partial ratios) from a long, low-leakage spectrum of the steady part."""
    seg = x[int(t0 * sr):int(t1 * sr)]
    if len(seg) < int(0.1 * sr):
        seg = x[:max(int(0.1 * sr), len(seg))]
    nfft = 1 << int(math.ceil(math.log2(len(seg) * 4)))
    spec = np.abs(np.fft.rfft(seg * signal.get_window('blackmanharris', len(seg)), nfft))
    ldb = 20 * np.log10(spec + 1e-12)
    binhz = sr / nfft
    kk = np.arange(1, K + 1, dtype=np.float64)
    # prominence above a local floor (median over ±f0/2): what a peak contributes
    hw = max(3, int(0.5 * f0 / binhz))
    c = max(1, hw // 2)                         # block medians (a sliding median is far too slow)
    nblk = len(ldb) // c
    med = np.median(ldb[:nblk * c].reshape(nblk, c), axis=1)
    med = ndimage.median_filter(med, size=3, mode='nearest')
    floor = np.interp(np.arange(len(ldb)), (np.arange(nblk) + 0.5) * c, med)
    prom = np.clip(ldb - floor, 0, 40)
    lobe = max(2, int(round(4 * sr / len(seg) / binhz)))      # Blackman-Harris main-lobe half width
    pmax = ndimage.maximum_filter1d(prom, 2 * lobe + 1)

    def score(f, b):
        fk = kk * f * np.sqrt(1 + b * kk ** 2)
        fk = fk[fk < 0.45 * sr]
        return pmax[np.minimum((fk / binhz).round().astype(int), len(pmax) - 1)].sum()

    cents = np.arange(-10, 10.01, 0.5)
    Bs = np.concatenate([[0.0], np.geomspace(1e-6, max_B, 90)])
    best = (score(f0, 0.0), f0, 0.0)
    base = max(score(f0 * 2 ** (c / 1200), 0.0) for c in cents)
    for b in Bs:
        for c in cents:
            f = f0 * 2 ** (c / 1200)
            sc = score(f, b)
            if sc > best[0]:
                best = (sc, f, b)
    _, f0b, Bb = best
    if best[0] < base * 1.04:      # stretching must clearly explain more of the spectrum
        Bb = 0.0
        f0b = max(((score(f0 * 2 ** (c / 1200), 0.0), f0 * 2 ** (c / 1200)) for c in cents))[1]
    model = kk * np.sqrt(1 + Bb * kk ** 2)
    ratios = model.copy()
    # measured peak frequencies where a partial stands clearly above the floor
    for i, r in enumerate(model):
        fc = r * f0b / binhz
        lo, hi = int(fc - lobe), int(fc + lobe) + 1
        if hi >= len(ldb) - 1 or lo < 1:
            continue
        j = lo + int(np.argmax(ldb[lo:hi]))
        if prom[j] < 12 or j in (lo, hi - 1):
            continue
        a, b_, c_ = ldb[j - 1], ldb[j], ldb[j + 1]
        d = 0.5 * (a - c_) / (a - 2 * b_ + c_) if (a - 2 * b_ + c_) != 0 else 0.0
        ratios[i] = (j + d) * binhz / f0b
    return f0b, Bb, ratios


def find_free_peaks(x: np.ndarray, sr: int, t0: float, t1: float, n: int,
                    exclude: np.ndarray | None = None, prominence_db: float = 12.0,
                    range_db: float = 70.0, fmin: float = 25.0) -> tuple[np.ndarray, np.ndarray]:
    """Stable sinusoidal peaks in a (long-term averaged) spectrum.

    Returns (frequencies, levels_db) of up to `n` peaks, strongest first, ignoring
    peaks within 1.5 % of any frequency in `exclude` (already-modelled partials).
    """
    a, b = int(t0 * sr), int(min(len(x), t1 * sr))
    seg = x[a:b]
    nper = 8192 if sr <= 50000 else 16384
    if len(seg) < nper:
        seg = np.pad(seg, (0, nper - len(seg)))
    f, P = signal.welch(seg, fs=sr, window='blackmanharris', nperseg=nper, noverlap=nper * 3 // 4,
                        scaling='spectrum')
    db = 10 * np.log10(P + 1e-20)
    pk, props = signal.find_peaks(db, prominence=prominence_db)
    if len(pk) == 0:
        return np.zeros(0), np.zeros(0)
    keep = (db[pk] > db.max() - range_db) & (f[pk] >= fmin) & (f[pk] <= 0.45 * sr)
    if exclude is not None and len(exclude):
        for i, p in enumerate(pk):
            if keep[i] and np.any(np.abs(exclude - f[p]) < np.maximum(0.015 * f[p], 3 * sr / nper)):
                keep[i] = False
    pk = pk[keep]
    pk = pk[np.argsort(-db[pk])][:n]
    freqs, levels = [], []
    for p in pk:
        al, be, ga = db[p - 1:p + 2]
        d = 0.5 * (al - ga) / (al - 2 * be + ga) if (al - 2 * be + ga) != 0 else 0.0
        freqs.append((p + d) * sr / nper)
        levels.append(be)
    return np.array(freqs), np.array(levels)


def analyze_zone(path: str, nominal_note: int, layer: str, *, kind: str,
                 max_partials: int = 64, periods: float = 3.0,
                 max_duration: float | None = None, onset_db: float = -30.0,
                 channel_mix: str = 'mean', octave_search: bool = True,
                 min_window_s: float = 0.0, release_from_end: bool = True,
                 smooth_scale: float = 1.0, smooth_mode: str | None = None,
                 harmonic: bool = True, free_partials: int = 0,
                 free_window_s: float = 0.04, transient: bool = False,
                 transient_max_s: float = 0.1, release_at_s: float | None = None,
                 max_loop_s: float | None = None, locked: bool | None = None,
                 max_stiffness: float = 2e-3, keep_release_tail: bool = True,
                 stereo: bool = False, steady_smooth_s: float = 0.0, phase_smooth_s: float = 0.0) -> Zone:
    if locked is None:
        locked = kind == 'sustained'
    x, sr = load_mono(path, channel_mix)
    # remove DC / sub-sonic offset (a step at the start of a stored attack would click)
    hp8 = signal.butter(2, 8.0, 'hp', fs=sr, output='sos')
    x = signal.sosfiltfilt(hp8, x)
    on = find_onset(x, sr, onset_db)
    x = x[on:]
    if max_duration:
        x = x[:int(max_duration * sr)]
    xs = None
    if stereo:
        raw2, _ = sf.read(path, dtype='float64', always_2d=True)
        if raw2.shape[1] >= 2:
            xs = [signal.sosfiltfilt(hp8, raw2[:, c])[on:on + len(x)] for c in (0, 1)]
    dur = len(x) / sr
    n = np.arange(len(x), dtype=np.float64)
    nominal_hz = midi_to_hz(nominal_note)
    steady0, steady1 = (0.15, min(dur, 1.2)) if kind == 'decaying' else (min(0.4, dur * 0.2), min(dur * 0.7, 3.0))
    smode = smooth_mode or ('magnitude' if kind == 'decaying' else 'complex')
    B = 0.0
    shimmer, shimmer_tau, shim_cut = None, 0.01, None
    stereo_img = None
    stereo_t = None

    if harmonic:
        f0 = estimate_f0(x, sr, nominal_hz, steady0, steady1, octave_search)
    else:
        # inharmonic (bells, bars, membranes): the reference pitch is the strong spectral
        # peak nearest the nominal pitch (allowing octave-naming differences)
        pf, pl = find_free_peaks(x, sr, 0.01, min(dur, 1.5), 40, prominence_db=10, fmin=0.5 * nominal_hz)
        f0 = nominal_hz
        if len(pf):
            strong = pl > pl.max() - 25
            best = None
            for oct_ in (0, -1, 1):
                target = nominal_hz * 2 ** oct_
                cand = [(abs(1200 * math.log2(fq / target)), fq) for fq, s in zip(pf, strong) if s]
                cand = [c for c in cand if c[0] < 70]
                if cand:
                    best = min(cand)[1]
                    break
            if best:
                f0 = float(best)

    # ── window setup ───────────────────────────────────────────────────────
    L = int(round(periods * sr / f0))
    L = max(L, int(min_window_s * sr), 64)
    L += (L % 2 == 0)  # odd
    half = L // 2
    win = np.blackman(L)
    dwin = np.gradient(win)
    hop = max(16, L // 4)
    centers = np.arange(0, len(x), hop, dtype=np.int64)
    cents = np.zeros(len(centers))

    if harmonic:
        K = int(min(max_partials, math.floor(0.45 * sr / f0)))
        K = max(K, 1)
        # ── pass 1: partial frequencies and string stiffness ───────────────────
        # Iteratively: measure partial deviations around the current prediction
        # r_k = k·sqrt(1 + B k²), refit (f0, B) from the strong partials, and extend
        # the fit to higher partials. Strongly stretched (piano bass/treble) partials
        # drift far from k·f0, so they must be found from the low ones outwards.
        kk = np.arange(1, K + 1, dtype=np.float64)
        fsel = (centers / sr >= steady0) & (centers / sr <= steady1)
        if fsel.sum() < 3:
            fsel = np.ones(len(centers), dtype=bool)
        sub = np.where(fsel)[0]
        if len(sub) > 48:
            sub = sub[np.linspace(0, len(sub) - 1, 48).astype(int)]
        psi0 = 2 * math.pi * n / sr        # unit-frequency phase; scaled per iteration
        ratios = kk.copy()
        kfit = min(K, 12)
        while True:
            model_ratios = kk * np.sqrt(1 + B * kk ** 2)
            a_c, dev = _demod(x, centers[sub], half, win, dwin, psi0 * f0, model_ratios, 0)
            mags = np.abs(a_c)
            strength = mags.mean(axis=0)
            fk = np.empty(K)
            for k in range(K):
                wk = mags[:, k]
                d = np.sum(wk * dev[:, k]) / max(np.sum(wk), 1e-30)   # cycles/sample offset
                fk[k] = model_ratios[k] * f0 + d * sr
            ratios = fk / f0
            good = (strength > strength.max() * 10 ** (-45 / 20)) & \
                   (np.abs(ratios / model_ratios - 1) < 0.25 / kk) & (kk <= kfit)
            if good.sum() >= 3:
                xk2 = kk[good] ** 2
                yk = (fk[good] / kk[good]) ** 2
                wk = strength[good]
                A = np.vstack([np.ones_like(xk2), xk2]).T * wk[:, None]
                coef, *_ = np.linalg.lstsq(A, yk * wk, rcond=None)
                f0_fit = math.sqrt(max(coef[0], 1e-6))
                B_fit = coef[1] / max(coef[0], 1e-9)
                if abs(1200 * math.log2(f0_fit / f0)) < 60 and -1e-5 < B_fit < 0.02:
                    f0 = f0_fit
                    B = max(0.0, B_fit)
            elif good.sum() >= 1 and good[0] and abs(ratios[0] - 1) < 0.01:
                f0 *= ratios[0]
            if kfit >= K:
                break
            kfit = min(K, kfit * 2)
        # The iterative fit can run away on weak, noisy upper partials (a pizzicato fitted
        # as a piano). Confirm (f0, B) against a high-resolution spectrum: the comb that
        # lands on the most prominent peaks wins, and B = 0 unless stretching clearly helps.
        if not locked:
            f0, B, ratios = comb_fit(x, sr, f0, steady0, steady1, K, max_stiffness)
        else:
            ratios = kk * np.sqrt(1 + B * kk ** 2)
        if locked:
            # Driven oscillators (reed, lip, bow, air jet, organ pipe) are mode-locked:
            # their partials are exact harmonics. Any measured stretch is analysis noise.
            B = 0.0
            ratios = kk.copy()

        # ── pass 2: pitch track (common-mode deviation of the low partials) ────
        psi = 2 * math.pi * f0 * n / sr
        amps_c, dev = _demod(x, centers, half, win, dwin, psi, ratios, 0)
        mags = np.abs(amps_c)
        kmax = min(K, 8)
        wts = mags[:, :kmax] ** 2
        rel = dev[:, :kmax] / ratios[None, :kmax]
        wsum = wts.sum(axis=1)
        f0dev = np.where(wsum > 0, (wts * rel).sum(axis=1) / np.maximum(wsum, 1e-30), 0.0)
        level = 10 * np.log10(wsum + 1e-30)
        loud = level > level.max() - 45
        f0dev = np.where(loud, f0dev, 0.0)
        f0dev = signal.medfilt(f0dev, 5)
        cents = 1200 * np.log2(np.clip(1 + f0dev * sr / f0, 0.5, 2.0))
        cents = np.clip(cents, -150, 150)
        last = 0.0
        for i in range(len(cents)):
            if loud[i]:
                last = cents[i]
            else:
                cents[i] = last * 0.98
                last = cents[i]

        if kind == 'decaying':
            # free vibrations have no vibrato: what the tracker sees is beating between
            # strings/modes. Keep only slow drift (it would otherwise move all partials in lockstep).
            hop_s = hop / sr
            wlen = max(3, int(round(0.25 / hop_s)) | 1)
            cents = np.convolve(np.pad(cents, wlen // 2, mode='edge'), np.ones(wlen) / wlen, mode='valid')[:len(cents)]

        # ── pass 3: demodulate following the pitch ───────────────────────────
        inst_f = f0 * 2 ** (np.interp(n, centers, cents) / 1200)
        psi = 2 * math.pi * np.cumsum(inst_f) / sr
        amps_c, dev3 = _demod(x, centers, half, win, dwin, psi, ratios, 0)
        jitter_cents, jitter_tau = measure_jitter(amps_c, dev3, ratios, f0, sr, hop,
                                                  (centers / sr >= steady0) & (centers / sr <= steady1))
        mid_gain = None
        if xs is not None:
            # Both channels: spaced room microphones give every partial its own left/right
            # level and phase. Averaging to mono first would comb-filter the partials; instead
            # keep the energy-correct source amplitude ŝ = (gL·aL + gR·e^{-iφ}·aR)/2 and the
            # per-partial image (gL, gR, φ), with gL² + gR² = 2.
            aL, _ = _demod(xs[0], centers, half, win, dwin, psi, ratios, 0)
            aR, _ = _demod(xs[1], centers, half, win, dwin, psi, ratios, 0)
            st_sel = (centers / sr >= steady0) & (centers / sr <= steady1)
            if st_sel.sum() < 3:
                st_sel = np.ones(len(centers), dtype=bool)
            PL = np.mean(np.abs(aL[st_sel]) ** 2, axis=0)
            PR = np.mean(np.abs(aR[st_sel]) ** 2, axis=0)
            cross = np.sum(aR[st_sel] * np.conj(aL[st_sel]), axis=0)
            st_ph = np.angle(cross)
            tot_p = np.maximum(PL + PR, 1e-30)
            gL = np.sqrt(2 * PL / tot_p)
            gR = np.sqrt(2 * PR / tot_p)
            stereo_img = (gL, gR, st_ph)
            # The image is not static: in a room, slight pitch wander moves each partial
            # through the room's modes, so its left/right level and phase drift. Keep the
            # smoothed channels themselves: source magnitude ŝ = √((|aL|² + |aR|²)/2) with the
            # left channel's phase, plus a per-frame image (ILD, inter-channel phase).
            aLs = smooth_to_grid(aL, centers / sr, smooth_scale, smode)
            aRs = smooth_to_grid(aR, centers / sr, smooth_scale, smode)
            mag_s = np.sqrt((np.abs(aLs) ** 2 + np.abs(aRs) ** 2) / 2)
            ild_t = 20 * np.log10((np.abs(aLs) + 1e-12) / (np.abs(aRs) + 1e-12))
            iph_t = np.angle(aRs * np.conj(aLs))
            raw_c = (aL + aR) / 2
            # the residual (noise model) is taken against the unsmoothed trajectories: what the
            # steady smoothing below removes is partial fluctuation, not broadband noise
            mono_s = (aLs + aRs) / 2
            if steady_smooth_s > 0:
                # A pipe's steady tone is steadier than a short analysis window can tell:
                # what the window sees as fast partial flutter is mostly wind and room noise
                # inside the partial's bandwidth. Average it out over the sustain (it stays
                # in the residual, as noise). The image changes slowly too.
                wm = steady_mask(centers / sr, 10 * np.log10(np.sum(mag_s ** 2, axis=1) + 1e-30), 0.3, 0.08)
                mag_s = np.abs(steady_smooth(mag_s.astype(np.complex128), centers / sr, wm, steady_smooth_s, 'mag'))
                ild_t = steady_smooth(ild_t, centers / sr, wm, steady_smooth_s, 'db')
                iph_t = steady_smooth(iph_t, centers / sr, wm, steady_smooth_s, 'phase')
            amps_c = mag_s * np.exp(1j * np.angle(aLs))
            # the left channel's own phase wander around the pitch track (unwrapped; the
            # right channel follows it plus iph)
            lph_t = np.angle(aLs)
            if phase_smooth_s > 0:
                # a weak partial's measured phase is dominated by noise in its band; the
                # pipe's real phase wander is slow. Smooth the phases over the sustain (the
                # attack keeps full detail, for a coherent hand-over from the recorded onset).
                wm = steady_mask(centers / sr, 10 * np.log10(np.sum(mag_s ** 2, axis=1) + 1e-30), 0.3, 0.08)
                iph_t = steady_smooth(iph_t, centers / sr, wm, phase_smooth_s, 'phase')
                lph_t = steady_smooth(lph_t, centers / sr, wm, phase_smooth_s, 'phase')
            stereo_t = (ild_t, iph_t, np.unwrap(lph_t, axis=0))
        else:
            # Deterministic part = trajectories smoothed to the model's time resolution;
            # faster fluctuations (breath, bow, wind turbulence) are left for the noise model.
            raw_c = amps_c
            amps_c = smooth_to_grid(amps_c, centers / sr, smooth_scale, smode)
            if steady_smooth_s > 0:
                wm = steady_mask(centers / sr, 10 * np.log10(np.sum(np.abs(amps_c) ** 2, axis=1) + 1e-30), 0.3, 0.08)
                amps_c = steady_smooth(amps_c, centers / sr, wm, steady_smooth_s, 'mag')
            mono_s = amps_c
        resid = x - _resynth(len(x), centers, mono_s, psi, ratios)
        if kind == 'sustained':
            shimmer, shimmer_tau, shim_cut = measure_shimmer(
                raw_c, mono_s, resid, ratios, f0, sr, hop, (centers / sr >= steady0) & (centers / sr <= steady1),
                steady0, steady1)
    else:
        K = 0
        ratios = np.zeros(0)
        amps_c = np.zeros((len(centers), 0), dtype=np.complex128)
        psi = 2 * math.pi * f0 * n / sr
        resid = x.copy()
        jitter_cents, jitter_tau = np.zeros(0), 0.03
    K_h = K
    # pitch-synchronous noise (reed closures, bow slip, lip pulses), folded on the pitch phase
    pulse = None
    if harmonic and kind == 'sustained':
        # the fundamental's actual phase (the tracker's psi drifts against it under vibrato),
        # referenced like the stored partial phases so the engine can follow partial 1
        a1 = amps_c[:, 0]
        m1 = np.abs(a1)
        i0 = int(np.argmax(m1 > m1.max() * 10 ** (-30 / 20)))
        dphi = np.unwrap(np.angle(a1)) - np.angle(a1[i0])
        phi1 = psi * ratios[0] + np.interp(n, centers, dphi)
        pulse = measure_pulse(resid, sr, phi1, f0, steady0, steady1)

    # ── free (inharmonic) partials: stable peaks the harmonic model does not explain ──
    if free_partials > 0:
        excl = ratios * f0 if K else None
        ff, _ = find_free_peaks(resid, sr, 0.02 if harmonic else 0.005, min(dur, 3.0), free_partials, excl,
                                fmin=25.0 if harmonic else 0.6 * f0)
        if len(ff):
            fr_ratios = ff / f0
            Lf = max(int(free_window_s * sr), 64)
            Lf += (Lf % 2 == 0)
            winf = np.blackman(Lf)
            amps_f, _ = _demod(resid, centers, Lf // 2, winf, np.gradient(winf), psi, fr_ratios, 0)
            amps_f = smooth_to_grid(amps_f, centers / sr, smooth_scale, smode)
            resid = resid - _resynth(len(x), centers, amps_f, psi, fr_ratios)
            ratios = np.concatenate([ratios, fr_ratios])
            amps_c = np.concatenate([amps_c, amps_f], axis=1)
            K = len(ratios)
    if K == 0:
        raise ValueError('no partials found')

    # ── sample everything on the shared grid ───────────────────────────────
    grid = make_time_grid(dur)
    frame_t = centers / sr
    mag = np.abs(amps_c)
    amps_grid = np.empty((len(grid), K))
    for k in range(K):
        amps_grid[:, k] = np.interp(grid, frame_t, mag[:, k])
    amps_db = 20 * np.log10(np.maximum(amps_grid, 1e-7))
    pitch_grid = np.interp(grid, frame_t, cents)
    if stereo_t is not None:
        ild_grid = np.empty((len(grid), stereo_t[0].shape[1]))
        iph_grid = np.empty_like(ild_grid)
        lph_grid = np.empty_like(ild_grid)
        for k in range(ild_grid.shape[1]):
            ild_grid[:, k] = np.interp(grid, frame_t, stereo_t[0][:, k])
            iph_grid[:, k] = np.interp(grid, frame_t, np.unwrap(stereo_t[1][:, k]))
            lph_grid[:, k] = np.interp(grid, frame_t, stereo_t[2][:, k])
        iph_grid = np.angle(np.exp(1j * iph_grid))

    # keep only partials that are ever audible (within 80 dB of the loudest partial)
    pk = amps_db.max(axis=0)
    audible = pk > pk.max() - 80
    if K_h:
        ah = np.where(audible[:K_h])[0]
        kh_new = int(ah[-1] + 1) if len(ah) else 1
    else:
        kh_new = 0
    sel = np.concatenate([np.arange(kh_new), K_h + np.where(audible[K_h:])[0]]).astype(int)
    ratios, amps_db, amps_c, mag, amps_grid = ratios[sel], amps_db[:, sel], amps_c[:, sel], mag[:, sel], amps_grid[:, sel]
    jit_full = np.concatenate([jitter_cents, np.zeros(max(0, len(sel) + K_h - len(jitter_cents)))])
    jitter_cents = np.array([jit_full[i] if i < len(jitter_cents) else 0.0 for i in sel])
    if shimmer is not None:
        shimmer = shimmer[:kh_new]
    if stereo_img is not None:
        stereo_img = tuple(v[:kh_new] for v in stereo_img)
    if stereo_t is not None:
        ild_grid, iph_grid, lph_grid = ild_grid[:, :kh_new], iph_grid[:, :kh_new], lph_grid[:, :kh_new]
    K_h, K = kh_new, len(sel)

    # phases at t = 0 for the reference psi(0)=0: phase at the first frame where the
    # partial is within 30 dB of its own maximum.
    phases = np.zeros(K)
    for k in range(K):
        mk = mag[:, k]
        if mk.max() <= 0:
            continue
        idx = int(np.argmax(mk > mk.max() * 10 ** (-30 / 20)))
        phases[k] = float(np.angle(amps_c[idx, k]))
    if stereo_t is not None:
        # left-channel phase relative to the start phase, wrapped (stored mod 2π)
        for k in range(lph_grid.shape[1]):
            mk = mag[:, k]
            idx = int(np.argmax(mk > mk.max() * 10 ** (-30 / 20))) if mk.max() > 0 else 0
            lph_grid[:, k] -= stereo_t[2][idx, sel[k]] if k < len(sel) else 0.0
        lph_grid = np.angle(np.exp(1j * lph_grid))

    # noise bands: band power of the residual on the grid. High bands use a short STFT
    # (good time resolution); bands below ~430 Hz need a long, low-leakage window or the
    # neighbouring partials' energy leaks in and is mistaken for noise.
    nb = len(NOISE_EDGES) - 1
    short = 1024 if sr <= 50000 else 2048
    long_ = 8192 if sr <= 50000 else 16384
    tt_s, bp_s = band_powers(resid, sr, short, 128, 'hann')
    tt_l, bp_l = band_powers(resid, sr, long_, 1024, 'blackmanharris')
    _, tot_s = band_powers(x, sr, short, 128, 'hann')
    _, tot_l = band_powers(x, sr, long_, 1024, 'blackmanharris')
    noise_grid = np.empty((len(grid), nb))
    for b in range(nb):
        low = NOISE_EDGES[b + 1] <= 430
        tt, bp, tot = (tt_l, bp_l, tot_l) if low else (tt_s, bp_s, tot_s)
        # the residual can never hold more power than the recording itself in that band
        capped = np.minimum(bp[:, b], 0.8 * tot[:, b])
        noise_grid[:, b] = np.interp(grid, tt, capped)
        if shim_cut is not None:
            noise_grid[:, b] *= 1.0 - shim_cut[b]      # that energy is rendered as partial shimmer
    noise_db = 10 * np.log10(np.maximum(noise_grid, 1e-14))
    # Band-power estimates fluctuate frame to frame (estimator variance, not signal):
    # smooth over ~3 grid frames outside the attack; noise is perceived by its envelope.
    if len(grid) > 8:
        att = int(np.searchsorted(grid, 0.08))
        sm = noise_db.copy()
        sm[att:] = (np.vstack([noise_db[att - 1:-1], noise_db[att:], np.vstack([noise_db[att + 1:], noise_db[-1:]])])
                    .reshape(3, -1, noise_db.shape[1]).mean(axis=0)) if len(grid) - att > 2 else noise_db[att:]
        noise_db = sm
    for b in range(len(NOISE_EDGES) - 1):
        if NOISE_EDGES[b] >= sr / 2:
            noise_db[:, b] = -140

    # ── loop & release ────────────────────────────────────────────────────
    tot = 10 * np.log10(np.sum(amps_grid ** 2, axis=1) + 1e-14)
    tot_all = 10 * np.log10(np.sum(amps_grid ** 2, axis=1) + np.sum(noise_grid, axis=1) + 1e-14)
    loop = None
    rel_frame = None
    rel_rate = np.zeros(K)
    rel_noise_rate = 0.0
    if kind == 'sustained':
        if release_at_s is not None:
            # release point known (e.g. GrandOrgue cue marker, relative to the file start)
            rel_t = release_at_s - on / sr
            rel_i = int(np.clip(np.searchsorted(grid, rel_t) - 1, 1, len(grid) - 2))
            loop, _ = find_loop(grid[:rel_i], tot[:rel_i], max_loop_s or 2.0)
            rel_start = rel_i
        else:
            loop, rel_start = find_loop(grid, tot, max_loop_s or 2.0)
        if release_from_end and rel_start is not None:
            rel_rate, rel_noise_rate = measure_release(grid, amps_db, noise_db, rel_start)
        if loop is not None:
            T = min(len(grid), loop[1] + 2)
            if rel_start is not None and rel_start > loop[1] + 2 and keep_release_tail:
                # keep the recording's own release (and room tail) for note-off: from just
                # before the level starts to fall, until −70 dB or 2.5 s
                back = int(np.searchsorted(grid, grid[rel_start] - 0.04))
                rel_frame = max(loop[1] + 2, back)
                after = np.where((np.arange(len(grid)) > rel_start) & (tot_all < tot_all.max() - 70))[0]
                end = int(after[0]) + 1 if len(after) else len(grid)
                end = min(end, int(np.searchsorted(grid, grid[rel_start] + 2.5)) + 1, len(grid))
                if end - rel_frame >= 8:
                    T = end
                else:
                    rel_frame = None
            grid, amps_db, pitch_grid, noise_db = grid[:T], amps_db[:T], pitch_grid[:T], noise_db[:T]
            if stereo_t is not None:
                ild_grid, iph_grid, lph_grid = ild_grid[:T], iph_grid[:T], lph_grid[:T]
    else:
        # decaying: trim when partials *and* noise are 80 dB below the peak
        thr = tot_all.max() - 80
        alive = np.where(tot_all > thr)[0]
        T = min(len(grid), (alive[-1] + 2) if len(alive) else len(grid))
        T = trim_edit_fade(grid, tot_all, T)
        grid, amps_db, pitch_grid, noise_db = grid[:T], amps_db[:T], pitch_grid[:T], noise_db[:T]
        if stereo_t is not None:
            ild_grid, iph_grid, lph_grid = ild_grid[:T], iph_grid[:T], lph_grid[:T]

    peak = float(np.max(np.abs(x)))
    rms = float(np.sqrt(np.mean(x[: int(min(len(x), sr * 1.0))] ** 2)))
    tr, tr_r, tfade = None, None, (0.0, 0.0)
    if transient:
        # The analysis window smears sharp onsets (hammer, pluck, mallet) over ~L samples.
        # Keep the real onset and crossfade into the model once its window has settled.
        # (decaying: until the model's analysis window has fully cleared the onset — two
        # window lengths — so the hand-over does not lose energy the window smeared)
        # (sustained: at least two windows too — a bass pipe's speech outlasts a fixed 50 ms)
        if kind == 'decaying':
            t2 = float(np.clip(2.0 * L / sr, 0.04, 0.25))
        else:
            t2 = float(max(transient_max_s, min(2.0 * L / sr, 0.2)))
        t1 = 0.5 * t2
        nf = int(0.0005 * sr) + 1

        def cut(sig):
            c = sig[:int(t2 * sr) + 1].astype(np.float32)
            c[:min(len(c), nf)] *= np.linspace(0, 1, min(len(c), nf))   # no step at the first sample
            return c
        if xs is not None and stereo_img is not None:
            tr, tr_r = cut(xs[0]), cut(xs[1])       # stereo zones: left / right channels
        else:
            tr, tr_r = cut(x), None
        tfade = (t1, t2)
    zone_out = Zone(
        source=path, nominal_note=nominal_note, layer=layer, f0=f0, ratios=ratios,
        times=grid, amps_db=amps_db, phases=phases, pitch_cents=pitch_grid,
        noise_db=noise_db, loop=loop, release_db_per_s=rel_rate,
        release_noise_db_per_s=rel_noise_rate,
        peak_db=20 * math.log10(peak + 1e-12), rms_db=20 * math.log10(rms + 1e-12),
        meta={'B': B, 'window': L, 'sr': sr, 'K': K, 'harmonic': K_h,
              'jitter': jitter_cents, 'jitter_tau': float(jitter_tau), 'pulse': pulse,
              'shimmer': shimmer, 'shimmer_tau': float(shimmer_tau), 'rel_frame': rel_frame,
              'stereo': stereo_img,
              'stereo_t': (ild_grid, iph_grid, lph_grid) if stereo_t is not None else None},
    )
    zone_out.transient = tr
    zone_out.transient_r = tr_r
    zone_out.transient_fade = tfade
    return zone_out


def measure_shimmer(raw_c, smooth_c, resid, ratios, f0, sr, hop, steady, t0, t1):
    """Fast complex fluctuation of each partial around its smoothed trajectory.

    The deviation raw − smooth also contains whatever broadband noise falls inside a
    partial's analysis bandwidth, so it is calibrated per noise band against the residual's
    actual *excess* energy near the harmonics (over the level between them). Returns
    (σ per partial, correlation time, fraction of each noise band's power moved to shimmer).
    """
    K = len(ratios)
    nb = len(NOISE_EDGES) - 1
    if steady.sum() < 8 or K == 0:
        return None, 0.01, None
    d = (raw_c - smooth_c)[steady]
    a = smooth_c[steady]
    pa = np.mean(np.abs(a) ** 2, axis=0)
    pd = np.mean(np.abs(d) ** 2, axis=0)
    strong = pa > pa.max() * 1e-4
    sig = np.where(strong, np.sqrt(pd / np.maximum(pa, 1e-30)), 0.0)
    # correlation time from the lag-1 autocorrelation of the strong partials' deviations
    ds = d[:, strong]
    num = np.real(np.sum(ds[1:] * np.conj(ds[:-1])))
    den = np.sum(np.abs(ds) ** 2) + 1e-30
    rho = float(np.clip(num / den, 0.05, 0.98))
    tau = float(np.clip(-(hop / sr) / math.log(rho), 0.002, 0.05))
    # high-resolution residual spectrum of the steady part: near-harmonic excess per band
    seg = resid[int(t0 * sr):int(t1 * sr)]
    nper = int(min(32768, 1 << int(math.ceil(math.log2(16 * sr / f0)))))
    if len(seg) < nper:
        nper = 1 << int(math.floor(math.log2(max(len(seg), 256))))
    fr, P = signal.welch(seg, fs=sr, window='hann', nperseg=nper, noverlap=nper // 2, scaling='density')
    df = fr[1] - fr[0]
    hk = ratios * f0
    near = np.zeros(len(fr), dtype=bool)
    for f in hk:
        near |= np.abs(fr - f) < 0.25 * f0
    cut = np.zeros(nb)
    scale = np.ones(nb)
    pk = np.abs(np.mean(np.abs(a) ** 2, axis=0))
    for b in range(nb):
        inb = (fr >= NOISE_EDGES[b]) & (fr < NOISE_EDGES[b + 1])
        nm, bm = inb & near, inb & ~near
        tot = P[inb].sum() * df
        if nm.sum() < 2 or bm.sum() < 2 or tot <= 0:
            scale[b] = 0.0
            continue
        excess = max(0.0, P[nm].sum() * df - P[bm].mean() * nm.sum() * df)
        ks = (hk >= NOISE_EDGES[b]) & (hk < NOISE_EDGES[b + 1])
        e_shim = float(np.sum(sig[ks] ** 2 * pk[ks]) / 2)       # a sinusoid's power is |a|²/2
        if e_shim <= 0:
            continue
        # the raw deviation can under-read fast vibrato smear: let σ grow to carry the measured
        # excess (up to 3×), but never move more than the residual actually holds near harmonics
        used = min(excess, 9.0 * e_shim)
        scale[b] = math.sqrt(used / e_shim)
        cut[b] = min(0.95, used / tot)
    band_of = np.clip(np.searchsorted(NOISE_EDGES, hk, side='right') - 1, 0, nb - 1)
    sig = np.clip(sig * scale[band_of], 0, 1.5)
    return sig, tau, cut


PULSE_BINS = 32
PULSE_MAX = 4.0


def measure_pulse(resid, sr, psi, f0, t0, t1):
    """Noise amplitude over one period of the fundamental (unit mean square), from the
    residual above the strong partials; None when the noise is effectively stationary."""
    fc = max(3000.0, 4.0 * f0)
    if fc > 0.4 * sr or t1 - t0 < 0.2:
        return None
    hp = signal.sosfiltfilt(signal.butter(4, fc, 'hp', fs=sr, output='sos'), resid)
    a, b = int(t0 * sr), int(t1 * sr)
    e = hp[a:b] ** 2
    ph = np.mod(psi[a:b] / (2 * math.pi), 1.0)
    idx = np.minimum((ph * PULSE_BINS).astype(int), PULSE_BINS - 1)
    cnt = np.bincount(idx, minlength=PULSE_BINS)
    if cnt.min() < 50:
        return None
    P = np.bincount(idx, e, minlength=PULSE_BINS) / cnt
    if P.mean() <= 0:
        return None
    P = np.convolve(np.concatenate([P[-1:], P, P[:1]]), [0.25, 0.5, 0.25], 'valid')  # light circular smoothing
    g = np.sqrt(P / P.mean())
    if 10 * math.log10(P.max() / max(P.min(), 1e-30)) < 2.0:
        return None
    return np.clip(g, 0, PULSE_MAX)


def measure_jitter(amps_c, dev, ratios, f0, sr, hop, steady):
    """Independent (non-common-mode) frequency jitter of each partial, in cents.

    Real partials wobble partly independently (turbulence, beating, room); one shared pitch
    track would move them in lockstep. The per-frame frequency estimate is noisy for weak
    partials, so the zone value is the median over strong low partials, and individual
    partials are capped at twice it. Returns (per-partial cents, correlation time s).
    """
    K = len(ratios)
    out = np.zeros(K)
    mags = np.abs(amps_c)
    sel = steady if steady.sum() >= 12 else np.ones(len(steady), dtype=bool)
    cents = 1200 * np.log2(np.clip(1 + dev[sel] * sr / (ratios[None, :] * f0), 0.5, 2.0))
    m = mags[sel]
    top = m.max()
    span = max(3, int(round(0.01 / (hop / sr))))         # average over ~10 ms
    for k in range(K):
        ok = m[:, k] > m[:, k].max() * 10 ** (-20 / 20)
        if ok.sum() < 12 or m[:, k].max() < top * 10 ** (-40 / 20):
            continue
        c = np.convolve(cents[:, k], np.ones(span) / span, mode='same')[ok]
        if len(c) < 48:
            continue
        slow = np.convolve(c, np.ones(31) / 31, mode='same')
        r = (c - slow)[15:-15]
        if len(r) > 8:
            out[k] = float(np.std(r))
    strong = [out[k] for k in range(min(K, 16)) if out[k] > 0]
    zone = float(np.median(strong)) if strong else 0.0
    out = np.minimum(out, 2 * zone)
    out[out == 0] = zone
    return out, 0.025


def band_powers(sig, sr, nper, hop, window):
    """Calibrated power per noise band over time (frames × bands)."""
    fr, tt, Z = signal.stft(sig, fs=sr, window=window, nperseg=nper, noverlap=nper - hop,
                            boundary='zeros', padded=True)
    P = np.abs(Z) ** 2
    out = np.zeros((P.shape[1], len(NOISE_EDGES) - 1))
    for b in range(len(NOISE_EDGES) - 1):
        selb = (fr >= NOISE_EDGES[b]) & (fr < NOISE_EDGES[b + 1])
        if selb.any():
            out[:, b] = P[selb].sum(axis=0)
    return tt, out * _stft_power_cal(nper, sr, window, hop)


_CAL = {}


def _stft_power_cal(nper: int, sr: int, window: str = 'hann', hop: int = 128) -> float:
    """Factor so that sum(|Z|^2 over band) * cal = band-limited signal power."""
    key = (nper, sr, window, hop)
    if key not in _CAL:
        rng = np.random.default_rng(0)
        w = rng.standard_normal(sr * 4)
        _, _, Z = signal.stft(w, fs=sr, window=window, nperseg=nper, noverlap=nper - hop)
        tot = (np.abs(Z) ** 2).sum(axis=0)[8:-8].mean()
        _CAL[key] = 1.0 / tot  # white noise of unit power
    return _CAL[key]


def find_loop(grid: np.ndarray, tot_db: np.ndarray, max_loop_s: float = 2.0
              ) -> tuple[tuple[int, int] | None, int | None]:
    """Sustain loop and release start of a sustained recording.

    The loop starts shortly after the attack has settled (not at the longest steady run,
    which for bowed/blown notes is often seconds later where the player is already
    shaping the note's end) and lasts up to `max_loop_s`, ending before the release.
    Returns ((loop_start, loop_end) frame indices or None, release_start frame or None).
    """
    t = grid
    if len(t) < 20:
        return None, None
    # level smoothed over ~150 ms (vibrato and bow changes are not "attack" or "release")
    lin = 10 ** (tot_db / 10)
    sm = np.empty_like(lin)
    for i in range(len(t)):
        sel = (t >= t[i] - 0.075) & (t <= t[i] + 0.075)
        sm[i] = lin[sel].mean()
    sm_db = 10 * np.log10(sm + 1e-20)
    body = t > 0.15
    if body.sum() < 10:
        return None, None
    med = float(np.median(sm_db[body & (sm_db > sm_db.max() - 25)]))
    above = np.where(body & (sm_db >= med - 3))[0]
    if len(above) == 0:
        return None, None
    attack_end = above[0]
    alive = np.where(sm_db >= med - 6)[0]
    rel_start = int(alive[-1]) if len(alive) else len(t) - 1
    if rel_start >= len(t) - 2:
        rel_start = None
    end_lim = (rel_start if rel_start is not None else len(t) - 1)
    a = int(np.searchsorted(t, t[attack_end] + 0.1))
    b_t = min(t[end_lim] - 0.15, t[a] + max_loop_s) if a < len(t) else 0
    b = int(np.searchsorted(t, b_t)) - 1
    if a >= len(t) or b - a < 6 or t[b] - t[a] < 0.3:
        return None, rel_start
    return (a, b), rel_start


def trim_edit_fade(grid, tot_db, T):
    """Sample libraries often end a recording with an editor's fade-out long before the
    instrument would have stopped. Detect a final decay much steeper than the note's own
    and cut the frames there (playback then continues the natural decay)."""
    t = grid[:T]
    y = tot_db[:T]
    if len(t) < 12 or t[-1] < 0.5:
        return T

    def slope(a, b):
        sel = (t >= a) & (t <= b)
        if sel.sum() < 3:
            return None
        return -np.polyfit(t[sel], y[sel], 1)[0]

    end = t[-1]
    for back in (0.15, 0.25, 0.4):
        late = slope(end - back, end)
        early = slope(end - back - 0.8, end - back)
        if late is None or early is None:
            continue
        if late > 30 and late > 2.5 * max(early, 3.0):
            cut = int(np.searchsorted(t, end - back))
            return max(cut, 8)
    return T


def measure_release(grid, amps_db, noise_db, rel_start):
    """Per-partial decay rate (dB/s) during the first part of the natural release."""
    t = grid
    t0 = t[rel_start]
    sel = (t >= t0) & (t <= t0 + 0.6)
    K = amps_db.shape[1]
    rates = np.zeros(K)
    if sel.sum() < 4:
        return rates, 0.0
    tt = t[sel] - t0
    for k in range(K):
        y = amps_db[sel, k]
        # fit only while above floor
        ok = y > y[0] - 60
        if ok.sum() < 3:
            continue
        p = np.polyfit(tt[ok], y[ok], 1)
        rates[k] = max(0.0, -p[0])
    # A weak partial sitting on the room's reverberant floor measures as barely decaying and
    # would ring on alone after the others have gone; hold every partial to at least half
    # the decay of the strong ones.
    lvl = amps_db[sel][0]
    strong = lvl > lvl.max() - 30
    if strong.any():
        ref = float(np.median(rates[strong]))
        rates = np.maximum(rates, 0.5 * ref)
    yn = 10 * np.log10(np.sum(10 ** (noise_db[sel] / 10), axis=1) + 1e-20)
    pn = np.polyfit(tt, yn, 1)
    return rates, max(0.0, -pn[0])
