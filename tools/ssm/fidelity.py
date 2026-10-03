"""Perceptually motivated fidelity checks for sustained instruments (organ pipes, winds).

  python fidelity.py <model-id> [--notes 51,63] [--max N] [--json out.json]

Frame-by-frame spectral distance penalises a synthesised sustain for not reproducing the exact
random fluctuations of one particular recording — something a second take of the same pipe
would not reproduce either. So every statistic here is measured three ways:

  real A  vs real B  — two halves of the recording's steady state (the "floor": how much a real
                       pipe differs from itself)
  synth   vs real B  — the engine against the same reference half

and reported as the synth distance next to the floor. A synth that sits at the floor on every
statistic is, by these measures, as close to the recording as the recording is to itself.

Statistics (all on the stereo signal, from the analysed note's own f0):
  harm     per-harmonic long-term level (dB), harmonics 1..40, energy-weighted mean |Δ|
  noise    inter-harmonic noise floor relative to the harmonics, per octave band (dB)
  flutter  per-harmonic amplitude fluctuation: std of the detrended dB trajectory, and its
           modulation spectrum in 0.5–4 Hz / 4–16 Hz / 16–40 Hz (dB)
  freq     per-harmonic frequency wander (cents std)
  stereo   per-harmonic inter-channel level difference (dB) and coherence
  attack   log-mel distance over the first 250 ms (onset aligned), and the rise time of
           harmonics 1–8 (ms) — floor from a second take when one exists
  release  level of each octave band 0.1/0.3/0.6/1.0 s after note-off, relative to the sustain
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
import soundfile as sf
from scipy import signal

from analysis import find_onset
from compare import logmel
from engine import read_header, ssrender
from evaluate import sustain_duration

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.environ.get('SSM_OUT_DIR', os.path.join(HERE, '..', '..', 'models'))

NFFT = 4096
HOP = 512
NHARM = 40
OCT_EDGES = [60, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]


def load_stereo(path):
    x, sr = sf.read(path, dtype='float64', always_2d=True)
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    return x[:, :2], sr


def render(model_path, note, hold, sr, tail=2.0, sets=(), vel=118):
    y, _ = ssrender(model_path, [f'{note}:{int(round(vel))}:0:{hold:.4f}'], sr, tail, sets)
    return np.repeat(y, 2, axis=1) if y.shape[1] == 1 else y[:, :2]


def stft2(x, sr):
    """Complex STFT of each channel: (2, bins, frames)."""
    f, t, Z = signal.stft(x.T, fs=sr, window='blackmanharris', nperseg=NFFT, noverlap=NFFT - HOP,
                          boundary=None, padded=False)
    return f, t, Z


def harmonic_tracks(Z, f, f0, nh):
    """Per harmonic: complex peak value per frame per channel, and the peak frequency (Hz)."""
    df = f[1] - f[0]
    P = (np.abs(Z) ** 2).sum(0)   # (bins, frames)
    amps = np.full((nh, 2, Z.shape[2]), 1e-12, dtype=complex)
    freqs = np.full((nh, Z.shape[2]), np.nan)
    ok = np.zeros(nh, bool)
    for k in range(1, nh + 1):
        fk = k * f0
        if fk + 0.3 * f0 >= f[-1]:
            break
        lo, hi = int((fk - 0.3 * f0) / df), int(np.ceil((fk + 0.3 * f0) / df)) + 1
        idx = lo + np.argmax(P[lo:hi], axis=0)
        cols = np.arange(Z.shape[2])
        # parabolic interpolation of the peak on the summed power (log)
        a = np.log(P[np.maximum(idx - 1, 0), cols] + 1e-30)
        b = np.log(P[idx, cols] + 1e-30)
        c = np.log(P[np.minimum(idx + 1, len(f) - 1), cols] + 1e-30)
        den = a - 2 * b + c
        d = np.where(np.abs(den) > 1e-12, 0.5 * (a - c) / den, 0.0)
        freqs[k - 1] = (idx + np.clip(d, -0.5, 0.5)) * df
        amps[k - 1] = Z[:, idx, cols]
        ok[k - 1] = True
    return amps[ok], freqs[ok]


def noise_floor(Z, f, f0):
    """Mean inter-harmonic power per octave band (dB), relative to the band's harmonic power.
    (Mean, not median: real room noise is spiky across frequency, and loudness follows power.)"""
    P = (np.abs(Z) ** 2).sum(0).mean(1)
    rel = (f / f0) % 1.0
    between = (rel > 0.35) & (rel < 0.65)
    near = (rel < 0.08) | (rel > 0.92)
    out = []
    top = P[(f >= 0.7 * f0) & near].max() if np.any((f >= 0.7 * f0) & near) else P.max()
    for lo, hi in zip(OCT_EDGES[:-1], OCT_EDGES[1:]):
        band = (f >= max(lo, 0.7 * f0)) & (f < hi)
        nb, hb = band & between, band & near
        # (a band whose harmonics are 70 dB below the strongest is at the recording's
        # quantisation floor: nothing there is audible)
        if nb.sum() < 3 or hb.sum() < 1 or P[hb].max() < top * 1e-7:
            out.append(np.nan)
            continue
        out.append(10 * np.log10(np.mean(P[nb]) + 1e-30) - 10 * np.log10(P[hb].max() + 1e-30))
    return np.array(out)


def steady_stats(x, sr, f0):
    f, t, Z = stft2(x, sr)
    amps, freqs = harmonic_tracks(Z, f, f0, NHARM)
    pw = (np.abs(amps) ** 2).sum(1)                     # (nh, frames)
    level = 10 * np.log10(pw.mean(1) + 1e-30)           # long-term level per harmonic
    traj = 10 * np.log10(pw + 1e-30)
    # detrend: remove a linear fit (slow drift is not flutter)
    tt = np.arange(traj.shape[1])
    A = np.vstack([tt, np.ones_like(tt)]).T
    coef, *_ = np.linalg.lstsq(A, traj.T, rcond=None)
    det = traj - (A @ coef).T
    fr = sr / HOP
    fm, Pm = signal.welch(det, fs=fr, nperseg=min(det.shape[1], 128), axis=1)
    def band(lo, hi):
        m = (fm >= lo) & (fm < hi)
        return 10 * np.log10(Pm[:, m].sum(1) * (fm[1] - fm[0]) + 1e-12)
    cents = 1200 * np.log2(freqs / np.nanmedian(freqs, axis=1, keepdims=True))
    ild = 10 * np.log10((np.abs(amps[:, 0]) ** 2).mean(1) + 1e-30) - 10 * np.log10((np.abs(amps[:, 1]) ** 2).mean(1) + 1e-30)
    cross = (amps[:, 0] * np.conj(amps[:, 1])).mean(1)
    coh = np.abs(cross) / np.sqrt((np.abs(amps[:, 0]) ** 2).mean(1) * (np.abs(amps[:, 1]) ** 2).mean(1) + 1e-30)
    return dict(level=level, flut_std=det.std(1), mod_lo=band(0.5, 4), mod_mid=band(4, 16), mod_hi=band(16, 40),
                cents=np.nanstd(cents, axis=1), ild=ild, coh=coh, noise=noise_floor(Z, f, f0))


def compare_steady(a, b):
    """Distances between two steady_stats dicts (energy-weighted over harmonics within 50 dB of the peak)."""
    n = min(len(a['level']), len(b['level']))
    lv = a['level'][:n]
    w = np.where(lv > lv.max() - 50, 10 ** ((lv - lv.max()) / 20), 0.0)
    w /= w.sum()
    def wd(key, n=n):
        return float(np.sum(w * np.abs(a[key][:n] - b[key][:n])))
    ra, rb = a['level'][:n] - a['level'][:n].max(), b['level'][:n] - b['level'][:n].max()
    nz = ~np.isnan(a['noise']) & ~np.isnan(b['noise'])
    return dict(harm=float(np.sum(w * np.abs(ra - rb))),
                noise=float(np.mean(np.abs(a['noise'][nz] - b['noise'][nz]))) if nz.any() else np.nan,
                flutter=wd('flut_std'), mod_lo=wd('mod_lo'), mod_mid=wd('mod_mid'), mod_hi=wd('mod_hi'),
                freq=wd('cents'), ild=wd('ild'), coh=wd('coh'))


def release_profile(x, sr, t_off):
    """Octave-band level at fixed times after note-off relative to the 0.5 s before it (dB)."""
    out = []
    def bands(seg):
        f, P = signal.welch(seg, fs=sr, nperseg=2048)
        return np.array([10 * np.log10(P[(f >= lo) & (f < hi)].sum() + 1e-20) for lo, hi in zip(OCT_EDGES[:-1], OCT_EDGES[1:])])
    m = x.mean(1)
    ref = bands(m[int((t_off - 0.5) * sr):int(t_off * sr)])
    for dt in (0.1, 0.3, 0.6, 1.0):
        a = int((t_off + dt - 0.05) * sr)
        seg = m[a:a + int(0.1 * sr)]
        out.append(bands(seg) - ref if len(seg) > 2048 else np.full(len(ref), np.nan))
    return np.array(out), ref


def attack_stats(x, sr, f0, steady_level):
    """Rise time (ms) of harmonics 1..8 to within 3 dB of their steady level."""
    f, t, Z = signal.stft(x.T, fs=sr, window='hann', nperseg=1024, noverlap=1024 - 128, boundary=None, padded=False)
    amps, _ = harmonic_tracks(Z, f, f0, 8)
    pw = 10 * np.log10((np.abs(amps) ** 2).sum(1) + 1e-30)
    out = []
    for k in range(len(amps)):
        tgt = np.median(pw[k, int(0.6 * sr / 128):int(1.0 * sr / 128)])
        hit = np.where(pw[k] > tgt - 3)[0]
        out.append((t[hit[0]] if len(hit) else np.nan) * 1000)
    return np.array(out)


def release_onset(m, sr):
    """Seconds from onset to where the recording's level starts to fall at its release
    (walking back from the −8 dB point to the first 20 ms frame 0.75 dB below the level just
    before the release, at most 0.4 s: a player's diminuendo earlier in the note is not the
    release)."""
    on = find_onset(m, sr)
    y = m[on:]
    t8 = sustain_duration(m, sr)
    w = int(0.02 * sr)
    n = len(y) // w
    env = 10 * np.log10(np.mean(y[:n * w].reshape(n, w) ** 2, axis=1) + 1e-20)
    j8 = min(int(t8 / 0.02), n - 1)
    a = max(int(0.3 / 0.02), j8 - int(0.9 / 0.02))
    b = max(a + 1, j8 - int(0.4 / 0.02))
    steady = np.median(env[a:b])
    j = j8
    while j > max(1, j8 - int(0.4 / 0.02)) and env[j - 1] < steady - 0.75:
        j -= 1
    return j * 0.02


def evaluate_note(model_path, wav, note, f0, sets=(), alt=None, vel=118):
    x, sr = load_stereo(wav)
    m = x.mean(1)
    on = find_onset(m, sr)
    hold = release_onset(m, sr)
    x = x[on:]
    y = render(model_path, note, hold, sr, sets=sets, vel=vel)
    y = y[find_onset(y.mean(1), sr):]
    # level-match on the steady state
    s0, s1 = int(0.6 * sr), int((hold - 0.2) * sr)
    g = np.sqrt(np.mean(x[s0:s1] ** 2) / max(np.mean(y[s0:s1] ** 2), 1e-20))
    y = y * g
    mid = (s0 + s1) // 2
    ra, rb = steady_stats(x[s0:mid], sr, f0), steady_stats(x[mid:s1], sr, f0)
    ln = mid - s0
    # synth: a segment of the same length, not overlapping the attack
    sy = steady_stats(y[s0:s0 + ln], sr, f0)
    sy2 = steady_stats(y[mid:s1], sr, f0)
    floor = compare_steady(ra, rb)
    syn = compare_steady(sy, rb)
    syn2 = compare_steady(sy2, ra)
    syn = {k: (syn[k] + syn2[k]) / 2 for k in syn}
    # attack
    n_at = int(0.25 * sr)
    _, A = logmel(x[:n_at].mean(1), sr, nfft=1024, hop=128)
    _, B = logmel(y[:n_at].mean(1), sr, nfft=1024, hop=128)
    top = max(A.max(), B.max())
    att = float(np.mean(np.abs(np.maximum(A, top - 80) - np.maximum(B, top - 80))))
    rise_r = attack_stats(x[:int(1.2 * sr)], sr, f0, None)
    rise_s = attack_stats(y[:int(1.2 * sr)], sr, f0, None)
    res = dict(note=note, f0=f0, hold=hold, floor=floor, synth=syn, attack_lsd=att,
               rise_real_ms=rise_r.tolist(), rise_syn_ms=rise_s.tolist(),
               rise_err_ms=float(np.nanmean(np.abs(rise_r - rise_s))))
    if alt is not None:
        xa, _ = load_stereo(alt)
        xa = xa[find_onset(xa.mean(1), sr):]
        _, C = logmel(xa[:n_at].mean(1), sr, nfft=1024, hop=128)
        res['attack_lsd_floor'] = float(np.mean(np.abs(np.maximum(A, top - 80) - np.maximum(C, top - 80))))
        res['rise_err_floor_ms'] = float(np.nanmean(np.abs(rise_r - attack_stats(xa[:int(1.2 * sr)], sr, f0, None))))
    # release (only if the recording continues long enough after its release point)
    if len(x) / sr > hold + 1.1 and len(y) / sr > hold + 1.1:
        pr, ref_r = release_profile(x, sr, hold)
        ps, _ = release_profile(y, sr, hold)
        valid = ref_r > ref_r.max() - 40
        d = np.abs(pr - ps)[:, valid]
        res['release_err_db'] = float(np.nanmean(d))
        res['release_real'] = np.round(pr[:, valid].mean(1), 1).tolist()
        res['release_syn'] = np.round(ps[:, valid].mean(1), 1).tolist()
    return res, x, y, sr


KEYS = ['harm', 'noise', 'flutter', 'mod_lo', 'mod_mid', 'mod_hi', 'freq', 'ild', 'coh']


def summarize(results, label=''):
    print(f'\n== {label}  n={len(results)}  (synth distance / real-vs-real floor)')
    summ = {}
    for k in KEYS:
        s = np.nanmean([r['synth'][k] for r in results])
        fl = np.nanmean([r['floor'][k] for r in results])
        summ[k] = (float(s), float(fl))
        print(f'  {k:8s} synth={s:7.3f}  floor={fl:7.3f}  ratio={s / max(fl, 1e-9):5.2f}')
    for k in ['attack_lsd', 'attack_lsd_floor', 'rise_err_ms', 'rise_err_floor_ms', 'release_err_db']:
        v = [r[k] for r in results if k in r]
        if v:
            summ[k] = float(np.mean(v))
            print(f'  {k:18s} {np.mean(v):7.2f}')
    return summ


def model_zones(model_id: str, path: str | None = None, max_notes: int | None = None,
                notes: set[int] | None = None) -> tuple[dict, list[tuple[dict, str]]]:
    """A model's header and its zones paired with the recordings they were analysed from
    (only `notes`, if given; at most `max_notes`, spread evenly over the range)."""
    from build import collect
    from instruments import INSTRUMENTS
    hdr = read_header(path or os.path.join(MODELS, f'{model_id}.ssm'))
    byname = {os.path.basename(f): f for f, _, _ in collect(INSTRUMENTS[model_id])}
    zones = [z for z in hdr['zones'] if z['src'] in byname]
    if notes:
        zones = [z for z in zones if int(round(z['note'])) in notes]
    if max_notes and len(zones) > max_notes:
        idx = np.linspace(0, len(zones) - 1, max_notes).round().astype(int)
        zones = [zones[i] for i in sorted(set(idx))]
    return hdr, [(z, byname[z['src']]) for z in zones]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('model')
    ap.add_argument('--notes', default=None)
    ap.add_argument('--max', type=int, default=None)
    ap.add_argument('--set', action='append', default=[])
    ap.add_argument('--json', default=None)
    ap.add_argument('--save', default=None, help='directory for real/synth wav pairs')
    ap.add_argument('--model-path', default=None)
    ap.add_argument('--holdout', action='store_true',
                    help='model built without every other pitch; test on the held-out recordings')
    a = ap.parse_args()
    if a.holdout:
        return main_holdout(a)
    path = a.model_path or os.path.join(MODELS, f'{a.model}.ssm')
    want = {int(n) for n in a.notes.split(',')} if a.notes else None
    hdr, zones = model_zones(a.model, path, a.max, want)
    results = []
    for z, src in zones:
        alt = None
        for rr in ('_rr1', '_RR1'):
            if rr in src:
                cand = src.replace(rr, rr[:-1] + '2')
                if os.path.exists(cand):
                    alt = cand
        vel = hdr['layers'][z['layer']]['velocity'] if z['layer'] < len(hdr['layers']) else 118
        r, x, y, sr = evaluate_note(path, src, int(round(z['note'])), z['f0'], a.set, alt, vel)
        r['src'] = z['src']
        results.append(r)
        if a.save:
            os.makedirs(a.save, exist_ok=True)
            b = os.path.splitext(z['src'])[0]
            n = min(len(x), len(y))
            sf.write(os.path.join(a.save, b + '__real.wav'), x[:n] / max(1e-9, np.abs(x).max()) * 0.8, sr)
            sf.write(os.path.join(a.save, b + '__syn.wav'), y[:n] / max(1e-9, np.abs(x).max()) * 0.8, sr)
        fl, sy = r['floor'], r['synth']
        print(f"{z['src']:36s} " + ' '.join(f'{k}={sy[k]:.2f}/{fl[k]:.2f}' for k in ('harm', 'noise', 'flutter', 'mod_mid', 'freq', 'coh'))
              + f" att={r['attack_lsd']:.2f} rel={r.get('release_err_db', float('nan')):.2f}", flush=True)
    summ = summarize(results, a.model)
    if a.json:
        json.dump({'summary': summ, 'results': results}, open(a.json, 'w'), indent=1, default=float)


def sampler(src, nominal_from, f0_from, f0_to, sr):
    """What a plain sampler does: the nearest recording, resampled to the new pitch."""
    y, sr2 = load_stereo(src)
    ratio = f0_to / f0_from
    n = int(len(y) * sr / sr2 / ratio)
    return signal.resample(y, n, axis=0)


def main_holdout(a):
    from analysis import estimate_f0, hz_to_midi, load_mono, midi_to_hz
    from blind import holdout_model
    from build import collect
    from instruments import INSTRUMENTS
    path, test = holdout_model(a.model)
    hdr = read_header(path)
    zones = hdr['zones']
    full = read_header(os.path.join(os.path.dirname(MODELS) if False else MODELS, f'{a.model}.ssm')) \
        if os.path.exists(os.path.join(MODELS, f'{a.model}.ssm')) else hdr
    # the octave convention of this instrument's file names, from the full model's zones
    nom = {os.path.basename(f): n for f, n, _ in collect(INSTRUMENTS[a.model])}
    offs = [round((z['note'] - nom[z['src']]) / 12) * 12 for z in full['zones'] if z['src'] in nom]
    oct_off = int(np.median(offs)) if offs else 0
    if a.max and len(test) > a.max:
        idx = np.linspace(0, len(test) - 1, a.max).round().astype(int)
        test = [test[i] for i in sorted(set(idx))]
    res, base = [], []
    for f, nominal, layer in test:
        xm, sr = load_mono(f)
        on = find_onset(xm, sr)
        f0 = estimate_f0(xm[on:], sr, midi_to_hz(nominal + oct_off), 0.3, 1.5, octave_search=False)
        note = int(round(hz_to_midi(f0)))
        li = [l['name'] for l in hdr['layers']].index(layer) if layer in [l['name'] for l in hdr['layers']] else len(hdr['layers']) - 1
        vel = hdr['layers'][li]['velocity']
        r, x, y, sr = evaluate_note(path, f, note, f0, a.set, None, vel)
        r['src'] = os.path.basename(f)
        res.append(r)
        # sampler baseline: nearest kept zone of the same layer
        cands = [z for z in zones if z['layer'] == li]
        z = min(cands, key=lambda z: abs(z['note'] - hz_to_midi(f0)))
        src = [g for g, _, _ in collect(INSTRUMENTS[a.model]) if os.path.basename(g) == z['src']][0]
        yb = sampler(src, None, z['f0'], f0, sr)
        yb = yb[find_onset(yb.mean(1), sr):]
        s0, s1 = int(0.6 * sr), int((r['hold'] - 0.2) * sr)
        mid = (s0 + s1) // 2
        if len(yb) > s1:
            ra, rb = steady_stats(x[s0:mid], sr, f0), steady_stats(x[mid:s1], sr, f0)
            sb = compare_steady(steady_stats(yb[s0:mid], sr, f0), rb)
            sb2 = compare_steady(steady_stats(yb[mid:s1], sr, f0), ra)
            n_at = int(0.25 * sr)
            _, A = logmel(x[:n_at].mean(1), sr, nfft=1024, hop=128)
            _, B = logmel(yb[:n_at].mean(1), sr, nfft=1024, hop=128)
            top = max(A.max(), B.max())
            att = float(np.mean(np.abs(np.maximum(A, top - 80) - np.maximum(B, top - 80))))
            rr = attack_stats(x[:int(1.2 * sr)], sr, f0, None)
            rb_ = attack_stats(yb[:int(1.2 * sr)], sr, f0, None)
            base.append({'synth': {k: (sb[k] + sb2[k]) / 2 for k in sb}, 'floor': r['floor'],
                         'attack_lsd': att, 'rise_err_ms': float(np.nanmean(np.abs(rr - rb_)))})
        print(f"{r['src']:36s} note={note} " + ' '.join(f"{k}={r['synth'][k]:.2f}" for k in ('harm', 'noise', 'flutter', 'coh')), flush=True)
    summ = summarize(res, f'{a.model} HOLDOUT engine')
    if base:
        summarize(base, f'{a.model} HOLDOUT sampler (nearest recording, pitch-shifted)')
    if a.json:
        json.dump({'summary': summ, 'results': res}, open(a.json, 'w'), indent=1, default=float)


if __name__ == '__main__':
    main()
