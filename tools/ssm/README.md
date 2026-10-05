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
