from dataclasses import dataclass
from math import isfinite
from pathlib import Path

from keystroke_model import WindowModel
from prompt_model import PromptModel

from .artifacts import load_activity_artifact, load_prompt_artifact
from .windows import WINDOW_FEATURE_VERSION, read_editor_window


MAX_PROMPT_LENGTH = 4_000


@dataclass(frozen=True)
class ApiError(Exception):
    status: int
    code: str
    message: str


@dataclass(frozen=True)
class InferenceService:
    prompt_metadata: dict
    prompt_model: PromptModel | None
    activity_metadata: dict
    activity_model: WindowModel | None

    @classmethod
    def load(cls, model_dir: Path, manifest_path: Path, activity_manifest_path: Path) -> "InferenceService":
        return cls(
            *load_prompt_artifact(model_dir, manifest_path),
            *load_activity_artifact(model_dir, activity_manifest_path),
        )

    def models(self) -> dict:
        return {"models": [
            {**self.prompt_metadata, "available": self.prompt_model is not None},
            {**self.activity_metadata, "available": self.activity_model is not None},
        ]}

    def classify_prompt(self, data: dict) -> dict:
        if set(data) != {"prompt", "language"}:
            raise ApiError(400, "invalid_request", "Send only prompt and language.")
        prompt = data.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > MAX_PROMPT_LENGTH:
            raise ApiError(422, "invalid_prompt", f"Enter a prompt of 1 to {MAX_PROMPT_LENGTH:,} characters.")
        if data["language"] != self.prompt_metadata.get("language", "en"):
            raise ApiError(422, "unsupported_language", "Choose English for this model.")
        if self.prompt_model is None:
            raise ApiError(503, "model_unavailable", "The prompt model is unavailable. Check the model export and restart.")

        return scored_result(
            self.prompt_metadata, float(self.prompt_model.score([prompt])[0]), self.prompt_model.threshold, "manual"
        )

    def classify_activity(self, data: dict) -> dict:
        if set(data) != {"source", "window"}:
            raise ApiError(400, "invalid_request", "Send only source and window.")
        try:
            window = read_editor_window(data)
        except ValueError as error:
            raise ApiError(422, "invalid_window", str(error)) from None
        if self.activity_model is None:
            raise ApiError(503, "model_unavailable", "The editor model is unavailable. Check the model export and restart.")
        if not window.complete:
            return {
                "status": "unavailable",
                "task": self.activity_metadata["task"],
                "modelVersion": self.activity_metadata.get("modelVersion"),
                "featureVersion": WINDOW_FEATURE_VERSION,
                "source": window.source,
                "reason": "insufficient_history",
                "message": "Observe a full two minutes before classifying activity.",
            }
        return scored_result(
            self.activity_metadata,
            float(self.activity_model.score(window.features())[0]),
            self.activity_model.threshold,
            window.source,
        )


def scored_result(metadata: dict, score: float, threshold: float, source: str) -> dict:
    if not isfinite(score) or not 0 <= score <= 1:
        raise ApiError(500, "inference_failed", "The model could not score this input.")
    label_key = "positiveLabel" if score >= threshold else "negativeLabel"
    return {
        "status": "scored",
        "task": metadata["task"],
        "modelVersion": metadata["modelVersion"],
        "featureVersion": metadata["featureVersion"],
        "score": score,
        "threshold": threshold,
        "label": metadata[label_key],
        "evaluationStatus": metadata["evaluationStatus"],
        "source": source,
    }
