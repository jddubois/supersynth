"""Held-out evaluation of every orchestral instrument (plus sampler baseline)."""
import json
import os
import sys

from evaluate import evaluate, OUT
from instruments import INSTRUMENTS


def main():
    ids = sys.argv[1:] or [i for i in INSTRUMENTS if not i.startswith('organ/')]
    summary = {}
    for i in ids:
        try:
            s = evaluate(i, holdout=True, plots=2, max_tests=8)
            summary[i] = s
        except Exception as ex:  # noqa: BLE001
            print(f'FAIL {i}: {ex}', flush=True)
            summary[i] = {'error': str(ex)}
        with open(os.path.join(OUT, 'holdout_summary.json'), 'w') as f:
            json.dump(summary, f, indent=1)


if __name__ == '__main__':
    main()
