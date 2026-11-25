"""Synthetic editor activity in five-second bins. No input is captured."""

from dataclasses import dataclass
from itertools import groupby

import numpy as np


SEED = 42
WINDOW_BINS = 24
BIN_SECONDS = 5
FEATURE_NAMES = (
    "edit_events",
    "active_edit_bins",
    "longest_edit_pause_seconds",
    "correction_fraction",
    "paste_events",
)

# Coverage controls the fraction of bins with a burst. Rate is a
# scenario multiplier on a profile's typical edits per active bin.
SCENARIOS = {
    "sustained_editing": (1, (4, 2), (0.60, 1.25), 0.25),
    "brief_editing": (1, (2, 6), (0.35, 1.00), 0.18),
    "reading_or_review": (0, (1.2, 12), (0.25, 0.80), 0.08),
    "idle": (0, (0.6, 35), (0.10, 0.35), 0.02),
    "paste_with_few_edits": (0, (1.5, 9), (0.35, 0.90), 1.00),
}


@dataclass(frozen=True)
class Window:
    profile: int
    scenario: str
    target: int
    counts: np.ndarray


def simulate_windows(
    profiles: int = 120, windows_per_scenario: int = 6, seed: int = SEED
) -> list[Window]:
    rng = np.random.default_rng(seed)
    windows = []
    for profile in range(profiles):
        edit_rate = rng.lognormal(mean=1.4, sigma=0.60)
        correction_rate = rng.beta(2, 12)
        for scenario, (target, coverage, rate, paste_probability) in SCENARIOS.items():
            for _ in range(windows_per_scenario):
                active = rng.random(WINDOW_BINS) < rng.beta(*coverage)
                burst_rate = edit_rate * rng.uniform(*rate)
                edits = rng.poisson(burst_rate, WINDOW_BINS) * active
                corrections = rng.binomial(edits, correction_rate)
                pastes = np.zeros(WINDOW_BINS, dtype=int)
                if rng.random() < paste_probability:
                    pastes[rng.integers(WINDOW_BINS)] = 1
                windows.append(Window(
                    profile, scenario, target, np.column_stack((edits, corrections, pastes))
                ))
    return windows


def window_features(counts: np.ndarray) -> np.ndarray:
    """Summarize edit, correction and paste counts for one synthetic window."""
    if counts.shape != (WINDOW_BINS, 3) or not np.issubdtype(counts.dtype, np.integer):
        raise ValueError("Expected a two-minute window with integer counts in three columns.")
    edits, corrections, pastes = counts.T
    if np.any(counts < 0) or np.any(corrections > edits):
        raise ValueError("Counts must be nonnegative, with corrections included in edits.")

    active = edits > 0
    longest_pause = max(
        (sum(1 for _ in run) for is_active, run in groupby(active) if not is_active),
        default=0,
    )
    total_edits = int(edits.sum())
    return np.array([
        total_edits,
        int(active.sum()),
        longest_pause * BIN_SECONDS,
        corrections.sum() / max(total_edits, 1),
        int(pastes.sum()),
    ], dtype=float)
