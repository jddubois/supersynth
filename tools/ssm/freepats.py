"""The FreePats rock organ (CC0, freepats.zenvoid.org/Organ/electric-organ.html): a sample set
of a tonewheel organ recorded through its rotary speaker, 16 notes in stereo.

  python freepats.py model     everything below: download, measure, calibrate, build `rock-organ`
  python freepats.py fetch     download and unpack the sample set into data/samples/freepats
  python freepats.py dry       write the organ's tone without the rotary speaker
                               (data/samples/freepats/rock-dry/<note>.wav), which
                               `python build.py rock-organ` analyses (instruments.py)

A tonewheel organ's tone is steady: every note is a fixed set of sine waves (the drawbars, and
the harmonics its amplifier adds). The movement in the recordings is the rotary speaker's, and
it is the same machine for every note. So the model holds the steady tone, and the engine's
rotary speaker (`leslie`, native/core/src/fx/leslie.rs, fitted to these recordings) puts the
movement back, once for everything that is played, as the speaker does. A model with the
rotation in it would play each note of a chord through a speaker of its own, and could not
change the speaker's speed.

`dry` measures the tone: the long-term power of each harmonic of the lowest drawbar (16'), both
channels, over whole rotations. `--calibrate MODEL_DIR` then corrects for the engine's speaker:
it renders each recorded note through the engine with the speaker running and moves every
harmonic by the difference between the recording and the render, so that the engine's output
has the recording's long-term spectrum. `model` does this three times, which leaves the strong
harmonics within 0.1 dB (`rotary_eval.py` prints the comparison).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
import urllib.request

import numpy as np
import soundfile as sf
from scipy import signal

from analysis import midi_to_hz, note_name_to_midi
from paths import DATA_ROOT

BASE = 'https://freepats.zenvoid.org/Organ'
ROOT = os.path.join(DATA_ROOT, 'samples', 'freepats')
SETS = {'rock': 'RockOrganEmulation/RockOrganEmulation-SFZ-20190715'}
MODELS = {'rock': 'rock-organ'}
NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

SR = 48000
DRY_SECONDS = 4.0
ATTACK_S = 0.003          # the recordings reach full level within 3–6 ms
RELEASE_DB_S = 115.0      # the sample set's own release (SFZ ampeg_release = 0.7 s)
RANGE_DB = 42.0           # harmonics further below the strongest are left out
LEAD_S = 9.0              # an engine render's lead-in: the bass rotor takes seconds to reach its speed
SKIP_S = 0.5              # start of the measured stretch (the tone is steady from the first ms)


def set_dir(name: str) -> str:
    return os.path.join(ROOT, os.path.basename(SETS[name]))


def dry_dir(name: str) -> str:
    return os.path.join(ROOT, f'{name}-dry')


def fetch(names: list[str]):
    os.makedirs(ROOT, exist_ok=True)
    for name in names:
        if os.path.isdir(os.path.join(set_dir(name), 'samples')):
            print(f'{name}: already in {set_dir(name)}')
            continue
        url = f'{BASE}/{SETS[name]}.tar.xz'
        arc = os.path.join(ROOT, os.path.basename(url))
        print(f'{name}: {url}')
        urllib.request.urlretrieve(url, arc)
        subprocess.run(['tar', '-xJf', arc, '-C', ROOT], check=True)
        os.remove(arc)


def recordings(name: str) -> list[tuple[int, str, str | None]]:
    """(MIDI note, left or mono file, right file or None) of a sample set, by note."""
    folder = os.path.join(set_dir(name), 'samples')
    out = {}
    for f in sorted(os.listdir(folder)):
        m = re.match(r'^([A-G]#?\d)(L|R)?\.wav$', f)
        if not m:
            continue
        note = note_name_to_midi(m.group(1))
        out.setdefault(note, {})[m.group(2) or 'L'] = os.path.join(folder, f)
    return [(n, d['L'], d.get('R')) for n, d in sorted(out.items())]


def load(left: str, right: str | None) -> tuple[np.ndarray, int]:
    """The recording as (n, 2) (a mono recording twice)."""
    l, sr = sf.read(left, dtype='float64')
    r = sf.read(right, dtype='float64')[0] if right else l
    n = min(len(l), len(r))
    return np.stack([l[:n], r[:n]], axis=1), sr


def harmonic_powers(y: np.ndarray, sr: int, f0: float, K: int, skip_s: float = SKIP_S,
                    end_s: float | None = None) -> np.ndarray:
    """Long-term power of the K harmonics of f0 in a stereo signal (mean of the channels). The rotary speaker spreads a harmonic into sidebands a
    few Hz to ±100 Hz around it (Doppler) and moves its level by 20 dB, so the power is summed
    over the band f0 wide around the harmonic and averaged over the whole stretch."""
    a = int(skip_s * sr)
    b = len(y) if end_s is None else min(len(y), int(end_s * sr))
    nper = int(2 ** math.ceil(math.log2(sr / f0 * 24)))
    nper = min(nper, (b - a) // 2)
    f, p = signal.welch(y[a:b], sr, window='hann', nperseg=nper, noverlap=nper * 3 // 4, axis=0, scaling='spectrum')
    p = p.mean(axis=1)
    pw = np.zeros(K)
    for k in range(1, K + 1):
        sel = (f >= (k - 0.5) * f0) & (f < (k + 0.5) * f0)
        pw[k - 1] = p[sel].sum()
    # a Hann window spreads a sine's power over neighbouring bins: 'spectrum' scaling of the
    # peak bin is the sine's power, and the bins of the main lobe sum to 1.5 times that
    return pw / 1.5


def tonewheel_ratio(k: int) -> float:
    """Frequency of the k-th component as a multiple of the 16' drawbar. Tonewheels are tuned
    in equal temperament, so the drawbars a fifth or a third above an octave (5 1/3', 2 2/3',
    1 1/3': k = 3, 6, 12; 1 3/5': k = 10, and 5 where the top keys fold it back an octave) sit
    2 and 14 cents above the harmonic. The rotary speaker's Doppler shift is not symmetric (the
    approaching horn is the louder one), so a recording's centre of gravity does not tell."""
    odd = k
    while odd % 2 == 0:
        odd //= 2
    if odd == 3:
        return k * 2 ** (19 / 12) / 3
    if odd == 5:
        return k * 2 ** (28 / 12) / 5
    return float(k)


def tune_zone(zone):
    """build.py's `zone_hook` of the tonewheel models: the analysed zone of a dry tone (exact
    harmonics of an equal-tempered 16' fundamental) with its partials at the tonewheels'
    frequencies."""
    zone.f0 = midi_to_hz(zone.nominal_note)
    zone.ratios = np.array([tonewheel_ratio(k) for k in range(1, len(zone.ratios) + 1)])
    return zone


def measure(name: str) -> list[dict]:
    """The steady tone of every recorded note: its 16' fundamental and the level of each
    harmonic (dB re full scale, as a sine's RMS)."""
    out = []
    for note, left, right in recordings(name):
        y, sr = load(left, right)
        f0 = midi_to_hz(note - 12)          # the 16' drawbar: an octave below the key
        K = int(0.45 * min(sr, SR) / f0)
        pw = harmonic_powers(y, sr, f0, K)
        db = 10 * np.log10(pw + 1e-30)
        keep = db > db.max() - RANGE_DB
        k = np.arange(1, K + 1)
        ratio = np.array([tonewheel_ratio(int(v)) for v in k])
        out.append({'note': int(note), 'f0': f0, 'k': [int(v) for v in k[keep]],
                    'ratio': [float(v) for v in ratio[keep]], 'db': [float(v) for v in db[keep]]})
    return out


def synth(tone: dict, corr_db: dict[int, float] | None = None, seconds: float = DRY_SECONDS) -> np.ndarray:
    """The dry tone of one note: steady sines, the recordings' fast key-on, the sample set's release."""
    n = int(seconds * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(tone['note'])
    y = np.zeros(n)
    # (exact harmonics: the analysis follows those without loss; `tune_zone` then moves the
    # model's partials to the tonewheels' own frequencies)
    for k, db in zip(tone['k'], tone['db']):
        if corr_db:
            db += corr_db.get(k, 0.0)
        y += math.sqrt(2) * 10 ** (db / 20) * np.sin(2 * math.pi * k * tone['f0'] * t + rng.uniform(0, 2 * math.pi))
    hold = seconds - 0.6
    env = np.clip(t / ATTACK_S, 0, 1)
    env *= 10 ** (-RELEASE_DB_S * np.clip(t - hold, 0, None) / 20)
    return y * env


def write_dry(name: str, tones: list[dict], corr: dict[int, dict[int, float]] | None = None) -> float:
    """Write the dry tones (named by their 16' fundamental, the pitch the analysis will find),
    all scaled together to just below full scale. Returns the scale (dB)."""
    os.makedirs(dry_dir(name), exist_ok=True)
    ys = {t['note']: synth(t, (corr or {}).get(t['note'])) for t in tones}
    scale = 0.9 / max(float(np.abs(y).max()) for y in ys.values())
    for f in os.listdir(dry_dir(name)):
        if f.endswith('.wav'):
            os.remove(os.path.join(dry_dir(name), f))
    for note, y in ys.items():
        low = note - 12
        fname = f'{NOTE_NAMES[low % 12]}{low // 12 - 1}.wav'
        sf.write(os.path.join(dry_dir(name), fname), y * scale, SR, subtype='PCM_24')
    with open(os.path.join(dry_dir(name), 'tones.json'), 'w') as fh:
        json.dump({'scaleDb': 20 * math.log10(scale), 'tones': tones, 'correction': corr or {}}, fh)
    return 20 * math.log10(scale)


def calibrate(name: str, model_id: str, model_dir: str, tones: list[dict], sets: list[str],
              prev: dict[int, dict[int, float]] | None = None) -> dict[int, dict[int, float]]:
    """Per note and harmonic, the level change (dB) that brings the engine's output (the model
    in `model_dir` through the running rotary speaker) to the recording's long-term spectrum,
    on top of the corrections `prev` the model was built with. Levels are compared as shapes:
    the common level of all notes is the model's gain, not the tone's."""
    from engine import ssrender
    model = os.path.join(model_dir, f'{model_id}.ssm')
    diffs = {}
    for tone, (note, left, right) in zip(tones, recordings(name)):
        y, sr = load(left, right)
        dur = len(y) / sr
        z, zsr = ssrender(model, [f'{note - 12}:100:0:{dur + LEAD_S:.2f}'], sr=SR, tail=0.1, sets=sets)
        K = max(tone['k'])
        pr = harmonic_powers(y, sr, tone['f0'], K)
        pe = harmonic_powers(z, zsr, tone['f0'], K, skip_s=LEAD_S, end_s=dur + LEAD_S - 0.1)
        d = 10 * np.log10(pr + 1e-30) - 10 * np.log10(pe + 1e-30)
        diffs[note] = {k: float(d[k - 1]) for k in tone['k']}
    # the common level: the median difference of the strong harmonics
    strong = [diffs[t['note']][k] for t in tones for k, db in zip(t['k'], t['db']) if db > max(t['db']) - 20]
    level = float(np.median(strong))
    out = {}
    for t in tones:
        p = (prev or {}).get(t['note'], {})
        out[t['note']] = {k: float(np.clip(p.get(k, 0.0) + diffs[t["note"]][k] - level, -12, 12)) for k in t['k']}
    resid = np.array([diffs[t['note']][k] - level for t in tones for k, db in zip(t['k'], t['db']) if db > max(t['db']) - 40])
    print(f'  engine vs recordings, harmonics within 40 dB of the strongest: '
          f'mean |difference| {np.abs(resid).mean():.2f} dB, worst {np.abs(resid).max():.1f} dB (level offset {level:+.1f} dB)')
    return out


def stored_correction(name: str) -> dict[int, dict[int, float]] | None:
    """The corrections the dry tones on disk were written with."""
    file = os.path.join(dry_dir(name), 'tones.json')
    if not os.path.exists(file):
        return None
    with open(file) as fh:
        return {int(n): {int(k): v for k, v in d.items()} for n, d in json.load(fh)['correction'].items()}


def model(name: str, rounds: int = 3):
    """Download, measure, calibrate against the engine's rotary speaker and build the model
    into its package."""
    from build import build
    from instruments import INSTRUMENTS
    model_id = MODELS[name]
    scratch = os.path.join(DATA_ROOT, 'build', 'freepats')
    os.makedirs(scratch, exist_ok=True)
    fetch([name])
    tones = measure(name)
    write_dry(name, tones)
    corr = None
    for _ in range(rounds):
        build(model_id, INSTRUMENTS[model_id], out_dir=scratch)
        corr = calibrate(name, model_id, scratch, tones, ['leslie=3'], corr)
        write_dry(name, tones, corr)
    build(model_id, INSTRUMENTS[model_id])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('command', choices=['model', 'fetch', 'dry'])
    ap.add_argument('--calibrate', metavar='MODEL_DIR',
                    help='dry: correct the tones against the engine render of the model in this directory '
                         '(on top of the corrections of the tones on disk)')
    a = ap.parse_args()
    name = 'rock'
    if a.command == 'fetch':
        fetch([name])
        return
    if a.command == 'model':
        model(name)
        return
    tones = measure(name)
    corr = calibrate(name, MODELS[name], a.calibrate, tones, ['leslie=3'], stored_correction(name)) if a.calibrate else None
    scale = write_dry(name, tones, corr)
    print(f'{name}: {len(tones)} notes → {dry_dir(name)} (scale {scale:+.1f} dB' + (', calibrated' if corr else '') + ')')
    for t in tones:
        top = sorted(zip(t['db'], t['k']), reverse=True)[:9]
        print(f"  {t['note']:3d}  " + '  '.join(f'{k}:{db:.0f}' for db, k in sorted(top, key=lambda x: x[1])))


if __name__ == '__main__':
    main()
