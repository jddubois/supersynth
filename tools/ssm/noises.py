"""Models of an organ's machinery from its GrandOrgue sample set: the key action of each
keyboard (a zone per key, the key going down and coming up), the stop action (a zone per
drawing and retiring noise), the blower and the empty church.

A noise has no partials: each zone is its recording's noise-band envelope (the engine's noise
generator) and, for the clicks of the key and stop action, the recording's first samples as
they are. Levels are the organ's own, like its pipes' (one gain for the whole organ).

  python noises.py <organ> [...]
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np
from scipy import signal

import build
import piotr
from analysis import NOISE_EDGES, Zone, band_powers, hz_to_midi, make_time_grid, midi_to_hz
from paths import model_path
from grandorgue import ODF, HauptwerkODF, Pipe, _pipe_from, _rank_family, _read, wav_cue

CLICK_S = 0.05          # stored onset of a click (key and stop action)
KEY_STEP = 2            # a key-action zone every KEY_STEP keys (neighbours play it a little faster or slower)
TAIL_DB = 70.0          # a click's room tail is kept down to this far below its peak


# ── sources ────────────────────────────────────────────────────────────────────────────────
def _sections(odf: ODF):
    for sec in odf.sections:
        if sec.startswith('stop'):
            yield sec, (odf.get(sec, 'Name', '') or '').strip()


def _norm(name: str) -> str:
    return re.sub(r'\s+', ' ', name).strip().lower()


def sources(odf: ODF, cat: dict) -> dict:
    """The noise recordings of a GrandOrgue organ: key action per keyboard (key → pipe, down and
    up), stop action per catalogue stop (on, off), tremulants and couplers (on, off), blower
    and ambient."""
    out = {'keys': {}, 'stops': {}, 'tremulants': {}, 'couplers': {}, 'blower': None, 'ambient': None}
    divisions = {}
    for st in cat['stops']:
        divisions.setdefault(st['manual'], st['division'])
    on, off = {}, {}
    for sec, name in _sections(odf):
        m = re.match(r'key action (manual (\d+)|pedal) (attack|release)$', name, re.I)
        if m:
            man = 0 if m.group(1).lower() == 'pedal' else int(m.group(2))
            div = divisions.get(man)
            if div is None:
                continue
            ms = f'manual{man:03d}'
            first = odf.int(ms, 'FirstAccessibleKeyMIDINoteNumber', 36) - (odf.int(sec, 'FirstAccessiblePipeLogicalKeyNumber', 1) - 1)
            keys = {}
            for i in range(1, odf.int(sec, 'NumberOfLogicalPipes', 0) + 1):
                p = _pipe_from(odf, sec, i, first)
                if p is not None:
                    keys[first + i - 1] = p
            out['keys'].setdefault(div, {})['down' if m.group(3).lower() == 'attack' else 'up'] = keys
            continue
        m = re.match(r'stop (attack|release) noise (.*)$', name, re.I)
        if m:
            p = _pipe_from(odf, sec, 1, 60)
            if p is not None:
                # the same noise once per microphone perspective: they sound together
                (on if m.group(1).lower() == 'attack' else off).setdefault(_norm(m.group(2)), []).append(p)
    raw = {st['id']: _norm(odf.get(st['section'], 'Name', '') or '') for st in cat['stops']}
    for sid, rn in raw.items():
        if rn in on or rn in off:
            out['stops'][sid] = (on.get(rn), off.get(rn))
    for n in set(on) | set(off):
        if n.startswith('tremulant'):
            out['tremulants'][n] = (on.get(n), off.get(n))
        elif n.startswith('coupler'):
            out['couplers'][n] = (on.get(n), off.get(n))
        elif n.startswith('blower'):
            out['blower'] = on.get(n)
        elif n.startswith('ambient'):
            out['ambient'] = on.get(n)
    return out


def signal_of(p: Pipe | list[Pipe], part: str) -> tuple[np.ndarray, int, int | None]:
    """A noise pipe as the sampler plays it: its attack (`part` 'on'), or its release
    recording from the cue on ('off'); with the pipe's gain. Also the cue (end of the sustain)
    of an attack that holds its own release (the blower). Several pipes (a Hauptwerk set's
    microphone perspectives) sound together."""
    if isinstance(p, list):
        parts = [signal_of(q, part) for q in p]
        sr = parts[0][1]
        # perspectives recorded at another rate are resampled to the first one's (as mix_key does)
        xs = [x if s == sr else signal.resample_poly(x, sr, s, axis=0) for x, s, _ in parts]
        n = max(len(x) for x in xs)
        acc = np.zeros((n, 2))
        for x in xs:
            acc[:len(x)] += x
        return acc, sr, parts[0][2]
    path = p.attack if part == 'on' or p.release is None else p.release
    x, sr = _read(path)
    cue = wav_cue(path)
    if part == 'off' and p.release is not None and cue is not None and 0 < cue < len(x) // 2:
        x, cue = x[cue:], None
    return x * p.amplitude * 10 ** (p.gain_db / 20), sr, cue


def hw_sources(hw: HauptwerkODF, cat: dict) -> dict:
    """The noise recordings of a Hauptwerk organ, like {@link sources}: every microphone
    perspective of a noise is a pipe of its list."""
    out = {'keys': {}, 'stops': {}, 'tremulants': {}, 'couplers': {}, 'blower': None, 'ambient': None}
    ranks = {r['RankID']: r.get('Name', '') for r in hw.all('Rank')}
    switch_name = {sw['SwitchID']: sw.get('Name', '') for sw in hw.all('Switch')}
    samples = {x['SampleID']: x for x in hw.all('Sample')}
    layers = {lay['PipeID']: lay for lay in hw.all('Pipe_SoundEngine01_Layer') if lay.get('PipeLayerNumber', '1') == '1'}
    attacks, releases = {}, {}
    for a in hw.all('Pipe_SoundEngine01_AttackSample'):
        attacks.setdefault(a['LayerID'], []).append(a)
    for r in hw.all('Pipe_SoundEngine01_ReleaseSample'):
        releases.setdefault(r['LayerID'], []).append(r)
    key_of = {d['SwitchID']: (int(d['DivisionID']), int(d['NormalMIDINoteNumber'])) for d in hw.all('DivisionInput')}
    drives: dict[str, list[str]] = {}
    for link in hw.all('SwitchLinkage'):
        drives.setdefault(link['DestSwitchID'], []).append(link['SourceSwitchID'])
    divisions = {}
    for st in cat['stops']:
        divisions.setdefault(st['manual'], st['division'])

    def pipe(p: dict) -> Pipe | None:
        lay = layers.get(p['PipeID'])
        if lay is None or not attacks.get(lay['LayerID']):
            return None
        rels = sorted(releases.get(lay['LayerID'], []), key=lambda r: -float(r.get('ReleaseSelCriteria_LatestKeyReleaseTimeMs') or 99999))
        rel = samples[rels[0]['SampleID']] if rels else None
        return Pipe(attack=hw.sample_path(samples[attacks[lay['LayerID']][0]['SampleID']]),
                    release=hw.sample_path(rel) if rel else None,
                    gain_db=float(lay.get('AmpLvl_LevelAdjustDecibels') or 0), amplitude=1.0, tuning_cents=0.0,
                    harmonic=8.0, midi=float(p.get('NormalMIDINoteNumber') or 60))

    def resolve(pallet: str) -> str:
        # another perspective's pipes sound from a duplicate of the first's switch
        while switch_name.get(pallet, '').startswith('__Duplicated') and drives.get(pallet):
            pallet = drives[pallet][0]
        return pallet

    def key(pallet: str):
        m = re.match(r'Keys Keyb:(\d+) MIDI:(\d+)', switch_name.get(pallet, ''))
        if m:
            return int(m.group(1)), int(m.group(2))
        for src in drives.get(pallet, []):
            if src in key_of:
                return key_of[src]
        return None

    stop_switch = {f"hwstop{x['StopID']}": x.get('ControllingSwitchID') for x in hw.all('Stop')}
    by_switch = {stop_switch.get(st['section']): st['id'] for st in cat['stops'] if not st['id'].endswith('-forte')}
    for p in hw.all('Pipe_SoundEngine01'):
        fam = _rank_family(ranks.get(p['RankID'], ''))
        pp = pipe(p)
        if pp is None:
            continue
        pallet = resolve(p.get('ControllingPalletSwitchID', ''))
        m = re.match(r'(?:\S+\s+)?key action noises (attack|release)$', fam, re.I)
        if m:
            k = key(pallet)
            div = divisions.get(k[0]) if k else None
            if div:
                part = 'down' if m.group(1).lower() == 'attack' else 'up'
                out['keys'].setdefault(div, {}).setdefault(part, {}).setdefault(k[1], []).append(pp)
            continue
        m = re.match(r'stop action noises (attack|release)$', fam, re.I)
        if m:
            sid = by_switch.get(pallet)
            if sid:
                pair = out['stops'].setdefault(sid, [[], []])
                pair[0 if m.group(1).lower() == 'attack' else 1].append(pp)
            continue
        if re.match(r'noises$', fam, re.I):
            if re.search(r'trem', switch_name.get(pallet, ''), re.I):
                continue                    # the tremulant's motor
            kind = 'blower' if re.search(r'blower|dmuch', switch_name.get(pallet, ''), re.I) else 'ambient'
            out[kind] = (out[kind] or []) + [pp]
    out['stops'] = {k: (v[0] or None, v[1] or None) for k, v in out['stops'].items()}
    return out


# ── analysis ───────────────────────────────────────────────────────────────────────────────
def noise_zone(x: np.ndarray, sr: int, note: float, *, sustained: bool = False, cue: int | None = None,
               loop_at: tuple[int, int] | None = None, ending: bool = True, source: str = '') -> Zone | None:
    """One noise recording (stereo) as a zone: its noise-band envelope over time and, for a
    click, its first CLICK_S seconds as recorded. Sustained noises (blower, room) loop their
    steady part and keep the recording's own ending after the cue."""
    mono = x.mean(axis=1)
    if not np.any(mono):
        return None
    nb = len(NOISE_EDGES) - 1
    short = 1024 if sr <= 50000 else 2048
    long_ = 8192 if sr <= 50000 else 16384
    xn = x
    if not sustained:
        # a click's onset is played as recorded and the model takes over from 0.5·CLICK_S: its
        # bands are measured from there (analysis windows reaching back into the click would
        # add the click's treble to the model's tail)
        t = np.arange(len(x)) / sr
        t1 = 0.5 * CLICK_S
        h = np.clip((t - (t1 - 0.005)) / 0.005, 0, 1)
        xn = x * (h * h * (3 - 2 * h))[:, None]
    sp = [band_powers(xn[:, c], sr, short, 128, 'hann') for c in (0, 1)]
    tt_s, bp_s = sp[0][0], (sp[0][1] + sp[1][1]) / 2
    # bands below 430 Hz need a longer window (a short one leaks them away); a click's
    # thump is short, so not the pipes' longest
    lw, lh = (long_, 1024) if sustained else (long_ // 2, 256)
    lp = [band_powers(xn[:, c], sr, lw, lh, 'hann') for c in (0, 1)]
    tt_l, bp_l = lp[0][0], (lp[0][1] + lp[1][1]) / 2
    dur = len(mono) / sr
    grid = make_time_grid(dur)
    noise = np.empty((len(grid), nb))
    for b in range(nb):
        if NOISE_EDGES[b + 1] <= 430:
            noise[:, b] = np.interp(grid, tt_l, bp_l[:, b])
        else:
            noise[:, b] = np.interp(grid, tt_s, bp_s[:, b])
    noise_db = 10 * np.log10(np.maximum(noise, 1e-14))
    for b in range(nb):
        if NOISE_EDGES[b] >= sr / 2:
            noise_db[:, b] = -140
    tot = 10 * np.log10(np.sum(noise, axis=1) + 1e-14)
    loop, rel_frame = None, None
    if sustained:
        if loop_at is not None and 0 <= loop_at[0] < loop_at[1] <= len(x):
            # the recording's own loop (in GrandOrgue): its sustain ends where the loop does
            end_t = loop_at[1] / sr
            a = int(np.searchsorted(grid, loop_at[0] / sr))
            b = int(np.searchsorted(grid, min(end_t, grid[a] + 4.0))) - 1
        else:
            end_t = cue / sr if cue else dur
            # loop the steady noise: from 1 s after the start (the blower has spun up) for up
            # to 4 s, ending before the cue
            a = int(np.searchsorted(grid, min(1.0, 0.3 * end_t)))
            b = int(np.searchsorted(grid, min(end_t - 0.2, grid[a] + 4.0)))
        cue = int(end_t * sr) if ending and end_t < dur - 0.3 else None   # the frames after it are its ending
        if b - a < 8:
            return None
        loop = (a, b)
        keep = np.arange(b + 2)
        if cue:
            r = max(int(np.searchsorted(grid, end_t - 0.02)), b + 3)   # after the frames kept for the loop
            alive = np.where((np.arange(len(grid)) > r) & (tot < tot.max() - TAIL_DB))[0]
            end = int(alive[0]) + 1 if len(alive) else len(grid)
            if end - r >= 8:
                keep = np.concatenate([np.arange(b + 3), np.arange(r, end)])
                rel_frame = b + 3
        grid, noise_db = grid[keep], noise_db[keep]
        assert np.all(np.diff(grid) > 0), 'noise zone frames out of order'
    else:
        alive = np.where(tot > tot.max() - TAIL_DB)[0]
        T = max(8, int(alive[-1]) + 2 if len(alive) else len(grid))
        grid, noise_db = grid[:T], noise_db[:T]
    T = len(grid)
    f0 = float(midi_to_hz(note))
    z = Zone(source=source, nominal_note=int(round(note)), layer='main', f0=f0, ratios=np.ones(1),
             times=grid, amps_db=np.full((T, 1), -200.0), phases=np.zeros(1), pitch_cents=np.zeros(T),
             noise_db=noise_db, loop=loop, release_db_per_s=np.full(1, 60.0), release_noise_db_per_s=60.0,
             peak_db=20 * math.log10(float(np.max(np.abs(mono))) + 1e-12),
             rms_db=10 * math.log10(float(np.mean(mono ** 2)) + 1e-24),
             meta={'sr': sr, 'K': 1, 'harmonic': 1, 'jitter': np.zeros(1), 'jitter_tau': 0.03,
                   'rel_frame': rel_frame, 'layer_index': 0, 'window': 0})
    if not sustained:
        n = min(len(x), int(CLICK_S * sr) + 1)
        fade_in = np.linspace(0, 1, min(n, int(0.0005 * sr) + 1))
        tr = [x[:n, c].astype(np.float32) for c in (0, 1)]
        for c in tr:
            c[:len(fade_in)] *= fade_in
        z.transient, z.transient_r = tr[0], tr[1]
        z.transient_fade = (0.5 * CLICK_S, CLICK_S)
    return z


def _job(args):
    x, sr, note, kw, src = args
    try:
        return noise_zone(x, sr, note, source=src, **kw)
    except Exception as ex:  # noqa: BLE001
        print(f'  !! {src}: {ex}', flush=True)
        return None


def write(model: str, zones: list[Zone], cat: dict, display: str, release_mode: str) -> str:
    zones = sorted((z for z in zones if z is not None), key=lambda z: z.f0)
    ref = build.gain_reference(model, piotr.model_id(cat['id'], cat['reference']), build.OUT_DIR)
    if ref is None:
        raise RuntimeError(f"{model}: build the organ's gain reference {cat['reference']} first")
    gain = json.loads(_header(ref))['params']['gainDb']
    end = max(float(z.times[-1]) for z in zones) + 0.01
    header = {
        'format': 1, 'name': model, 'displayName': f"{cat['church']} — {display}", 'family': 'organ',
        'kind': 'decaying' if release_mode == 'ringout' else 'sustained',
        'source': piotr.SOURCE.format(name=cat['church']),
        'grid': [round(float(t), 5) for t in make_time_grid(end)],
        'noiseEdges': [float(e) for e in NOISE_EDGES],
        'layers': [{'name': 'main', 'velocity': 118.0}],
        'params': {'gainDb': gain, 'releaseMode': release_mode, 'pitchMorph': False, 'reverbSend': 0.06,
                   'spread': 0.0, 'formant': 0.0},
    }
    path = model_path(model, build.OUT_DIR)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    build.write_model(path, header, zones)
    print(f'  wrote {path} ({os.path.getsize(path) / 1024:.0f} KB, {len(zones)} zones)', flush=True)
    return path


def _header(path: str) -> bytes:
    import gzip
    import struct
    with gzip.open(path, 'rb') as f:
        raw = f.read()
    n = struct.unpack('<I', raw[4:8])[0]
    return raw[8:8 + n]


def _hauptwerk_beside(organ: str) -> HauptwerkODF | None:
    import glob
    xml = glob.glob(os.path.join(piotr.SAMPLES, organ, 'OrganDefinitions', '*.Organ_Hauptwerk_xml'))
    return HauptwerkODF(xml[0]) if xml else None


def _hw_catalog(cat: dict, hw: HauptwerkODF) -> dict:
    """The catalogue as the Hauptwerk definition numbers it: its divisions in order are the
    GrandOrgue manuals in order; its stops are matched by division and name."""
    hw_divs = sorted(int(d['DivisionID']) for d in hw.all('Division'))
    go_mans = sorted({st['manual'] for st in cat['stops']})
    to_hw = dict(zip(go_mans, hw_divs))
    stops = []
    for x in hw.all('Stop'):
        div = int(x['DivisionID'])
        name = piotr.clean_name(x.get('Name', ''), '')
        st = next((st for st in cat['stops'] if to_hw.get(st['manual']) == div and st['name'].lower() == name.lower()), None)
        if st:
            stops.append({**st, 'section': f"hwstop{x['StopID']}", 'manual': div})
    return {**cat, 'stops': stops}


def build_noises(organ: str, workers: int = min(4, os.cpu_count() or 4)) -> dict:
    """Every noise model of an organ; returns the map the organ's config needs."""
    cat = piotr.load_catalog(organ)
    odf = piotr.load_odf(organ)
    src = hw_sources(odf, cat) if isinstance(odf, HauptwerkODF) else sources(odf, cat)
    hw = _hauptwerk_beside(organ)
    if hw is not None and not isinstance(odf, HauptwerkODF):
        # a GrandOrgue definition made from a Hauptwerk set may leave its noises out: take
        # what is missing from the Hauptwerk definition
        extra = hw_sources(hw, _hw_catalog(cat, hw))
        for k in ('keys', 'stops', 'tremulants', 'couplers'):
            src[k] = src[k] or extra[k]
        for k in ('blower', 'ambient'):
            src[k] = src[k] or extra[k]
    base = f'organ/{organ}/noise'
    out = {'keys': {}, 'stops': {}, 'tremulants': {}, 'couplers': {}}
    with ProcessPoolExecutor(workers, initializer=build._worker_init) as ex:
        # key action: a zone per key, at the key's note
        for div, parts in src['keys'].items():
            for part, keys in parts.items():
                if part not in ('down', 'up'):
                    continue
                ks = sorted(keys)
                ks = ks[::KEY_STEP] + ([ks[-1]] if (len(ks) - 1) % KEY_STEP else [])
                jobs = [(*signal_of(keys[k], 'on' if part == 'down' else 'off')[:2], k, {}, f'{div}-{part}-{k}') for k in ks]
                zones = list(ex.map(_job, jobs))
                if any(z is not None for z in zones):
                    m = f'{base}-keys-{div}-{part}'
                    write(m, zones, cat, f'key action, {div}, key {part}', 'ringout')
                    out['keys'].setdefault(div, {})[part] = m
        # stop action: drawing and retiring noises of every stop, tremulant and coupler, a zone
        # each at notes 3, 4, 5, … (key 1 and 2 of the noise part are the blower and the room)
        items, note = [], 3
        for kind, table in (('stops', src['stops']), ('tremulants', src['tremulants']), ('couplers', src['couplers'])):
            for name, (p_on, p_off) in sorted(table.items()):
                if note + 1 > 127:
                    break
                pair = []
                for p, part in ((p_on, 'on'), (p_off, 'off')):
                    if p is None:
                        pair.append(None)
                        continue
                    x, sr, _ = signal_of(p, part)
                    items.append((x, sr, note, {}, f'{name}-{part}'))
                    pair.append(note)
                    note += 1
                out[kind][name] = pair
        zones = list(ex.map(_job, items))
        if any(z is not None for z in zones):
            write(f'{base}-stops', zones, cat, 'stop action', 'ringout')
            out['stopsModel'] = f'{base}-stops'
        for kind in ('blower', 'ambient'):
            p = src[kind]
            if p is None:
                continue
            x, sr, cue = signal_of(p, 'on')
            from grandorgue import wav_loops
            loops = wav_loops((p[0] if isinstance(p, list) else p).attack)
            # the blower spins down when switched off; the room just fades (its recording
            # going on after the loop is more of the same, not an ending)
            z = noise_zone(x, sr, 60, sustained=True, cue=cue if kind == 'blower' else None,
                           loop_at=loops[0] if loops else None, ending=kind == 'blower', source=kind)
            if z is not None:
                write(f'{base}-{kind}', [z], cat, kind, 'natural')
                out[kind] = f'{base}-{kind}'
    with open(os.path.join(piotr.CATALOG_DIR, f'{organ}.noises.json'), 'w') as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    return out


if __name__ == '__main__':
    for o in sys.argv[1:]:
        r = build_noises(o)
        print(o, {k: (len(v) if isinstance(v, dict) else v) for k, v in r.items()})
