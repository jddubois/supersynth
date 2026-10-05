"""GrandOrgue organ definition files (.organ): which recordings sound for every key of every stop,
and those recordings rendered the way GrandOrgue plays them.

A GrandOrgue stop plays, for each key, one pipe of each of its ranks (several for a mixture made
of ranks). A pipe is an attack recording (onset and sustain, looped) and a release recording
that GrandOrgue crossfades into at key-up; the organ definition retunes it (PitchTuning, cents)
and sets its level (Gain, dB; Amplitude, %), per pipe and per rank. Sample sets borrow pipes
between stops this way (a 1 1/3' Quint from a 2' Principal retuned by up to a semitone, a 4'
from a 2' an octave down).

`render_key` produces one recording per stop and key with exactly that: the attack up to well
into its sustain, a phase-aligned crossfade into the release (a cue point marks the key-up),
retuned and at its level, all ranks of the key summed. The analysis then treats it like a
Bureå pipe (one file per pipe with a release marker).
"""
from __future__ import annotations

import math
import os
import re
import struct
from dataclasses import dataclass, field

import numpy as np
import soundfile as sf
from scipy import signal


# ── organ definition file ──────────────────────────────────────────────────────────────────
class ODF:
    """An .organ file: sections of key=value settings (keys compared case-insensitively)."""

    def __init__(self, path: str):
        raw = open(path, 'rb').read()
        for enc in ('utf-8-sig', 'cp1250', 'latin-1'):
            try:
                text = raw.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        self.path = path
        self.root = os.path.dirname(os.path.abspath(path))
        self.sections: dict[str, dict[str, str]] = {}
        cur = None
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith(';'):
                continue
            if line.startswith('[') and line.endswith(']'):
                cur = self.sections.setdefault(line[1:-1].lower(), {})
                continue
            if cur is not None and '=' in line:
                k, v = line.split('=', 1)
                cur[k.strip().lower()] = v.strip()

    def get(self, section: str, key: str, default=None):
        return self.sections.get(section.lower(), {}).get(key.lower(), default)

    def int(self, section: str, key: str, default: int = 0) -> int:
        v = self.get(section, key)
        return int(v) if v not in (None, '') else default

    def float(self, section: str, key: str, default: float = 0.0) -> float:
        v = self.get(section, key)
        return float(v) if v not in (None, '') else default

    def yes(self, section: str, key: str, default: bool = False) -> bool:
        v = self.get(section, key)
        return default if v is None else v.strip().upper().startswith('Y')

    def file(self, rel: str) -> str:
        """A sample path of the definition (Windows separators, relative to the .organ file)."""
        p = os.path.join(self.root, *[s for s in re.split(r'[\\/]+', rel) if s])
        if os.path.exists(p):
            return p
        # case-insensitive fallback (archives extracted on a case-sensitive file system)
        cur = self.root
        for part in [s for s in re.split(r'[\\/]+', rel) if s]:
            try:
                names = {n.lower(): n for n in os.listdir(cur)}
            except OSError:
                return p
            cur = os.path.join(cur, names.get(part.lower(), part))
        return cur


@dataclass
class Pipe:
    attack: str                 # recording of onset + sustain
    release: str | None         # separate release recording (None: release after the attack's cue)
    gain_db: float              # pipe + rank gain
    amplitude: float            # pipe × rank amplitude (1 = 100 %)
    tuning_cents: float         # pipe + rank retuning
    harmonic: float             # harmonic number (8 = 8' pitch)
    midi: float                 # nominal sounding pitch (MIDI)
    crossfade_ms: float = 10.0  # attack → release crossfade at key-up
    release_in_attack: bool = False
    # releases recorded after shorter key presses: (longest press in seconds, recording),
    # shortest first (GrandOrgue MaxKeyPressTime)
    alt_releases: list = field(default_factory=list)

    @property
    def footage_semitones(self) -> float:
        return 12 * math.log2(self.harmonic / 8.0)


@dataclass
class Stop:
    section: str
    name: str
    manual: int
    manual_name: str
    keys: dict[int, list[Pipe]] = field(default_factory=dict)   # key (MIDI) → pipes sounding
    percussive: bool = False
    ranks: list[str] = field(default_factory=list)


def _pipe_from(odf: ODF, sec: str, i: int, base_midi: int, depth: int = 0) -> Pipe | None:
    """Pipe i (1-based) of a rank (or an old-style stop holding its pipes) `sec`."""
    p = f'pipe{i:03d}'
    v = odf.get(sec, p)
    if v is None or v.upper().startswith('DUMMY') or v == '':
        return None
    if v.upper().startswith('REF:'):
        if depth > 4:
            return None
        man, st, pi = (int(x) for x in v[4:].split(':'))
        stop_sec = f'stop{odf.int(f"manual{man:03d}", f"stop{st:03d}"):03d}'
        return _pipe_from(odf, stop_sec, pi, odf.int(stop_sec, 'FirstMidiNoteNumber', 36), depth + 1)

    def attr(name, conv, default):
        own = odf.get(sec, p + name)
        if own is not None:
            return conv(own)
        rank = odf.get(sec, name)
        return conv(rank) if rank is not None else default
    # gain and tuning: pipe value on top of the rank's (GrandOrgue's config hierarchy)
    gain = float(odf.get(sec, p + 'gain', 0) or 0) + odf.float(sec, 'gain', 0.0)
    tune = (float(odf.get(sec, p + 'pitchtuning', 0) or 0) + odf.float(sec, 'pitchtuning', 0.0)
            + float(odf.get(sec, p + 'pitchcorrection', 0) or 0) + odf.float(sec, 'pitchcorrection', 0.0))
    amp = float(odf.get(sec, p + 'amplitude', 100) or 100) / 100.0 * odf.float(sec, 'amplitude', 100.0) / 100.0
    hn = attr('harmonicnumber', float, 8.0)
    xf = attr('releasecrossfadelength', float, 10.0) or 10.0

    # main attack: the non-tremulant one (Pipe001 itself, else the first AttackNNN not marked tremulant)
    attacks = [(v, odf.get(sec, p + 'istremulant', '-1'), odf.get(sec, p + 'loadrelease', 'Y'))]
    for a in range(1, odf.int(sec, p + 'attackcount', 0) + 1):
        attacks.append((odf.get(sec, f'{p}attack{a:03d}'), odf.get(sec, f'{p}attack{a:03d}istremulant', '-1'),
                        odf.get(sec, f'{p}attack{a:03d}loadrelease', 'Y')))
    attacks = [a for a in attacks if a[0]]
    main = next((a for a in attacks if a[1].strip() != '1'), attacks[0])
    # releases: GrandOrgue plays the one with the shortest MaxKeyPressTime the key press fits
    # (−1 = any length). The main release (any length) is a separate recording, or the one
    # the attack recording holds after its cue; the others are for short presses.
    rels = []
    for r in range(1, odf.int(sec, p + 'releasecount', 0) + 1):
        rp = odf.get(sec, f'{p}release{r:03d}')
        if not rp:
            continue
        mk = float(odf.get(sec, f'{p}release{r:03d}maxkeypresstime', -1) or -1)
        if (odf.get(sec, f'{p}release{r:03d}istremulant', '-1') or '-1').strip() == '1':
            continue
        rels.append((1e9 if mk < 0 else mk, rp))
    rels.sort()
    any_len = [rp for mk, rp in rels if mk >= 1e9]
    loads = not main[2].strip().upper().startswith('N')
    if any_len:
        release, in_attack = odf.file(any_len[0]), False
    elif loads or not rels:
        release, in_attack = None, loads
    else:
        # no release for long presses: the longest one serves them
        release, in_attack = odf.file(rels[-1][1]), False
        rels = rels[:-1]
    alt = [(mk / 1000.0, odf.file(rp)) for mk, rp in rels if mk < 1e9]
    midi = base_midi + (i - 1) + 12 * math.log2(hn / 8.0)
    return Pipe(attack=odf.file(main[0]), release=release, gain_db=gain, amplitude=amp,
                tuning_cents=tune, harmonic=hn, midi=midi, crossfade_ms=xf, release_in_attack=in_attack,
                alt_releases=alt)


def read_stops(odf: ODF) -> list[Stop]:
    """Every stop of every manual (Manual000 is the pedal when the organ has pedals) with the
    pipes each of its keys sounds."""
    first = 0 if odf.yes('organ', 'HasPedals') else 1
    out = []
    for m in range(first, odf.int('organ', 'NumberOfManuals') + 1):
        ms = f'manual{m:03d}'
        mname = odf.get(ms, 'Name', f'Manual {m}')
        key1_logical = odf.int(ms, 'FirstAccessibleKeyLogicalKeyNumber', 1)
        key1_midi = odf.int(ms, 'FirstAccessibleKeyMIDINoteNumber', 36)
        for s in range(1, odf.int(ms, 'NumberOfStops') + 1):
            sid = odf.int(ms, f'stop{s:03d}')
            ss = f'stop{sid:03d}'
            st = Stop(section=ss, name=odf.get(ss, 'Name', ss), manual=m, manual_name=mname,
                      percussive=odf.yes(ss, 'Percussive'))
            first_key = odf.int(ss, 'FirstAccessiblePipeLogicalKeyNumber', 1)
            n_acc = odf.int(ss, 'NumberOfAccessiblePipes', 0)
            nranks = odf.int(ss, 'NumberOfRanks', 0)
            if nranks:
                for r in range(1, nranks + 1):
                    rs = f'rank{odf.int(ss, f"rank{r:03d}"):03d}'
                    st.ranks.append(rs)
                    if odf.yes(rs, 'Percussive'):
                        st.percussive = True
                    fp = odf.int(ss, f'rank{r:03d}FirstPipeNumber', 1)
                    fk = odf.int(ss, f'rank{r:03d}FirstAccessibleKeyNumber', 1)
                    cnt = odf.int(ss, f'rank{r:03d}PipeCount', odf.int(rs, 'NumberOfLogicalPipes') - fp + 1)
                    base = odf.int(rs, 'FirstMidiNoteNumber', 36)
                    for j in range(cnt):
                        stop_key = fk + j                       # 1-based key of the stop
                        if stop_key > n_acc and n_acc:
                            break
                        key = key1_midi + (first_key - 1 + stop_key - 1) - (key1_logical - 1)
                        pipe = _pipe_from(odf, rs, fp + j, base)
                        if pipe is not None:
                            st.keys.setdefault(key, []).append(pipe)
            elif odf.get(ss, 'Pipe001') is not None:
                # old style: the stop holds its pipes
                fpn = odf.int(ss, 'FirstAccessiblePipeLogicalPipeNumber', 1)
                base = odf.int(ss, 'FirstMidiNoteNumber', 36)
                for j in range(n_acc):
                    key = key1_midi + (first_key - 1 + j) - (key1_logical - 1)
                    pipe = _pipe_from(odf, ss, fpn + j, base)
                    if pipe is not None:
                        st.keys.setdefault(key, []).append(pipe)
            if st.keys:
                out.append(st)
    return out


# ── rendering a key as GrandOrgue plays it ──────────────────────────────────────────────────
def wav_loops(path: str) -> list[tuple[int, int]]:
    """Loops of a WAV's smpl chunk (start, end frames)."""
    with open(path, 'rb') as f:
        d = f.read()
    i, out = 12, []
    while i < len(d) - 8:
        cid, sz = d[i:i + 4], struct.unpack('<I', d[i + 4:i + 8])[0]
        if cid == b'smpl' and sz >= 36:
            n = struct.unpack('<I', d[i + 8 + 28:i + 8 + 32])[0]
            for k in range(n):
                o = i + 8 + 36 + 24 * k
                if o + 24 <= len(d):
                    _, _, a, b, _, _ = struct.unpack('<6I', d[o:o + 24])
                    out.append((a, b))
        i += 8 + sz + (sz & 1)
    return out


def wav_cue(path: str) -> int | None:
    with open(path, 'rb') as f:
        d = f.read()
    i = 12
    while i < len(d) - 8:
        cid, sz = d[i:i + 4], struct.unpack('<I', d[i + 4:i + 8])[0]
        if cid == b'cue ':
            n = struct.unpack('<I', d[i + 8:i + 12])[0]
            if n:
                return struct.unpack('<I', d[i + 12 + 20:i + 12 + 24])[0]
        i += 8 + sz + (sz & 1)
    return None


def _read(path: str) -> tuple[np.ndarray, int]:
    x, sr = sf.read(path, dtype='float64', always_2d=True)
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    return x[:, :2], sr


def splice_release(att: np.ndarray, rel: np.ndarray, sr: int, at: int, f0: float, xf_ms: float) -> tuple[np.ndarray, int]:
    """Attack up to about `at`, crossfaded into the release recording. The splice point is moved
    (by up to ±25 ms) to where the attack's waveform best matches the release's first 30 ms,
    as GrandOrgue aligns a release with the playing sustain. Returns (signal, splice frame)."""
    w = int(0.03 * sr)
    reach = int(0.025 * sr) + int(sr / max(f0, 20.0))
    lo, hi = max(int(0.2 * sr), at - reach), min(len(att) - w - 1, at + reach)
    r0 = rel[:w]
    best, score = min(max(at, lo), hi), -2.0
    if hi > lo:
        # normalised cross-correlation, both channels
        num = sum(signal.correlate(att[lo:hi + w, c], r0[:, c], mode='valid') for c in range(2))
        e = np.cumsum(np.concatenate([[0.0], (att[lo:hi + w] ** 2).sum(axis=1)]))
        energy = e[w:] - e[:-w]
        energy = energy[:len(num)]
        nc = num / np.sqrt(np.maximum(energy, 1e-20) * max((r0 ** 2).sum(), 1e-20))
        j = int(np.argmax(nc))
        best, score = lo + j, float(nc[j])
    n = max(16, int(xf_ms * 1e-3 * sr))
    fade = 0.5 - 0.5 * np.cos(np.linspace(0, math.pi, n))[:, None]
    seg = att[best:best + n]
    n = len(seg)
    out = np.concatenate([att[:best], seg * (1 - fade[:n]) + rel[:n] * fade[:n], rel[n:]])
    return out, best


def retune(x: np.ndarray, cents: float) -> np.ndarray:
    """Play faster by `cents` (as a sampler retunes): band-limited resampling."""
    if abs(cents) < 0.05:
        return x
    ratio = 2.0 ** (cents / 1200.0)
    n = int(round(len(x) / ratio))
    # polyphase with a fine rational approximation of the ratio
    from fractions import Fraction
    fr = Fraction(1 / ratio).limit_denominator(4000)
    y = signal.resample_poly(x, fr.numerator, fr.denominator, axis=0, window=('kaiser', 10.0))
    return y[:n] if len(y) >= n else np.pad(y, ((0, n - len(y)), (0, 0)))


def extend_loop(att: np.ndarray, a: int, b: int, need: int) -> np.ndarray:
    """`att` played through its sustain loop until at least `need` frames long. A WAV smpl loop's
    start and end frames are both part of the loop (the end is inclusive): the loop is
    att[a:b + 1], and after frame b playback continues at frame a."""
    if len(att) >= need:
        return att
    period = b + 1 - a
    reps = int(math.ceil((need - (b + 1)) / period)) + 1
    return np.concatenate([att[:b + 1]] + [att[a:b + 1]] * reps)


def render_pipe(p: Pipe, hold_s: float = 3.4, alt: int | None = None, exact_hold: bool = False) -> tuple[np.ndarray, int, int]:
    """One pipe: (stereo signal, sample rate, key-up frame). `alt`: released into its
    alternative release `alt` (recorded after a shorter key press) instead of the main one."""
    att, sr = _read(p.attack)
    f0 = 440.0 * 2 ** ((p.midi - 69) / 12)
    release = p.release
    if alt is not None and alt < len(p.alt_releases):
        release = p.alt_releases[alt][1]
        if p.release is None:
            # the attack recording holds the main release after its cue: play its sustain only
            cue = wav_cue(p.attack)
            if cue is not None and 0 < cue < len(att):
                att = att[:cue]
    if release is not None:
        rel, sr2 = _read(release)
        rcue = wav_cue(release)
        if rcue is not None and 0 < rcue < len(rel) // 2:
            # a release recording with a cue point starts sounding there (the samples before it
            # are silence or pre-roll that the sampler skips)
            rel = rel[rcue:]
        if sr2 != sr:
            rel = signal.resample_poly(rel, sr, sr2, axis=0)
        loops = wav_loops(p.attack)
        loop_a = loops[0][0] if loops else int(0.5 * len(att))
        if loops and 0 < loops[0][0] < loops[0][1] < len(att):
            # a short recording: play its loop, as the sampler does, until the key-up is reached
            a, b = loops[0]
            need = int(max(hold_s * sr, min(a, 2.5 * sr) + 1.8 * sr) + 0.1 * sr)
            att = extend_loop(att, a, b, need)
        # key-up well into the sustain: at least `hold_s`, 1.8 s past the loop start (a loop
        # starting later than 2.5 s counts as 2.5 s: the model loops within the first ~2 s of
        # steady sound and drops the rest of the sustain before the release)
        at = int(min(len(att) - 0.06 * sr, hold_s * sr if exact_hold else max(hold_s * sr, min(loop_a, 2.5 * sr) + 1.8 * sr)))
        y, up = splice_release(att, rel, sr, at, f0, p.crossfade_ms)
    else:
        y = att
        cue = wav_cue(p.attack)
        up = cue if cue is not None else len(att)
    g = p.amplitude * 10 ** (p.gain_db / 20)
    y = retune(y * g, p.tuning_cents)
    up = int(round(up / 2.0 ** (p.tuning_cents / 1200.0)))
    return y, sr, up


def render_key(pipes: list[Pipe], alt: int | None = None, hold_s: float = 3.4, exact_hold: bool = False) -> tuple[np.ndarray, int, int]:
    """All pipes of one key of a stop, summed, released together (the first pipe's key-up)."""
    return mix_key([render_pipe(p, hold_s=hold_s, alt=alt, exact_hold=exact_hold) for p in pipes])


def mix_key(parts: list[tuple[np.ndarray, int, int]]) -> tuple[np.ndarray, int, int]:
    """Sum rendered pipes (signal, rate, key-up frame) with their key-ups at the same instant,
    at the first pipe's sample rate. Pipes recorded at another rate are resampled first, and
    their key-up frame converted, so offsets and lengths are all in the output rate."""
    sr = parts[0][1]
    if len(parts) == 1:
        return parts[0]
    conv = []
    for y, s, u in parts:
        if s != sr:
            y = signal.resample_poly(y, sr, s, axis=0)
            u = int(round(u * sr / s))
        conv.append((y, u))
    up = max(u for _, u in conv)
    n = max(up - u + len(y) for y, u in conv)
    acc = np.zeros((n, 2))
    for y, u in conv:
        o = up - u
        acc[o:o + len(y)] += y
    return acc, sr, up


def write_wav_cue(path: str, x: np.ndarray, sr: int, cue: int):
    """32-bit float stereo WAV with one cue point (the key-up)."""
    data = np.ascontiguousarray(x.astype('<f4'))
    fmt = struct.pack('<HHIIHH', 3, data.shape[1], sr, sr * 4 * data.shape[1], 4 * data.shape[1], 32)
    cue_chunk = struct.pack('<I', 1) + struct.pack('<II4sIII', 1, cue, b'data', 0, 0, cue)
    body = (b'WAVE' + b'fmt ' + struct.pack('<I', len(fmt)) + fmt
            + b'cue ' + struct.pack('<I', len(cue_chunk)) + cue_chunk
            + b'data' + struct.pack('<I', data.nbytes) + data.tobytes())
    with open(path, 'wb') as f:
        f.write(b'RIFF' + struct.pack('<I', len(body)) + body)


# ── Hauptwerk organ definitions ─────────────────────────────────────────────────────────────
class HauptwerkODF:
    """A Hauptwerk organ definition (.Organ_Hauptwerk_xml): its objects by type, as dicts."""

    def __init__(self, path: str):
        import xml.etree.ElementTree as ET
        self.path = path
        # <root>/OrganDefinitions/<file> next to <root>/OrganInstallationPackages/<id>/...
        self.root = os.path.dirname(os.path.dirname(os.path.abspath(path)))
        tree = ET.parse(path).getroot()
        self.objects: dict[str, list[dict]] = {
            ol.get('ObjectType'): [{c.tag: (c.text or '') for c in k} for k in ol] for ol in tree.findall('ObjectList')}
        self.general = self.objects.get('_General', [{}])[0]

    def all(self, typ: str) -> list[dict]:
        return self.objects.get(typ, [])

    def sample_path(self, sample: dict) -> str:
        return os.path.join(self.root, 'OrganInstallationPackages', f"{int(sample['InstallationPackageID']):06d}",
                            *re.split(r'[\\/]+', sample['SampleFilename']))


def _rank_family(name: str) -> str:
    """A rank's name without its microphone perspective, e.g. "003. I  Diapason 8' (close)" → "I  Diapason 8'"."""
    return re.sub(r'\s*\((?:close|front|rear|dry|direct|surround|diffuse)\)\s*$', '', re.sub(r'^\d+\.\s*', '', name), flags=re.I).strip()


def read_hauptwerk_stops(hw: HauptwerkODF) -> list[Stop]:
    """Every stop of a Hauptwerk organ with the pipes its keys sound: a pipe belongs to the stop
    whose switch conditions the pipe's pallet, at the key whose switch drives it; all microphone
    perspectives of the stop's rank sound together (Hauptwerk's default mix)."""
    switch_name = {s['SwitchID']: s.get('Name', '') for s in hw.all('Switch')}
    key_of = {d['SwitchID']: (int(d['DivisionID']), int(d['NormalMIDINoteNumber'])) for d in hw.all('DivisionInput')}
    drives: dict[str, list[tuple[str, str]]] = {}
    for link in hw.all('SwitchLinkage'):
        drives.setdefault(link['DestSwitchID'], []).append((link['SourceSwitchID'], link.get('ConditionSwitchID', '')))
    ranks = {r['RankID']: r.get('Name', '') for r in hw.all('Rank')}
    samples = {s['SampleID']: s for s in hw.all('Sample')}
    layers: dict[str, dict] = {}
    for lay in hw.all('Pipe_SoundEngine01_Layer'):
        if lay.get('PipeLayerNumber', '1') == '1':
            layers[lay['PipeID']] = lay
    attacks: dict[str, list[dict]] = {}
    for a in hw.all('Pipe_SoundEngine01_AttackSample'):
        attacks.setdefault(a['LayerID'], []).append(a)
    releases: dict[str, list[dict]] = {}
    for r in hw.all('Pipe_SoundEngine01_ReleaseSample'):
        releases.setdefault(r['LayerID'], []).append(r)
    divisions = {d['DivisionID']: d.get('Name', '') for d in hw.all('Division')}

    out = []
    for st in hw.all('Stop'):
        primary = ranks.get(st.get('Hint_PrimaryAssociatedRankID', ''), '')
        fam = _rank_family(primary)
        my_ranks = {rid for rid, n in ranks.items() if _rank_family(n) == fam}
        stop = Stop(section=f"hwstop{st['StopID']}", name=st.get('Name', ''), manual=int(st['DivisionID']),
                    manual_name=divisions.get(st['DivisionID'], ''), ranks=sorted(my_ranks))
        for p in hw.all('Pipe_SoundEngine01'):
            if p['RankID'] not in my_ranks:
                continue
            keys = [key_of[src] for src, cond in drives.get(p.get('ControllingPalletSwitchID', ''), [])
                    if cond == st['ControllingSwitchID'] and src in key_of]
            lay = layers.get(p['PipeID'])
            if not keys or lay is None or not attacks.get(lay['LayerID']):
                continue
            att = samples[attacks[lay['LayerID']][0]['SampleID']]
            rels = sorted(releases.get(lay['LayerID'], []), key=lambda r: -float(r.get('ReleaseSelCriteria_LatestKeyReleaseTimeMs') or 99999))
            rel = samples[rels[0]['SampleID']] if rels else None
            hn = float(p.get('Pitch_Tempered_RankBasePitch64ftHarmonicNum') or 8)
            # played at the pipe's original pitch: a sample borrowed for another pipe (an
            # extended bass, a celeste from another rank) is retuned to it
            tune = float(lay.get('PitchLvl_DetuningPercentSemitones') or 0)
            if att.get('Pitch_SpecificationMethodCode') == '4' and float(p.get('Pitch_OriginalOrgan_PitchHz') or 0) > 0:
                tune += 1200 * math.log2(float(p['Pitch_OriginalOrgan_PitchHz']) / float(att['Pitch_ExactSamplePitch']))
            # releases for short key presses (Hauptwerk: the latest key-release time each serves)
            alt = sorted((float(r['ReleaseSelCriteria_LatestKeyReleaseTimeMs']) / 1000.0, hw.sample_path(samples[r['SampleID']]))
                         for r in rels[1:] if float(r.get('ReleaseSelCriteria_LatestKeyReleaseTimeMs') or 99999) < 99999)
            pipe = Pipe(attack=hw.sample_path(att), release=hw.sample_path(rel) if rel else None,
                        gain_db=float(lay.get('AmpLvl_LevelAdjustDecibels') or 0), amplitude=1.0,
                        tuning_cents=tune, harmonic=hn, midi=int(p['NormalMIDINoteNumber']) + 12 * math.log2(hn / 8.0),
                        crossfade_ms=float(rels[0].get('ReleaseCrossfadeLengthMs') or 10) if rels else 10.0,
                        alt_releases=alt)
            for div, key in keys:
                if div == stop.manual:
                    stop.keys.setdefault(key, []).append(pipe)
        if stop.keys:
            out.append(stop)
    return out
