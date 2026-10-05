"""Settings of a Piotr Grabowski organ config (src/organs/piotr/<organ>.ts) from its sample set's
organ definition: the swell boxes and how far they close, the tremulants and the divisions on
their wind, the stops' key ranges. The stop list and presets are left as they are.

  python piotr_config.py <organ> [...]      # patch the configs
"""
from __future__ import annotations

import json
import os
import re
import sys

import piotr

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIGS = os.path.join(HERE, '..', '..', 'src', 'organs', 'piotr')
CHURCH_PAN = {'great': 0, 'swell': 0.15, 'positive': -0.15, 'pedal': 0}
DIVS = ['great', 'swell', 'positive', 'pedal']


def ts_value(v) -> str:
    if isinstance(v, dict):
        return '{ ' + ', '.join(f'{k}: {ts_value(x)}' for k, x in v.items()) + ' }'
    if isinstance(v, list):
        return '[' + ', '.join(ts_value(x) for x in v) + ']'
    if isinstance(v, str):
        return "'" + v.replace("'", "\\'") + "'"
    if isinstance(v, bool):
        return 'true' if v else 'false'
    return f'{v:g}' if isinstance(v, float) else str(v)


def settings(organ: str, pans: dict[str, float]) -> dict:
    cat = piotr.load_catalog(organ)
    odf = piotr.load_odf(organ)
    stops = piotr.catalog_stops(odf, cat)
    levels = piotr.swell_levels(odf, stops)
    boxes = set(cat.get('swellBoxes') or [])
    divisions = {}
    for d in DIVS:
        e = {'pan': pans.get(d, 0)}
        if d in boxes:
            e['swellBox'] = {'closed': levels[d]} if d in levels else True
        divisions[d] = e
    winds = piotr.tremulant_winds(odf, stops)
    trems = []
    for t in cat.get('tremulants') or []:
        w = next((x for x in winds if x['division'] == t['division']), {})
        div = [t['division'], *w.get('also', [])]
        e = {'division': div if len(div) > 1 else div[0]}
        if w.get('name'):
            e['name'] = w['name']
        e.update(depth=t['depth'], pitch=t['pitch'], rate=t['rate'])
        trems.append(e)
    # stops with fewer pipes than their keyboard has keys
    keys = {}
    for d in DIVS:
        ss = [st for st in cat['stops'] if st['division'] == d]
        if not ss:
            continue
        lo, hi = min(s['keys'][0] for s in ss), max(s['keys'][1] for s in ss)
        for s in ss:
            if s['keys'][0] > lo or s['keys'][1] < hi:
                keys[s['id']] = s['keys']
    return dict(divisions=divisions, tremulant=trems, keys=keys)


def patch(organ: str) -> None:
    path = os.path.join(CONFIGS, f'{organ}.ts')
    src = open(path).read()
    m = re.search(r'\n  divisions: (CHURCH_DIVISIONS|\{.*\}),\n', src)
    pans = dict(CHURCH_PAN)
    if m and m.group(1) != 'CHURCH_DIVISIONS':
        pans = {d: float(p) for d, p in re.findall(r'(\w+): \{ pan: (-?[\d.]+)', m.group(1))}
    st = settings(organ, pans)
    tail = (f"  divisions: {ts_value(st['divisions'])},\n"
            f"  tremulant: {ts_value(st['tremulant'] if len(st['tremulant']) != 1 else st['tremulant'][0])},\n"
            f"  wind: 0,\n")
    src = re.sub(r'\n  divisions: .*,\n(  tremulant: .*,\n)?(  wind: .*,\n)?', '\n' + tail, src, count=1)
    if 'CHURCH_DIVISIONS' not in tail:
        src = re.sub(r"import \{ CHURCH_DIVISIONS \} from '\.\./defaults\.js';\n", '', src)
    for sid, (lo, hi) in st['keys'].items():
        src = re.sub(rf"(\{{ id: '{re.escape(sid)}',[^\n]*?)(, keys: \[\d+, \d+\])? \}},", rf'\1, keys: [{lo}, {hi}] }},', src)
    open(path, 'w').write(src)
    print(f"{organ}: boxes {[d for d, e in st['divisions'].items() if 'swellBox' in e]}, "
          f"{len(st['tremulant'])} tremulants, {len(st['keys'])} short stops")


if __name__ == '__main__':
    for o in sys.argv[1:]:
        patch(o)
