"""Piotr Grabowski's organs: presets through the public organ API against the sample set
played as GrandOrgue plays it (the same pipes summed: attack, sustain, release at key-up).

  python piotr_eval.py <organ> [preset ...]

Per preset, a chord on every manual it draws stops on (C4 E4 G4) and C3 on the pedal;
couplers as the preset sets them. Reports, per channel, the log-spectral distance, the
envelope error, the spectral centroid error and the level difference (engine − sample set).
"""
import json
import os
import subprocess
import sys

import numpy as np
import soundfile as sf

from compare import metrics
from paths import DATA_ROOT, existing_model_path
from piotr import load_catalog, load_odf, pipe_stops
from grandorgue import render_key

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(DATA_ROOT, 'piotr_eval')
CHORD = {'great': [60, 64, 67], 'swell': [60, 64, 67], 'positive': [60, 64, 67], 'pedal': [48]}


def organ_def(organ: str) -> dict:
    out = subprocess.run(['node', '--import', 'tsx', 'tools/ssm/piotr_render.ts', '--def', organ], cwd=REPO,
                         check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def real_sum(organ, odf, sections, play, couplers, seconds):
    """The sample set's pipes for `play` (division → keys), stops drawn per division."""
    cat = load_catalog(organ)
    byname = {}
    for st in cat['stops']:
        byname[(st['division'], st['name'])] = st
    stops = {(s.section, s.manual): s for s in pipe_stops(odf)}
    acc, sr = None, 48000
    # every (division, key) sounds once, whether played directly or through a coupler
    sounding_keys: dict[str, set[int]] = {}
    for div, keys in play.items():
        for d in [div] + [a for a, b in (c.split('>') for c in couplers) if b == div]:
            sounding_keys.setdefault(d, set()).update(keys)
    for d, keys in sounding_keys.items():
        if True:
            for name in sections.get(d, []):
                st = byname[(d, name)]
                s = stops[(st['section'], st['manual'])]
                for k in sorted(keys):
                    if k not in s.keys:
                        continue
                    y, sr, up = render_key(s.keys[k])
                    y = y[:int(seconds * sr)]
                    if acc is None:
                        acc = np.zeros((int(seconds * sr), 2))
                    acc[:len(y)] += y
    return acc, sr


def main(organ, regs):
    os.makedirs(OUT, exist_ok=True)
    od = organ_def(organ)
    odf = load_odf(organ)
    res = {}
    for name in regs or list(od['presets']):
        r = od['presets'][name]
        play = {d: CHORD[d] for d in ('great', 'swell', 'positive', 'pedal') if r.get(d)}
        seconds, hold = 3.0, 2.9
        couplers = [f'{src}>{dst}' for dst, srcs in (r.get('couple') or {}).items() for src in srcs]
        real, sr = real_sum(organ, odf, r, play, couplers, seconds)
        spec = dict(organ=organ, preset=name, play=play, hold=hold, seconds=seconds, sampleRate=sr)
        sp = os.path.join(OUT, f'{organ}-{name}.json')
        json.dump(spec, open(sp, 'w'))
        out = os.path.join(OUT, f'{organ}-{name}__syn.wav')
        subprocess.run(['node', '--import', 'tsx', 'tools/ssm/piotr_render.ts', sp, out], cwd=REPO, check=True)
        syn, _ = sf.read(out, always_2d=True)
        sf.write(os.path.join(OUT, f'{organ}-{name}__real.wav'), real.astype(np.float32), sr, subtype='FLOAT')
        n = min(len(real), len(syn))
        ms = [metrics(real[:n, c], syn[:n, c], sr, seconds=2.8) for c in (0, 1)]
        m = {k: float(np.mean([mm[k] for mm in ms])) for k in ms[0]}
        res[name] = m
        print(f'{organ:14s} {name:18s} lsd={m["lsd_db"]:5.2f} attack={m["lsd_attack_db"]:5.2f} env={m["env_err_db"]:5.2f} '
              f'centroid={m["centroid_err_cents"]:6.1f}c gain={m["gain_db"]:+.1f}', flush=True)
    json.dump(res, open(os.path.join(OUT, f'{organ}.json'), 'w'), indent=1)
    return res


def stops(organ):
    """Every stop alone (a chord, C3 for the pedal): level and spectrum against the sample set."""
    os.makedirs(OUT, exist_ok=True)
    od = organ_def(organ)
    odf = load_odf(organ)
    res = {}
    for st in od['stops']:
        if not os.path.exists(existing_model_path(st['model'])):
            continue
        d = st['division']
        play = {d: CHORD[d]}
        real, sr = real_sum(organ, odf, {d: [st['name']]}, play, [], 3.0)
        if real is None:
            continue
        spec = dict(organ=organ, draw={d: [st['name']]}, play=play, hold=2.9,
                    seconds=3.0, sampleRate=sr)
        sp = os.path.join(OUT, f"{organ}-stop-{st['id']}.json")
        json.dump(spec, open(sp, 'w'))
        out = os.path.join(OUT, f"{organ}-stop-{st['id']}__syn.wav")
        subprocess.run(['node', '--import', 'tsx', 'tools/ssm/piotr_render.ts', sp, out], cwd=REPO, check=True)
        syn, _ = sf.read(out, always_2d=True)
        n = min(len(real), len(syn))
        ms = [metrics(real[:n, c], syn[:n, c], sr, seconds=2.8) for c in (0, 1)]
        m = {k: float(np.mean([mm[k] for mm in ms])) for k in ms[0]}
        res[st['id']] = m
        print(f"{organ:14s} {st['id']:34s} lsd={m['lsd_db']:5.2f} attack={m['lsd_attack_db']:5.2f} env={m['env_err_db']:5.2f} "
              f"centroid={m['centroid_err_cents']:6.1f}c gain={m['gain_db']:+.1f}", flush=True)
    json.dump(res, open(os.path.join(OUT, f'{organ}-stops.json'), 'w'), indent=1)
    return res


if __name__ == '__main__':
    if sys.argv[2:3] == ['--stops']:
        stops(sys.argv[1])
    else:
        main(sys.argv[1], sys.argv[2:])
