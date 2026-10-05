# tools/ssm: the analysis pipeline

These scripts turn instrument recordings into `.ssm` spectral models. The recordings live
under `data/`, which is git-ignored; set `SUPERSYNTH_DATA_ROOT` to use another location.

## Setup

Use the pinned versions. STFT/Welch defaults, resampling filters and numba's compiled kernels
change between releases, and the models change with them.

```sh
python3.12 -m venv tools/ssm/.venv
tools/ssm/.venv/bin/pip install -r tools/ssm/requirements.txt
cd tools/ssm && .venv/bin/python build.py <instrument-id>
```

`npm run models` runs `python build_all.py` here: activate the virtual environment first
(`source tools/ssm/.venv/bin/activate`).

## Recordings

The recordings aren't in the repository, and nothing downloads them for you. Get the libraries
below and unpack them under `data/samples/` (or under `$SUPERSYNTH_DATA_ROOT/samples/`):

| Folder | Source |
| --- | --- |
| `VCSL/` | [Versilian Community Sample Library](https://github.com/sgossner/VCSL) (CC0) |
| `VSCO-2-CE/` | [VSCO 2 Community Edition](https://github.com/sgossner/VSCO-2-CE) (CC0) |
| `grandorgue/Burea_wav/` | Bureå Church organ GrandOrgue sample set by Lars Palo (CC BY-SA 2.5) |
| `piotr/<organ>/` | Piotr Grabowski's GrandOrgue sample sets ([piotrgrabowski.pl](https://piotrgrabowski.pl/instruments/)) |

`instruments.py` lists the recordings each model is analysed from. Anything that renders through
the engine (`engine.py` and the evaluation scripts) needs the Rust `ssrender` binary; build it
with `cargo build --release` in `native/`.

## Scripts

| Script | |
| --- | --- |
| `build.py <id>` | analyse one model (ids as in `instruments.py`, e.g. `grand-piano`, `organ/great-principal-8`) |
| `build_all.py [--orchestra \| --organ \| id …]` | every model, continuing past failures (`npm run models`) |
| `piotr.py survey \| catalog \| build \| ts <organ>` | Piotr Grabowski's organs: read the organ definition, write `piotr_organs/<organ>.json`, analyse its stops, print the TypeScript stop list |
| `noises.py <organ>` | an organ's machinery noises (key and stop action, blower, church) |
| `evaluate.py <id> [--holdout]`, `eval_all.py` | render notes through `ssrender` and compare them with the recordings; with `--holdout`, on notes left out of the model |
| `blind.py make \| score` | blind A/B pairs of real and synthesised notes, and their scoring |

The other scripts are helpers for these, or one-off experiments. `requirements.txt` covers
building models. `discriminate.py` also needs scikit-learn, and `compare.py` needs matplotlib for
its plots; neither is pinned. [docs/models.md](../../docs/models.md#evaluation) explains what the
evaluation scripts measure and what they don't. None of their results are in the repository.

## Where models go

A model's *name* (`grand-piano`, `organ/great-principal-8`, `organ/friesach/great-principal-8`) maps
to its committed file through `paths.model_path(name)`:

| name                     | file                                                     |
| ------------------------ | -------------------------------------------------------- |
| `organ/<stop>` (Bureå)   | `packages/organ-burea/models/organ/<stop>.ssm`           |
| `organ/<organ>/<stop>`   | `packages/organ-<organ>/models/organ/<organ>/<stop>.ssm` |
| anything else            | `packages/instruments/models/<name>.ssm`                 |

With an explicit output directory (`SSM_OUT_DIR`, or `build.py --out DIR`), models are written
flat to `<DIR>/<name>.ssm` instead. That's the layout the engine's `modelsDirectory` option
expects, and the `.ts` render helpers here use it.

## Experiment flags

`SSM_OVERRIDES` (JSON spec overrides), `SSM_ONLY` (regex: only matching recordings),
`SSM_NO_WEAK`, `SSM_MONO_NOISE` and `SSM_OLD_RELEASE` change what a model contains. If any of
them is set, `build.py` won't write to the committed model locations unless you give it an
output directory (`--out DIR` / `SSM_OUT_DIR`) or `--force` (`SSM_FORCE=1`). The model header
records the flags that were active under `build.flags`.

## Lost recordings

If a recording's analysis fails, or its measured pitch is far from the note it's supposed to
be, it doesn't become a zone. `build.py` prints each of these recordings with the reason and
lists them in the header (`build.lost`). The build fails if:

- a key in the middle of a layer's range is lost and no other recording of that key and layer
  survives, because the neighbouring zones would then be pitch-shifted across the gap. "Middle"
  means every recorded key except the lowest and highest 10 %, with at least one key at each end.
  Losing a key at the edge just narrows the range. Use `--allow-gaps` (`SSM_ALLOW_GAPS=1`) to
  accept a gap.
- more than 8 % of all recordings are lost. `--max-failed 0.2` (`SSM_MAX_FAILED`) changes the
  limit.
