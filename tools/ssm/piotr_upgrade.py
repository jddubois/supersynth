"""Bring a built Piotr Grabowski organ up to date with its sample set (which must be extracted
in data/samples/piotr/<organ>):

1. releases recorded after shorter key presses, added to every stop's model (`--rebuild`:
   the stops are analysed again from scratch, for organs whose main release was taken wrongly)
2. the machinery noises: key and stop action, blower, room (noises.py)
3. the organ's config (src/organs/piotr/<organ>.ts): swell boxes, tremulants, short stops,
   noises (piotr_config.py)

Resumable: stops whose model already has its alternative releases are skipped.

  python piotr_upgrade.py <organ> [--rebuild] [--only stop-id ...]
"""
from __future__ import annotations

import os
import sys
import time

import build
import noises
import piotr
import piotr_config
import ssm_patch
from paths import model_path


def has_alts(path: str) -> bool:
    if not os.path.exists(path):
        return False
    h, _, _ = ssm_patch.read_model(path)
    return any(z.get('altRel') for z in h['zones'])


def upgrade(organ: str, rebuild: bool = False, only: list[str] | None = None) -> None:
    cat = piotr.load_catalog(organ)
    odf = piotr.load_odf(organ)
    stops = piotr.catalog_stops(odf, cat)
    want_alts = any(p.alt_releases for s, _ in stops for ps in s.keys.values() for p in ps[:1])
    # the gain reference first: a rebuilt organ's other stops take its gain
    order = sorted(cat['stops'], key=lambda st: st['id'] != cat['reference'])
    for st in order:
        if only and st['id'] not in only:
            continue
        path = model_path(piotr.model_id(organ, st['id']), build.OUT_DIR)
        s = next(x for x, y in stops if y['id'] == st['id'])
        alts = any(p.alt_releases for ps in s.keys.values() for p in ps[:1])
        if alts and has_alts(path) or not alts and not rebuild:
            continue
        t = time.time()
        if rebuild:
            piotr.build_stop(cat, st, odf)
        else:
            piotr.add_alt_releases(cat, st, odf)
        print(f'{time.strftime("%H:%M:%S")} {st["id"]} done in {time.time() - t:.0f} s', flush=True)
    if not only:
        r = noises.build_noises(organ)
        print('noises:', {k: (len(v) if isinstance(v, dict) else v) for k, v in r.items()}, flush=True)
        piotr_config.patch(organ)
    print(f'{organ}: done (alternative releases {"yes" if want_alts else "none in the sample set"})', flush=True)


if __name__ == '__main__':
    args = sys.argv[1:]
    only = args[args.index('--only') + 1:] if '--only' in args else None
    upgrade(args[0], rebuild='--rebuild' in args, only=only)
