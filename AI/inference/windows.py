from dataclasses import dataclass
from math import ceil

import numpy as np

from keystroke_data import BIN_SECONDS, WINDOW_BINS, window_features


WINDOW_FEATURE_VERSION = "editor-window-v1"
WINDOW_SECONDS = BIN_SECONDS * WINDOW_BINS
MAX_BIN_COUNT = 10_000


@dataclass(frozen=True)
class EditorWindow:
    bins: list[list[int]]
    observed_seconds: float
    source: str

    @property
    def complete(self) -> bool:
        return self.observed_seconds == WINDOW_SECONDS

    def features(self) -> np.ndarray:
        return window_features(np.asarray(self.bins, dtype=int)).reshape(1, -1)


def read_editor_window(data: dict) -> EditorWindow:
    source = data.get("source")
    if source not in ("live", "sample"):
        raise ValueError("Choose live or sample as the observation source.")
    window = data.get("window")
    if not isinstance(window, dict) or set(window) != {"featureVersion", "binSeconds", "observedSeconds", "bins"}:
        raise ValueError("Send the feature version, bin duration, observation time and bins.")
    if window["featureVersion"] != WINDOW_FEATURE_VERSION:
        raise ValueError("Use editor-window-v1 features.")
    if type(window["binSeconds"]) is not int or window["binSeconds"] != BIN_SECONDS:
        raise ValueError("Use five-second bins.")
    duration = window["observedSeconds"]
    if type(duration) not in (int, float) or not 0 <= duration <= WINDOW_SECONDS:
        raise ValueError("Observation time must be between 0 and 120 seconds.")
    bins = window["bins"]
    if not isinstance(bins, list) or len(bins) != ceil(duration / BIN_SECONDS):
        raise ValueError("Provide one bin for each observed five-second interval, up to 24 bins.")
    for counts in bins:
        if not isinstance(counts, list) or len(counts) != 3:
            raise ValueError("Each bin needs edit, correction and paste counts.")
        if any(type(count) is not int or not 0 <= count <= MAX_BIN_COUNT for count in counts):
            raise ValueError("Counts must be integers from 0 to 10,000.")
        if counts[1] > counts[0]:
            raise ValueError("Corrections cannot exceed edit events.")
    return EditorWindow(bins, duration, source)
