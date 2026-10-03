"""Build .ssm spectral instrument models from folders of real recordings.

Usage:
  python build.py <instrument-id> [<instrument-id> ...]     # ids from instruments.py
  python build.py --all
"""
from __future__ import annotations

import glob
import gzip
import json
import math
import os
import re
import struct
import sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np

from analysis import NOISE_EDGES, Zone, analyze_zone, hz_to_midi, note_name_to_midi
from paths import DATA_ROOT

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
DATA = os.path.join(DATA_ROOT, 'samples')
OUT_DIR = os.environ.get('SSM_OUT_DIR', os.path.join(REPO, 'models'))


def q_db(db: np.ndarray) -> np.ndarray:
    q = np.round((db + 120.0) * 2.0)
    q = np.where(db < -119.5, 0, np.clip(q, 1, 255))
    return q.astype(np.uint8)


def q_db_coarse(db: np.ndarray) -> np.ndarray:
    """Noise envelopes: 1 dB steps (still the 0.5 dB code space) — compresses far better."""
    q = q_db(db).astype(np.int16)
    q = np.where(q > 0, np.maximum(1, (q // 2) * 2), 0)
    return q.astype(np.uint8)


def delta_planes_i16(x: np.ndarray) -> bytes:
    """int16 PCM → first differences split into low/high byte planes (gzip-friendly)."""
    d = np.diff(x.astype(np.int32), prepend=0).astype(np.int16).view(np.uint8).reshape(-1, 2)
    return d[:, 0].tobytes() + d[:, 1].tobytes()


def delta_pm(q: np.ndarray) -> bytes:
    """(T,K) uint8 → partial-major, time-delta coded (mod 256): compresses ~3x better."""
    a = q.T.astype(np.int16)
    d = np.diff(a, axis=1, prepend=0)
    return (d % 256).astype(np.uint8).tobytes()


AMP_STEP = 1.0 / 16.0
IMG_RANGE_DB = 40.0


def delta_pm16(db: np.ndarray) -> bytes:
    """(T,K) dB → partial-major, time-delta coded int16 in AMP_STEP dB above −160 dB (0 = silent),
    low byte plane then high byte plane. u8 0.5 dB steps were audible as a 0.15 dB random
    flutter on very steady tones (organ pipes are steadier than that)."""
    q = np.where(db < -159.9, 0, np.clip(np.round((db + 160.0) / AMP_STEP), 1, 32767)).astype(np.int32)
    d = np.ascontiguousarray(np.diff(q.T, axis=1, prepend=0).astype(np.int16)).view(np.uint8).reshape(-1, 2)
    return d[:, 0].tobytes() + d[:, 1].tobytes()


def write_model(path: str, header: dict, zones: list[Zone]):
    blob = bytearray()
    hgrid = np.asarray(header['grid'], dtype=np.float64)

    def put(b: bytes) -> int:
        off = len(blob)
        blob.extend(b)
        while len(blob) % 4:
            blob.append(0)
        return off

    hz = []
    for z in zones:
        K = len(z.ratios)
        T = len(z.times)
        o = {
            'ratios': put(np.asarray(z.ratios, '<f4').tobytes()),
            'phases': put(np.round((np.mod(z.phases, 2 * math.pi)) / (2 * math.pi) * 256).astype(np.int64).clip(0, 255).astype(np.uint8).tobytes()),
            'amps16': put(delta_pm16(z.amps_db)),
            'ampsStep': AMP_STEP,
            'pitch': put(np.round(np.clip(z.pitch_cents, -300, 300) * 100).astype('<i2').tobytes()),
            'noise': put(delta_pm(q_db_coarse(z.noise_db))),
            'release': put(np.clip(np.round(z.release_db_per_s / 2.0), 0, 255).astype(np.uint8).tobytes()),
            'jitter': put(np.clip(np.round(np.asarray(z.meta.get('jitter', np.zeros(K)))[:K] * 10), 0, 255).astype(np.uint8).tobytes()),
        }
        o['amps'] = o['amps16']        # (required key of older readers)
        zt = np.asarray(z.times, dtype=np.float64)
        if T > len(hgrid) or not np.allclose(zt, hgrid[:T], atol=1e-5):
            # the zone's own frame times (dense around a recorded release)
            o['grid'] = put(zt.astype('<f4').tobytes())
        st_t = z.meta.get('stereo_t')
        if st_t is not None and st_t[0].shape[0] == T:
            # time-varying stereo image of the harmonics that matter (within IMG_RANGE_DB of the
            # strongest; weaker ones keep the static image): ILD in ¼ dB around 128, phases in
            # 1/256 turns (delta coding mod 256 wraps the phase for free)
            kh = st_t[0].shape[1]
            pk = z.amps_db[:, :kh].max(axis=0)
            rows = np.where(pk > pk.max() - IMG_RANGE_DB)[0]
            sel = lambda a: a[:, rows]
            o['ild'] = put(delta_pm(np.clip(np.round(sel(st_t[0]) * 4) + 128, 0, 255).astype(np.uint8)))
            o['iph'] = put(delta_pm((np.round(sel(st_t[1]) / (2 * math.pi) * 256).astype(np.int64) % 256).astype(np.uint8)))
            o['imgK'] = int(len(rows))
            o['imgIdx'] = [int(r) for r in rows]
            if len(st_t) > 2:
                o['lph'] = put(delta_pm((np.round(sel(st_t[2]) / (2 * math.pi) * 256).astype(np.int64) % 256).astype(np.uint8)))
        tr = None
        if z.transient is not None and len(z.transient):
            pkv = float(np.max(np.abs(z.transient))) or 1.0
            q = np.round(z.transient / pkv * 32767).astype('<i2')
            tr = {'o': put(delta_planes_i16(q)), 'n': int(len(q)), 'enc': 'dp16', 'scale': pkv, 'rate': int(z.meta['sr']),
                  'fade': [round(z.transient_fade[0], 5), round(z.transient_fade[1], 5)]}
            tr_r = getattr(z, 'transient_r', None)
            if tr_r is not None and len(tr_r) == len(z.transient):
                pkr = float(np.max(np.abs(tr_r))) or 1.0
                qr = np.round(tr_r / pkr * 32767).astype('<i2')
                tr['o_r'] = put(delta_planes_i16(qr))
                tr['scale_r'] = pkr
        hz.append({
            'transient': tr,
            'note': round(float(hz_to_midi(z.f0)), 4),
            'f0': round(float(z.f0), 4),
            'layer': int(z.meta['layer_index']),
            'partials': K,
            'harmonic': int(z.meta.get('harmonic', K)),
            'jitterTau': round(float(z.meta.get('jitter_tau', 0.03)), 4),
            **({'shimmer': [int(v) for v in np.round(np.asarray(z.meta['shimmer']) * 100).clip(0, 255)],
                'shimmerTau': round(float(z.meta.get('shimmer_tau', 0.01)), 4)}
               if z.meta.get('shimmer') is not None else {}),
            **({'stereo': {'l': [int(v) for v in np.round(np.asarray(z.meta['stereo'][0]) / math.sqrt(2) * 255).clip(0, 255)],
                           'r': [int(v) for v in np.round(np.asarray(z.meta['stereo'][1]) / math.sqrt(2) * 255).clip(0, 255)],
                           'ph': [int(v) for v in np.round((np.asarray(z.meta['stereo'][2]) + math.pi) / (2 * math.pi) * 255).clip(0, 255)]}}
               if z.meta.get('stereo') is not None else {}),
            **({'relFrame': int(z.meta['rel_frame'])} if z.meta.get('rel_frame') is not None else {}),
            **({'pulse': [int(v) for v in np.round(np.asarray(z.meta['pulse']) / 4.0 * 255).clip(0, 255)]}
               if z.meta.get('pulse') is not None else {}),
            'frames': T,
            'loop': list(z.loop) if z.loop else None,
            'releaseNoise': round(float(z.release_noise_db_per_s), 2),
            'gainDb': 0.0,
            'src': os.path.basename(z.source),
            'o': o,
        })
    header = dict(header)
    header['zones'] = hz
    hjson = json.dumps(header, separators=(',', ':')).encode()
    raw = bytearray(b'SSM1' + struct.pack('<I', len(hjson)) + hjson)
    while len(raw) % 4:
        raw.append(0)
    raw.extend(blob)
    with gzip.open(path, 'wb', compresslevel=9) as f:
        f.write(bytes(raw))
    return os.path.getsize(path)


def _worker_init():
    # one numba thread per worker process: the pool already uses every core
    try:
        import numba
        numba.set_num_threads(1)
    except Exception:  # noqa: BLE001
        pass


def _analyze_job(args):
    path, note, layer, kw = args
    try:
        kw = dict(kw)
        if kw.pop('use_cue', False):
            kw['release_at_s'] = wav_cue_seconds(path)
        return analyze_zone(path, note, layer, **kw)
    except Exception as ex:  # noqa: BLE001
        print(f'  !! failed {os.path.basename(path)}: {ex}', flush=True)
        return None


def wav_cue_seconds(path: str) -> float | None:
    """First cue point (release marker in GrandOrgue samples), in seconds."""
    try:
        with open(path, 'rb') as f:
            d = f.read()
    except OSError:
        return None
    if d[:4] != b'RIFF':
        return None
    i, sr, cue = 12, None, None
    while i < len(d) - 8:
        cid = d[i:i + 4]
        sz = struct.unpack('<I', d[i + 4:i + 8])[0]
        if cid == b'fmt ':
            sr = struct.unpack('<I', d[i + 12:i + 16])[0]
        elif cid == b'cue ':
            n = struct.unpack('<I', d[i + 8:i + 12])[0]
            if n:
                cue = struct.unpack('<I', d[i + 12 + 20:i + 12 + 24])[0]
        i += 8 + sz + (sz & 1)
    return cue / sr if (cue is not None and sr) else None


def collect(spec: dict) -> list[tuple[str, int, str]]:
    files = []
    for pat in spec['files']:
        files += glob.glob(os.path.join(DATA, pat))
    files = sorted(set(files))
    out = []
    lay_re = re.compile(spec.get('layer_regex', r'$^'))
    excl = re.compile(spec['exclude']) if spec.get('exclude') else None
    for f in files:
        base = os.path.basename(f)
        if excl and excl.search(base):
            continue
        name_for_note = base
        if spec.get('note_from_number'):
            m = re.match(r'^(\d{2,3})-', base)
            if not m:
                continue
            out.append((f, int(m.group(1)) + spec.get('note_offset', 0), 'main'))
            continue
        if spec.get('note_regex'):
            m = re.search(spec['note_regex'], base)
            if not m:
                continue
            name_for_note = m.group(1)
        note = note_name_to_midi(name_for_note)
        if note is None:
            continue
        note += spec.get('note_offset', 0)
        m = lay_re.search(base)
        layer = m.group(1) if m else 'main'
        out.append((f, note, layer))
    return out


def build(inst_id: str, spec: dict, workers: int = min(4, os.cpu_count() or 4)) -> str:
    if os.environ.get('SSM_OVERRIDES'):
        # experiments: e.g. SSM_OVERRIDES='{"phase_smooth_s": 0.1}'
        spec = {**spec, **json.loads(os.environ['SSM_OVERRIDES'])}
    items = collect(spec)
    if 'stereo' not in spec and items:
        # stereo recordings keep their per-partial stereo image (and per-channel noise)
        import soundfile as sf
        spec = {**spec, 'stereo': sf.info(items[0][0]).channels >= 2}
    if os.environ.get('SSM_ONLY'):
        # experiments: only the recordings whose file name matches this regex
        items = [it for it in items if re.search(os.environ['SSM_ONLY'], os.path.basename(it[0]))]
    if spec.get('layers_keep'):
        items = [it for it in items if it[2] in spec['layers_keep']]
    if not items:
        raise SystemExit(f'{inst_id}: no files matched')
    print(f'[{inst_id}] {len(items)} recordings', flush=True)
    kw = dict(kind=spec['kind'], max_partials=spec.get('max_partials', 512),
              periods=spec.get('periods', 3.0), max_duration=spec.get('max_duration'),
              onset_db=spec.get('onset_db', -30.0), octave_search=spec.get('octave_search', True),
              min_window_s=spec.get('min_window_s', 0.0), harmonic=spec.get('harmonic', True),
              free_partials=spec.get('free_partials', 0), free_window_s=spec.get('free_window_s', 0.04),
              transient=spec.get('transient', False), transient_max_s=spec.get('transient_max_s', 0.1),
              max_loop_s=spec.get('max_loop_s'), use_cue=spec.get('use_cue', False), locked=spec.get('locked'),
              max_stiffness=spec.get('max_stiffness', 2e-3), stereo=spec.get('stereo', False),
              steady_smooth_s=spec.get('steady_smooth_s', 0.0), phase_smooth_s=spec.get('phase_smooth_s', 0.0),
              weak_after_attack=spec.get('weak_after_attack', False),
              pitch_smooth_s=spec.get('pitch_smooth_s', 0.1 if spec.get('family') == 'organ' and spec['kind'] == 'sustained' else 0.0))
    jobs = [(f, n, l, kw) for f, n, l in items]
    with ProcessPoolExecutor(workers, initializer=_worker_init) as ex:
        results = list(ex.map(_analyze_job, jobs))
    failed = sum(1 for z in results if z is None)
    zones = [z for z in results if z is not None]
    if failed > max(1, 0.08 * len(jobs)):
        raise RuntimeError(f'{failed}/{len(jobs)} recordings failed analysis')

    # octave consistency: all zones of an instrument share one naming convention
    offs = [round((hz_to_midi(z.f0) - z.nominal_note) / 12) * 12 for z in zones]
    med = int(np.median(offs))
    redo = [(z.source, z.nominal_note + med, z.layer) for z, o in zip(zones, offs) if o != med]
    if redo:
        print(f'  re-analysing {len(redo)} zones with octave offset {med}', flush=True)
        kw2 = dict(kw, octave_search=False)
        with ProcessPoolExecutor(workers, initializer=_worker_init) as ex:
            fixed = list(ex.map(_analyze_job, [(f, n, l, kw2) for f, n, l in redo]))
        fixmap = {z.source: z for z in fixed if z is not None}
        zones = [fixmap.get(z.source, z) if o != med else z for z, o in zip(zones, offs)]
    # detuning sanity: drop zones whose pitch is far from the nominal (mislabelled / failed)
    good = []
    for z in zones:
        dev = hz_to_midi(z.f0) - (z.nominal_note + med)
        if abs(dev) > 0.8:
            print(f'  dropping {os.path.basename(z.source)}: pitch off by {dev:+.2f} semitones', flush=True)
            continue
        good.append(z)
    zones = good

    # dynamic layers ordered by loudness (peak level, robust to decay length)
    layer_names = sorted({z.layer for z in zones})
    loud = {ln: float(np.median([z.peak_db for z in zones if z.layer == ln])) for ln in layer_names}
    order = sorted(layer_names, key=lambda ln: loud[ln])
    top = float(np.median([z.rms_db for z in zones if z.layer == order[-1]]))
    n = len(order)
    spreads = {1: [118], 2: [70, 118], 3: [50, 85, 118], 4: [40, 66, 92, 118], 5: [32, 54, 76, 98, 120]}
    vels = np.array(spreads.get(n, list(np.linspace(30, 120, n))), dtype=float)
    if 'layer_velocities' in spec:
        vels = np.array([spec['layer_velocities'][ln] for ln in order], dtype=float)
    layers = [{'name': ln, 'velocity': round(float(v), 1)} for ln, v in zip(order, vels)]
    for z in zones:
        z.meta['layer_index'] = order.index(z.layer)
    zones.sort(key=lambda z: (z.meta['layer_index'], z.f0))

    # normalisation: loudest layer median RMS → target
    target = spec.get('target_rms_db', -20.0)
    gain = target - top
    if spec.get('fixed_gain_from'):
        # keep the natural balance between the stops of one organ: share one gain
        ref_path = os.path.join(OUT_DIR, spec['fixed_gain_from'] + '.ssm')
        if os.path.exists(ref_path) and spec['fixed_gain_from'] != inst_id:
            with gzip.open(ref_path, 'rb') as fh:
                raw = fh.read()
            n = struct.unpack('<I', raw[4:8])[0]
            gain = json.loads(raw[8:8 + n])['params']['gainDb'] - spec.get('params', {}).get('gainDb', 0.0)
    grid_len = max(len(z.times) for z in zones)
    # shared frame times (every zone's grid is a prefix of the plain grid unless it carries
    # its own, e.g. dense around a recorded release)
    from analysis import make_time_grid
    grid = [round(float(t), 5) for t in make_time_grid(max(float(z.times[-1]) for z in zones) + 0.01)]
    params = dict(spec.get('params', {}))
    params['gainDb'] = round(gain + params.get('gainDb', 0.0), 2)
    header = {
        'format': 1,
        'name': inst_id,
        'displayName': spec.get('display', inst_id),
        'family': spec.get('family', ''),
        'kind': spec['kind'],
        'source': spec.get('source', ''),
        'grid': grid,
        'noiseEdges': [float(x) for x in NOISE_EDGES],
        'layers': layers,
        'params': params,
    }
    if spec.get('stop'):
        header['stop'] = spec['stop']
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, f'{inst_id}.ssm')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    size = write_model(path, header, zones)
    # per-layer recorded levels + family velocity range (used by the playback velocity curve)
    from layer_levels import process as add_levels
    add_levels(path)
    size = os.path.getsize(path)
    print(f'  wrote {path} ({size/1024:.0f} KB, {len(zones)} zones, layers={[(l["name"], l["velocity"]) for l in layers]}, '
          f'notes {min(z.f0 for z in zones):.1f}-{max(z.f0 for z in zones):.1f} Hz, grid {grid_len})', flush=True)
    return path


if __name__ == '__main__':
    from instruments import INSTRUMENTS
    ids = sys.argv[1:]
    if ids == ['--all']:
        ids = list(INSTRUMENTS)
    for i in ids:
        build(i, INSTRUMENTS[i])
