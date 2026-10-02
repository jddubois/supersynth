"""Organ-focused blind A/B pairs: real Bureå pipes vs the engine.

  python organ_blind.py <out-dir> <n-single> [seed]

Single pipes are held exactly as long as the recorded pipe (until the sample's release
cue) and then released, so each pair includes the pipe's attack, sustain and release
with the church's own reverberation. Chords and registrations come from organ_eval.py
(sum of the real pipes vs the engine through the public API).
Writes <out-dir>/pairs/pair_NN_{A,B}.wav and <out-dir>/key.json.
"""
import json
import os
import random
import subprocess
import sys
import tempfile

import numpy as np
import soundfile as sf

from analysis import find_onset
from blind import prep  # noqa: F401  (mono variant)
from build import wav_cue_seconds
from evaluate import read_header, SSRENDER
from instruments import BUREA_STOPS
from paths import DATA_ROOT

MODELS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'models')
SAMPLES = os.path.join(DATA_ROOT, 'samples')
REF = os.path.join(DATA_ROOT, 'organ_ref')


def single_pairs(n: int, rng: random.Random):
    by_family: dict[str, list[str]] = {}
    folders = {}
    for folder, sid, disp, offset, family in BUREA_STOPS:
        by_family.setdefault(family, []).append(sid)
        folders[sid] = folder
    fams = sorted(by_family)
    out = []
    for i in range(n):
        fam = fams[i % len(fams)]
        sid = rng.choice(by_family[fam])
        mid = f'organ/{sid}'
        path = os.path.join(MODELS, 'organ', f'{sid}.ssm')
        h = read_header(path)
        zones = [z for z in h['zones'] if 0.2 < (z['note'] - 36) / 60 < 0.85] or h['zones']
        z = rng.choice(zones)
        f = os.path.join(SAMPLES, 'grandorgue', 'Burea_wav', folders[sid], z['src'])
        x, sr = sf.read(f, dtype='float64', always_2d=True)
        x = x[:, :2]
        cue = wav_cue_seconds(f)
        on = find_onset(x.mean(axis=1), sr, -40) / sr
        if cue is None or cue - on < 0.8:
            continue
        hold = cue - on
        seconds = float(min(hold + 2.2, 7.0))
        fd, tmp = tempfile.mkstemp(suffix='.wav')
        os.close(fd)
        subprocess.run([SSRENDER, path, tmp, '--sr', str(sr), '--tail', '3', '--reverb', 'off',
                        f'{int(round(z["note"]))}:100:0:{hold:.3f}'], check=True, capture_output=True)
        y, _ = sf.read(tmp, dtype='float64', always_2d=True)
        os.remove(tmp)
        out.append((mid, z['src'], int(round(z['note'])), x, y, sr, seconds))
        print('single', mid, z['src'], f'hold {hold:.2f}s', flush=True)
    return out


def chord_pairs(cases):
    subprocess.run([sys.executable, 'organ_eval.py', *cases], check=True)
    out = []
    for name in cases:
        a, sr = sf.read(os.path.join(REF, f'{name}__real_st.wav'), always_2d=True)
        b, _ = sf.read(os.path.join(REF, f'{name}__syn.wav'), always_2d=True)
        out.append((f'organ/{name}', 'summed real pipes', 0, a, b, sr, 3.5))
    return out


def prep_st(x: np.ndarray, sr: int, seconds: float) -> np.ndarray:
    """Stereo version of blind.prep: same onset cut (from the mid signal), fades and length."""
    on = max(0, find_onset(x.mean(axis=1), sr, -40) - int(0.003 * sr))
    y = x[on:on + int(seconds * sr)].copy()
    fi = int(0.003 * sr)
    y[:fi] *= (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, fi)))[:, None]
    if len(y) < int(seconds * sr):
        y = np.pad(y, ((0, int(seconds * sr) - len(y)), (0, 0)))
    fade = int(0.03 * sr)
    y[-fade:] *= np.linspace(1, 0, fade)[:, None]
    return y


def main(out_dir: str, n_single: int, seed: int = 5):
    rng = random.Random(seed)
    items = single_pairs(n_single, rng)
    items += chord_pairs(['principal-chord', 'plenum-chord', 'flutes-chord', 'trumpet-note', 'krummhorn-note',
                          'celeste-chord', 'cornet-note', 'pedal-note'])
    pairs_dir = os.path.join(out_dir, 'pairs')
    os.makedirs(pairs_dir, exist_ok=True)
    key = []
    for k, (mid, src, note, x, y, sr, seconds) in enumerate(items, 1):
        a, b = prep_st(x, sr, seconds), prep_st(y, sr, seconds)
        b *= np.sqrt(np.mean(a ** 2) / max(np.mean(b ** 2), 1e-20))
        floor = 10 ** (-76 / 20) * np.random.default_rng(k).standard_normal(a.shape)
        a, b = a + floor, b + floor[::-1]
        real_first = rng.random() < 0.5
        name = f'pair_{k:02d}'
        for which, sig in (('A', a if real_first else b), ('B', b if real_first else a)):
            sf.write(os.path.join(pairs_dir, f'{name}_{which}.wav'), np.clip(sig, -1, 1), sr, subtype='PCM_16')
        key.append({'pair': name, 'real': 'A' if real_first else 'B', 'instrument': mid, 'file': src, 'note': note})
    json.dump(key, open(os.path.join(out_dir, 'key.json'), 'w'), indent=1)
    print(len(key), 'pairs')


if __name__ == '__main__':
    main(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]) if len(sys.argv) > 3 else 5)
