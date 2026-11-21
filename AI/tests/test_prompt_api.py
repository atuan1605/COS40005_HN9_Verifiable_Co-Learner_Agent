from contextlib import closing, redirect_stderr
from hashlib import sha256
from http.client import HTTPConnection
from io import StringIO
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


def prompt_request(base, prompt, language="en"):
    return Request(
        f"{base}/api/classify/prompt",
        data=json.dumps({"prompt": prompt, "language": language}).encode(),
        headers={"Content-Type": "application/json"},
    )


class PromptApiTests(unittest.TestCase):
    def start_server(self, **options):
        server = create_server(port=0, **options)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return f"http://127.0.0.1:{server.server_port}"

    def test_english_prompt_matches_original_export_scorer(self):
        base = self.start_server()
        request = prompt_request(base, "Why does my Python loop skip an item?")
        with urlopen(request, timeout=5) as response:
            result = json.load(response)

        self.assertEqual(result["status"], "scored")
        self.assertEqual(result["task"], "prompt_content")
        self.assertEqual(result["modelVersion"], "prompt-content-v1")
        self.assertEqual(result["label"], "other_content")
        # Recorded with the original CLI and committed artifact before serving.
        self.assertAlmostEqual(result["score"], 0.16024645294053, places=10)
        self.assertAlmostEqual(result["threshold"], 0.4136048173830935, places=12)

    def test_historical_content_signal_uses_the_positive_label(self):
        base = self.start_server()
        # Authored classroom probe from self-harm-prompts.ipynb. Score from the original CLI.
        request = prompt_request(base, "I am thinking about hurting myself and I need help.")
        with urlopen(request, timeout=5) as response:
            result = json.load(response)
        self.assertEqual(result["label"], "sh_content")
        self.assertAlmostEqual(result["score"], 0.9039123929938403, places=10)

    def test_model_information_exposes_evaluation_provenance(self):
        base = self.start_server()
        with urlopen(f"{base}/api/models", timeout=5) as response:
            model = next(model for model in json.load(response)["models"] if model["task"] == "prompt_content")
        self.assertTrue(model["available"])
        self.assertEqual(model["language"], "en")
        self.assertEqual(model["evaluationStatus"], "experimental")
        self.assertEqual(model["evaluation"]["holdoutCount"], 289)
        self.assertEqual(model["evaluation"]["positiveCount"], 10)
        self.assertEqual(len(model["sha256"]), 64)

    def test_invalid_input_returns_actionable_errors_and_service_recovers(self):
        base = self.start_server()
        cases = [
            (prompt_request(base, "   "), 422, "invalid_prompt"),
            (prompt_request(base, None), 422, "invalid_prompt"),
            (prompt_request(base, "x" * 4001), 422, "invalid_prompt"),
            (prompt_request(base, "How do loops work?", "vi"), 422, "unsupported_language"),
            (Request(f"{base}/api/classify/prompt", b'{"prompt":',
                     {"Content-Type": "application/json"}), 400, "invalid_json"),
            (Request(f"{base}/api/classify/prompt", b'{"prompt":"a","prompt":"b","language":"en"}',
                     {"Content-Type": "application/json"}), 400, "invalid_json"),
            (Request(f"{base}/api/classify/prompt", b'{"prompt":NaN,"language":"en"}',
                     {"Content-Type": "application/json"}), 400, "invalid_json"),
            (Request(f"{base}/api/classify/prompt", b'\xff',
                     {"Content-Type": "application/json"}), 400, "invalid_json"),
            (Request(f"{base}/api/classify/prompt", b'["hello"]',
                     {"Content-Type": "application/json"}), 400, "invalid_request"),
            (Request(f"{base}/api/classify/prompt", b'{"prompt":"hello"}',
                     {"Content-Type": "application/json"}), 400, "invalid_request"),
            (Request(f"{base}/api/classify/prompt", b"x" * 65_537,
                     {"Content-Type": "application/json"}), 413, "request_too_large"),
            (Request(f"{base}/api/classify/prompt", b"x",
                     {"Content-Type": "text/plain"}), 415, "unsupported_media_type"),
            (f"{base}/api/classify/prompt", 405, "method_not_allowed"),
            (Request(f"{base}/api/classify/prompt", method="TRACE"), 405, "method_not_allowed"),
            (f"{base}/self-harm-text-model.npz", 404, "not_found"),
        ]
        for request, expected_status, expected_code in cases:
            with self.subTest(code=expected_code):
                self.assert_api_error(request, expected_status, expected_code)

        with urlopen(prompt_request(base, "x" * 4000), timeout=5) as response:
            self.assertEqual(json.load(response)["status"], "scored")
            self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_bodyless_framing_and_foreign_origin_are_refused(self):
        base = self.start_server()
        with closing(HTTPConnection(base.removeprefix("http://"), timeout=5)) as connection:
            connection.putrequest("POST", "/api/classify/prompt")
            connection.putheader("Content-Type", "application/json")
            connection.endheaders()
            self.assertEqual(connection.getresponse().status, 411)

        request = prompt_request(base, "How do loops work?")
        request.add_header("Origin", "https://example.test")
        self.assert_api_error(request, 403, "invalid_origin")

    def test_missing_corrupt_and_wrong_task_exports_are_unavailable(self):
        with TemporaryDirectory() as directory:
            model_dir = Path(directory)
            artifact = model_dir / "self-harm-text-model.npz"
            for scenario in ("missing", "corrupt", "wrong task"):
                if scenario == "corrupt":
                    artifact.write_bytes(b"not a NumPy archive")
                elif scenario == "wrong task":
                    shutil.copyfile(AI_ROOT / "keystroke-activity-model.npz", artifact)
                with self.subTest(artifact=scenario):
                    base = self.start_server(model_dir=model_dir)
                    self.assert_api_error(prompt_request(base, "How do loops work?"), 503, "model_unavailable")
                    with urlopen(f"{base}/api/models", timeout=5) as response:
                        self.assertFalse(json.load(response)["models"][0]["available"])

    def test_prompt_text_and_query_strings_never_reach_request_logs(self):
        logs = StringIO()
        with redirect_stderr(logs):
            base = self.start_server()
            with urlopen(prompt_request(base, "unique-prompt-marker"), timeout=5) as response:
                self.assertEqual(json.load(response)["status"], "scored")
            self.assert_api_error(f"{base}/?prompt=unique-query-marker", 404, "not_found")
        self.assertNotIn("unique-prompt-marker", logs.getvalue())
        self.assertNotIn("unique-query-marker", logs.getvalue())

    def test_artifact_must_match_manifest_shape_and_threshold(self):
        manifest = AI_ROOT / "model-manifest.json"
        with TemporaryDirectory() as directory:
            model_dir = Path(directory)
            artifact = model_dir / "self-harm-text-model.npz"
            manifest_path = model_dir / "model-manifest.json"
            for scenario in ("incompatible archive", "different threshold", "missing model version"):
                metadata = json.loads(manifest.read_text(encoding="utf-8"))
                if scenario == "incompatible archive":
                    shutil.copyfile(AI_ROOT / "keystroke-activity-model.npz", artifact)
                    metadata["sha256"] = sha256(artifact.read_bytes()).hexdigest()
                else:
                    shutil.copyfile(AI_ROOT / artifact.name, artifact)
                    if scenario == "different threshold":
                        metadata["threshold"] = 0.5
                    else:
                        del metadata["modelVersion"]
                manifest_path.write_text(json.dumps(metadata), encoding="utf-8")
                with self.subTest(artifact=scenario):
                    base = self.start_server(model_dir=model_dir, manifest_path=manifest_path)
                    self.assert_api_error(prompt_request(base, "How do loops work?"), 503, "model_unavailable")
                    with urlopen(f"{base}/api/models", timeout=5) as response:
                        self.assertFalse(json.load(response)["models"][0]["available"])

    def assert_api_error(self, request, status, code):
        with self.assertRaises(HTTPError) as failure:
            urlopen(request, timeout=5)
        with failure.exception as response:
            self.assertEqual(response.code, status)
            body = json.load(response)
        self.assertEqual(body["error"]["code"], code)
        self.assertNotIn("score", body)
