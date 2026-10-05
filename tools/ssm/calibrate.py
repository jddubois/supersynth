"""Loudness calibration: a mid-range note at velocity 100 of every instrument plays at the
same RMS level (organ stops share one correction so their natural balance is kept).

  python calibrate.py
"""
import glob
import os

import numpy as np

from engine import read_header, ssrender
from paths import MODELS_DIR, existing_model_path
from patch_header import patch

TARGET_DB = -20.0


def level(path: str) -> float:
    h = read_header(path)
    lo, hi = min(z['note'] for z in h['zones']), max(z['note'] for z in h['zones'])
    note = int(round(lo + (hi - lo) * 0.45))
    y, sr = ssrender(path, [f'{note}:100:0:2'], tail=0.5, mono=True)
    seg = y[int(0.05 * sr):int(1.5 * sr)]
    return 20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-12)


def main():
    # the root package's models (organs, in their own packages, are calibrated as one below)
    files = sorted(glob.glob(os.path.join(MODELS_DIR, '*.ssm')))
    corrections = {}
    for f in files:
        h = read_header(f)
        if h['params'].get('releaseOf'):
            continue                      # follows its parent's correction (below)
        lv = level(f)
        corr = TARGET_DB - lv
        corrections[h['name']] = corr
        patch(f, {'gainDb': round(h['params']['gainDb'] + corr, 2)})
        print(f'{os.path.basename(f):32s} {lv:6.1f} dB → {corr:+5.1f} dB')
    for f in files:
        h = read_header(f)
        parent = h['params'].get('releaseOf')
        if parent in corrections:
            patch(f, {'gainDb': round(h['params']['gainDb'] + corrections[parent], 2)})
            print(f'{os.path.basename(f):32s} follows {parent} ({corrections[parent]:+.1f} dB)')
    ref = existing_model_path('organ/great-principal-8')
    if os.path.exists(ref):
        corr = TARGET_DB - level(ref)
        # the Bureå stops: the reference's directory (Piotr's organs share their own gain)
        for f in sorted(glob.glob(os.path.join(os.path.dirname(ref), '*.ssm'))):
            h = read_header(f)
            patch(f, {'gainDb': round(h['params']['gainDb'] + corr, 2)})
        print(f'organ stops: {corr:+5.1f} dB (from the Principal 8\')')


if __name__ == '__main__':
    main()
