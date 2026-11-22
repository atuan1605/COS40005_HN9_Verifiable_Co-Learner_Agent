"""Reproduce holdout results and verify the shipped local demo artifacts."""

import argparse
from pathlib import Path
import sys

from evaluation.report import build_report, write_reports
from evaluation.tasks import evaluate_activity, evaluate_forecast, evaluate_prompt
from inference.artifacts import AI_ROOT


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=AI_ROOT / "results")
    parser.add_argument("--model-dir", type=Path, default=AI_ROOT, help="Directory containing the published exports.")
    args = parser.parse_args()

    results = []
    for name, evaluate in [
        ("English prompt content", evaluate_prompt),
        ("synthetic editor activity", evaluate_activity),
        ("real CS1 first submission", evaluate_forecast),
    ]:
        print(f"Evaluating {name}...", flush=True)
        try:
            results.append(evaluate(args.model_dir))
        except (OSError, ValueError, RuntimeError) as error:
            print(f"Evaluation failed for {name}. {error}", file=sys.stderr)
            return 1
    try:
        write_reports(build_report(results), args.output)
    except (OSError, ValueError) as error:
        print(f"Could not write the evaluation report. {error}", file=sys.stderr)
        return 1
    print(f"Wrote {args.output / 'evaluation.md'} and {args.output / 'evaluation.json'}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
