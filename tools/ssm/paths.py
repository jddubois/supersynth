"""Where the (large, git-ignored) recordings and evaluation outputs live, and where each
committed model is stored.

Set SUPERSYNTH_DATA_ROOT to override the data root; defaults to <repo>/data.
"""
from __future__ import annotations

import glob
import os

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
DATA_ROOT = os.environ.get('SUPERSYNTH_DATA_ROOT', os.path.join(REPO, 'data'))

# models live in npm workspace packages: organs in their own, everything else in instruments
PACKAGES_DIR = os.path.join(REPO, 'packages')
INSTRUMENTS_PACKAGE = 'instruments'
MODELS_DIR = os.path.join(PACKAGES_DIR, INSTRUMENTS_PACKAGE, 'models')
LEGACY_MODELS_DIR = os.path.join(REPO, 'models')
BUREA_PACKAGE = 'organ-burea'


def model_package(name: str) -> str | None:
    """The workspace package (directory name under packages/) holding the organ model
    `name`, or None for a core instrument model (packages/instruments/models/).

      organ/<stop>            → organ-burea         (the Bureå organ)
      organ/<organ>/<stop>    → organ-<organ>       (Piotr Grabowski's organs)
    """
    parts = name.split('/')
    if parts[0] != 'organ' or len(parts) < 2:
        return None
    return BUREA_PACKAGE if len(parts) == 2 else f'organ-{parts[1]}'


def model_path(name: str, out_dir: str | None = None) -> str:
    """The .ssm file of model `name` (e.g. 'piano', 'organ/great-principal-8',
    'organ/friesach/great-principal-8').

    With `out_dir` (a scratch build, SSM_OUT_DIR): <out_dir>/<name>.ssm, the flat layout a
    `modelsDirectory` override of the engine reads. Without it: the package location —
    packages/<package>/models/<name>.ssm for organs, packages/instruments/models/<name>.ssm for
    everything else.
    """
    if out_dir:
        return os.path.join(out_dir, f'{name}.ssm')
    pkg = model_package(name)
    root = MODELS_DIR if pkg is None else os.path.join(PACKAGES_DIR, pkg, 'models')
    return os.path.join(root, f'{name}.ssm')


def existing_model_path(name: str, out_dir: str | None = None) -> str:
    """model_path for reading: falls back to the pre-package location (models/<name>.ssm) while
    a checkout still has models there. Returns model_path when neither exists."""
    p = model_path(name, out_dir)
    if not out_dir and not os.path.exists(p):
        legacy = os.path.join(LEGACY_MODELS_DIR, f'{name}.ssm')
        if os.path.exists(legacy):
            return legacy
    return p


def committed_models() -> list[str]:
    """Every .ssm file of the workspace packages."""
    files = glob.glob(os.path.join(PACKAGES_DIR, '*', 'models', '**', '*.ssm'), recursive=True)
    return sorted(set(files))


def is_committed_location(path: str) -> bool:
    """Whether `path` lies in a directory that holds committed models."""
    p = os.path.realpath(path)
    roots = [os.path.realpath(d) for d in glob.glob(os.path.join(PACKAGES_DIR, '*', 'models'))]
    roots.append(os.path.realpath(PACKAGES_DIR))
    return any(p == r or p.startswith(r + os.sep) for r in roots)
