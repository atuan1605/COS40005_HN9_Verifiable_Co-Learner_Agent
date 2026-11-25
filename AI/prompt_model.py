"""Train and score the offline self-harm content baseline."""

import argparse
from dataclasses import dataclass
from io import BytesIO
import json
from pathlib import Path

import numpy as np
from scipy.special import expit
from sklearn.feature_extraction.text import HashingVectorizer, TfidfTransformer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import normalize


SEED = 42
N_FEATURES = 2**16
MODEL_FORMAT = 1
MODEL_PATH = Path(__file__).resolve().parent / "models" / "self-harm-text-model.npz"


def vectorizer() -> HashingVectorizer:
    return HashingVectorizer(
        analyzer="char_wb",
        ngram_range=(3, 5),
        strip_accents="unicode",
        n_features=N_FEATURES,
        alternate_sign=False,
        norm=None,
    )


def build_model() -> Pipeline:
    return Pipeline([
        ("hash", vectorizer()),
        ("tfidf", TfidfTransformer()),
        ("classifier", LogisticRegression(
            solver="liblinear",
            class_weight="balanced",
            random_state=SEED,
        )),
    ])


def export_model(pipeline: Pipeline, threshold: float, path: Path = MODEL_PATH) -> None:
    classifier = pipeline.named_steps["classifier"]
    if not np.array_equal(classifier.classes_, [0, 1]):
        raise ValueError("Expected a fitted binary classifier with classes 0 and 1.")
    np.savez_compressed(
        path,
        format_version=MODEL_FORMAT,
        idf=pipeline.named_steps["tfidf"].idf_,
        coefficients=classifier.coef_[0],
        intercept=classifier.intercept_[0],
        threshold=threshold,
    )


@dataclass(frozen=True)
class PromptModel:
    idf: np.ndarray
    coefficients: np.ndarray
    intercept: float
    threshold: float

    def score(self, prompts: list[str]) -> np.ndarray:
        counts = vectorizer().transform(prompts)
        weighted = normalize(counts.multiply(self.idf), norm="l2")
        return expit(weighted @ self.coefficients + self.intercept)


def load_prompt_model(source: Path | BytesIO) -> PromptModel:
    with np.load(source, allow_pickle=False) as archive:
        if set(archive.files) != {"format_version", "idf", "coefficients", "intercept", "threshold"}:
            raise ValueError("Unexpected prompt model fields.")
        version = archive["format_version"]
        if version.shape != () or version.dtype.kind not in "iu" or version.item() != MODEL_FORMAT:
            raise ValueError("Unsupported model artifact format.")
        idf = finite_array(archive["idf"], (N_FEATURES,))
        coefficients = finite_array(archive["coefficients"], (N_FEATURES,))
        intercept = float(finite_array(archive["intercept"], ()).item())
        threshold = float(finite_array(archive["threshold"], ()).item())
    if not 0 <= threshold <= 1:
        raise ValueError("Invalid prompt model threshold.")
    return PromptModel(idf, coefficients, intercept, threshold)


def finite_array(values: np.ndarray, shape: tuple[int, ...]) -> np.ndarray:
    if values.shape != shape or values.dtype.kind not in "fiu" or not np.isfinite(values).all():
        raise ValueError("Invalid numeric parameters in the prompt model.")
    values.setflags(write=False)
    return values


def score_prompts(
    prompts: list[str], path: Path = MODEL_PATH
) -> tuple[np.ndarray, float]:
    model = load_prompt_model(path)
    return model.score(prompts), model.threshold


def main() -> None:
    parser = argparse.ArgumentParser(description="Score a synthetic prompt locally.")
    parser.add_argument("prompt")
    args = parser.parse_args()
    scores, threshold = score_prompts([args.prompt])
    score = float(scores[0])
    print(json.dumps({"score": score, "threshold": threshold, "flagged": score >= threshold}))


if __name__ == "__main__":
    main()
