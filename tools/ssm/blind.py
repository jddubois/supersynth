"""Blind A/B pairs: real recording vs synthesis of a note the model never saw.

  python blind.py make <out-dir> [ids...]   # build hold-out models, render pairs, write key.json
  python blind.py score <out-dir> <answers.json>...

Pairs are made indistinguishable in everything but the sound itself: both mono,
same sample rate, 16-bit with dither, cut at the onset, same length, same RMS,
same fade-out. The answer key is written outside the pair directory.
"""
from __future__ import annotations

import json
import os
import random
import subprocess
import sys
import tempfile

import numpy as np
import soundfile as sf

from analysis import find_onset, load_mono
from build import build, collect
import build as buildmod
from evaluate import read_header, sustain_duration, SSRENDER
from instruments import INSTRUMENTS

HOLD = '/Users/jddubois/aptora/supersynth/data/holdout'


def holdout_model(model_id: str) -> tuple[str, list[tuple[str, int, str]]]:
    """Build (once) a model without every other pitch; return path and held-out items."""
    os.makedirs(HOLD, exist_ok=True)
    safe = model_id.replace('/', '__')
    path = os.path.join(HOLD, f'{safe}.ssm')
    meta = os.path.join(HOLD, f'{safe}.json')
    spec = dict(INSTRUMENTS[model_id])
    items = collect(spec)
    by_layer: dict[str, list] = {}
    for f, n, l in items:
        by_layer.setdefault(l, []).append((n, f, l))
    keep, test = [], []
    for l, lst in by_layer.items():
        lst.sort()
        for i, (n, f, ll) in enumerate(lst):
            (test if (i % 2 == 1 and 0 < i < len(lst) - 1) else keep).append((f, n, ll))
    if not os.path.exists(path):
        data = os.environ.get('SUPERSYNTH_DATA', '/Users/jddubois/aptora/supersynth/data/samples')
        spec['files'] = [os.path.relpath(f, data) for f, _, _ in keep]
        old = buildmod.OUT_DIR
        buildmod.OUT_DIR = HOLD
        try:
            build(safe, spec)
        finally:
            buildmod.OUT_DIR = old
        with open(meta, 'w') as fh:
            json.dump({'test': test}, fh)
    return path, test


def prep(x: np.ndarray, sr: int, seconds: float) -> np.ndarray:
    # identical treatment: cut 3 ms before the onset, 3 ms raised-cosine fade-in
    on = max(0, find_onset(x, sr, -40) - int(0.003 * sr))
    y = x[on:on + int(seconds * sr)].copy()
    fi = int(0.003 * sr)
    y[:fi] *= 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, fi))
    if len(y) < int(seconds * sr):
        y = np.pad(y, (0, int(seconds * sr) - len(y)))
    fade = int(0.03 * sr)
    y[-fade:] *= np.linspace(1, 0, fade)
    return y


def render(model_path: str, note: int, vel: float, dur: float, tail: float, sr: int, tune: float = 0.0) -> np.ndarray:
    fd, out = tempfile.mkstemp(suffix='.wav')
    os.close(fd)
    cmd = [SSRENDER, model_path, out, '--sr', str(sr), '--tail', str(tail), '--mono', '--reverb', 'off',
           '--set', f'tune={tune:.2f}', f'{note}:{int(round(vel))}:0:{dur}']
    subprocess.run(cmd, check=True, capture_output=True)
    y, _ = sf.read(out, dtype='float64')
    os.remove(out)
    return y


def make(out_dir: str, ids: list[str], per_instrument: int = 1, seconds: float = 3.5, seed: int = 7,
         rebuild: bool = False):
    if rebuild:
        for mid in ids:
            p = os.path.join(HOLD, mid.replace('/', '__') + '.ssm')
            if os.path.exists(p):
                os.remove(p)
    rng = random.Random(seed)
    pairs_dir = os.path.join(out_dir, 'pairs')
    os.makedirs(pairs_dir, exist_ok=True)
    key = []
    k = 0
    for mid in ids:
        try:
            path, test = holdout_model(mid)
        except Exception as ex:  # noqa: BLE001
            print('skip', mid, ex)
            continue
        hdr = read_header(path)
        lv = {l['name']: l['velocity'] for l in hdr['layers']}
        # pick held-out notes from the middle of the range, loudest layer first
        test = [t for t in test if t[2] in lv]
        if not test:
            continue
        test.sort(key=lambda t: (-lv[t[2]], abs(t[1] - np.median([u[1] for u in test]))))
        for f, nominal, layer in test[:per_instrument]:
            x, sr = load_mono(f)
            # sounding pitch from the model's octave convention
            items = collect(INSTRUMENTS[mid])
            nmap = {os.path.basename(a): b for a, b, _ in items}
            offs = [round((z['note'] - nmap.get(z['src'], z['note'])) / 12) * 12 for z in hdr['zones']]
            note = int(nominal + int(np.median(offs)))
            if hdr['kind'] == 'sustained':
                dur = sustain_duration(x, sr)          # hold as long as the real note sustains
                tail = 1.0
            else:
                dur = seconds
                tail = 0.2
            # tuning equalisation (like loudness matching): play at the recording's pitch
            from analysis import estimate_f0, midi_to_hz
            from evaluate import octave_offset  # noqa: F401
            f0 = estimate_f0(x[find_onset(x, sr):], sr, midi_to_hz(note), 0.2 if hdr['kind'] == 'sustained' else 0.05,
                             1.0, octave_search=False)
            tune = float(np.clip(1200 * np.log2(f0 / midi_to_hz(note)), -60, 60))
            if hdr['params'].get('tuning') == 'recorded':
                tune = 0.0
            y = render(path, note, lv[layer], dur, tail, sr, tune)
            a = prep(x, sr, seconds)
            b = prep(y, sr, seconds)
            b *= np.sqrt(np.mean(a ** 2) / max(np.mean(b ** 2), 1e-20))
            # identical faint channel noise on both (masks digital silence, a non-acoustic tell)
            nrng = np.random.default_rng(k)
            floor = 10 ** (-76 / 20) * nrng.standard_normal(len(a))
            a = a + floor
            b = b + floor[::-1]
            k += 1
            real_first = rng.random() < 0.5
            name = f'pair_{k:02d}'
            for which, sig in (('A', a if real_first else b), ('B', b if real_first else a)):
                sf.write(os.path.join(pairs_dir, f'{name}_{which}.wav'), np.clip(sig, -1, 1), sr, subtype='PCM_16')
            key.append({'pair': name, 'real': 'A' if real_first else 'B', 'instrument': mid,
                        'file': os.path.basename(f), 'note': note})
            print(name, mid, os.path.basename(f), 'real=', key[-1]['real'], flush=True)
    with open(os.path.join(out_dir, 'key.json'), 'w') as fh:
        json.dump(key, fh, indent=1)


def score(out_dir: str, answer_files: list[str]):
    key = {k['pair']: k for k in json.load(open(os.path.join(out_dir, 'key.json')))}
    tot = cor = 0
    rows = []
    for af in answer_files:
        ans = json.load(open(af))
        for a in ans:
            k = key.get(a['pair'])
            if not k:
                continue
            ok = a['real'] == k['real']
            tot += 1
            cor += ok
            rows.append((k['instrument'], a['pair'], ok, a.get('confidence'), a.get('evidence', '')[:160]))
    for r in sorted(rows):
        print(('CORRECT ' if r[2] else 'fooled  '), r[0], r[1], 'conf', r[3], '|', r[4])
    print(f'accuracy {cor}/{tot} = {cor / max(tot, 1):.0%}  (50% = indistinguishable)')


if __name__ == '__main__':
    if sys.argv[1] == 'make':
        ids = sys.argv[3:] or [i for i in INSTRUMENTS if not i.startswith('organ/')]
        make(sys.argv[2], ids, rebuild=os.environ.get('REBUILD') == '1', seed=int(os.environ.get('SEED', '7')))
    elif sys.argv[1] == 'score':
        score(sys.argv[2], sys.argv[3:])
