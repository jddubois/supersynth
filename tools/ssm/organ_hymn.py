"""The hymn on the real Bureå pipes vs the engine, per registration.

  python organ_hymn.py <out-dir> [registration ...]      (default: principal-chorus plenum flutes full)

The engine plays Old Hundredth through the public organ API (organ_hymn.ts, no added reverb).
The reference plays the same pipes from the recordings like a GrandOrgue sampler: each pipe's
recorded attack and sustain, and at note-off a 15 ms crossfade into the recording's own
release, from where its tone starts to die away. Both are level-matched and compared per
channel with compare.metrics (log-spectral distance overall, over the attacks, envelope error).
Also writes <reg>__real.wav / <reg>__syn.wav for listening.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

import numpy as np
import soundfile as sf

from analysis import find_onset
from compare import metrics
from fidelity import release_onset
from instruments import BUREA_STOPS
from paths import DATA_ROOT

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
WAV = os.path.join(DATA_ROOT, 'samples/grandorgue/Burea_wav')
FOLDER = {sid: folder for folder, sid, *_ in BUREA_STOPS}
XF = 0.015


def pipe(folder: str, key: int, cache: dict):
    if (folder, key) not in cache:
        names = [f for f in os.listdir(os.path.join(WAV, folder)) if f.startswith(f'{key:03d}-')]
        if not names:
            cache[(folder, key)] = None
        else:
            x, sr = sf.read(os.path.join(WAV, folder, names[0]), dtype='float64', always_2d=True)
            x = x[:, :2]
            m = x.mean(1)
            on = find_onset(m, sr)
            cache[(folder, key)] = (x[on:], sr, release_onset(m, sr))
    return cache[(folder, key)]


def real_render(ev: dict, sr_out: int = 44100) -> np.ndarray:
    out = np.zeros((int(ev['seconds'] * sr_out) + 1, 2))
    cache: dict = {}
    for e in ev['events']:
        p = pipe(FOLDER[e['stop']], e['key'], cache)
        if p is None:
            continue
        x, sr, t_rel = p
        assert sr == sr_out
        n_on = int(e['dur'] * sr)
        nx = int(XF * sr)
        r0 = int(t_rel * sr)
        if n_on + nx < r0:
            # held part, then crossfade into the recorded release
            head = x[:n_on + nx].copy()
            tail = x[r0:].copy()
            fade = np.linspace(0, 1, nx)[:, None]
            head[n_on:] *= 1 - fade
            tail[:nx] *= fade
            seg = np.concatenate([head[:n_on], head[n_on:] + tail[:nx], tail[nx:]])
        else:
            seg = x                      # longer than the recording's own sustain
        a = int(e['at'] * sr)
        n = min(len(seg), len(out) - a)
        out[a:a + n] += seg[:n]
    return out


def main(out_dir: str, regs: list[str]):
    os.makedirs(out_dir, exist_ok=True)
    res = {}
    for reg in regs:
        syn_p = os.path.join(out_dir, f'{reg}__syn.wav')
        ev_p = os.path.join(out_dir, f'{reg}.json')
        subprocess.run(['node', '--import', 'tsx', 'tools/ssm/organ_hymn.ts', reg, syn_p, ev_p, '--dry'],
                       cwd=REPO, check=True, capture_output=True)
        ev = json.load(open(ev_p))
        real = real_render(ev)
        syn, sr = sf.read(syn_p, dtype='float64', always_2d=True)
        n = min(len(real), len(syn))
        real, syn = real[:n], syn[:n]
        g = np.sqrt(np.mean(real ** 2) / max(np.mean(syn ** 2), 1e-20))
        pk = max(np.abs(real).max(), np.abs(syn * g).max())
        sf.write(os.path.join(out_dir, f'{reg}__real.wav'), real / pk * 0.9, sr)
        sf.write(syn_p, syn * g / pk * 0.9, sr)
        # per channel (what is heard on speakers): the room microphones see some partials in
        # opposite phase, which a mono sum would cancel
        ms = [metrics(real[:, c], syn[:, c] * g, sr, seconds=n / sr - 0.5) for c in (0, 1)]
        m = {k: float(np.mean([mm[k] for mm in ms])) for k in ms[0]}
        res[reg] = m
        print(f'{reg:18s} lsd={m["lsd_db"]:5.2f} attack={m["lsd_attack_db"]:5.2f} env={m["env_err_db"]:5.2f} '
              f'centroid={m["centroid_err_cents"]:6.1f}c gain={20 * np.log10(1 / g):+.1f}', flush=True)
    json.dump(res, open(os.path.join(out_dir, 'results.json'), 'w'), indent=1)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2:] or ['principal-chorus', 'plenum', 'flutes', 'full'])
