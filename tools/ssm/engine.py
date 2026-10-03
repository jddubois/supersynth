"""The Rust engine from Python: offline renders with `ssrender`, and model headers."""
from __future__ import annotations

import gzip
import json
import os
import struct
import subprocess
import tempfile

import numpy as np
import soundfile as sf

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SSRENDER = os.environ.get('SSRENDER', os.path.join(REPO, 'native', 'target', 'release', 'ssrender'))


def read_header(path: str) -> dict:
    """The JSON header of a .ssm model."""
    with gzip.open(path, 'rb') as f:
        raw = f.read()
    assert raw[:4] == b'SSM1'
    n = struct.unpack('<I', raw[4:8])[0]
    return json.loads(raw[8:8 + n])


def ssrender(model_path: str, events: list[str], sr: int | None = None, tail: float = 2.0, sets=(),
             reverb: str = 'off', mono: bool = False) -> tuple[np.ndarray, int]:
    """Render `note:velocity:start:duration` events through the engine.

    Returns (samples, sample rate): 1-D when `mono`, else (n, channels)."""
    fd, out = tempfile.mkstemp(suffix='.wav')
    os.close(fd)
    cmd = [SSRENDER, model_path, out]
    if sr is not None:
        cmd += ['--sr', str(sr)]
    cmd += ['--tail', str(tail)]
    if mono:
        cmd.append('--mono')
    cmd += ['--reverb', reverb]
    for s in sets:
        cmd += ['--set', s]
    cmd += events
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        y, rate = sf.read(out, dtype='float64', always_2d=not mono)
    finally:
        os.remove(out)
    return y, rate
