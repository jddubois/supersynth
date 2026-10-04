"""Piotr Grabowski's free organ sample sets (piotrgrabowski.pl): every stop as the sample set
plays it, analysed like the Bureå stops.

  python piotr.py survey <organ>             # manuals, stops, ranks of the organ definition
  python piotr.py catalog <organ>            # write piotr_organs/<organ>.json (stops, divisions, pitch)
  python piotr.py build <organ> [stop ...]   # render each key of each stop and analyse it
  python piotr.py ts <organ>                 # print the TypeScript stop list

The sample sets are GrandOrgue organ definitions (samples in data/samples/piotr/<organ>/). A stop
is rendered key by key with `grandorgue.render_key` — attack, sustain, the release crossfaded in
at key-up, the definition's retuning and level for every pipe, borrowed and extended ranks as the
definition assigns them — into data/samples/piotr-prep/<organ>/<stop>/ and analysed into
models/organ/<organ>/<stop>.ssm. All stops of an organ share one gain (their natural balance).

Keys of a manual where a stop has no pipe (a treble-only Cornet, a short-compass celeste) get a
silent zone, so the stop is silent there as on the organ.
"""
from __future__ import annotations

import copy
import json
import math
import os
import re
import shutil
import sys
import unicodedata

import numpy as np

from analysis import midi_to_hz
from grandorgue import ODF, Stop, read_stops, render_key, write_wav_cue
from paths import DATA_ROOT

HERE = os.path.dirname(os.path.abspath(__file__))
CATALOG_DIR = os.path.join(HERE, 'piotr_organs')
SAMPLES = os.path.join(DATA_ROOT, 'samples', 'piotr')
PREP = os.path.join(DATA_ROOT, 'samples', 'piotr-prep')

SOURCE = ('Analysed from the {name} sample set by Piotr Grabowski (free sample set, '
          'piotrgrabowski.pl)')

# organ slug → definition file and which manual is which division. Manual numbers are the
# GrandOrgue ones (0 = pedal).
ORGANS: dict[str, dict] = {
    'green-positiv': dict(odf='GreenPositiv.organ', divisions={1: 'great'}),
    'ledziny': dict(odf='Ledziny st Clement.organ', divisions={0: 'pedal', 1: 'great'}),
    'skrzatusz': dict(odf='Skrzatusz.organ', divisions={0: 'pedal', 1: 'great', 2: 'positive'},
                      names={'P Bassflote 8': "Bassflöte 8'", 'I Flute harmonique 8': "Flûte harmonique 8'"}),
    'azzio': dict(odf='Azzio.organ', divisions={0: 'pedal', 1: 'great', 2: 'positive'},
                  names={'GO  Sesquialtera 2 file (first rank only)': "Sesquialtera 2 2/3'",
                         'GO  Sesquialtera 2 file (both ranks)': 'Sesquialtera II'}),
    'melcer': dict(odf='Melcer Chamber Music Hall.organ', divisions={0: 'pedal', 1: 'great', 2: 'swell'},
                   names={"II Prinzpal 2'": "Prinzipal 2'"}),
    'szczecinek': dict(odf='Szczecinek.organ', divisions={0: 'pedal', 1: 'great', 2: 'swell'}),
    'lipiny': dict(odf='Lipiny.organ', divisions={0: 'pedal', 1: 'great', 2: 'positive'},
                   names={'II  Geigen Principal 8 Fuß': "Geigenprincipal 8'"}),
    'raszczyce': dict(odf='Raszczyce.organ', divisions={0: 'pedal', 1: 'positive', 2: 'great'}),
    'strassburg': dict(odf='Strassburg.organ', divisions={0: 'pedal', 1: 'great', 2: 'positive'}),
}

NOISE_RE = re.compile(r'noise|action|blower|ambient|motor|traktur|szum|dmuchaw|tremul|cymbelstern|'
                      r'zimbelstern|vogel|nightingale|rossignol|usignolo|glocken|tymp|campan|kalkant|coupler',
                      re.I)


# ── stop names, ids, families ──────────────────────────────────────────────────────────────
FRACTIONS = {'2 2/3': 24, '1 3/5': 40, '1 1/3': 48, '1 1/7': 56, '5 1/3': 12, '10 2/3': 6,
             '3 1/5': 20, '2/3': 96, '4/5': 80, '1/2': 128, '8/9': 72, '1 7/9': 36}


def clean_name(name: str, manual_name: str) -> str:
    """Stop knob name without the division prefix, footage written as N'."""
    n = name.strip()
    # division prefixes: "P  Subbaß", "M  Principal", "I Bordun", "II Gedact", "PED  Soubasse", "GO  …"
    n = re.sub(r"^(?:P|M|I{1,3}|IV|PED|Ped|GO|REC|POS|HW|SW|OW|BW|RP|RW|SO|SOL|GT|SR|CH|Pos|Man|Hw|Sw|Pd)\.?\s+(?=\S)", '', n)
    n = re.sub(r'^\d+\.\s*', '', n)
    n = re.sub(r'\s*(?:Fuß|Fuss|Fus|ft\.?|stóp)(?=\s|$)', "'", n, flags=re.I)
    n = re.sub(r'\s+st\.?$', '', n)
    n = re.sub(r"(\d)\s*'", r"\1'", n)
    n = re.sub(r"''+", "'", n)
    # a bare footage at the end ("Flûte 8", "Quinte 2 2/3") gets its foot mark
    if not n.endswith("'") and re.search(r'(?:^|\s)(\d+(?: \d/\d)?|\d/\d)$', n) and not re.search(r'(?:fach|f|rg|rangs?|x)$', n, re.I):
        n += "'"
    return re.sub(r'\s+', ' ', n).strip()


def slug(s: str) -> str:
    s = s.replace("'", '').replace('/', '-').replace('ß', 'ss').replace('ł', 'l').replace('Ł', 'L')
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    s = re.sub(r'[^A-Za-z0-9]+', '-', s).strip('-').lower()
    return re.sub(r'-+', '-', s)


MIXTURE_RE = re.compile(r'mixt|mikst|cymb|zimbel|scharf|sesquialt|cornet|kornet|plein|fournit|rausch|ripieno|'
                        r'progress|terzian|harmonia aeth|\b\d+\s*(?:fach|f|rg|rangs|x|chör|ch)\b|\b[IV]{2,}\b', re.I)
REED_RE = re.compile(r'tromp|trump|trąbk|trabk|posaun|puzon|fagot|basson|bassoon|oboe|hautbois|clairon|krumm|'
                     r'cromorn|vox hum|voix hum|regal|dulcian|schalm|chalum|tuba|bombard|clarinet|klarinet|'
                     r'englisch|cor angl|corno ingl|zink|krumhorn|cornett?o\b|trombon|basun|skalmej|ranket|sordun|'
                     r'harmonium|physharm|anches?\b|kromhoorn|fagot', re.I)
STRING_RE = re.compile(r'gamb|viol(?!-?princ)|fugara|salic|aeolin|eolin|celest|coelest|unda|dolce\b|cello|kontrab|contrab|'
                       r'geigen(?!princ|prinz)|vox ang|voce angel|bifra|piffaro|keraulo|harfen', re.I)
FLUTE_RE = re.compile(r'fl[oöôe]t|floet|flut|flaut|flet|gedac|gedak|bourdon|bordun|burdon|subbas|subbaß|rohr|hohl|'
                      r'nacht|koppel|spitz|wald|portun|jubal|trichter|quer|bassfl|untersatz|tibia|'
                      r'doppel|lieblich|still|zart|nasard|nazard|larigot|piccolo|pikolo|siffl|echobas|'
                      r'flageol|cor de nuit|bordon|soubasse|clarabel|melodia|fernfl|harmonique|kryty|otwart|quintat|quintad(?!ecima)|pijp|fluit|gedekt|gedeck', re.I)


FLUTE_FIRST_RE = re.compile(r'^(?:fl[oöôe]t|flaut|flet|gedac|gedak|bourdon|bordun)', re.I)


def family_of(name: str, harmonics: list[float]) -> str:
    n = name.lower()
    # several ranks per key, or a compound stop ("Quinte 2 2/3' Octave 2'")
    if MIXTURE_RE.search(n) or len(set(harmonics)) > 1 or len(re.findall(r"\d'", n)) > 1:
        return 'mixture'
    if REED_RE.search(n):
        return 'reed'
    hn = harmonics[0] if harmonics else 8.0
    octave = abs(math.log2(hn / 8.0) - round(math.log2(hn / 8.0))) < 1e-6
    if STRING_RE.search(n) and not FLUTE_FIRST_RE.search(n):
        return 'string'
    if not octave:
        return 'mutation'
    if FLUTE_RE.search(n):
        return 'flute'
    return 'principal'


# ── organ pitch ─────────────────────────────────────────────────────────────────────────────
def measure_pitch(stop: Stop, transpose: float) -> float:
    """Semitones between the organ's pitch and A = 440 Hz (median over middle pipes)."""
    devs = []
    for key in sorted(stop.keys)[len(stop.keys) // 4: 3 * len(stop.keys) // 4: 3]:
        y, sr, up = render_key(stop.keys[key])
        x = y[int(0.8 * sr):min(up, int(2.8 * sr))].mean(axis=1)
        if len(x) < sr // 2:
            continue
        nom = midi_to_hz(key + transpose)
        nfft = 1 << 20
        mag = np.abs(np.fft.rfft(x * np.blackman(len(x)), nfft))
        logm = np.log(mag + 1e-12)
        best, score = nom, -1e9
        for c in nom * 2 ** (np.arange(-250, 251) / 1200.0):   # ±250 cents, 1-cent steps
            s = 0.0
            for k in range(1, 6):
                i = int(round(k * c * nfft / sr))
                if i < len(logm) - 2:
                    s += logm[i - 2:i + 3].max()
            if s > score:
                best, score = c, s
        devs.append(12 * math.log2(best / nom))
    return float(np.median(devs)) if devs else 0.0


# ── swell boxes and tremulants ───────────────────────────────────────────────────────────
NOT_A_BOX = re.compile(r'audio ?group|noise|master|level|volume|ambient|blower', re.I)


def _windchests(odf: ODF, s: Stop) -> set[int]:
    return {odf.int(sec, 'WindchestGroup', 0) for sec in (s.ranks or [s.section])}


def enclosed(odf: ODF, s: Stop) -> bool:
    for wc in _windchests(odf, s):
        ws = f'windchestgroup{wc:03d}'
        for e in range(1, odf.int(ws, 'NumberOfEnclosures') + 1):
            name = odf.get(f"enclosure{odf.int(ws, f'enclosure{e:03d}'):03d}", 'Name', '')
            if not NOT_A_BOX.search(name):
                return True
    return False


def tremulant_ids(odf: ODF, s: Stop) -> set[int]:
    out = set()
    for wc in _windchests(odf, s):
        ws = f'windchestgroup{wc:03d}'
        for t in range(1, odf.int(ws, 'NumberOfTremulants') + 1):
            out.add(odf.int(ws, f'tremulant{t:03d}'))
    return out


def measure_tremulant(path: str, f0: float) -> dict:
    """Loudness swing (± dB, broadband), pitch swing (± cents, fundamental) and rate of a pipe
    recorded with the tremulant on."""
    import soundfile as sf
    from scipy import signal as sg
    x, sr = sf.read(path, dtype='float64', always_2d=True)
    x = x[int(1.0 * sr):int(6.0 * sr)]
    hop = sr // 200
    # broadband level, both channels (a single harmonic swings with the room's modes)
    w = max(int(2.5 * sr / f0), int(0.012 * sr))
    p = np.convolve((x ** 2).mean(axis=1), np.ones(w) / w, mode='same')[::hop]
    env = 10 * np.log10(p + 1e-20)
    sos = sg.butter(4, [f0 * 0.8, f0 * 1.25], 'bandpass', fs=sr, output='sos')
    a = sg.hilbert(sg.sosfiltfilt(sos, x.mean(axis=1)))
    inst = np.diff(np.unwrap(np.angle(a)))[::hop] * sr / (2 * np.pi)
    cents = 1200 * np.log2(np.maximum(inst, 1) / f0)
    sm = lambda v: np.convolve(v - np.median(v), np.ones(5) / 5, mode='same')[10:-10]
    env, cents = sm(env), sm(cents)
    spec = np.abs(np.fft.rfft(env * np.hanning(len(env)), 1 << 14))
    fr = np.fft.rfftfreq(1 << 14, 1 / 200)
    band = (fr > 2) & (fr < 9)
    rate = float(fr[band][np.argmax(spec[band])])
    swing = lambda v: float((np.percentile(v, 95) - np.percentile(v, 5)) / 2)
    return dict(depth=swing(env), pitch=swing(cents), rate=rate)


def tremulant_pipes(odf: ODF, s: Stop, keys=range(55, 80, 3)):
    """(recording, f0) of the pipes of a stop recorded with the tremulant on."""
    for key in keys:
        for pipe in s.keys.get(key, [])[:1]:
            for rs in (s.ranks or [s.section]):
                for i in range(1, odf.int(rs, 'NumberOfLogicalPipes', 0) + 1):
                    p = f'pipe{i:03d}'
                    if odf.get(rs, p) is None or os.path.basename(odf.file(odf.get(rs, p))) != os.path.basename(pipe.attack) \
                            or odf.file(odf.get(rs, p)) != pipe.attack:
                        continue
                    for a in range(1, odf.int(rs, p + 'AttackCount') + 1):
                        if (odf.get(rs, f'{p}attack{a:03d}istremulant', '') or '').strip() == '1':
                            yield odf.file(odf.get(rs, f'{p}attack{a:03d}')), midi_to_hz(pipe.midi)
                            break


def tremulants(odf: ODF, stops: list[tuple[Stop, dict]]) -> list[dict]:
    """Each tremulant with the division it shakes: synthetic ones from their settings, sampled
    ones (pipes recorded with the tremulant on) measured on the division's 8' and 4' flue pipes
    (median over the pipes)."""
    out = []
    for t in range(1, odf.int('organ', 'NumberOfTremulants') + 1):
        ts = f'tremulant{t:03d}'
        divs = [st['division'] for s, st in stops if t in tremulant_ids(odf, s)]
        if not divs:
            continue
        division = max(set(divs), key=divs.count)
        if any(o['division'] == division for o in out):
            continue
        if (odf.get(ts, 'TremulantType', 'Synth') or 'Synth').lower().startswith('wave'):
            meas = []
            for s, st in stops:
                if st['division'] == division and st['family'] in ('flute', 'principal', 'string') and st['transpose'] in (0, 12):
                    meas += [measure_tremulant(f, f0) for f, f0 in tremulant_pipes(odf, s)]
                if len(meas) >= 24:
                    break
            if meas:
                med = lambda k: float(np.median([m[k] for m in meas]))
                out.append(dict(division=division, depth=round(med('depth'), 2), pitch=round(med('pitch'), 1),
                                rate=round(med('rate'), 2), sampled=True, pipes=len(meas)))
        else:
            period = odf.float(ts, 'Period', 160.0)
            amp = odf.float(ts, 'AmpModDepth', 18.0)
            out.append(dict(division=division, depth=round(20 * math.log10(1 + amp / 100), 2),
                            pitch=round(0.6 * amp, 1), rate=round(1000.0 / period, 2), sampled=False))
    return out


# ── catalogue ───────────────────────────────────────────────────────────────────────────────
def load_odf(organ: str) -> ODF:
    return ODF(os.path.join(SAMPLES, organ, ORGANS[organ]['odf']))


def pipe_stops(odf: ODF) -> list[Stop]:
    out = []
    for s in read_stops(odf):
        files = {p.attack for ps in s.keys.values() for p in ps}
        if s.percussive or len(files) < 6 or NOISE_RE.search(s.name):
            continue
        out.append(s)
    return out


def stop_transpose(s: Stop, family: str) -> int:
    if family == 'mixture':
        return 0
    d = [p.midi - k for k, ps in s.keys.items() for p in ps]
    return int(round(float(np.median(d))))


def catalog(organ: str) -> dict:
    odf = load_odf(organ)
    divs = ORGANS[organ]['divisions']
    stops = []
    for s in pipe_stops(odf):
        if s.manual not in divs:
            continue
        name = ORGANS[organ].get('names', {}).get(s.name) or clean_name(s.name, s.manual_name)
        hns = sorted({p.harmonic for ps in s.keys.values() for p in ps})
        per_key = max(len(ps) for ps in s.keys.values())
        fam = family_of(name, hns if per_key > 1 else hns[:1])
        division = divs[s.manual]
        base = f'{division}-{slug(name)}'
        sid, n = base, 2
        while any(x['id'] == sid for x in stops):
            sid, n = f'{base}-{n}', n + 1
        stops.append(dict(id=sid, name=name, odfName=s.name, section=s.section, manual=s.manual,
                          division=division, family=fam, transpose=stop_transpose(s, fam),
                          keys=[min(s.keys), max(s.keys)], missing=[]))
    # swell boxes and tremulants
    byid = {(x.section, x.manual): x for x in pipe_stops(odf)}
    pairs = [(byid[(st['section'], st['manual'])], st) for st in stops]
    boxes = sorted({st['division'] for s, st in pairs if enclosed(odf, s)})
    trems = tremulants(odf, pairs)
    # pipe-less keys inside each manual's compass
    for st in stops:
        s = next(x for x in pipe_stops(odf) if x.section == st['section'] and x.manual == st['manual'])
        ms = f"manual{st['manual']:03d}"
        k0 = odf.int(ms, 'FirstAccessibleKeyMIDINoteNumber', 36)
        compass = range(k0, k0 + odf.int(ms, 'NumberOfAccessibleKeys', odf.int(ms, 'NumberOfLogicalKeys', 56)))
        st['missing'] = [k for k in compass if k not in s.keys]
    # pitch of the organ (an 8' principal of the main manual, else any 8')
    allst = {x.section: x for x in pipe_stops(odf)}
    ref = next((x for x in stops if x['family'] == 'principal' and x['transpose'] == 0 and x['division'] == 'great'),
               next((x for x in stops if x['transpose'] == 0 and x['family'] != 'mixture'), stops[0]))
    pitch = measure_pitch(allst[ref['section']], ref['transpose'])
    o = odf.sections['organ']
    return dict(id=organ, church=o.get('churchname', organ), address=o.get('churchaddress', ''),
                builder=o.get('organbuilder', ''), year=o.get('organbuilddate', ''),
                pitch=round(pitch, 3), reference=ref['id'], swellBoxes=boxes, tremulants=trems, stops=stops)


def catalog_path(organ: str) -> str:
    return os.path.join(CATALOG_DIR, f'{organ}.json')


def load_catalog(organ: str) -> dict:
    with open(catalog_path(organ)) as f:
        return json.load(f)


# ── models ──────────────────────────────────────────────────────────────────────────────────
def model_id(organ: str, stop_id: str) -> str:
    return f'organ/{organ}/{stop_id}'


def spec_for(cat: dict, st: dict) -> dict:
    """Analysis settings of one stop (those of the Bureå stops)."""
    mixture = st['family'] == 'mixture'
    shift = int(round(cat['pitch']))
    return dict(
        display=f"{cat['church']} — {st['name']}", family='organ', kind='sustained',
        source=SOURCE.format(name=cat['church']),
        files=[f"piotr-prep/{cat['id']}/{st['id']}/*.wav"], note_from_number=True,
        # nominal pitch of each recording: the key, the stop's footage and the organ's own pitch
        note_offset=st['transpose'] + cat['pitch'],
        octave_search=False, use_cue=True, max_loop_s=1.6, stereo=True,
        transient=True, transient_max_s=0.05,
        max_partials=512, locked=not mixture, free_partials=12 if mixture else 0,
        stop=dict(name=st['name'], footage_offset=st['transpose'] + shift, family=st['family'], organ=cat['id']),
        fixed_gain_from=model_id(cat['id'], cat['reference']),
        params=dict(releaseMode='natural', spread=0.35, reverb='church', reverbSend=0.06,
                    formant=0.0, minReleaseDbS=20.0, tuning='recorded'),
    )


def _with_silent_zones(write_model, notes: list[float]):
    """write_model that adds a silent zone at each of `notes` (keys without a pipe)."""
    def wm(path, header, zones):
        if notes and zones:
            extra = []
            for nt in notes:
                ref = min(zones, key=lambda z: abs(math.log2(z.f0) - math.log2(midi_to_hz(nt))))
                z = copy.copy(ref)
                z.f0 = midi_to_hz(nt)
                z.amps_db = np.full_like(ref.amps_db, -200.0)
                z.noise_db = np.full_like(ref.noise_db, -200.0)
                z.transient, z.transient_r = None, None
                z.meta = dict(ref.meta)
                z.source = f'silent-{nt:.0f}'
                extra.append(z)
            zones = sorted(zones + extra, key=lambda z: (z.meta['layer_index'], z.f0))
        return write_model(path, header, zones)
    return wm


def build_stop(cat: dict, st: dict, odf: ODF | None = None, keep: bool = False) -> str:
    import build
    odf = odf or load_odf(cat['id'])
    s = next(x for x in pipe_stops(odf) if x.section == st['section'] and x.manual == st['manual'])
    d = os.path.join(PREP, cat['id'], st['id'])
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    for key, pipes in sorted(s.keys.items()):
        y, sr, up = render_key(pipes)
        write_wav_cue(os.path.join(d, f'{key:03d}-.wav'), y, sr, up)
    spec = spec_for(cat, st)
    shift = int(round(cat['pitch']))
    silent = [k + st['transpose'] + shift + (cat['pitch'] - shift) for k in st['missing']]
    orig = build.write_model
    build.write_model = _with_silent_zones(orig, silent)
    try:
        path = build.build(model_id(cat['id'], st['id']), spec)
    finally:
        build.write_model = orig
    if not keep:
        shutil.rmtree(d, ignore_errors=True)
    return path


def build_organ(organ: str, only: list[str] | None = None, keep: bool = False):
    import time
    import build
    cat = load_catalog(organ)
    odf = load_odf(organ)
    order = sorted(cat['stops'], key=lambda s: s['id'] != cat['reference'])   # the gain reference first
    for st in order:
        if only and st['id'] not in only:
            continue
        out = os.path.join(build.OUT_DIR, model_id(organ, st['id']) + '.ssm')
        if not only and os.path.exists(out):
            continue
        t = time.time()
        try:
            build_stop(cat, st, odf, keep)
            print(f"OK {organ}/{st['id']} {time.time() - t:.0f}s", flush=True)
        except Exception as ex:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            print(f"FAIL {organ}/{st['id']}: {ex}", flush=True)


def ts_stops(organ: str) -> str:
    """The stop list of an organ as TypeScript (`StopDef[]` entries)."""
    cat = load_catalog(organ)
    shift = int(round(cat['pitch']))
    lines, div = [], None
    for st in cat['stops']:
        if div is not None and st['division'] != div:
            lines.append('')
        div = st['division']
        lines.append(f"  {{ id: '{st['id']}', model: 'organ/{organ}/{st['id']}', name: {json.dumps(st['name'], ensure_ascii=False)}, "
                     f"division: '{st['division']}', family: '{st['family']}', transpose: {st['transpose'] + shift} }},")
    return '\n'.join(lines)


def main():
    cmd, organ, *rest = sys.argv[1:]
    if cmd == 'survey':
        odf = load_odf(organ)
        for s in read_stops(odf):
            files = {p.attack for ps in s.keys.values() for p in ps}
            print(f'[{s.manual}] {s.manual_name[:16]:16s} {s.name[:34]:34s} → {clean_name(s.name, s.manual_name)!r:30s} '
                  f'keys={len(s.keys)} {min(s.keys)}-{max(s.keys)} files={len(files)} perc={s.percussive}')
    elif cmd == 'catalog':
        cat = catalog(organ)
        os.makedirs(CATALOG_DIR, exist_ok=True)
        with open(catalog_path(organ), 'w') as f:
            json.dump(cat, f, indent=1, ensure_ascii=False)
        print(f"{cat['church']}: {len(cat['stops'])} stops, pitch {cat['pitch']:+.2f} semitones from A440, "
              f"swell boxes {cat['swellBoxes']}, tremulants {cat['tremulants']}")
        for st in cat['stops']:
            print(f"  {st['id']:32s} {st['name']:30s} {st['family']:9s} {st['transpose']:+d} keys {st['keys']} missing {len(st['missing'])}")
    elif cmd == 'build':
        build_organ(organ, rest or None)
    elif cmd == 'prune':
        print(f'{prune(organ) / 1e9:.1f} GB freed')
    elif cmd == 'ts':
        print(ts_stops(organ))



def prune(organ: str) -> int:
    """Delete the sample set's recordings no stop of the catalogue plays (alternative attacks,
    tremulant recordings, noises), once the catalogue is written. Returns bytes freed."""
    cat = load_catalog(organ)
    odf = load_odf(organ)
    keep = set()
    wanted = {(st['section'], st['manual']) for st in cat['stops']}
    for s in pipe_stops(odf):
        if (s.section, s.manual) in wanted:
            for ps in s.keys.values():
                for p in ps:
                    keep.add(os.path.realpath(p.attack))
                    if p.release:
                        keep.add(os.path.realpath(p.release))
    freed = 0
    for root, _, files in os.walk(os.path.join(SAMPLES, organ)):
        for f in files:
            if f.lower().endswith(('.wav', '.wv')):
                path = os.path.realpath(os.path.join(root, f))
                if path not in keep:
                    freed += os.path.getsize(path)
                    os.remove(path)
    return freed


if __name__ == '__main__':
    main()
