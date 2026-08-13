#!/bin/zsh
# One-command install of OmniOS remote access on a Mac. Idempotent: run it
# again after pulling changes and it rebuilds and reloads everything.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
UID_NUM="$(id -u)"
AGENTS="$HOME/Library/LaunchAgents"
ENV_FILE="$HOME/.omnios/env"

echo "OmniOS remote-access setup"
echo "repo: $REPO"

# 1. Prerequisites — report, never auto-install.
if ! command -v node >/dev/null || [[ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -lt 22 ]]; then
  echo "✗ Node 22+ required (brew install node)"; exit 1
fi
echo "✓ node $(node --version)"
TUNNEL_BIN=""
if command -v cloudflared >/dev/null; then
  TUNNEL_BIN="$(command -v cloudflared)"
  echo "✓ cloudflared at $TUNNEL_BIN"
elif command -v tailscale >/dev/null; then
  echo "✓ tailscale present (no tunnel plist needed — see docs/MOBILE.md option B)"
else
  echo "· no tunnel binary yet — install one:"
  echo "    brew install cloudflared      # public URL (needs a domain on Cloudflare)"
  echo "    brew install tailscale        # private tailnet (Tailscale app on the phone)"
fi

# 2. Env file — created once, owned by you alone.
if [[ ! -f "$ENV_FILE" ]]; then
  mkdir -p "$(dirname "$ENV_FILE")"
  cp "$REPO/ops/env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "✓ created $ENV_FILE (chmod 600)"
  echo "  → set OMNIOS_ACCESS_KEY now; a strong one:"
  echo "    openssl rand -base64 32"
else
  chmod 600 "$ENV_FILE"
  echo "✓ $ENV_FILE exists"
fi

# 3. Build.
cd "$REPO"
npm ci
npm run build
echo "✓ built"

# 4. launchd services — template placeholders, install, (re)load.
mkdir -p "$AGENTS" "$HOME/Library/Logs/omnios"
for PLIST in com.omnios.server com.omnios.heartbeat com.omnios.backup; do
  sed -e "s|__OMNIOS_REPO__|$REPO|g" -e "s|__OMNIOS_HOME__|$HOME|g" \
    "$REPO/ops/launchd/$PLIST.plist" > "$AGENTS/$PLIST.plist"
  launchctl bootout "gui/$UID_NUM" "$AGENTS/$PLIST.plist" 2>/dev/null || true
  launchctl bootstrap "gui/$UID_NUM" "$AGENTS/$PLIST.plist"
  echo "✓ loaded $PLIST"
done
if [[ -n "$TUNNEL_BIN" ]]; then
  sed -e "s|__OMNIOS_REPO__|$REPO|g" -e "s|__OMNIOS_HOME__|$HOME|g" -e "s|__CLOUDFLARED__|$TUNNEL_BIN|g" \
    "$REPO/ops/launchd/com.omnios.tunnel.plist" > "$AGENTS/com.omnios.tunnel.plist"
  launchctl bootout "gui/$UID_NUM" "$AGENTS/com.omnios.tunnel.plist" 2>/dev/null || true
  launchctl bootstrap "gui/$UID_NUM" "$AGENTS/com.omnios.tunnel.plist"
  echo "✓ loaded com.omnios.tunnel"
fi

echo
echo "Verify:"
echo "  launchctl list | grep omnios"
echo "  lsof -nP -iTCP -sTCP:LISTEN | grep node     # must show only 127.0.0.1:3000"
echo "  ops/heartbeat.sh && tail -1 ~/Library/Logs/omnios/heartbeat.log"
echo
echo "Full runbook: docs/MOBILE.md"
