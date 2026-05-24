#!/usr/bin/env python3
"""Local SnareSense server with file-backed user persistence."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


APP_NAME = "SnareSense"


def default_data_file() -> Path:
    override = os.environ.get("SNARESENSE_DATA_FILE")
    if override:
        return Path(override).expanduser()

    if os.name == "posix" and (Path.home() / "Library").exists():
        return Path.home() / "Library" / "Application Support" / APP_NAME / "user-data.json"

    return Path.home() / ".snaresense" / "user-data.json"


DATA_FILE = default_data_file()


def load_data() -> dict:
    try:
        with DATA_FILE.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError:
        backup_path = DATA_FILE.with_suffix(".corrupt.json")
        DATA_FILE.replace(backup_path)
        return {}


def write_data(data: dict) -> None:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=DATA_FILE.parent,
        delete=False,
        prefix="user-data-",
        suffix=".tmp",
    ) as handle:
        json.dump(data, handle, indent=2, sort_keys=True)
        handle.write("\n")
        temp_name = handle.name

    Path(temp_name).replace(DATA_FILE)


class SnareSenseHandler(SimpleHTTPRequestHandler):
    def send_json(self, status: HTTPStatus, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/storage":
            self.send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "path": str(DATA_FILE),
                    "data": load_data(),
                },
            )
            return

        super().do_GET()

    def do_PUT(self) -> None:
        parsed = urlparse(self.path)
        prefix = "/api/storage/"
        if not parsed.path.startswith(prefix):
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        key = unquote(parsed.path[len(prefix) :]).strip()
        if not key or "/" in key:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid storage key"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0

        if length > 5_000_000:
            self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"ok": False, "error": "Payload too large"})
            return

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON"})
            return

        if not isinstance(payload, dict) or "value" not in payload:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Missing value"})
            return

        data = load_data()
        updated_at = payload.get("updatedAt")
        if not isinstance(updated_at, (int, float)):
            updated_at = None

        metadata = data.setdefault("__updatedAt", {})
        if not isinstance(metadata, dict):
            metadata = {}
            data["__updatedAt"] = metadata

        previous_updated_at = metadata.get(key)
        if (
            updated_at is not None
            and isinstance(previous_updated_at, (int, float))
            and updated_at < previous_updated_at
        ):
            self.send_json(HTTPStatus.OK, {"ok": True, "stale": True, "path": str(DATA_FILE)})
            return

        data[key] = payload["value"]
        metadata[key] = updated_at if updated_at is not None else 0
        write_data(data)
        self.send_json(HTTPStatus.OK, {"ok": True, "path": str(DATA_FILE)})


def main() -> None:
    parser = argparse.ArgumentParser(description="Run SnareSense locally.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=5173, type=int)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), SnareSenseHandler)
    print(f"SnareSense running at http://{args.host}:{args.port}")
    print(f"User data file: {DATA_FILE}")
    server.serve_forever()


if __name__ == "__main__":
    main()
