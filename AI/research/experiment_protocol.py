"""Splits and threshold selection shared by the notebooks and evaluation."""

import numpy as np
from sklearn.metrics import precision_recall_curve
from sklearn.model_selection import (
    GroupKFold, GroupShuffleSplit, StratifiedKFold, cross_val_predict, train_test_split,
)

from keystroke_data import SEED as WINDOW_SEED
from keystroke_model import build_model as build_window_model
from prompt_model import SEED as PROMPT_SEED, build_model as build_prompt_model


def prompt_split(labels: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    return train_test_split(
        np.arange(len(labels)), test_size=0.2, stratify=labels, random_state=PROMPT_SEED,
    )


def assert_disjoint_groups(development: np.ndarray, holdout: np.ndarray) -> None:
    if not set(development).isdisjoint(holdout):
        raise ValueError("The development and holdout partitions share learners or profiles.")


def grouped_split(x: np.ndarray, y: np.ndarray, groups: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    split = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=WINDOW_SEED)
    development, holdout = next(split.split(x, y, groups))
    assert_disjoint_groups(groups[development], groups[holdout])
    return development, holdout


def prompt_development_scores(prompts: list[str], labels: np.ndarray) -> np.ndarray:
    folds = StratifiedKFold(n_splits=5, shuffle=True, random_state=PROMPT_SEED)
    return cross_val_predict(build_prompt_model(), prompts, labels, cv=folds, method="predict_proba")[:, 1]


def forecast_development_scores(x: np.ndarray, labels: np.ndarray, groups: np.ndarray) -> np.ndarray:
    return cross_val_predict(
        build_window_model(), x, labels, groups=groups, cv=GroupKFold(n_splits=4), method="predict_proba",
    )[:, 1]


def prompt_threshold(labels: np.ndarray, scores: np.ndarray) -> float:
    return select_threshold(labels, scores, beta=2)


def forecast_threshold(labels: np.ndarray, scores: np.ndarray) -> float:
    return select_threshold(labels, scores, beta=1)


def select_threshold(truth: np.ndarray, scores: np.ndarray, beta: int) -> float:
    precision, recall, thresholds = precision_recall_curve(truth, scores)
    p, r = precision[:-1], recall[:-1]
    denominator = beta**2 * p + r
    objectives = np.divide(
        (1 + beta**2) * p * r,
        denominator,
        out=np.zeros_like(thresholds),
        where=denominator > 0,
    )
    return float(thresholds[np.argmax(objectives)])
