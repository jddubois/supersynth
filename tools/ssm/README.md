# tools/ssm — the analysis pipeline

Turns instrument recordings (under `data/`, git-ignored; `SUPERSYNTH_DATA_ROOT` overrides) into
`.ssm` spectral models.

## Setup

Use the pinned versions: STFT/Welch defaults, resampling filters and numba's compiled kernels
change between releases, and with them the models.

```sh
python3.12 -m venv tools/ssm/.venv
tools/ssm/.venv/bin/pip install -r tools/ssm/requirements.txt
cd tools/ssm && .venv/bin/python build.py <instrument-id>
```

## Where models go

A model's *name* (`piano`, `organ/great-principal-8`, `organ/friesach/great-principal-8`) maps
to its committed file through `paths.model_path(name)`:

| name                     | file                                                     |
| ------------------------ | -------------------------------------------------------- |
| `organ/<stop>` (Bureå)   | `packages/organ-burea/models/organ/<stop>.ssm`           |
| `organ/<organ>/<stop>`   | `packages/organ-<organ>/models/organ/<organ>/<stop>.ssm` |
| anything else            | `models/<name>.ssm`                                      |

With an explicit output directory (`SSM_OUT_DIR`, or `build.py --out DIR`) models are written
flat to `<DIR>/<name>.ssm` instead — the layout the engine's `modelsDirectory` option reads, as
used by the `.ts` render helpers here.
