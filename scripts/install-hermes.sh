#!/usr/bin/env bash
# Install the iphone-screen Hermes plugin from this repo checkout.
# Idempotent: safe to re-run after every `git pull` on the hermes branch.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
CONFIG="$HERMES_HOME/config.yaml"

echo "repo:        $REPO"
echo "hermes home: $HERMES_HOME"

# 1. Agent half — link the package into the profile's plugins dir.
ln -sfn "$REPO/hermes-plugin" "$HERMES_HOME/plugins/iphone-screen"
echo "linked:      $HERMES_HOME/plugins/iphone-screen -> $REPO/hermes-plugin"

# 2. Enable the plugin in config.yaml (idempotent; surgical text insert — no reformat).
/usr/bin/python3 - "$CONFIG" <<'EOF'
import sys, yaml
path = sys.argv[1]
text = open(path).read()
lines = text.split("\n")

def entry_exists():
    for line in lines:
        if line.strip() == "- iphone-screen":
            return True
    return False

if entry_exists():
    print("enabled:     already in plugins.enabled")
else:
    # Locate the plugins: block and its enabled: list, then insert.
    plugin_at = next((i for i, l in enumerate(lines) if l.rstrip() == "plugins:"), None)
    enabled_at = next((i for i in range(plugin_at or 0, min((plugin_at or 0) + 30, len(lines)))
                       if lines[i].strip() == "enabled:"), None)
    if enabled_at is not None:
        lines.insert(enabled_at + 1, "    - iphone-screen")
        open(path, "w").write("\n".join(lines))
        print("enabled:     iphone-screen inserted (text edit, no reformat)")
    else:
        cfg = yaml.safe_load(text)
        cfg.setdefault("plugins", {})["enabled"] = ["iphone-screen"]
        yaml.safe_dump(cfg, open(path, "w"), default_flow_style=False, sort_keys=True, allow_unicode=True)
        print("enabled:     plugins.enabled missing — rebuilt via PyYAML (config reformatted)")
EOF

# 3. Point the MCP server at this repo checkout (single source of truth).
python3 - "$CONFIG" "$REPO/server/iphone_use.py" <<'EOF'
import sys
path, entry = sys.argv[1], sys.argv[2]
text = open(path).read()
old = "/Users/andy/Documents/tools/iPhone-use/server/iphone_use.py"
if entry in text:
    print("mcp server:  already points at repo checkout")
elif old in text:
    open(path, "w").write(text.replace(old, entry))
    print(f"mcp server:  repointed to {entry}")
else:
    print("mcp server:  iphone-use entry not found — check mcp_servers.iphone-use by hand")
EOF

cat <<'NOTES'

Done. Next steps (in the Hermes desktop app):
  1. ⌘K → "Reload desktop plugins"          (picks up the linked package)
  2. Capabilities → Plugins → toggle "iPhone Screen" ON   (defaultEnabled: false)
  3. The pane appears on the right; it shows 未连接 until the agent runs a
     pua_* screen tool once (that spawns the MCP server + bridge).

Troubleshooting:
  - Pane stuck on 连接中 but WDA is up → the MCP server process predates this
    checkout; ask the agent to run pua_ready (re-spawns it).
  - Port file: ~/.local/share/iphone-use/screen-http.json (0600, written by the
    bridge; read by the gateway proxy).
  - The pane and a Codex widget share one capture lease (5s); both can be live.
NOTES
