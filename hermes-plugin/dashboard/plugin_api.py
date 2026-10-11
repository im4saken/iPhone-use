"""Backend for the iphone-screen desktop pane.

Forwards the pane's REST calls to the iphone-use MCP server's loopback HTTP
bridge (``server/screen_http.py``). The bridge publishes its port in a 0600
file inside the iphone-use state dir; this process runs as the same user, so
it can read that file where a renderer could not.

Everything degrades to a 200 with an "offline" shape: the pane polls, and the
bridge only exists while the MCP server is running. Never 5xx — a missing
bridge means "not connected", not "broken".
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

from fastapi import APIRouter, Request

router = APIRouter()

DEFAULT_STATE_DIR = os.environ.get("IPHONE_USE_STATE_DIR") or (
    Path.home() / ".local" / "share" / "iphone-use"
)
FRAME_TIMEOUT = 4.0
ACTION_TIMEOUT = 13.0

# The pane's full offline shape — matches what ScreenHub.frame() returns live,
# minus the frame bytes. service_ready:false lets the pane say "not connected"
# instead of "connecting".
_OFFLINE_FRAME = {
    "server_time": 0,
    "frame": None,
    "stream_id": None,
    "device": None,
    "frame_available": False,
    "viewport": None,
    "busy": False,
    "paused": False,
    "pause_reason": None,
    "events": [],
    "service_ready": False,
}


def _bridge_port() -> int | None:
    """Read the port published by screen_http.py; None when the MCP server is down."""
    try:
        raw = (Path(DEFAULT_STATE_DIR).expanduser() / "screen-http.json").read_text()
        port = int(json.loads(raw).get("port", 0))
    except (OSError, ValueError):
        return None
    return port if 0 < port < 65536 else None


def _wda_url() -> str | None:
    """WDA's loopback URL from the iphone-use config; 18100 is its documented default."""
    try:
        raw = (Path(DEFAULT_STATE_DIR).expanduser() / "config.json").read_text()
        port = int(json.loads(raw).get("local_port", 18100))
    except (OSError, ValueError):
        return None
    return f"http://127.0.0.1:{port}" if 0 < port < 65536 else None


def _probe_service_ready() -> bool:
    """WDA /status probe — the pane's way of telling 'connecting' from 'offline'."""
    url = _wda_url()
    if url is None:
        return False
    try:
        with urllib.request.urlopen(url + "/status", timeout=2) as response:
            return (json.loads(response.read().decode("utf-8")).get("value") or {}).get("ready") is True
    except (OSError, ValueError):
        return False


def _forward(path: str, query: dict[str, object] | None, body: bytes | None, timeout: float) -> dict | None:
    """GET/POST one bridge endpoint; returns the JSON payload, or None when the bridge is unreachable."""
    port = _bridge_port()
    if port is None:
        return None
    url = f"http://127.0.0.1:{port}{path}"
    if query:
        url += "?" + "&".join(f"{k}={v}" for k, v in query.items())
    request = urllib.request.Request(url, data=body, method="POST" if body is not None else "GET")
    if body is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except (OSError, ValueError):
        return None


@router.get("/frame")
async def frame(request: Request):
    after_seq = request.query_params.get("after_seq", "0")
    last_event_id = request.query_params.get("last_event_id", "0")
    payload = _forward("/frame", {"after_seq": after_seq, "last_event_id": last_event_id}, None, FRAME_TIMEOUT)
    if payload is None:
        return dict(_OFFLINE_FRAME)
    if "service_ready" not in payload and payload.get("frame_available") is False:
        # ScreenHub.frame() never carries service_ready; while the stream is idle
        # the pane cannot tell "WDA down" from "connecting", so probe WDA itself.
        # Live frames skip the probe — a frame on screen already proves readiness.
        payload = dict(payload, service_ready=_probe_service_ready())
    return payload


@router.post("/action")
async def action(request: Request):
    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError):
        body = {}
    action_name = body.get("action") if isinstance(body, dict) else None
    payload_bytes = json.dumps({"action": action_name}).encode("utf-8") if isinstance(action_name, str) else None
    payload = _forward("/action", None, payload_bytes, ACTION_TIMEOUT)
    if payload is None:
        return {"ok": False, "service_ready": False, "error": {"code": "bridge_unavailable", "message": "iPhone Use server is not running."}}
    return payload


@router.get("/status")
async def status():
    port = _bridge_port()
    return {"mcp_running": port is not None, "port": port}
