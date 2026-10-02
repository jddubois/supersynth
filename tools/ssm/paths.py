"""Where the (large, git-ignored) recordings and evaluation outputs live.

Set SUPERSYNTH_DATA_ROOT to override; defaults to <repo>/data.
"""
import os

DATA_ROOT = os.environ.get('SUPERSYNTH_DATA_ROOT',
                           os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'data')))
