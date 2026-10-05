"""Read a built .ssm model's frame data and add alternative releases to its zones without
re-analysing them (build.py's analysis of the main recordings is kept as it is).

  read_model(path) -> (header, zones)       zones: dicts with decoded frame arrays
  add_releases(path, {zone index: [(longest press s, analysed Zone of the alternative)]})
"""
from __future__ import annotations

import gzip
import json
import math
import struct

import numpy as np

from analysis import Zone
from build import AMP_STEP, delta_pm, delta_pm16, q_db_coarse


def _undelta_pm(b: bytes, t: int, k: int) -> np.ndarray:
    """partial-major time-delta u8 (mod 256) → (t, k) codes."""
    a = np.frombuffer(b, np.uint8, t * k).reshape(k, t).astype(np.int64)
    return (np.cumsum(a, axis=1) % 256).T.astype(np.uint8)


def _undelta_pm16(b: bytes, t: int, k: int, step: float) -> np.ndarray:
    """partial-major time-delta int16 (lo/hi planes) → (t, k) dB (−200 = silent)."""
    lo = np.frombuffer(b, np.uint8, t * k).astype(np.uint16)
    hi = np.frombuffer(b, np.uint8, t * k, t * k).astype(np.uint16)
    d = (lo | (hi << 8)).view(np.int16).reshape(k, t).astype(np.int64)
    q = np.cumsum(d, axis=1).astype(np.int16).astype(np.int64).T
    return np.where(q <= 0, -200.0, q * step - 160.0)


def _qdb(codes: np.ndarray) -> np.ndarray:
    return np.where(codes == 0, -200.0, codes * 0.5 - 120.0)


def read_model(path: str) -> tuple[dict, bytes, list[dict]]:
    with gzip.open(path, 'rb') as f:
        raw = f.read()
    n = struct.unpack('<I', raw[4:8])[0]
    h = json.loads(raw[8:8 + n])
    blob = raw[(8 + n + 3) & ~3:]
    nb = len(h['noiseEdges']) - 1
    zones = []
    for hz in h['zones']:
        o, t, k = hz['o'], hz['frames'], hz['partials']
        z = {'h': hz, 't': t, 'k': k}
        z['grid'] = (np.frombuffer(blob, '<f4', t, o['grid']).astype(np.float64) if o.get('grid') is not None
                     else np.asarray(h['grid'][:t], dtype=np.float64))
        z['amps'] = _undelta_pm16(blob[o['amps16']:], t, k, o.get('ampsStep', AMP_STEP))
        z['pitch'] = np.frombuffer(blob, '<i2', t, o['pitch']).astype(np.float64) / 100.0
        z['noise'] = _qdb(_undelta_pm(blob[o['noise']:], t, nb))
        z['ratios'] = np.frombuffer(blob, '<f4', k, o['ratios']).astype(np.float64)
        if o.get('imgK'):
            ik = o['imgK']
            z['img'] = {key: _undelta_pm(blob[o[key]:], t, ik) for key in ('ild', 'iph', 'lph') if o.get(key) is not None}
            z['img_idx'] = o.get('imgIdx') or list(range(ik))
        zones.append(z)
    return h, blob, zones


def _append(z: dict, a: Zone, max_hold: float) -> bool:
    """Frames of `a` from its release on, appended to model zone `z` (harmonics by number, free
    partials by frequency, stereo image rows by harmonic)."""
    ra = a.meta.get('rel_frame')
    if ra is None or z['h'].get('relFrame') is None or ra + 4 >= len(a.times):
        return False
    hz = z['h']
    seg = slice(ra, len(a.times))
    n = len(a.times) - ra
    step = float(z['grid'][-1] - z['grid'][-2])
    times = a.times[seg] - a.times[ra] + z['grid'][-1] + step
    k, kh = z['k'], int(hz.get('harmonic', z['k']))
    kh_a = int(a.meta.get('harmonic', a.amps_db.shape[1]))
    amps = np.full((n, k), -200.0)
    m = min(kh, kh_a)
    amps[:, :m] = a.amps_db[seg, :m]
    f0 = float(hz['f0'])
    ra_free = np.asarray(a.ratios[kh_a:], dtype=float) * a.f0
    for j in range(kh, k):
        if len(ra_free):
            d = np.abs(ra_free / (z['ratios'][j] * f0) - 1)
            i = int(np.argmin(d))
            if d[i] < 3e-3:
                amps[:, j] = a.amps_db[seg, kh_a + i]
    z['grid'] = np.concatenate([z['grid'], times])
    z['amps'] = np.concatenate([z['amps'], amps])
    z['pitch'] = np.concatenate([z['pitch'], a.pitch_cents[seg] + 1200 * math.log2(a.f0 / f0)])
    z['noise'] = np.concatenate([z['noise'], a.noise_db[seg]])
    if 'img' in z:
        st = a.meta.get('stereo_t')
        idx = z['img_idx']
        for key, conv, i in (('ild', lambda v: np.clip(np.round(v * 4) + 128, 0, 255), 0),
                             ('iph', lambda v: np.round(v / (2 * math.pi) * 256) % 256, 1),
                             ('lph', lambda v: np.round(v / (2 * math.pi) * 256) % 256, 2)):
            if key not in z['img']:
                continue
            add = np.full((n, len(idx)), 128 if key == 'ild' else 0, dtype=np.int64)
            if st is not None and i < len(st):
                for c, hh in enumerate(idx):
                    if hh < st[i].shape[1]:
                        add[:, c] = conv(st[i][seg, hh])
            z['img'][key] = np.concatenate([z['img'][key], add.astype(np.uint8)])
    hz.setdefault('altRel', []).append([round(float(max_hold), 4), z['t']])
    z['t'] += n
    return True


def add_releases(path: str, alts: dict[int, list[tuple[float, Zone]]]) -> int:
    """Append alternative releases to zones of the model at `path` (rewritten in place).
    Returns how many were added."""
    h, blob, zones = read_model(path)
    added = 0
    for zi, lst in alts.items():
        z = zones[zi]
        z['h'].pop('altRel', None)
        for max_hold, a in sorted(lst, key=lambda x: x[0]):
            added += _append(z, a, max_hold)
    out = bytearray()

    def put(b: bytes) -> int:
        off = len(out)
        out.extend(b)
        while len(out) % 4:
            out.append(0)
        return off

    def copy(off: int, size: int) -> int:
        return put(blob[off:off + size])

    nb = len(h['noiseEdges']) - 1
    for z in zones:
        hz, o, t, k = z['h'], z['h']['o'], z['t'], z['k']
        changed = bool(hz.get('altRel'))
        new = dict(o)
        new['ratios'] = copy(o['ratios'], k * 4)
        new['phases'] = copy(o['phases'], k)
        new['release'] = copy(o['release'], k)
        if o.get('jitter') is not None:
            new['jitter'] = copy(o['jitter'], k)
        t0 = hz['frames']
        if changed:
            new['amps16'] = put(delta_pm16(z['amps']))
            new['ampsStep'] = AMP_STEP
            new['pitch'] = put(np.round(np.clip(z['pitch'], -300, 300) * 100).astype('<i2').tobytes())
            new['noise'] = put(delta_pm(q_db_coarse(z['noise'])))
            new['grid'] = put(z['grid'].astype('<f4').tobytes())
            for key in ('ild', 'iph', 'lph'):
                if key in z.get('img', {}):
                    new[key] = put(delta_pm(z['img'][key]))
            hz['frames'] = t
        else:
            new['amps16'] = copy(o['amps16'], t0 * k * 2)
            new['pitch'] = copy(o['pitch'], t0 * 2)
            new['noise'] = copy(o['noise'], t0 * nb)
            if o.get('grid') is not None:
                new['grid'] = copy(o['grid'], t0 * 4)
            for key in ('ild', 'iph', 'lph'):
                if o.get(key) is not None:
                    new[key] = copy(o[key], t0 * o['imgK'])
        new['amps'] = new['amps16']
        tr = hz.get('transient')
        if tr:
            tr['o'] = copy(tr['o'], tr['n'] * 2)
            if tr.get('o_r') is not None:
                tr['o_r'] = copy(tr['o_r'], tr['n'] * 2)
        hz['o'] = new
    hj = json.dumps(h, separators=(',', ':')).encode()
    raw = bytearray(b'SSM1' + struct.pack('<I', len(hj)) + hj)
    while len(raw) % 4:
        raw.append(0)
    raw.extend(out)
    with gzip.open(path, 'wb', compresslevel=9) as f:
        f.write(bytes(raw))
    return added
