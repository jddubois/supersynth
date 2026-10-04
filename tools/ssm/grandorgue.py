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
    # release: the one for the longest key press (MaxKeyPressTime −1 = any), not the tremulant one
    rels = []
    for r in range(1, odf.int(sec, p + 'releasecount', 0) + 1):
        rp = odf.get(sec, f'{p}release{r:03d}')
        if not rp:
            continue
        mk = float(odf.get(sec, f'{p}release{r:03d}maxkeypresstime', -1) or -1)
        trem = (odf.get(sec, f'{p}release{r:03d}istremulant', '-1') or '-1').strip() == '1'
        rels.append((trem, -(1e9 if mk < 0 else mk), rp))
    rels.sort()
    release = odf.file(rels[0][2]) if rels else None
    in_attack = release is None and not main[2].strip().upper().startswith('N')
    midi = base_midi + (i - 1) + 12 * math.log2(hn / 8.0)
    return Pipe(attack=odf.file(main[0]), release=release, gain_db=gain, amplitude=amp,
                tuning_cents=tune, harmonic=hn, midi=midi, crossfade_ms=xf, release_in_attack=in_attack)


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


def render_pipe(p: Pipe, hold_s: float = 3.4) -> tuple[np.ndarray, int, int]:
    """One pipe: (stereo signal, sample rate, key-up frame)."""
    att, sr = _read(p.attack)
    f0 = 440.0 * 2 ** ((p.midi - 69) / 12)
    if p.release is not None:
        rel, sr2 = _read(p.release)
        if sr2 != sr:
            rel = signal.resample_poly(rel, sr, sr2, axis=0)
        loops = wav_loops(p.attack)
        loop_a = loops[0][0] if loops else int(0.5 * len(att))
        # key-up well into the sustain: at least `hold_s`, at least 1.8 s past the loop start
        at = int(min(len(att) - 0.06 * sr, max(hold_s * sr, loop_a + 1.8 * sr)))
        y, up = splice_release(att, rel, sr, at, f0, p.crossfade_ms)
    else:
        y = att
        cue = wav_cue(p.attack)
        up = cue if cue is not None else len(att)
    g = p.amplitude * 10 ** (p.gain_db / 20)
    y = retune(y * g, p.tuning_cents)
    up = int(round(up / 2.0 ** (p.tuning_cents / 1200.0)))
    return y, sr, up


def render_key(pipes: list[Pipe]) -> tuple[np.ndarray, int, int]:
    """All pipes of one key of a stop, summed, released together (the first pipe's key-up)."""
    parts = [render_pipe(p) for p in pipes]
    sr = parts[0][1]
    if len(parts) == 1:
        return parts[0]
    # align every pipe's key-up to the same instant
    up = max(u for _, _, u in parts)
    n = max(up - u + len(y) for y, _, u in parts)
    acc = np.zeros((n, 2))
    for y, s, u in parts:
        if s != sr:
            y = signal.resample_poly(y, sr, s, axis=0)
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
