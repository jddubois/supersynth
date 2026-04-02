"""Build every instrument model, continuing past failures.

  python build_all.py [--orchestra | --organ | id ...]
"""
import sys
import time
import traceback

from build import build
from instruments import INSTRUMENTS


def main():
    ids = sys.argv[1:] or list(INSTRUMENTS)
    if ids == ['--orchestra']:
        ids = [i for i in INSTRUMENTS if not i.startswith('organ/')]
    elif ids == ['--organ']:
        ids = [i for i in INSTRUMENTS if i.startswith('organ/')]
    for i in ids:
        t = time.time()
        try:
            build(i, INSTRUMENTS[i])
            print(f'OK {i} {time.time() - t:.0f}s', flush=True)
        except Exception as ex:  # noqa: BLE001
            print(f'FAIL {i}: {ex}', flush=True)
            traceback.print_exc()


if __name__ == '__main__':
    main()
