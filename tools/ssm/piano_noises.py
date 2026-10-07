"""A piano's sustain-pedal noise from its recordings: the dampers lifting off the strings (pedal
pressed) and landing on them (pedal released), two takes of each, as a noise model for a layer
with `trigger: 'pedal'`. Its zones sit on the keys the engine plays them from (PEDAL_DOWN_KEY and
PEDAL_UP_KEY in native/core/src/engine, each take on the key after the first). Levels are the
piano's own, like its release noise.

  python piano_noises.py [model ...]
"""
from __future__ import annotations

import json
import os
import sys

import soundfile as sf

import build
from analysis import NOISE_EDGES, make_time_grid
from instruments import CCBY_SALAMANDER, SALAMANDER
from noises import _header, noise_zone
from paths import DATA_ROOT, model_path

PEDAL_DOWN_KEY, PEDAL_UP_KEY = 60, 72
VELOCITY = 100.0        # the engine's PEDAL_VELOCITY: the zones play at their recorded level

PEDALS = {
    'grand-piano-salamander-pedal': dict(
        parent='grand-piano-salamander', display='Concert Grand Piano (Yamaha C5) — pedal noise', source=CCBY_SALAMANDER,
        # key: (recording, level dB): normalised recordings, played as the sample set's SFZ plays them
        files={PEDAL_DOWN_KEY: (f'{SALAMANDER}/pedalD1.wav', -20.0), PEDAL_DOWN_KEY + 1: (f'{SALAMANDER}/pedalD2.wav', -20.0),
               PEDAL_UP_KEY: (f'{SALAMANDER}/pedalU1.wav', -19.0), PEDAL_UP_KEY + 1: (f'{SALAMANDER}/pedalU2.wav', -19.0)},
    ),
}


def build_pedal(model: str) -> str:
    spec = PEDALS[model]
    zones = []
    for key, (rel, level_db) in spec['files'].items():
        x, sr = sf.read(os.path.join(DATA_ROOT, 'samples', rel), always_2d=True)
        x = x * 10 ** (level_db / 20)
        if x.shape[1] == 1:
            x = x.repeat(2, axis=1)
        z = noise_zone(x[:, :2], sr, key, source=os.path.basename(rel))
        if z is None:
            raise RuntimeError(f'{model}: {rel} is silent')
        zones.append(z)
    zones.sort(key=lambda z: z.f0)
    ref = build.gain_reference(model, spec['parent'], build.OUT_DIR)
    if ref is None:
        raise RuntimeError(f"{model}: build {spec['parent']} first")
    gain = json.loads(_header(ref))['params']['gainDb']
    end = max(float(z.times[-1]) for z in zones) + 0.01
    header = {
        'format': 1, 'name': model, 'displayName': spec['display'], 'family': 'keyboard', 'kind': 'decaying',
        'source': spec['source'],
        'grid': [round(float(t), 5) for t in make_time_grid(end)],
        'noiseEdges': [float(e) for e in NOISE_EDGES],
        'layers': [{'name': 'main', 'velocity': VELOCITY}],
        'params': {'gainDb': gain, 'releaseMode': 'ringout', 'pitchMorph': False, 'spread': 0.0, 'formant': 0.0,
                   'tuning': 'recorded'},
        'build': {'flags': build.experiment_flags(), 'lost': []},
    }
    path = model_path(model, build.OUT_DIR)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    build.write_model(path, header, zones)
    print(f'  wrote {path} ({os.path.getsize(path) / 1024:.0f} KB, {len(zones)} zones)', flush=True)
    return path


def main():
    for model in sys.argv[1:] or list(PEDALS):
        build_pedal(model)


if __name__ == '__main__':
    main()
