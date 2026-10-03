"""Classifier two-sample test: can a model tell the real recordings from the engine?

  python discriminate.py <model-id> [--max N] [--set k=v ...]

Every note is cut into 0.75 s windows of its steady sustain (real recording and engine
rendering of the same note), plus its attack (first 0.3 s) and its release (octave-band
decay after note-off, the synthetic note released where the recording starts to die away).
Each window is described by
pitch-normalised features — per-harmonic level, flutter, modulation, frequency wander,
stereo image, noise floor between the harmonics — and a gradient-boosted classifier is
trained to separate real from synthetic, cross-validated leaving whole notes out (it never
sees the note it is tested on). ROC AUC 0.5 = indistinguishable; 1.0 = always told apart.
Also prints the features the classifier relies on most: the remaining tells.
"""
from __future__ import annotations

import argparse
import os

import numpy as np

from analysis import find_onset
from fidelity import MODELS, OCT_EDGES, attack_stats, load_stereo, release_onset, render, steady_stats
from evaluate import read_header, sustain_duration

NH = 12
WIN = 0.75
AUDIBLE_DB = 30.0


def window_features(x, sr, f0):
    st = steady_stats(x, sr, f0)
    n = min(NH, len(st['level']))
    pad = lambda v: np.concatenate([v[:n], np.full(NH - n, np.nan)])
    lv = st['level'] - st['level'].max()
    feats = {}
    for key, v in (('level', lv), ('flut', st['flut_std']), ('modlo', st['mod_lo']), ('modmid', st['mod_mid']),
                   ('modhi', st['mod_hi']), ('cents', st['cents']), ('ild', np.abs(st['ild'])), ('coh', st['coh'])):
        for i, val in enumerate(pad(v)):
            feats[f'{key}{i + 1}'] = val
    for i, val in enumerate(st['noise']):
        feats[f'noise_oct{i}'] = val
    return feats


def note_windows(x, sr, f0, hold):
    out = []
    t = 0.6
    while t + WIN <= hold - 0.2:
        out.append(window_features(x[int(t * sr):int((t + WIN) * sr)], sr, f0))
        t += WIN
    return out


def attack_features(x, sr, f0):
    rise = attack_stats(x[:int(1.2 * sr)], sr, f0, None)
    f = {f'rise{i + 1}': v for i, v in enumerate(rise)}
    # onset envelope shape: level (dB re steady) at 10/20/40/80/160 ms
    m = x.mean(1)
    ref = np.sqrt(np.mean(m[int(0.6 * sr):int(1.0 * sr)] ** 2)) + 1e-12
    for ms in (10, 20, 40, 80, 160):
        a = int(ms / 1000 * sr)
        seg = m[max(0, a - int(0.005 * sr)):a + int(0.005 * sr)]
        f[f'env{ms}'] = 20 * np.log10(np.sqrt(np.mean(seg ** 2)) / ref + 1e-9)
    return f


def release_features(x, sr, t_off, ref_bands=None):
    """Octave-band level (dB re the 0.4 s before note-off) at 20/50/100/200/400 ms after it."""
    from scipy import signal
    m = x.mean(1)
    def bands(seg):
        f, P = signal.welch(seg, fs=sr, nperseg=min(len(seg), 2048))
        return np.array([10 * np.log10(P[(f >= lo) & (f < hi)].sum() + 1e-20) for lo, hi in zip(OCT_EDGES[:-1], OCT_EDGES[1:])])
    ref = bands(m[int((t_off - 0.4) * sr):int(t_off * sr)])
    use = ref > ref.max() - 40 if ref_bands is None else ref_bands
    f = {}
    for ms in (20, 50, 100, 200, 400):
        a = int((t_off + ms / 1000 - 0.01) * sr)
        seg = m[a:a + int(0.02 * sr)]
        d = bands(seg) - ref if len(seg) >= 256 else np.full(len(ref), np.nan)
        for b in range(len(ref)):
            f[f'rel{ms}_oct{b}'] = d[b] if use[b] else np.nan
    return f, use


def collect_features(model_id, max_notes=None, sets=(), path=None, rel=None):
    from build import collect
    from instruments import INSTRUMENTS
    path = path or os.path.join(MODELS, f'{model_id}.ssm')
    hdr = read_header(path)
    by = {os.path.basename(f): f for f, _, _ in collect(INSTRUMENTS[model_id])}
    zones = [z for z in hdr['zones'] if z['src'] in by]
    if max_notes and len(zones) > max_notes:
        idx = np.linspace(0, len(zones) - 1, max_notes).round().astype(int)
        zones = [zones[i] for i in sorted(set(idx))]
    rows, att = [], []
    for gi, z in enumerate(zones):
        x, sr = load_stereo(by[z['src']])
        on = find_onset(x.mean(1), sr)
        hold = sustain_duration(x.mean(1), sr)
        x = x[on:]
        vel = hdr['layers'][z['layer']]['velocity'] if z['layer'] < len(hdr['layers']) else 118
        y = render(path, int(round(z['note'])), hold, sr, sets=sets, vel=vel)
        y = y[find_onset(y.mean(1), sr):]
        wins = {lab: note_windows(sig, sr, z['f0'], hold) for lab, sig in ((1, x), (0, y))}
        # audibility mask from the *real* note (same for both sides): per-harmonic features of
        # harmonics more than AUDIBLE_DB below the strongest carry no audible information
        if wins[1]:
            lv = np.array([wins[1][0].get(f'level{i + 1}', np.nan) for i in range(NH)])
            quiet = [i + 1 for i in range(NH) if not lv[i] > -AUDIBLE_DB]
            for lab in (1, 0):
                for f in wins[lab]:
                    for i in quiet:
                        for key in ('flut', 'modlo', 'modmid', 'modhi', 'cents', 'ild', 'coh'):
                            f[f'{key}{i}'] = np.nan
        for lab in (1, 0):
            for f in wins[lab]:
                rows.append((gi, lab, f))
        for lab, sig in ((1, x), (0, y)):
            att.append((gi, lab, attack_features(sig, sr, z['f0'])))
        if rel is not None:
            # release: note-off where the recorded tone starts to die away
            t_r = release_onset(x.mean(1), sr)
            if len(x) / sr > t_r + 0.5:
                yr = render(path, int(round(z['note'])), t_r, sr, sets=sets, vel=vel)
                yr = yr[find_onset(yr.mean(1), sr):]
                fr, use = release_features(x, sr, t_r)
                rel.append((gi, 1, fr))
                rel.append((gi, 0, release_features(yr, sr, t_r, use)[0]))
        print(f'  {z["src"]}', flush=True)
    return rows, att


def two_sample(rows, label):
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.inspection import permutation_importance
    from sklearn.metrics import roc_auc_score
    keys = sorted(rows[0][2])
    X = np.array([[r[2].get(k, np.nan) for k in keys] for r in rows], float)
    X[~np.isfinite(X)] = np.nan
    keep = ~np.all(np.isnan(X), axis=0) & (np.nanstd(X, axis=0) > 0)
    X, keys = X[:, keep], [k for k, kk in zip(keys, keep) if kk]
    y = np.array([r[1] for r in rows])
    g = np.array([r[0] for r in rows])
    groups = np.unique(g)
    folds = np.array_split(np.random.default_rng(0).permutation(groups), min(5, len(groups)))
    prob = np.zeros(len(y))
    imp = np.zeros(len(keys))
    for test_g in folds:
        te = np.isin(g, test_g)
        if len(y) < 300:
            # few examples (one attack per note): a regularised linear model can still learn
            from sklearn.impute import SimpleImputer
            from sklearn.linear_model import LogisticRegression
            from sklearn.pipeline import make_pipeline
            from sklearn.preprocessing import StandardScaler
            clf = make_pipeline(SimpleImputer(), StandardScaler(), LogisticRegression(C=0.3, max_iter=2000))
        else:
            clf = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.05, max_leaf_nodes=8, random_state=0)
        clf.fit(X[~te], y[~te])
        prob[te] = clf.predict_proba(X[te])[:, 1]
        if len(np.unique(y[te])) == 2:
            pi = permutation_importance(clf, X[te], y[te], scoring='roc_auc', n_repeats=5, random_state=0)
            imp += pi.importances_mean
    auc = roc_auc_score(y, prob)
    acc = float(np.mean((prob > 0.5) == y))
    order = np.argsort(-imp)[:6]
    print(f'[{label}] windows={len(y)} AUC={auc:.3f} accuracy={acc:.2f}  top tells: ' +
          ', '.join(f'{keys[i]}({imp[i] / len(folds):.3f})' for i in order))
    return auc, acc, [(keys[i], float(imp[i] / len(folds))) for i in order]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('model')
    ap.add_argument('--max', type=int, default=None)
    ap.add_argument('--set', action='append', default=[])
    ap.add_argument('--model-path', default=None)
    a = ap.parse_args()
    import pickle
    cache = os.environ.get('DISC_CACHE')
    if cache and os.path.exists(cache):
        rows, att, rel = pickle.load(open(cache, 'rb'))
    else:
        rel = []
        rows, att = collect_features(a.model, a.max, a.set, a.model_path, rel)
        if cache:
            pickle.dump((rows, att, rel), open(cache, 'wb'))
    two_sample(rows, f'{a.model} sustain')
    two_sample(att, f'{a.model} attack')
    if rel:
        two_sample(rel, f'{a.model} release')


if __name__ == '__main__':
    main()
