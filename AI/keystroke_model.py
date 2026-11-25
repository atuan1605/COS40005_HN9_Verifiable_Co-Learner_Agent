"""Portable offline classifier for the synthetic editor window task."""

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

import numpy as np
from scipy.special import expit
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from keystroke_data import FEATURE_NAMES, SEED


MODEL_PATH = Path(__file__).resolve().parent / "models" / "keystroke-activity-model.npz"
MODEL_FORMAT = 1
PREDICTION_THRESHOLD = 0.5


def build_model() -> Pipeline:
    return Pipeline([
        ("scaler", StandardScaler()),
        ("classifier", LogisticRegression(solver="liblinear", random_state=SEED)),
    ])


def export_model(
    model: Pipeline, path: Path = MODEL_PATH, *, threshold: float = PREDICTION_THRESHOLD
) -> None:
    scaler = model.named_steps["scaler"]
    classifier = model.named_steps["classifier"]
    if not np.array_equal(classifier.classes_, [0, 1]):
        raise ValueError("Expected a fitted binary classifier with classes 0 and 1.")
    np.savez_compressed(
        path,
        format_version=MODEL_FORMAT,
        mean=scaler.mean_,
        scale=scaler.scale_,
        coefficients=classifier.coef_[0],
        intercept=classifier.intercept_[0],
        threshold=threshold,
    )


@dataclass(frozen=True)
class WindowModel:
    mean: np.ndarray
    scale: np.ndarray
    coefficients: np.ndarray
    intercept: float
    threshold: float

    def score(self, features: np.ndarray) -> np.ndarray:
        if features.ndim != 2 or features.shape[1] != len(FEATURE_NAMES):
            raise ValueError("Expected one row per window in FEATURE_NAMES order.")
        normalized = (features - self.mean) / self.scale
        return expit(normalized @ self.coefficients + self.intercept)


def load_window_model(source: Path | BytesIO) -> WindowModel:
    with np.load(source, allow_pickle=False) as archive:
        shapes = {
            "mean": (len(FEATURE_NAMES),),
            "scale": (len(FEATURE_NAMES),),
            "coefficients": (len(FEATURE_NAMES),),
            "intercept": (),
            "threshold": (),
        }
        if set(archive.files) != shapes.keys() | {"format_version"}:
            raise ValueError("Unexpected editor model fields.")
        version = archive["format_version"]
        if version.shape != () or version.dtype.kind not in "iu" or version.item() != MODEL_FORMAT:
            raise ValueError("Unsupported model artifact format.")
        parameters = {}
        for key, shape in shapes.items():
            value = archive[key]
            if value.shape != shape or value.dtype.kind not in "fiu" or not np.isfinite(value).all():
                raise ValueError(f"Invalid editor model parameter: {key}.")
            value.setflags(write=False)
            parameters[key] = value if shape else float(value.item())
    if (parameters["scale"] <= 0).any() or not 0 <= parameters["threshold"] <= 1:
        raise ValueError("Invalid editor model scale or threshold.")
    return WindowModel(**parameters)


def score_windows(
    features: np.ndarray, path: Path = MODEL_PATH
) -> tuple[np.ndarray, float]:
    model = load_window_model(path)
    return model.score(features), model.threshold
