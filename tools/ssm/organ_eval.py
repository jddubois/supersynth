"""Organ registrations: sum of the real recorded pipes vs the engine (public API), per channel."""
import json
import os
import subprocess
import sys

import numpy as np
import soundfile as sf

from analysis import load_mono
from compare import metrics, plot_pair
from instruments import BUREA_TRANSPOSE, burea_pipe
from paths import DATA_ROOT

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.environ.get('ORGAN_EVAL_OUT', os.path.join(DATA_ROOT, 'organ_ref'))

CASES = {
    'principal-chord': (['great-principal-8'], [60, 64, 67]),
    'plenum-chord': (['great-principal-8', 'great-octave-4', 'great-octave-2', 'great-mixture'], [60, 64, 67]),
    'flutes-chord': (['great-gedackt-8', 'great-rohrflute-4'], [53, 57, 60, 65]),
    'trumpet-note': (['great-principal-8', 'great-trumpet-8'], [67]),
    'krummhorn-note': (['positive-gedackt-8', 'positive-krummhorn-8'], [62]),
    'celeste-chord': (['swell-salicional-8', 'extra-voix-celeste-8'], [57, 60, 64]),
    'cornet-note': (['great-gedackt-8', 'great-rohrflute-4', 'great-sesquialtera'], [72]),
    'pedal-note': (['pedal-subbass-16', 'pedal-principal-8'], [36]),
}


def real_sum(stops, keys, seconds, stereo=False):
    acc = None
    sr = None
    for s in stops:
        for k in keys:
            if stereo:
                x, sr = sf.read(burea_pipe(s, k), dtype='float64', always_2d=True)
                x = x[:int(seconds * sr), :2]
                if acc is None:
                    acc = np.zeros((int(seconds * sr), 2))
            else:
                x, sr = load_mono(burea_pipe(s, k))
                x = x[:int(seconds * sr)]
                if acc is None:
                    acc = np.zeros(int(seconds * sr))
            acc[:len(x)] += x
    return acc, sr


def first_release(stops, keys):
    """Seconds until the first of the summed recorded pipes starts its release (each recording
    is held for its own length: beyond this the sum no longer represents the held chord)."""
    from fidelity import release_onset
    t = 99.0
    for s in stops:
        for k in keys:
            x, sr = load_mono(burea_pipe(s, k))
            t = min(t, release_onset(x, sr))
    return t


def main(cases):
    os.makedirs(OUT, exist_ok=True)
    res = {}
    for name in cases:
        stops, keys = CASES[name]
        seconds = 4.5
        real, sr = real_sum(stops, keys, seconds)
        spec = {'sampleRate': sr, 'layers': [{'model': f'organ/{s}', 'transpose': BUREA_TRANSPOSE[s]} for s in stops],
                'keys': keys, 'hold': 4.0, 'seconds': seconds}
        sp = os.path.join(OUT, f'{name}.json')
        json.dump(spec, open(sp, 'w'))
        out = os.path.join(OUT, f'{name}__syn.wav')
        subprocess.run(['node', '--import', 'tsx', 'tools/ssm/organ_render.ts', sp, out], cwd=REPO, check=True)
        y_st, _ = sf.read(out)
        y = y_st.mean(axis=1)
        sf.write(os.path.join(OUT, f'{name}__real.wav'), real / max(1e-9, np.abs(real).max()) * 0.8, sr)
        real_st, _ = real_sum(stops, keys, seconds, stereo=True)
        sf.write(os.path.join(OUT, f'{name}__real_st.wav'), real_st / max(1e-9, np.abs(real_st).max()) * 0.8, sr)
        # per channel (what is heard on speakers: the room microphones see some partials in
        # opposite phase, which the mono sum cancels); the mono comparison is kept as `mono`
        dur = min(3.8, first_release(stops, keys) - 0.05)
        ms = [metrics(real_st[:, c], y_st[:, c], sr, seconds=dur) for c in (0, 1)]
        m = {k: float(np.mean([mm[k] for mm in ms])) for k in ms[0]}
        m['mono'] = metrics(real, y, sr, seconds=dur)
        res[name] = m
        plot_pair(real, y, sr, os.path.join(OUT, f'{name}.png'), title=f'organ {name}', labels=('real pipes (sum)', 'engine'), seconds=4)
        print(f'{name:18s} lsd={m["lsd_db"]:5.2f} attack={m["lsd_attack_db"]:5.2f} env={m["env_err_db"]:5.2f} '
              f'centroid={m["centroid_err_cents"]:6.1f}c gain={m["gain_db"]:+.1f}  (mono lsd={m["mono"]["lsd_db"]:5.2f})', flush=True)
    json.dump(res, open(os.path.join(OUT, 'results.json'), 'w'), indent=1)


if __name__ == '__main__':
    main(sys.argv[1:] or list(CASES))
