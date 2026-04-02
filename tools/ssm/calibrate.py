"""Loudness calibration: a mid-range note at velocity 100 of every instrument plays at the
same RMS level (organ stops share one correction so their natural balance is kept).

  python calibrate.py
"""
import glob
import os
import subprocess
import tempfile

import numpy as np
import soundfile as sf

from evaluate import read_header, SSRENDER
from patch_header import patch

TARGET_DB = -20.0
MODELS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'models')


def level(path: str) -> float:
    h = read_header(path)
    lo, hi = min(z['note'] for z in h['zones']), max(z['note'] for z in h['zones'])
    note = int(round(lo + (hi - lo) * 0.45))
    fd, out = tempfile.mkstemp(suffix='.wav')
    os.close(fd)
    subprocess.run([SSRENDER, path, out, '--mono', '--reverb', 'off', '--tail', '0.5', f'{note}:100:0:2'],
                   check=True, capture_output=True)
    y, sr = sf.read(out)
    os.remove(out)
    seg = y[int(0.05 * sr):int(1.5 * sr)]
    return 20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-12)


def main():
    files = sorted(glob.glob(os.path.join(MODELS, '*.ssm')))
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
    ref = os.path.join(MODELS, 'organ', 'great-principal-8.ssm')
    if os.path.exists(ref):
        corr = TARGET_DB - level(ref)
        for f in sorted(glob.glob(os.path.join(MODELS, 'organ', '*.ssm'))):
            h = read_header(f)
            patch(f, {'gainDb': round(h['params']['gainDb'] + corr, 2)})
        print(f'organ stops: {corr:+5.1f} dB (from the Principal 8\')')


if __name__ == '__main__':
    main()
