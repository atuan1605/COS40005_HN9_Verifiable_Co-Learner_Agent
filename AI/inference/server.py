from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re

from .artifacts import ACTIVITY_MANIFEST_PATH, AI_ROOT, FORECAST_MANIFEST_PATH, MANIFEST_PATH, MODELS_DIR
from .service import ApiError, InferenceService


MAX_BODY_BYTES = 65_536
ASSETS = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/activity.js": ("activity.js", "text/javascript; charset=utf-8"),
    "/collector.js": ("collector.js", "text/javascript; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
}
PROMPT_ROUTE = "/api/classify/prompt"
ACTIVITY_ROUTE = "/api/classify/activity"
FORECAST_ROUTE = "/api/predict/submission"
MODELS_ROUTE = "/api/models"


def unique_fields(pairs: list[tuple]) -> dict:
    result = {}
    for name, value in pairs:
        if name in result:
            raise ValueError("Duplicate JSON field.")
        result[name] = value
    return result


def invalid_constant(_value: str) -> None:
    raise ValueError("Use standard JSON values.")


def demo_assets() -> dict:
    assets = {
        route: (content_type, (AI_ROOT / "demo" / name).read_bytes())
        for route, (name, content_type) in ASSETS.items()
    }
    theme = (AI_ROOT.parent / "web/app/assets/css/main.css").read_text(encoding="utf-8")
    colors = re.findall(r"^\s*(--color-[\w-]+: #[\da-fA-F]+;)", theme, re.MULTILINE)
    palette = ":root {\n" + "\n".join(colors) + "\n}\n"
    content_type, styles = assets["/styles.css"]
    assets["/styles.css"] = content_type, palette.encode("utf-8") + styles
    return assets


def create_server(
    port: int = 8765,
    *,
    model_dir: Path = MODELS_DIR,
    manifest_path: Path = MANIFEST_PATH,
    activity_manifest_path: Path = ACTIVITY_MANIFEST_PATH,
    forecast_manifest_path: Path = FORECAST_MANIFEST_PATH,
) -> ThreadingHTTPServer:
    service = InferenceService.load(model_dir, manifest_path, activity_manifest_path, forecast_manifest_path)
    post_routes = {
        PROMPT_ROUTE: service.classify_prompt,
        ACTIVITY_ROUTE: service.classify_activity,
        FORECAST_ROUTE: service.predict_submission,
    }
    assets = demo_assets()

    class Handler(BaseHTTPRequestHandler):
        def setup(self) -> None:
            self.request.settimeout(5)
            super().setup()

        def log_message(self, *_args) -> None:
            # Request URLs and bodies can contain user-supplied content.
            pass

        def do_GET(self) -> None:
            self.dispatch("GET")

        def do_POST(self) -> None:
            self.dispatch("POST")

        def send_error(self, code: int, message: str | None = None, explain: str | None = None) -> None:
            if code == 501:
                self.dispatch(self.command)
            else:
                super().send_error(code, message, explain)

        def dispatch(self, method: str) -> None:
            origin = f"http://127.0.0.1:{self.server.server_port}"
            try:
                if self.headers.get_all("Host") != [origin.removeprefix("http://")]:
                    raise ApiError(403, "invalid_host", "Open the demo using its printed loopback address.")
                if method == "POST" and self.headers.get_all("Origin") not in (None, [origin]):
                    raise ApiError(403, "invalid_origin", "Send the request from the local demo.")
                if self.path in post_routes and method == "POST":
                    self.json_response(200, post_routes[self.path](self.read_json()))
                elif self.path == MODELS_ROUTE and method == "GET":
                    self.json_response(200, service.models())
                elif self.path in assets and method == "GET":
                    content_type, body = assets[self.path]
                    self.respond(200, content_type, body)
                elif self.path in assets or self.path in post_routes or self.path == MODELS_ROUTE:
                    raise ApiError(405, "method_not_allowed", "Use the documented method for this route.")
                else:
                    raise ApiError(404, "not_found", "This route does not exist.")
            except ApiError as error:
                self.json_response(error.status, {"error": {"code": error.code, "message": error.message}})
            except (TimeoutError, ConnectionError):
                self.close_connection = True
            except Exception:
                self.json_response(500, {
                    "error": {"code": "inference_failed", "message": "The local service could not complete the request."},
                })

        def read_json(self) -> dict:
            if self.headers.get_content_type() != "application/json":
                raise ApiError(415, "unsupported_media_type", "Send an application/json body.")
            lengths = self.headers.get_all("Content-Length", [])
            if "Transfer-Encoding" in self.headers:
                raise ApiError(400, "invalid_request", "Send a body with a fixed content length.")
            if not lengths:
                raise ApiError(411, "length_required", "Send a content length.")
            if len(lengths) != 1 or not lengths[0].isascii() or not lengths[0].isdecimal():
                raise ApiError(400, "invalid_request", "Send a valid content length.")
            length_text = lengths[0].lstrip("0") or "0"
            if len(length_text) > len(str(MAX_BODY_BYTES)) or int(length_text) > MAX_BODY_BYTES:
                raise ApiError(413, "request_too_large", "The request exceeds 64 KiB.")
            length = int(length_text)
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise ApiError(400, "invalid_request", "The request body is incomplete.")
            try:
                data = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_fields, parse_constant=invalid_constant)
            except (ValueError, RecursionError):
                raise ApiError(400, "invalid_json", "Send a valid UTF-8 JSON body.") from None
            if not isinstance(data, dict):
                raise ApiError(400, "invalid_request", "Send a JSON object.")
            return data

        def json_response(self, status: int, body: dict) -> None:
            self.respond(status, "application/json; charset=utf-8", json.dumps(body, allow_nan=False).encode("utf-8"))

        def respond(self, status: int, content_type: str, body: bytes) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            if status == 405:
                self.send_header("Allow", "POST" if self.path in post_routes else "GET")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; base-uri 'none'; frame-ancestors 'none'")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)
