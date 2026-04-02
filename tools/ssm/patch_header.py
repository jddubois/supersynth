"""Patch .ssm header params in place (no re-analysis): python patch_header.py file.ssm key=json ..."""
import gzip
import json
import struct
import sys


def patch(path, updates: dict):
    raw = gzip.open(path, 'rb').read()
    n = struct.unpack('<I', raw[4:8])[0]
    h = json.loads(raw[8:8 + n])
    blob = raw[(8 + n + 3) & ~3:]
    h.setdefault('params', {}).update(updates)
    hj = json.dumps(h, separators=(',', ':')).encode()
    out = bytearray(b'SSM1' + struct.pack('<I', len(hj)) + hj)
    while len(out) % 4:
        out.append(0)
    out.extend(blob)
    with gzip.open(path, 'wb', compresslevel=9) as f:
        f.write(bytes(out))
    return h


if __name__ == '__main__':
    upd = {}
    for kv in sys.argv[2:]:
        k, v = kv.split('=', 1)
        upd[k] = json.loads(v)
    patch(sys.argv[1], upd)
