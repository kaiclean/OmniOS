#!/bin/zsh
# Runs the production server for launchd. Sourcing the 600-mode env file here —
# not in the plist — is what keeps secrets out of anything committed or
# world-readable. Binding 127.0.0.1 is the "no listeners" guarantee: the only
# way in from outside this machine is the outbound-only tunnel.
set -euo pipefail

ENV_FILE="$HOME/.omnios/env"
if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
fi

# launchd starts this script with the stock system PATH, which has neither
# Homebrew nor uv's install dirs — npm itself and every stdio MCP server the
# app spawns (npx, uvx) would be invisible. Locations only, never credentials;
# lib/mcp/client.ts appends the same list for the spawned servers themselves.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

cd "$(dirname "$0")/.."
export NODE_ENV=production
exec npm run start:local
