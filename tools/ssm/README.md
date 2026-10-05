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

`npm run models` runs `python build_all.py` here: activate the virtual environment first
(`source tools/ssm/.venv/bin/activate`).

## Recordings

The recordings are not in the repository and nothing downloads them. Get the libraries below
and put them under `data/samples/` (`SUPERSYNTH_DATA_ROOT` replaces `data/`), as they unpack:

| Folder | Source |
| --- | --- |
| `VCSL/` | [Versilian Community Sample Library](https://github.com/sgossner/VCSL) (CC0) |
| `VSCO-2-CE/` | [VSCO 2 Community Edition](https://github.com/sgossner/VSCO-2-CE) (CC0) |
| `grandorgue/Burea_wav/` | Bureå Church organ GrandOrgue sample set by Lars Palo (CC BY-SA 2.5) |
| `piotr/<organ>/` | Piotr Grabowski's GrandOrgue sample sets ([piotrgrabowski.pl](https://piotrgrabowski.pl/instruments/)) |

`instruments.py` lists, for every model, the recordings it is analysed from. Rendering with the
engine (`engine.py`, the evaluation scripts) needs the Rust `ssrender` binary (`cargo build
--release` in `native/`).

## Scripts

| Script | |
| --- | --- |
| `build.py <id>` | analyse one model (ids as in `instruments.py`, e.g. `grand-piano`, `organ/great-principal-8`) |
| `build_all.py [--orchestra \| --organ \| id …]` | every model, continuing past failures (`npm run models`) |
| `piotr.py survey \| catalog \| build \| ts <organ>` | Piotr Grabowski's organs: read the organ definition, write `piotr_organs/<organ>.json`, analyse its stops, print the TypeScript stop list |
| `noises.py <organ>` | an organ's machinery noises (key and stop action, blower, church) |
| `evaluate.py <id> [--holdout]`, `eval_all.py` | render notes through `ssrender` and compare with the recordings; held out, the model never saw them |
| `blind.py make \| score` | blind A/B pairs of real and synthesised notes, and their scoring |

The others are helpers of these, or one-off experiments. `requirements.txt` covers building
models; `discriminate.py` also needs scikit-learn and `compare.py` (plots) matplotlib, not
pinned. What the evaluation scripts measure, and what they do not, is in
[docs/models.md](../../docs/models.md#evaluation): the repository holds no results from them.

## Where models go

A model's *name* (`grand-piano`, `organ/great-principal-8`, `organ/friesach/great-principal-8`) maps
to its committed file through `paths.model_path(name)`:

| name                     | file                                                     |
| ------------------------ | -------------------------------------------------------- |
| `organ/<stop>` (Bureå)   | `packages/organ-burea/models/organ/<stop>.ssm`           |
| `organ/<organ>/<stop>`   | `packages/organ-<organ>/models/organ/<organ>/<stop>.ssm` |
| anything else            | `models/<name>.ssm`                                      |

With an explicit output directory (`SSM_OUT_DIR`, or `build.py --out DIR`) models are written
flat to `<DIR>/<name>.ssm` instead — the layout the engine's `modelsDirectory` option reads, as
used by the `.ts` render helpers here.

## Experiment flags

`SSM_OVERRIDES` (JSON spec overrides), `SSM_ONLY` (regex: only matching recordings),
`SSM_NO_WEAK`, `SSM_MONO_NOISE` and `SSM_OLD_RELEASE` change what a model contains. With any of
them set, `build.py` refuses to write into the committed model locations unless it has an
output directory (`--out DIR` / `SSM_OUT_DIR`) or `--force` (`SSM_FORCE=1`); the model header
records the active flags under `build.flags`.

## Lost recordings

A recording whose analysis fails, or whose measured pitch is far from its nominal note, does
not become a zone. `build.py` prints every such recording with the reason and records them in
the header (`build.lost`). The build fails when

- a key in the *middle* of a layer's range is lost — every recorded key except the lowest and
  highest 10 % (at least one at each end) — and no other recording of that key and layer
  survives: the neighbouring zones would be pitch-shifted across the gap. Losing an edge key
  only narrows the range. Accept with `--allow-gaps` (`SSM_ALLOW_GAPS=1`);
- more than 8 % of all recordings are lost: `--max-failed 0.2` (`SSM_MAX_FAILED`) changes that.
