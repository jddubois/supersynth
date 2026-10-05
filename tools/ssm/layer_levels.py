"""Compute per-layer recorded levels from model data and store them in the header."""
import gzip
import json
import struct
import sys

import numpy as np

FAMILY_VELOCITY_DB = {'keyboard': 1.0, 'percussion': 0.9, 'strings': 0.75, 'woodwind': 0.6, 'brass': 0.7, 'organ': 0.0}
OVERRIDE = {'harpsichord': 0.2, 'harpsichord-flemish': 0.2, 'harp': 0.9, 'violin-pizzicato': 0.9,
            'cello-pizzicato': 0.9, 'contrabass-pizzicato': 0.9}


def zone_level(blob, z, nb):
    T, K = z['frames'], z['partials']
    o = z['o']
    if 'amps16' in o:
        b = np.frombuffer(blob[o['amps16']:o['amps16'] + 2 * T * K], np.uint8)
        d = (b[:T * K].astype(np.uint16) | (b[T * K:].astype(np.uint16) << 8)).view(np.int16).reshape(K, T)
        q = np.cumsum(d.astype(np.int64), axis=1)
        db = np.where(q <= 0, -200.0, q * o.get('ampsStep', 1 / 16) - 160.0)
    else:
        d = np.frombuffer(blob[o['amps']:o['amps'] + T * K], np.uint8).reshape(K, T)
        q = np.cumsum(d.astype(np.int64), axis=1) % 256
        db = np.where(q == 0, -200.0, q * 0.5 - 120.0)
    p = (10 ** (db / 10)).sum(axis=0)          # total partial power per frame
    return 10 * np.log10(p.max() + 1e-20)


def process(path):
    raw = gzip.open(path, 'rb').read()
    n = struct.unpack('<I', raw[4:8])[0]
    h = json.loads(raw[8:8 + n])
    blob = raw[(8 + n + 3) & ~3:]
    nb = len(h['noiseEdges']) - 1
    for li, layer in enumerate(h['layers']):
        lv = [zone_level(blob, z, nb) for z in h['zones'] if z['layer'] == li]
        layer['level'] = round(float(np.median(lv)), 2) if lv else 0.0
    name = h['name'].split('/')[-1]
    vdb = OVERRIDE.get(name, FAMILY_VELOCITY_DB.get(h.get('family', ''), 0.7))
    h['params']['velocityDb'] = vdb
    hj = json.dumps(h, separators=(',', ':')).encode()
    out = bytearray(b'SSM1' + struct.pack('<I', len(hj)) + hj)
    while len(out) % 4:
        out.append(0)
    out.extend(blob)
    with gzip.open(path, 'wb', compresslevel=9) as f:
        f.write(bytes(out))
    return [(l['name'], l['velocity'], l['level']) for l in h['layers']], vdb


if __name__ == '__main__':
    from paths import committed_models
    files = sys.argv[1:] or committed_models()
    for f in sorted(files):
        print(f.split('models/')[-1], *process(f))
