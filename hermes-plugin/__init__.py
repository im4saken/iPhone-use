"""iphone-screen — Hermes desktop pane mirroring the iPhone via iphone-use.

The Python half is a small proxy: ``dashboard/plugin_api.py`` forwards the
pane's REST calls to the iphone-use MCP server's loopback HTTP bridge
(``server/screen_http.py``, port published in ``screen-http.json``). No agent-side
hooks or tools — the UI half lives in ``desktop/plugin.js``.
"""
