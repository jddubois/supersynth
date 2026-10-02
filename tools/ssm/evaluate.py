"""Render reference notes through the Rust engine and compare with the real recordings.

  python evaluate.py <model-id> [--holdout] [--plots N] [--notes 60,64] [--set k=v ...]

--holdout builds a model from every other pitch (per layer) and evaluates only on the
excluded recordings: the synthesizer must *generalise* to notes it never saw.
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import struct
import subprocess
import sys
import tempfile

import numpy as np
import soundfile as sf

from analysis import find_onset, load_mono, midi_to_hz
from compare import metrics, plot_pair
from paths import DATA_ROOT

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
SSRENDER = os.environ.get('SSRENDER', os.path.join(REPO, 'native', 'target', 'release', 'ssrender'))
OUT = os.environ.get('SUPERSYNTH_EVAL_OUT', os.path.join(DATA_ROOT, 'eval'))


def read_header(path):
    with gzip.open(path, 'rb') as f:
        raw = f.read()
    assert raw[:4] == b'SSM1'
    n = struct.unpack('<I', raw[4:8])[0]
    return json.loads(raw[8:8 + n])


def sustain_duration(x, sr):
    """Time from onset to the start of the natural release in a sustained recording."""
    on = find_onset(x, sr)
    y = x[on:]
    win = int(0.02 * sr)
    env = 20 * np.log10(np.sqrt(np.convolve(y * y, np.ones(win) / win, 'same')) + 1e-9)
    steady = np.median(env[int(0.3 * sr):int(max(0.31 * sr, len(env) * 0.6))])
    above = np.where(env > steady - 8)[0]
    return (above[-1] / sr) if len(above) else len(y) / sr


def octave_offset(hdr, items):
    """Octave naming offset of this instrument, learned from the model's zones."""
    nominal = {os.path.basename(f): n for f, n, _ in items}
    offs = [round((z['note'] - nominal[z['src']]) / 12) * 12 for z in hdr['zones'] if z['src'] in nominal]
    return int(np.median(offs)) if offs else 0


def render(model_path, note, vel, dur, tail, sr, sets=(), reverb='off'):
    fd, out = tempfile.mkstemp(suffix='.wav')
    os.close(fd)
    cmd = [SSRENDER, model_path, out, '--sr', str(sr), '--tail', str(tail), '--mono', '--reverb', reverb]
    for s in sets:
        cmd += ['--set', s]
    cmd.append(f'{note}:{int(round(vel))}:0:{dur}')
    subprocess.run(cmd, check=True, capture_output=True)
    y, _ = sf.read(out, dtype='float64')
    os.remove(out)
    return y


def sampler_baseline(f, x, sr, nominal, layer, keep_files, items, seconds):
    from scipy import signal as sg
    cands = [(abs(n - nominal), ff, n) for ff, n, l in items if l == layer and ff in keep_files]
    if not cands:
        return None
    _, ff, n2 = min(cands)
    y, sr2 = load_mono(ff)
    ratio = 2 ** ((nominal - n2) / 12)          # play the neighbour faster/slower
    # resample: new length = len / ratio (and match sample rates)
    target_len = int(len(y) * sr / sr2 / ratio)
    y = sg.resample(y, target_len)
    return metrics(x, y, sr, seconds=seconds)


def evaluate(model_id, holdout=False, plots=6, notes=None, sets=(), baseline=True, max_tests=None):
    from build import build, OUT_DIR
    from instruments import INSTRUMENTS
    spec = dict(INSTRUMENTS[model_id])
    model_path = os.path.join(OUT_DIR, f'{model_id}.ssm')
    test_files = None
    keep_files = []
    if holdout:
        # model built without every other pitch (shared with blind.py), tested on the rest
        from blind import holdout_model
        model_path, test = holdout_model(model_id)
        test_files = {t[0] for t in test}
        from build import collect
        keep_files = [f for f, _, _ in collect(spec) if f not in test_files]
    hdr = read_header(model_path)
    layers = hdr['layers']
    out_dir = os.path.join(OUT, model_id + ('-holdout' if holdout else ''))
    os.makedirs(out_dir, exist_ok=True)

    from build import collect
    items = collect(INSTRUMENTS[model_id])
    results = []
    all_items = items
    if test_files is not None:
        items = [it for it in items if it[0] in test_files]
    if max_tests and len(items) > max_tests:
        idx = np.linspace(0, len(items) - 1, max_tests).round().astype(int)
        items = [items[i] for i in sorted(set(idx))]
    for f, nominal, layer in items:
        x, sr = load_mono(f)
        # the model knows each layer's velocity; holdout models share layer names
        lv = {l['name']: l['velocity'] for l in layers}
        if layer not in lv:
            continue
        vel = lv[layer]
        # pitch: nominal note corrected by the instrument's octave convention
        zsrc = {z['src']: z for z in hdr['zones']}
        if os.path.basename(f) in zsrc:
            note = int(round(zsrc[os.path.basename(f)]['note']))
        else:
            from analysis import estimate_f0, hz_to_midi
            f0 = estimate_f0(x[find_onset(x, sr):], sr, midi_to_hz(nominal + octave_offset(hdr, all_items)), 0.2, 1.0,
                             octave_search=False)
            note = int(round(hz_to_midi(f0)))
        if notes and note not in notes:
            continue
        if hdr['kind'] == 'sustained':
            dur = sustain_duration(x, sr)
            tail = 1.5
        else:
            dur = len(x) / sr
            tail = 0.2
        y = render(model_path, note, vel, dur, tail, sr, sets)
        seconds = min(len(x) / sr, dur + tail, 6.0)
        m = metrics(x, y, sr, seconds=seconds)
        if holdout and baseline:
            # sampler baseline: nearest kept recording of the same layer, resampled to pitch
            bm = sampler_baseline(f, x, sr, nominal, layer, keep_files, all_items, seconds)
            if bm:
                m['base_lsd_db'] = bm['lsd_db']
                m['base_centroid_err_cents'] = bm['centroid_err_cents']
        m.update(file=os.path.basename(f), note=note, velocity=vel, layer=layer)
        results.append(m)
        base = os.path.splitext(os.path.basename(f))[0]
        # loudness-match for listening comparisons
        sf.write(os.path.join(out_dir, base + '__ref.wav'), x[find_onset(x, sr):][:int(seconds * sr)], sr)
        sf.write(os.path.join(out_dir, base + '__syn.wav'), y[find_onset(y, sr):][:int(seconds * sr)], sr)
        if plots > 0:
            plot_pair(x, y, sr, os.path.join(out_dir, base + '.png'), title=f'{model_id} {base}',
                      labels=('real', 'synth'), seconds=seconds)
            plots -= 1
        print(f"  {base:48s} note={note:3d} v={vel:5.1f} lsd={m['lsd_db']:5.2f} attack={m['lsd_attack_db']:5.2f} "
              f"gain={m['gain_db']:+5.1f} env={m['env_err_db']:5.2f} centroid={m['centroid_err_cents']:6.1f}c", flush=True)
    if results:
        keys = ['lsd_db', 'lsd_attack_db', 'env_err_db', 'centroid_err_cents']
        if all('base_lsd_db' in r for r in results):
            keys += ['base_lsd_db', 'base_centroid_err_cents']
        summ = {k: float(np.mean([r[k] for r in results])) for k in keys}
        print(f'[{model_id}{" holdout" if holdout else ""}] n={len(results)} ' +
              ' '.join(f'{k}={v:.2f}' for k, v in summ.items()), flush=True)
        with open(os.path.join(out_dir, 'results.json'), 'w') as fh:
            json.dump({'summary': summ, 'results': results}, fh, indent=1)
        return summ
    return None


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('model')
    ap.add_argument('--holdout', action='store_true')
    ap.add_argument('--plots', type=int, default=6)
    ap.add_argument('--notes', type=str, default=None)
    ap.add_argument('--set', action='append', default=[])
    ap.add_argument('--max', type=int, default=None)
    a = ap.parse_args()
    notes = [int(n) for n in a.notes.split(',')] if a.notes else None
    evaluate(a.model, a.holdout, a.plots, notes, a.set, max_tests=a.max)
