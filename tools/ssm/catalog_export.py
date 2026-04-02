"""Instrument catalog from the TypeScript sources (single source of truth)."""
import json
import os
import subprocess

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def catalog():
    out = subprocess.run(['node', '--import', 'tsx', 'scripts/export-catalog.ts'], cwd=REPO, check=True,
                         capture_output=True, text=True).stdout
    return json.loads(out)
