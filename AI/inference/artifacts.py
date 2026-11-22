from collections.abc import Callable
from hashlib import sha256
from io import BytesIO
import json
from math import isfinite
from pathlib import Path
import re
from zipfile import BadZipFile

from keystroke_data import FEATURE_NAMES
from keystroke_model import MODEL_FORMAT as WINDOW_FORMAT, WindowModel, load_window_model
from prompt_model import MODEL_FORMAT as PROMPT_FORMAT, PromptModel, load_prompt_model

from .windows import WINDOW_FEATURE_VERSION


AI_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = AI_ROOT / "model-manifest.json"
ACTIVITY_MANIFEST_PATH = AI_ROOT / "activity-model-manifest.json"
FORECAST_MANIFEST_PATH = AI_ROOT / "forecast-model-manifest.json"
PROMPT_TASK = "prompt_content"
ACTIVITY_TASK = "editor_activity"
FORECAST_TASK = "first_submission"
FORECAST_HORIZON_SECONDS = 600
# The two editor archives carry the same array schema and no task identifier.
# Bind this published forecast version to its original CS1 artifact bytes.
CS1_FORECAST_V1_SHA256 = "eb842512300025e252411629ee888428903cb6e9c1a8f40f5451cb2341ba2ccf"


def load_prompt_artifact(model_dir: Path, manifest_path: Path) -> tuple[dict, PromptModel | None]:
    return load_artifact(model_dir, manifest_path, load_prompt_model, {
        "task": PROMPT_TASK,
        "artifact": "self-harm-text-model.npz",
        "formatVersion": PROMPT_FORMAT,
        "featureVersion": "hashed-char-tfidf-v1",
        "language": "en",
        "positiveLabel": "sh_content",
        "negativeLabel": "other_content",
    }, ("constantScoreAveragePrecision",))


def load_activity_artifact(model_dir: Path, manifest_path: Path) -> tuple[dict, WindowModel | None]:
    return load_artifact(model_dir, manifest_path, load_window_model, {
        "task": ACTIVITY_TASK,
        "artifact": "keystroke-activity-model.npz",
        "formatVersion": WINDOW_FORMAT,
        "featureVersion": WINDOW_FEATURE_VERSION,
        "featureNames": list(FEATURE_NAMES),
        "positiveLabel": "editing",
        "negativeLabel": "other_activity",
    }, ("threeActiveBinsF1",), ("heldOutProfiles",))


def load_forecast_artifact(model_dir: Path, manifest_path: Path) -> tuple[dict, WindowModel | None]:
    return load_artifact(model_dir, manifest_path, load_window_model, {
        "task": FORECAST_TASK,
        "artifact": "cs1-submission-model.npz",
        "modelVersion": "first-submission-v1",
        "sha256": CS1_FORECAST_V1_SHA256,
        "formatVersion": WINDOW_FORMAT,
        "featureVersion": WINDOW_FEATURE_VERSION,
        "featureNames": list(FEATURE_NAMES),
        "horizonSeconds": FORECAST_HORIZON_SECONDS,
        "positiveLabel": "submission_within_10_minutes",
        "negativeLabel": "no_submission_within_10_minutes",
    }, ("activeEditBinsAveragePrecision", "constantScoreAveragePrecision", "alwaysPositiveF1"), ("heldOutLearners",))


def load_artifact[Model: (PromptModel, WindowModel)](
    model_dir: Path,
    manifest_path: Path,
    load_model: Callable[[BytesIO], Model],
    expected_fields: dict,
    baseline_metrics: tuple[str, ...],
    extra_counts: tuple[str, ...] = (),
) -> tuple[dict, Model | None]:
    try:
        metadata = read_model_manifest(manifest_path, expected_fields, baseline_metrics, extra_counts)
    except (OSError, ValueError, RecursionError):
        return {"task": expected_fields["task"]}, None
    try:
        data = (model_dir / metadata["artifact"]).read_bytes()
        if sha256(data).hexdigest() != metadata["sha256"]:
            return metadata, None
        model = load_model(BytesIO(data))
        if model.threshold != metadata["threshold"]:
            return metadata, None
    except (OSError, ValueError, KeyError, EOFError, BadZipFile):
        return metadata, None
    return metadata, model


def read_model_manifest(
    path: Path, expected_fields: dict, baseline_metrics: tuple[str, ...], extra_counts: tuple[str, ...]
) -> dict:
    metadata = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(metadata, dict):
        raise ValueError("Expected an object in the model manifest.")
    for key, value in expected_fields.items():
        if type(metadata.get(key)) is not type(value) or metadata[key] != value:
            raise ValueError(f"Unsupported model field: {key}.")
    for key in ("modelVersion", "featureDescription", "meaning", "evaluationStatus"):
        if not isinstance(metadata.get(key), str) or not metadata[key].strip():
            raise ValueError(f"Missing model field: {key}.")
    checksum = metadata.get("sha256")
    if not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-f]{64}", checksum):
        raise ValueError("Invalid model checksum.")
    if not unit_number(metadata.get("threshold")):
        raise ValueError("Invalid model threshold.")
    evaluation = metadata.get("evaluation")
    if not isinstance(evaluation, dict):
        raise ValueError("Missing model evaluation.")
    for key in ("dataset", "revision"):
        if not isinstance(evaluation.get(key), str) or not evaluation[key].strip():
            raise ValueError(f"Missing evaluation field: {key}.")
    for key in ("holdoutCount", "positiveCount", *extra_counts):
        if type(evaluation.get(key)) is not int or evaluation[key] < 0:
            raise ValueError(f"Invalid evaluation count: {key}.")
    if evaluation["positiveCount"] > evaluation["holdoutCount"]:
        raise ValueError("The positive count exceeds the holdout size.")
    for key in ("averagePrecision", "precision", "recall", "f1", *baseline_metrics):
        if not unit_number(evaluation.get(key)):
            raise ValueError(f"Invalid evaluation metric: {key}.")
    return metadata


def unit_number(value: object) -> bool:
    return type(value) in (float, int) and 0 <= value <= 1 and isfinite(value)
