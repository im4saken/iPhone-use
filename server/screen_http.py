"""Loopback HTTP preview bridge for host apps without an MCP-Apps UI surface.

The Codex widget talks to this server over stdio; a Hermes desktop pane (or any
browser on the same machine) talks to it over loopback HTTP. Both front ends
share one ScreenHub: the 5-second capture lease arbitrates USB access, so at
most one visible client holds the MJPEG stream at a time.

Transport contract: ``GET /frame`` returns exactly what ``ScreenHub.frame()``
returns (the widget's Preview shape); ``POST /action`` returns what
``Runtime.screen_action()`` returns. The pane polls; nothing here calls WDA
except the refresh probe. Loopback-only: 127.0.0.1, no auth of its own — the
pane reaches it through the Hermes gateway's ``/api/plugins/<id>`` proxy, and
the port is published in a 0600 state file.
"""
from __future__ import annotations

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import urllib.parse

DEFAULT_PORT = 18199


class _Handler(BaseHTTPRequestHandler):
    server_version = "iPhoneUseScreen/1"

    def log_message(self, format, *args):
        pass  # stdout is the MCP stdio pipe.

    def _send(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parts = urllib.parse.urlsplit(self.path)
        if parts.path != "/frame":
            self._send(404, {"error": {"code": "not_found"}})
            return
        query = urllib.parse.parse_qs(parts.query)
        try:
            after_seq = int((query.get("after_seq") or ["0"])[0])
            last_event_id = int((query.get("last_event_id") or ["0"])[0])
        except ValueError:
            self._send(400, {"error": {"code": "bad_request"}})
            return
        data = self.server.hub_frame(after_seq, last_event_id)  # type: ignore[attr-defined]
        self._send(200, data)

    def do_POST(self):
        parts = urllib.parse.urlsplit(self.path)
        if parts.path != "/action":
            self._send(404, {"error": {"code": "not_found"}})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length)) if length else {}
        except (ValueError, OSError):
            self._send(400, {"error": {"code": "bad_request"}})
            return
        data = self.server.hub_action(body.get("action"))  # type: ignore[attr-defined]
        self._send(200, data)


class ScreenHttpServer:
    """A daemon-thread HTTP server bound to 127.0.0.1; publish_port() writes the
    port into a 0600 file so an out-of-process proxy can find it."""

    def __init__(self, state_dir: Path, frame_fn, action_fn, port: int = DEFAULT_PORT):
        self.state_dir = Path(state_dir)
        self._frame_fn = frame_fn
        self._action_fn = action_fn
        self.port = port
        self._httpd: ThreadingHTTPServer | None = None
        self._lock = threading.Lock()

    def _hub_frame(self, after_seq: int, last_event_id: int):
        try:
            return self._frame_fn(after_seq=after_seq, last_event_id=last_event_id)
        except Exception as exc:  # the pane treats any error as "offline"
            return {"error": {"code": "preview_unavailable", "message": str(exc)}}

    def _hub_action(self, action):
        try:
            return self._action_fn(action)
        except Exception as exc:
            return {"error": {"code": "action_failed", "message": str(exc)}}

    def start(self) -> bool:
        with self._lock:
            if self._httpd is not None:
                return True
            try:
                httpd = ThreadingHTTPServer(("127.0.0.1", self.port), _Handler)
            except OSError:
                return False
            httpd.daemon_threads = True
            httpd.hub_frame = self._hub_frame  # type: ignore[attr-defined]
            httpd.hub_action = self._hub_action  # type: ignore[attr-defined]
            thread = threading.Thread(target=httpd.serve_forever, name="screen-http", daemon=True)
            thread.start()
            self._httpd = httpd
            self.port = httpd.server_address[1]
            self._publish_port()
            return True

    def _publish_port(self):
        path = self.state_dir / "screen-http.json"
        payload = json.dumps({"port": self.port}, separators=(",", ":"))
        try:
            fd = os.open(path, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as stream:
                stream.write(payload)
        except OSError:
            pass

    @property
    def address(self) -> str | None:
        if self._httpd is None:
            return None
        host, port = self._httpd.server_address[:2]
        return f"http://{host}:{port}"

    def close(self):
        with self._lock:
            httpd, self._httpd = self._httpd, None
        if httpd is not None:
            try:
                httpd.shutdown()
                httpd.server_close()
            except OSError:
                pass
