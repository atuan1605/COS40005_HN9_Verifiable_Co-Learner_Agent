from copy import deepcopy
import json
from pathlib import Path
from subprocess import run
import sys
from tempfile import TemporaryDirectory
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cs1_submission_data import HEADER, load_windows
from evaluation import binary_metrics
from evaluation.metrics import assert_disjoint_groups, verify_parity
from evaluation.report import build_report, write_reports


AI_ROOT = Path(__file__).resolve().parents[1]


def simple_results():
    truth = np.array([0, 1])
    scores = np.array([0.1, 0.8])
    metrics = binary_metrics(truth, scores, scores >= 0.5)
    baselines = [
        ("prompt_content", ["Constant score, always predict other content"]),
        ("editor_activity", ["At least three active edit bins"]),
        ("first_submission", ["Ranking by active edit bins", "Constant score, always predict submission"]),
    ]
    return [
        {
            "task": task,
            "title": f"Worked example for {task}",
            "model": {
                "modelVersion": f"{task}-fixture", "featureVersion": "fixture-features",
                "artifact": "fixture.npz", "sha256": "0" * 64, "meaning": "A worked example.",
                "positiveLabel": "positive", "evaluationStatus": "experimental",
            },
            "dataset": {
                "name": "Authored fixture", "revision": "1", "source": "Test fixture",
                "checksum": {"scope": "fixture", "sha256": "0" * 64}, "unit": "row", "counts": {"rows": 4},
            },
            "split": {
                "seed": 42, "policy": "Separate rows.", "groupsDisjoint": True, "groupUnit": "fixture groups",
                "development": {"rows": 2, "positive": 1}, "holdout": {"rows": 2, "positive": 1},
            },
            "threshold": 0.5,
            "thresholdSelection": "Fixed.",
            "metrics": metrics,
            "parity": verify_parity(scores, scores, 0.5, 0.5),
            "baselines": [{"name": name, "metrics": {"averagePrecision": 0.5}} for name in names],
            "limits": ["Authored numbers for testing the report."],
        }
        for task, names in baselines
    ]


class EvaluationTests(unittest.TestCase):
    def test_metrics_on_an_independent_worked_example(self):
        truth = np.array([1, 0, 0, 1, 0])
        scores = np.array([0.9, 0.8, 0.7, 0.6, 0.1])
        metrics = binary_metrics(truth, scores, scores >= 0.75)
        self.assertEqual(metrics["counts"], {"tp": 1, "fp": 1, "tn": 2, "fn": 1})
        self.assertEqual(metrics["precision"], 0.5)
        self.assertEqual(metrics["recall"], 0.5)
        self.assertEqual(metrics["f1"], 0.5)
        self.assertEqual(metrics["averagePrecision"], 0.75)

    def test_rejects_group_leakage_and_artifact_drift(self):
        with self.assertRaisesRegex(ValueError, "share learners or profiles"):
            assert_disjoint_groups(np.array(["a", "b"]), np.array(["b", "c"]))
        with self.assertRaisesRegex(ValueError, "differs from the fitted pipeline"):
            verify_parity(np.array([0.85]), np.array([0.75]), 0.5, 0.5)
        # Numeric tolerances alone would accept this score. Crossing the threshold still fails.
        with self.assertRaisesRegex(ValueError, "different labels"):
            verify_parity(np.array([0.5]), np.array([0.5 - 1e-12]), 0.5, 0.5)

    def test_reports_share_the_same_tasks_versions_and_counts(self):
        with TemporaryDirectory() as directory:
            output = Path(directory)
            report = build_report(simple_results())
            write_reports(report, output)
            structured = json.loads((output / "evaluation.json").read_text(encoding="utf-8"))
            readable = (output / "evaluation.md").read_text(encoding="utf-8")
        self.assertEqual(structured, report)
        for item in structured["tasks"]:
            self.assertIn(item["model"]["modelVersion"], readable)
        self.assertIn("| Served model | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1 | 0 | 1 | 0 |", readable)

    def test_report_rejects_missing_tasks_baselines_or_mismatched_confusion_counts(self):
        valid = simple_results()
        with self.assertRaisesRegex(ValueError, "three served tasks"):
            build_report(valid[:2])
        without_baseline = deepcopy(valid)
        without_baseline[-1]["baselines"].pop()
        with self.assertRaisesRegex(ValueError, "missing a required baseline"):
            build_report(without_baseline)
        bad_counts = deepcopy(valid)
        bad_counts[0]["metrics"]["counts"]["tp"] = 2
        with self.assertRaisesRegex(ValueError, "do not match the holdout"):
            build_report(bad_counts)

    def test_cli_failure_keeps_previous_reports(self):
        with TemporaryDirectory() as directory:
            output = Path(directory)
            for filename in ("evaluation.json", "evaluation.md"):
                (output / filename).write_text("previous complete report", encoding="utf-8")
            process = run(
                [sys.executable, str(AI_ROOT / "evaluate-models.py"), "--output", str(output),
                 "--model-dir", str(output / "missing-exports")],
                capture_output=True, text=True, timeout=30, check=False,
            )
            self.assertEqual(process.returncode, 1)
            self.assertIn("prompt model export is missing", process.stderr)
            for filename in ("evaluation.json", "evaluation.md"):
                self.assertEqual((output / filename).read_text(encoding="utf-8"), "previous complete report")

    def test_cs1_windows_use_pre_anchor_history_and_a_complete_exclusive_horizon(self):
        # Time-to-deadline decreases as time advances. Both eligible windows anchor at 960.
        rows = [
            ("a", "text_insert", 1030), ("a", "text_remove", 1025),
            ("a", "submit", 950), ("a", "text_insert", 940), ("a", "run", 300),
            ("b", "text_insert", 1030), ("b", "submit", 360), ("b", "run", 300),
            ("c", "text_insert", 1030), ("c", "run", 400),
        ]
        with TemporaryDirectory() as directory:
            source = Path(directory) / "events.csv"
            data = "\n".join(f"{learner},p,e,{event},0,{remaining}" for learner, event, remaining in rows)
            source.write_bytes(HEADER + b"\n" + data.encode("utf-8") + b"\n")
            windows, counts = load_windows(source)
        self.assertEqual(counts["eligible_windows"], 2)
        self.assertEqual(
            windows.rows(),
            [("a", 2, 2, 60, 0.5, 0, 1), ("b", 1, 1, 65, 0.0, 0, 0)],
        )
