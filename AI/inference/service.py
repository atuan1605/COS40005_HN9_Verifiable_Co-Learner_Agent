from dataclasses import dataclass
from math import isfinite
from pathlib import Path

from keystroke_model import WindowModel
from prompt_model import PromptModel

from .artifacts import load_activity_artifact, load_forecast_artifact, load_prompt_artifact
from .windows import EditorWindow, read_editor_window


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
    forecast_metadata: dict
    forecast_model: WindowModel | None

    @classmethod
    def load(
        cls, model_dir: Path, manifest_path: Path, activity_manifest_path: Path, forecast_manifest_path: Path,
    ) -> "InferenceService":
        return cls(
            *load_prompt_artifact(model_dir, manifest_path),
            *load_activity_artifact(model_dir, activity_manifest_path),
            *load_forecast_artifact(model_dir, forecast_manifest_path),
        )

    def models(self) -> dict:
        return {"models": [
            {**self.prompt_metadata, "available": self.prompt_model is not None},
            {**self.activity_metadata, "available": self.activity_model is not None},
            {**self.forecast_metadata, "available": self.forecast_model is not None},
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
        window = parse_window(data)
        if self.activity_model is None:
            raise ApiError(503, "model_unavailable", "The editor model is unavailable. Check the model export and restart.")
        if not window.complete:
            return unavailable_result(
                self.activity_metadata, window.source,
                "insufficient_history", "Observe a full two minutes before classifying activity.",
            )
        return scored_result(
            self.activity_metadata,
            float(self.activity_model.score(window.features())[0]),
            self.activity_model.threshold,
            window.source,
        )

    def predict_submission(self, data: dict) -> dict:
        if type(data.get("alreadySubmitted")) is not bool:
            raise ApiError(422, "invalid_submission_state", "Set alreadySubmitted to true or false.")
        if set(data) != {"source", "window", "alreadySubmitted"}:
            raise ApiError(400, "invalid_request", "Send only source, window and alreadySubmitted.")
        window = parse_window(data)
        if self.forecast_model is None:
            raise ApiError(503, "model_unavailable", "The submission model is unavailable. Check the model export and restart.")
        metadata = self.forecast_metadata
        if data["alreadySubmitted"]:
            result = unavailable_result(
                metadata, window.source, "already_submitted", "This demo exercise already has a submission.",
            )
        elif not window.complete:
            result = unavailable_result(
                metadata, window.source, "insufficient_history", "Observe a full two minutes before forecasting.",
            )
        elif not window.has_editor_changes:
            result = unavailable_result(
                metadata, window.source, "no_editor_change", "No edits or pastes were observed in this window.",
            )
        else:
            result = scored_result(
                metadata, float(self.forecast_model.score(window.features())[0]), self.forecast_model.threshold, window.source,
            )
        return {**result, "horizonSeconds": metadata["horizonSeconds"]}


def parse_window(data: dict) -> EditorWindow:
    try:
        return read_editor_window(data)
    except ValueError as error:
        raise ApiError(422, "invalid_window", str(error)) from None


def model_identity(metadata: dict, source: str) -> dict:
    return {
        "task": metadata["task"],
        "modelVersion": metadata["modelVersion"],
        "featureVersion": metadata["featureVersion"],
        "evaluationStatus": metadata["evaluationStatus"],
        "source": source,
    }


def unavailable_result(metadata: dict, source: str, reason: str, message: str) -> dict:
    return {"status": "unavailable", **model_identity(metadata, source), "reason": reason, "message": message}


def scored_result(metadata: dict, score: float, threshold: float, source: str) -> dict:
    if not isfinite(score) or not 0 <= score <= 1:
        raise ApiError(500, "inference_failed", "The model could not score this input.")
    label_key = "positiveLabel" if score >= threshold else "negativeLabel"
    return {
        "status": "scored",
        **model_identity(metadata, source),
        "score": score,
        "threshold": threshold,
        "label": metadata[label_key],
    }
