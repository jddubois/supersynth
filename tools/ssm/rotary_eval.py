"""Compare the engine's rock organ with the recordings it was measured from (freepats.py).

  python rotary_eval.py [--models DIR] [--set leslie=3 …] [--notes 48,60,72] [--wav DIR]

For every recorded note the engine plays the same note through its rotary speaker, and both
are measured the same way:

  spectrum   the long-term level of each harmonic (what `freepats.py dry --calibrate` matches)
  movement   per harmonic, from its demodulated envelope and phase in each channel: how far
             the level swings (dB between the 5th and 95th percentile), how fast (the
             strongest modulation rate), how far the pitch swings (cents, weighted by level,
             so the wild phase at a level minimum counts little), and how alike the left and
             right swings are (correlation of the two envelopes)

Movement is summarised by the harmonic's frequency: the bass rotor carries everything below
the speaker's crossover (800 Hz), the horn everything above. The two rotors turn at different
speeds and nothing fixes their positions when a note starts, so the waveforms themselves are
not comparable, only these statistics. Results are printed, not stored.
"""
from __future__ import annotations

import argparse
import math
import os

import numpy as np
import soundfile as sf
from scipy import signal

from engine import ssrender
from freepats import LEAD_S, SR, harmonic_powers, load, measure, recordings
from paths import model_path

BANDS = [(0, 200, 'below 200 Hz'), (200, 800, '200–800 Hz'), (800, 2000, '0.8–2 kHz'), (2000, 20000, 'above 2 kHz')]


def movement(y: np.ndarray, sr: int, f: float, f0: float, a_s: float, b_s: float) -> dict:
    """Level swing, rate, pitch swing and left/right likeness of the component at `f` Hz."""
    n = np.arange(len(y))
    cut = min(0.45 * f0, 160.0)
    sos = signal.butter(4, cut, fs=sr, output='sos')
    env, dev = [], []
    for c in (0, 1):
        z = signal.sosfiltfilt(sos, y[:, c] * np.exp(-2j * math.pi * f * n / sr))[int(a_s * sr):int(b_s * sr)]
        a = np.abs(z)
        fi = np.gradient(np.unwrap(np.angle(z))) * sr / (2 * math.pi)
        w = a * a
        mean = (w * fi).sum() / w.sum()
        dev.append(math.sqrt((w * (fi - mean) ** 2).sum() / w.sum()) * math.sqrt(2))
        env.append(a)
    db = [20 * np.log10(e + 1e-9) for e in env]
    swing = [float(np.percentile(d, 95) - np.percentile(d, 5)) for d in db]
    e = env[0] + env[1]
    e = e - e.mean()
    spec = np.abs(np.fft.rfft(e * np.hanning(len(e)), 8 * len(e)))
    fr = np.fft.rfftfreq(8 * len(e), 1 / sr)
    sel = (fr > 0.4) & (fr < min(cut, 30))
    rate = float(fr[sel][np.argmax(spec[sel])])
    return {'swing': float(np.mean(swing)), 'rate': rate,
            'cents': float(1200 * math.log2(1 + np.mean(dev) / f)),
            'lr': float(np.corrcoef(env[0], env[1])[0, 1])}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--models', default=None, help='directory of the model (<DIR>/rock-organ.ssm); default: the package')
    ap.add_argument('--set', action='append', default=[], dest='params')
    ap.add_argument('--notes', default=None, help='comma-separated MIDI notes (default: every recorded note)')
    ap.add_argument('--wav', default=None, help='write the engine renders here')
    a = ap.parse_args()
    model = os.path.join(a.models, 'rock-organ.ssm') if a.models else model_path('rock-organ')
    sets = a.params or ['leslie=3']
    only = {int(v) for v in a.notes.split(',')} if a.notes else None
    tones = {t['note']: t for t in measure('rock')}
    rows = {name: {'rec': [], 'eng': []} for *_, name in BANDS}
    spec_diffs = []
    print(f'{model}  {" ".join(sets)}')
    for note, left, right in recordings('rock'):
        if only and note not in only:
            continue
        tone = tones[note]
        y, sr = load(left, right)
        dur = len(y) / sr
        z, zsr = ssrender(model, [f'{note - 12}:100:0:{dur + LEAD_S:.2f}'], sr=SR, tail=0.1, sets=sets)
        if a.wav:
            os.makedirs(a.wav, exist_ok=True)
            sf.write(os.path.join(a.wav, f'{note}.wav'), z, zsr)
        K = max(tone['k'])
        pr = harmonic_powers(y, sr, tone['f0'], K)
        pe = harmonic_powers(z, zsr, tone['f0'], K, skip_s=LEAD_S, end_s=dur + LEAD_S - 0.1)
        dr, de = 10 * np.log10(pr + 1e-30), 10 * np.log10(pe + 1e-30)
        strong = [k for k, db in zip(tone['k'], tone['db']) if db > max(tone['db']) - 25]
        d = np.array([de[k - 1] - dr[k - 1] for k in strong])
        level = 10 * math.log10(z[int(LEAD_S * zsr):int((LEAD_S + dur - 0.1) * zsr)].var() / y.var())
        spec_diffs.append((note, d - np.median(d), level))
        for k, ratio in zip(tone['k'], tone['ratio']):
            if k not in strong:
                continue
            f = ratio * tone['f0']
            name = next(nm for lo, hi, nm in BANDS if lo <= f < hi)
            rows[name]['rec'].append(movement(y, sr, f, tone['f0'], 0.5, dur - 0.3))
            rows[name]['eng'].append(movement(z, zsr, f, tone['f0'], LEAD_S + 0.5, LEAD_S + dur - 0.3))
    print('\nspectrum (engine − recording, harmonics within 25 dB of the strongest, common level removed)')
    alld = np.concatenate([d for _, d, _ in spec_diffs])
    for note, d, level in spec_diffs:
        print(f'  note {note:3d}: mean |Δ| {np.abs(d).mean():4.2f} dB  worst {np.abs(d).max():4.1f} dB   level {level:+5.1f} dB')
    lv = np.array([l for *_, l in spec_diffs])
    print(f'  all: mean |Δ| {np.abs(alld).mean():.2f} dB, worst {np.abs(alld).max():.1f} dB; note levels {lv.mean():+.1f} dB ± {lv.std():.1f}')
    print('\nmovement (median over harmonics; recording → engine)')
    print(f'  {"":14s} {"n":>3s}  {"level swing dB":>16s}  {"rate Hz":>14s}  {"pitch swing c":>15s}  {"left/right":>13s}')
    for *_, name in BANDS:
        r, e = rows[name]['rec'], rows[name]['eng']
        if not r:
            continue
        med = lambda rs, key: float(np.median([x[key] for x in rs]))
        print(f'  {name:14s} {len(r):3d}  ' + '  '.join(
            f'{med(r, key):6.2f} → {med(e, key):6.2f}'.rjust(w) for key, w in (('swing', 16), ('rate', 14), ('cents', 15), ('lr', 13))))


if __name__ == '__main__':
    main()
