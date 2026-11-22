from math import isfinite

import numpy as np
from sklearn.metrics import average_precision_score, confusion_matrix


PARITY_RTOL = 1e-8
PARITY_ATOL = 1e-10


def binary_metrics(truth: np.ndarray, scores: np.ndarray, predicted: np.ndarray) -> dict:
    tn, fp, fn, tp = map(int, confusion_matrix(truth, predicted, labels=[0, 1]).ravel())
    counts = {"tp": tp, "fp": fp, "tn": tn, "fn": fn}
    return {
        "averagePrecision": float(average_precision_score(truth, scores)),
        **classification_metrics(counts),
        "counts": counts,
    }


def classification_metrics(counts: dict) -> dict:
    tp, fp, fn = (counts[key] for key in ("tp", "fp", "fn"))
    return {
        "precision": tp / (tp + fp) if tp + fp else 0.0,
        "recall": tp / (tp + fn) if tp + fn else 0.0,
        "f1": 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else 0.0,
    }


def verify_parity(
    reference: np.ndarray,
    served: np.ndarray,
    fitted_threshold: float,
    artifact_threshold: float,
) -> dict:
    if (
        reference.ndim != 1
        or not reference.size
        or reference.shape != served.shape
        or not np.isfinite(reference).all()
        or not np.isfinite(served).all()
    ):
        raise ValueError("Invalid score vectors for artifact parity.")
    maximum_difference = float(np.max(np.abs(reference - served)))
    threshold_difference = abs(fitted_threshold - artifact_threshold)
    if not (
        isfinite(threshold_difference)
        and np.allclose(served, reference, rtol=PARITY_RTOL, atol=PARITY_ATOL)
        and np.isclose(artifact_threshold, fitted_threshold, rtol=PARITY_RTOL, atol=PARITY_ATOL)
        and np.array_equal(served >= artifact_threshold, reference >= fitted_threshold)
    ):
        raise ValueError(
            f"The served artifact differs from the fitted pipeline (max score difference {maximum_difference:.6g}, "
            f"threshold difference {threshold_difference:.6g}, or different labels)."
        )
    return {
        "holdoutCount": int(reference.size),
        "maximumAbsoluteScoreDifference": maximum_difference,
        "absoluteThresholdDifference": threshold_difference,
        "absoluteTolerance": PARITY_ATOL,
        "relativeTolerance": PARITY_RTOL,
        "labelsMatch": True,
    }
