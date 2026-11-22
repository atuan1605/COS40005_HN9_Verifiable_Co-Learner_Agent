from copy import deepcopy
import json
from pathlib import Path
from runpy import run_path
from subprocess import run
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from classroom_probes import CLASSROOM_CASES
from cs1_submission_data import HEADER, load_windows
from evaluation import binary_metrics
from evaluation.metrics import verify_parity
from evaluation.report import build_report, write_reports
from experiment_protocol import assert_disjoint_groups


AI_ROOT = Path(__file__).resolve().parents[1]


def simple_results():
    truth = np.array([0, 1])
    scores = np.array([0.1, 0.8])
    metrics = binary_metrics(truth, scores, scores >= 0.5)
    tasks = [
        ("prompt_content", "sh_content", None, ["prompt_constant"]),
        ("editor_activity", "editing", "profiles", ["activity_three_bins"]),
        ("first_submission", "submission_within_10_minutes", "learners", ["active_bins_rank", "forecast_constant"]),
    ]
    return [
        {
            "task": task,
            "title": f"Worked example for {task}",
            "model": {
                "modelVersion": f"{task}-fixture", "featureVersion": "fixture-features",
                "artifact": "fixture.npz", "sha256": "0" * 64, "meaning": "A worked example.",
                "positiveLabel": label, "evaluationStatus": "experimental",
            },
            "dataset": {
                "name": "Authored fixture", "revision": "1", "source": "Test fixture",
                "checksum": {"scope": "fixture", "sha256": "0" * 64}, "unit": "row", "counts": {"rows": 4},
            },
            "split": {
                "seed": 42, "policy": "Separate rows.", "groupsDisjoint": True, "groupUnit": group_unit,
                "development": {"rows": 2, "positive": 1, "groups": 1},
                "holdout": {"rows": 2, "positive": 1, "groups": 1},
            },
            "threshold": 0.5,
            "thresholdSelection": "Fixed.",
            "metrics": deepcopy(metrics),
            "parity": verify_parity(scores, scores, 0.5, 0.5),
            "baselines": [
                {"id": key, "metrics": {"averagePrecision": 0.5} if key == "active_bins_rank" else deepcopy(metrics)}
                for key in baseline_ids
            ],
            **({"classroomProbes": {name: {"flagged": 0, "total": len(cases)} for name, cases in CLASSROOM_CASES.items()}}
               if group_unit is None else {}),
            "limits": ["Authored numbers for testing the report."],
        }
        for task, label, group_unit, baseline_ids in tasks
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

    def test_report_requires_task_specific_evidence(self):
        missing_probes = simple_results()
        del missing_probes[0]["classroomProbes"]
        with self.assertRaisesRegex(ValueError, "classroom probe counts"):
            build_report(missing_probes)
        missing_groups = simple_results()
        del missing_groups[1]["split"]["holdout"]["groups"]
        with self.assertRaisesRegex(ValueError, "Group counts or separation"):
            build_report(missing_groups)
        missing_baseline_counts = simple_results()
        del missing_baseline_counts[2]["baselines"][1]["metrics"]["counts"]
        with self.assertRaisesRegex(ValueError, "confusion counts"):
            build_report(missing_baseline_counts)
        wrong_precision = simple_results()
        wrong_precision[0]["metrics"]["precision"] = 0.5
        with self.assertRaisesRegex(ValueError, "thresholded metrics"):
            build_report(wrong_precision)

    def test_publication_failure_preserves_previous_report_pair(self):
        original_replace = Path.replace

        def replace(source, destination):
            if source.name == "evaluation.md":
                raise PermissionError("Markdown report is open in another application")
            return original_replace(source, destination)

        with TemporaryDirectory() as directory:
            output = Path(directory)
            names = {"evaluation.json", "evaluation.md"}
            for filename in names:
                (output / filename).write_text("previous report", encoding="utf-8")
            with patch.object(Path, "replace", replace):
                with self.assertRaisesRegex(PermissionError, "Markdown report"):
                    write_reports(build_report(simple_results()), output)
            self.assertEqual({path.name for path in output.iterdir()}, names)
            for filename in names:
                self.assertEqual((output / filename).read_text(encoding="utf-8"), "previous report")

    def test_cli_writes_fixture_reports_and_reports_parity_failure(self):
        script = str(AI_ROOT / "evaluate-models.py")
        prompt, activity, forecast = simple_results()
        with TemporaryDirectory() as directory:
            output = Path(directory)
            with (
                patch.object(sys, "argv", [script, "--output", str(output)]),
                patch("evaluation.tasks.evaluate_prompt", return_value=prompt),
                patch("evaluation.tasks.evaluate_activity", return_value=activity),
                patch("evaluation.tasks.evaluate_forecast", return_value=forecast) as score_forecast,
                patch("sys.stdout"), patch("sys.stderr") as stderr,
            ):
                with self.assertRaises(SystemExit) as success:
                    run_path(script, run_name="__main__")
                self.assertEqual(success.exception.code, 0)
                previous_reports = {path: path.read_bytes() for path in output.iterdir()}
                self.assertEqual({path.name for path in previous_reports}, {"evaluation.md", "evaluation.json"})

                score_forecast.side_effect = lambda _: verify_parity(np.array([0.8]), np.array([0.7]), 0.5, 0.5)
                with self.assertRaises(SystemExit) as failure:
                    run_path(script, run_name="__main__")
                self.assertEqual(failure.exception.code, 1)
                self.assertIn("The served artifact differs", "".join(call.args[0] for call in stderr.write.call_args_list))
                self.assertEqual({path: path.read_bytes() for path in output.iterdir()}, previous_reports)

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
