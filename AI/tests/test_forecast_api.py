import json
from pathlib import Path
import shutil
import sys
from tempfile import TemporaryDirectory
from threading import Thread
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

AI_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AI_ROOT))

from inference import create_server


QUIET = [[0, 0, 0]] * 24
EDITING = [[2, 1, 0]] * 24


def observation(bins, seconds=120, source="sample"):
    return {
        "source": source,
        "window": {
            "featureVersion": "editor-window-v1",
            "binSeconds": 5,
            "observedSeconds": seconds,
            "bins": bins,
        },
    }


def post(base, data, path="/api/predict/submission"):
    return urlopen(Request(
        base + path,
        data=json.dumps(data).encode(),
        headers={"Content-Type": "application/json"},
    ), timeout=5)


class ForecastApiTests(unittest.TestCase):
    def start_server(self, **options):
        server = create_server(port=0, **options)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return f"http://127.0.0.1:{server.server_port}"

    def test_forecast_uses_the_cs1_export_and_its_own_threshold(self):
        base = self.start_server()
        window = observation(EDITING)
        with post(base, {**window, "alreadySubmitted": False}) as response:
            forecast = json.load(response)
        with post(base, window, "/api/classify/activity") as response:
            activity = json.load(response)
        self.assertEqual(forecast["status"], "scored")
        self.assertEqual(forecast["task"], "first_submission")
        self.assertEqual(forecast["modelVersion"], "first-submission-v1")
        self.assertEqual(forecast["featureVersion"], "editor-window-v1")
        self.assertEqual(forecast["horizonSeconds"], 600)
        self.assertEqual(forecast["source"], "sample")
        self.assertEqual(forecast["threshold"], 0.2317631072747051)
        self.assertEqual(forecast["label"], "submission_within_10_minutes")
        # Reference from the offline CS1 scorer on [48, 24, 0, 0.5, 0].
        self.assertAlmostEqual(forecast["score"], 0.42885949, places=7)
        self.assertEqual(activity["task"], "editor_activity")
        self.assertNotEqual(forecast["score"], activity["score"])

    def test_missing_history_empty_observation_and_prior_submission_omit_scores(self):
        base = self.start_server()
        partial = observation([[1, 0, 0]], seconds=4, source="live")
        cases = (
            (partial, False, "insufficient_history"),
            (observation(QUIET), False, "no_editor_change"),
            (observation(EDITING), True, "already_submitted"),
            (partial, True, "already_submitted"),
        )
        for window, submitted, reason in cases:
            with self.subTest(reason=reason):
                with post(base, {**window, "alreadySubmitted": submitted}) as response:
                    result = json.load(response)
                self.assertEqual(result["status"], "unavailable")
                self.assertEqual(result["reason"], reason)
                self.assertEqual(result["horizonSeconds"], 600)
                self.assertTrue(result["message"])
                self.assertTrue({"score", "threshold", "label"}.isdisjoint(result))

    def test_paste_without_ordinary_edits_is_eligible(self):
        base = self.start_server()
        window = observation(QUIET[:23] + [[0, 0, 1]], source="live")
        with post(base, {**window, "alreadySubmitted": False}) as response:
            result = json.load(response)
        self.assertEqual(result["status"], "scored")
        self.assertEqual(result["source"], "live")
        # Reference from the offline CS1 scorer on [0, 0, 120, 0, 1].
        self.assertAlmostEqual(result["score"], 0.37256288, places=7)

    def test_validates_state_and_window_before_checking_eligibility(self):
        base = self.start_server()
        cases = [
            (observation(EDITING), "invalid_submission_state"),
            ({**observation(EDITING), "alreadySubmitted": "false"}, "invalid_submission_state"),
            ({**observation(EDITING), "alreadySubmitted": 0}, "invalid_submission_state"),
            ({**observation(QUIET[:23] + [[1, 2, 0]]), "alreadySubmitted": True}, "invalid_window"),
        ]
        for data, code in cases:
            with self.subTest(code=code):
                with self.assertRaises(HTTPError) as failure:
                    post(base, data)
                with failure.exception as response:
                    self.assertEqual(response.status, 422)
                    self.assertEqual(json.load(response)["error"]["code"], code)

    def test_activity_archive_cannot_be_loaded_as_a_forecast(self):
        with TemporaryDirectory() as directory:
            model_dir = Path(directory)
            shutil.copyfile(AI_ROOT / "keystroke-activity-model.npz", model_dir / "cs1-submission-model.npz")
            base = self.start_server(model_dir=model_dir)
            with self.assertRaises(HTTPError) as failure:
                post(base, {**observation(EDITING), "alreadySubmitted": False})
            with failure.exception as response:
                self.assertEqual(response.status, 503)
                self.assertEqual(json.load(response)["error"]["code"], "model_unavailable")
            with urlopen(f"{base}/api/models", timeout=5) as response:
                model = next(model for model in json.load(response)["models"] if model["task"] == "first_submission")
            self.assertFalse(model["available"])

    def test_model_information_reports_the_higher_baseline(self):
        base = self.start_server()
        with urlopen(f"{base}/api/models", timeout=5) as response:
            model = next(model for model in json.load(response)["models"] if model["task"] == "first_submission")
        self.assertEqual(model["evaluationStatus"], "experimental")
        self.assertEqual(model["horizonSeconds"], 600)
        self.assertEqual(model["evaluation"]["averagePrecision"], 0.491)
        self.assertEqual(model["evaluation"]["activeEditBinsAveragePrecision"], 0.5206)
