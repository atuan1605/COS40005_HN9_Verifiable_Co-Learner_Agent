from hashlib import sha256
from pathlib import Path

import numpy as np
from sklearn.metrics import average_precision_score
from sklearn.model_selection import GroupKFold, GroupShuffleSplit, StratifiedKFold, cross_val_predict, train_test_split

from benchmark import ARCHIVE_SHA256, DATA_URL, REVISION, load_benchmark
from classroom_probes import CLASSROOM_CASES
from cs1_submission_data import (
    HORIZON_SECONDS, RANGE_BYTES, RANGE_STARTS, SAMPLE_SHA256, SOURCE_BYTES,
    WINDOW_SECONDS, fetch_source, load_windows,
)
from inference.artifacts import (
    ACTIVITY_MANIFEST_PATH, AI_ROOT, FORECAST_MANIFEST_PATH, MANIFEST_PATH,
    load_activity_artifact, load_forecast_artifact, load_prompt_artifact,
)
from keystroke_data import FEATURE_NAMES, SEED, simulate_windows, window_features
from keystroke_model import PREDICTION_THRESHOLD, build_model as build_window_model
from prompt_model import SEED as PROMPT_SEED, build_model as build_prompt_model

from .metrics import assert_disjoint_groups, binary_metrics, select_threshold, verify_parity


def partition(labels: np.ndarray, groups: np.ndarray | None = None) -> dict:
    counts = {"rows": len(labels), "positive": int(labels.sum())}
    if groups is not None:
        counts["groups"] = len(set(groups))
    return counts


def grouped_split(x: np.ndarray, y: np.ndarray, groups: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    split = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=SEED)
    development, holdout = next(split.split(x, y, groups))
    assert_disjoint_groups(groups[development], groups[holdout])
    return development, holdout


def trained_result(
    metadata: dict, truth: np.ndarray, reference: np.ndarray, served: np.ndarray,
    fitted_threshold: float, artifact_threshold: float,
) -> dict:
    return {
        "task": metadata["task"],
        "model": {
            key: metadata[key] for key in (
                "modelVersion", "featureVersion", "artifact", "sha256", "meaning", "positiveLabel", "evaluationStatus",
            )
        },
        "threshold": artifact_threshold,
        "metrics": binary_metrics(truth, served, served >= artifact_threshold),
        "parity": verify_parity(reference, served, fitted_threshold, artifact_threshold),
    }


def evaluate_prompt(model_dir: Path = AI_ROOT) -> dict:
    metadata, artifact = load_prompt_artifact(model_dir, MANIFEST_PATH)
    if artifact is None:
        raise ValueError("The prompt model export is missing or fails its manifest checks.")
    prompts, labels, counts = load_benchmark()
    y = np.asarray(labels)
    development, holdout = train_test_split(
        np.arange(len(y)), test_size=0.2, stratify=y, random_state=PROMPT_SEED,
    )
    development_prompts = [prompts[i] for i in development]
    holdout_prompts = [prompts[i] for i in holdout]
    folds = StratifiedKFold(n_splits=5, shuffle=True, random_state=PROMPT_SEED)
    scores = cross_val_predict(
        build_prompt_model(), development_prompts, y[development], cv=folds, method="predict_proba",
    )[:, 1]
    threshold = select_threshold(y[development], scores, beta=2)
    reference = build_prompt_model().fit(development_prompts, y[development])
    truth = y[holdout]
    probes = {
        name: {"flagged": int((artifact.score(texts) >= artifact.threshold).sum()), "total": len(texts)}
        for name, texts in CLASSROOM_CASES.items()
    }
    return {
        **trained_result(
            metadata, truth, reference.predict_proba(holdout_prompts)[:, 1], artifact.score(holdout_prompts),
            threshold, artifact.threshold,
        ),
        "title": "English prompt content",
        "dataset": {
            "name": metadata["evaluation"]["dataset"],
            "source": DATA_URL,
            "revision": REVISION,
            "checksum": {"scope": "compressed source archive", "sha256": ARCHIVE_SHA256},
            "unit": "Unique English prompt with a known historical SH label",
            "counts": counts,
        },
        "split": {
            "seed": PROMPT_SEED,
            "policy": "Stratified 80/20 split after normalized deduplication.",
            "development": partition(y[development]),
            "holdout": partition(truth),
        },
        "thresholdSelection": "Maximum F2 on five-fold stratified out-of-fold development scores. TF-IDF is fitted within each fold.",
        "baselines": [{
            "name": "Constant score, always predict other content",
            "metrics": binary_metrics(truth, np.zeros_like(truth), np.zeros_like(truth)),
        }],
        "classroomProbes": probes,
        "limits": [
            "The public holdout has ten positive labels. The probes are authored classroom examples evaluated separately.",
            "The historical label describes content. The English score has no calibration for classroom traffic.",
        ],
    }


def evaluate_activity(model_dir: Path = AI_ROOT) -> dict:
    metadata, artifact = load_activity_artifact(model_dir, ACTIVITY_MANIFEST_PATH)
    if artifact is None:
        raise ValueError("The editor activity export is missing or fails its manifest checks.")
    windows = simulate_windows()
    x = np.stack([window_features(window.counts) for window in windows])
    y = np.array([window.target for window in windows])
    groups = np.array([window.profile for window in windows])
    development, holdout = grouped_split(x, y, groups)
    reference = build_window_model().fit(x[development], y[development])
    truth = y[holdout]
    bins = x[holdout, FEATURE_NAMES.index("active_edit_bins")]
    rule = bins >= 3
    fingerprint = sha256()
    for window in windows:
        fingerprint.update(np.asarray([window.profile, window.target], dtype="<i8").tobytes())
        fingerprint.update(np.asarray(window.counts, dtype="<i8").tobytes())
    return {
        **trained_result(
            metadata, truth, reference.predict_proba(x[holdout])[:, 1], artifact.score(x[holdout]),
            PREDICTION_THRESHOLD, artifact.threshold,
        ),
        "title": "Synthetic editor activity",
        "dataset": {
            "name": metadata["evaluation"]["dataset"],
            "source": "Repository simulator",
            "revision": f"Fixed simulator, seed {SEED}",
            "checksum": {"scope": "generated integer profile, label and bin counts", "sha256": fingerprint.hexdigest()},
            "unit": "Two-minute aggregate window generated by the simulator",
            "counts": {"windows": len(y), "profiles": len(set(groups)), "positive_windows": int(y.sum())},
        },
        "split": {
            "seed": SEED,
            "policy": "80/20 GroupShuffleSplit by whole synthetic profile.",
            "groupUnit": "profiles",
            "groupsDisjoint": True,
            "development": partition(y[development], groups[development]),
            "holdout": partition(truth, groups[holdout]),
        },
        "thresholdSelection": "Fixed at 0.5 before scoring the holdout.",
        "baselines": [{"name": "At least three active edit bins", "metrics": binary_metrics(truth, rule, rule)}],
        "limits": ["Simulator labels measure simulated editing. Quiet windows can include reading or planning."],
    }


def evaluate_forecast(model_dir: Path = AI_ROOT) -> dict:
    metadata, artifact = load_forecast_artifact(model_dir, FORECAST_MANIFEST_PATH)
    if artifact is None:
        raise ValueError("The CS1 forecast export is missing or fails its manifest checks.")
    windows, counts = load_windows(fetch_source())
    x = windows.select(*FEATURE_NAMES).to_numpy()
    y = windows["submit_within_horizon"].to_numpy()
    groups = windows["student"].to_numpy()
    if not np.isfinite(x).all():
        raise ValueError("The CS1 sample produced non-finite features.")
    development, holdout = grouped_split(x, y, groups)
    scores = cross_val_predict(
        build_window_model(), x[development], y[development], groups=groups[development],
        cv=GroupKFold(n_splits=4), method="predict_proba",
    )[:, 1]
    threshold = select_threshold(y[development], scores, beta=1)
    reference = build_window_model().fit(x[development], y[development])
    truth = y[holdout]
    bins = x[holdout, FEATURE_NAMES.index("active_edit_bins")]
    constant = np.ones_like(truth)
    return {
        **trained_result(
            metadata, truth, reference.predict_proba(x[holdout])[:, 1], artifact.score(x[holdout]),
            threshold, artifact.threshold,
        ),
        "title": "First submission on real CS1 editor logs",
        "dataset": {
            "name": metadata["evaluation"]["dataset"],
            "source": "https://doi.org/10.5281/zenodo.6903968",
            "revision": "Zenodo v1, nine fixed CSV byte ranges and whole interior learner blocks",
            "checksum": {"scope": "pinned CSV sample", "sha256": SAMPLE_SHA256},
            "unit": f"{WINDOW_SECONDS}-second pre-submission window, {HORIZON_SECONDS}-second horizon",
            "counts": counts,
            "selection": {"sourceBytes": SOURCE_BYTES, "rangeBytes": RANGE_BYTES, "rangeStarts": list(RANGE_STARTS)},
        },
        "split": {
            "seed": SEED,
            "policy": "80/20 GroupShuffleSplit by whole learner.",
            "groupUnit": "learners",
            "groupsDisjoint": True,
            "development": partition(y[development], groups[development]),
            "holdout": partition(truth, groups[holdout]),
        },
        "thresholdSelection": "Maximum F1 on four-fold GroupKFold out-of-fold development scores.",
        "baselines": [
            {"name": "Ranking by active edit bins", "metrics": {"averagePrecision": float(average_precision_score(truth, bins))}},
            {"name": "Constant score, always predict submission", "metrics": binary_metrics(truth, constant, constant)},
        ],
        "limits": [
            "Sampling can favor shorter learner logs. Opt-in logging gaps can hide activity.",
            "The target is a recorded assessment attempt. Browser transactions and demo fixtures differ from the historical IDE logs.",
            "The held-out evaluation measures this historical sample. Live classroom scores have no calibration.",
        ],
    }
