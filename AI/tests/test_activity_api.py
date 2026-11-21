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


class ActivityApiTests(unittest.TestCase):
    def start_server(self, **options):
        server = create_server(port=0, **options)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return f"http://127.0.0.1:{server.server_port}"

    def activity_request(self, base, bins, seconds=120, source="sample", **fields):
        return Request(
            f"{base}/api/classify/activity",
            data=json.dumps({
                "source": source,
                "window": {
                    "binSeconds": 5,
                    "observedSeconds": seconds,
                    "featureVersion": "editor-window-v1",
                    "bins": bins,
                    **fields,
                },
            }).encode(),
            headers={"Content-Type": "application/json"},
        )

    def test_complete_window_matches_the_existing_export(self):
        base = self.start_server()
        # Twenty-four [2, 1, 0] bins yield [48, 24, 0, 0.5, 0].
        # Reference score computed by keystroke_model.score_windows before adding the API.
        request = self.activity_request(base, [[2, 1, 0]] * 24)
        with urlopen(request, timeout=5) as response:
            result = json.load(response)
        self.assertEqual(result["task"], "editor_activity")
        self.assertEqual(result["label"], "editing")
        self.assertEqual(result["source"], "sample")
        self.assertEqual(result["modelVersion"], "editor-activity-v1")
        self.assertEqual(result["featureVersion"], "editor-window-v1")
        self.assertEqual(result["threshold"], 0.5)
        self.assertAlmostEqual(result["score"], 0.9999246346103162, places=10)

    def test_quiet_windows_are_scoreable_and_short_windows_are_unavailable(self):
        base = self.start_server()
        quiet = [[0, 0, 0]] * 24
        with urlopen(self.activity_request(base, quiet, source="live"), timeout=5) as response:
            result = json.load(response)
        self.assertEqual(result["source"], "live")
        self.assertEqual(result["label"], "other_activity")
        self.assertAlmostEqual(result["score"], 0.07414578564869742, places=10)

        for seconds, bins in ((0, []), (5.1, quiet[:2]), (119.9, quiet)):
            with self.subTest(seconds=seconds):
                request = self.activity_request(base, bins, seconds=seconds, source="live")
                with urlopen(request, timeout=5) as response:
                    result = json.load(response)
                self.assertEqual(result["status"], "unavailable")
                self.assertEqual(result["reason"], "insufficient_history")
                self.assertNotIn("score", result)
                self.assertNotIn("label", result)

    def test_paste_and_edit_pause_match_the_research_features(self):
        base = self.start_server()
        quiet = [[0, 0, 0]] * 23
        cases = (
            # [0, 0, 120, 0, 1]: one late paste still leaves 120 seconds without edits.
            (quiet + [[0, 0, 1]], 0.013807755593223432),
            # [1, 1, 115, 0, 0]: one early edit followed by a 115-second edit pause.
            ([[1, 0, 0]] + quiet, 0.1142014530302709),
        )
        for bins, score in cases:
            with self.subTest(score=score):
                with urlopen(self.activity_request(base, bins), timeout=5) as response:
                    result = json.load(response)
                self.assertAlmostEqual(result["score"], score, places=10)

    def test_rejects_malformed_counts_and_windows(self):
        base = self.start_server()
        quiet = [[0, 0, 0]] * 24
        cases = [
            self.activity_request(base, quiet[:-1]),
            self.activity_request(base, quiet + [[0, 0, 0]]),
            self.activity_request(base, quiet[:23] + [None]),
            self.activity_request(base, quiet[:23] + [[1, 0]]),
            self.activity_request(base, quiet[:23] + [[-1, 0, 0]]),
            self.activity_request(base, quiet[:23] + [[1.5, 0, 0]]),
            self.activity_request(base, quiet[:23] + [[True, 0, 0]]),
            self.activity_request(base, quiet[:23] + [[1, 2, 0]]),
            self.activity_request(base, quiet[:23] + [[10_001, 0, 0]]),
            self.activity_request(base, [[0, 1, 0]], seconds=1, source="live"),
            self.activity_request(base, quiet, seconds=10),
            self.activity_request(base, quiet, binSeconds=10),
            self.activity_request(base, quiet, featureVersion="editor-window-v2"),
            self.activity_request(base, quiet, source="recorded"),
        ]
        for index, request in enumerate(cases):
            with self.subTest(index=index):
                with self.assertRaises(HTTPError) as failure:
                    urlopen(request, timeout=5)
                with failure.exception as response:
                    self.assertEqual(response.code, 422)
                    self.assertEqual(json.load(response)["error"]["code"], "invalid_window")

    def test_wrong_editor_artifact_is_unavailable_even_with_matching_shape(self):
        with TemporaryDirectory() as directory:
            model_dir = Path(directory)
            shutil.copyfile(
                AI_ROOT / "cs1-submission-model.npz",
                model_dir / "keystroke-activity-model.npz",
            )
            base = self.start_server(model_dir=model_dir)
            for seconds, bins in ((0, []), (120, [[2, 1, 0]] * 24)):
                request = self.activity_request(base, bins, seconds=seconds, source="live")
                with self.subTest(seconds=seconds):
                    with self.assertRaises(HTTPError) as failure:
                        urlopen(request, timeout=5)
                    with failure.exception as response:
                        self.assertEqual(response.status, 503)
                        self.assertEqual(json.load(response)["error"]["code"], "model_unavailable")
            with urlopen(f"{base}/api/models", timeout=5) as response:
                model = next(model for model in json.load(response)["models"] if model["task"] == "editor_activity")
                self.assertFalse(model["available"])

    def test_model_information_identifies_synthetic_holdout(self):
        base = self.start_server()
        with urlopen(f"{base}/api/models", timeout=5) as response:
            activity = next(model for model in json.load(response)["models"] if model["task"] == "editor_activity")
        self.assertTrue(activity["available"])
        self.assertEqual(activity["evaluation"]["dataset"], "Synthetic editor activity profiles")
        self.assertEqual(activity["evaluation"]["heldOutProfiles"], 24)
