"""How a key's release sounds after short and long key presses: the engine (public organ API)
against the sample set played as GrandOrgue plays it (the attack until key-up, crossfaded
into the release the press length selects).

  python alt_check.py <organ> [stop-id ...]

Prints, per press length, the release level (dB re the level at key-up) 0.1–1.5 s after the
key-up, sample set vs engine, and the mean difference.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile

import numpy as np
import soundfile as sf

import piotr
from grandorgue import _read, retune, splice_release, wav_cue

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HOLDS = (0.12, 0.6, 2.0)
AFTER = (0.1, 0.25, 0.5, 1.0, 1.5)


def real(p, hold: float) -> tuple[np.ndarray, int]:
    att, sr = _read(p.attack)
    f0 = 440.0 * 2 ** ((p.midi - 69) / 12)
    rel = next((r for mx, r in p.alt_releases if hold <= mx), None)
    cue = wav_cue(p.attack)
    if rel is None and p.release is None:
        # the attack recording's own release, after its cue
        n = int(hold * sr)
        y = np.concatenate([att[:n], att[cue:]]) if cue else att
        up = n
    else:
        r, _ = _read(rel or p.release)
        rc = wav_cue(rel or p.release)
        if rc is not None and 0 < rc < len(r) // 2:
            r = r[rc:]
        a = att[:cue] if (p.release is None and cue) else att
        y, up = splice_release(a, r, sr, int(hold * sr), f0, p.crossfade_ms)
    return retune(y * p.amplitude * 10 ** (p.gain_db / 20), p.tuning_cents), up


def levels(x: np.ndarray, sr: int, up: int) -> np.ndarray:
    w = int(0.05 * sr)
    p = np.convolve((x ** 2).mean(axis=1), np.ones(w) / w, 'same')
    ref = 10 * np.log10(np.mean(p[max(0, up - w):up]) + 1e-20)
    return np.array([10 * np.log10(p[min(len(p) - 1, up + int(t * sr))] + 1e-20) - ref for t in AFTER])


def engine(organ: str, st: dict, key: int, hold: float) -> tuple[np.ndarray, int, int]:
    spec = {'organ': organ, 'draw': {st['division']: [st['name']]}, 'play': {st['division']: [key]},
            'hold': hold, 'seconds': hold + 2.0, 'sampleRate': 48000}
    with tempfile.TemporaryDirectory() as d:
        sp, out = os.path.join(d, 'spec.json'), os.path.join(d, 'out.wav')
        with open(sp, 'w') as f:
            json.dump(spec, f)
        subprocess.run(['node', '--import', 'tsx', 'tools/ssm/piotr_render.ts', sp, out], cwd=REPO, check=True)
        x, sr = sf.read(out, always_2d=True)
    return x, sr, int((0.01 + hold) * sr)


def main(organ: str, only: list[str]):
    cat = piotr.load_catalog(organ)
    odf = piotr.load_odf(organ)
    stops = piotr.catalog_stops(odf, cat)
    if not only:
        # one stop per family
        seen, only = set(), []
        for _, st in stops:
            if st['family'] not in seen:
                seen.add(st['family'])
                only.append(st['id'])
    diffs = {h: [] for h in HOLDS}
    for s, st in stops:
        if st['id'] not in only:
            continue
        keys = sorted(s.keys)
        for key in (keys[len(keys) // 4], keys[len(keys) // 2], keys[3 * len(keys) // 4]):
            p = s.keys[key][0]
            for hold in HOLDS:
                y, up = real(p, hold)
                a = levels(y, 48000, up)
                x, sr, eup = engine(organ, st, key, hold)
                b = levels(x, sr, eup)
                diffs[hold].append(np.abs(a - b).mean())
                print(f'{st["id"]:32s} {key} hold {hold:4.2f}  real {np.round(a, 0)}  engine {np.round(b, 0)}', flush=True)
    for h in HOLDS:
        print(f'hold {h:4.2f} s: mean |real - engine| over the release {np.mean(diffs[h]):.1f} dB')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2:])
