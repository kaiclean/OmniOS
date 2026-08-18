#!/bin/zsh
# Start the OmniOS MCP server (lib/mcp/serve.ts) on stdio, for registration in
# an outside harness's MCP client (e.g. DeepSeek Harness's mcp-client plugin).
#
# Read-only by construction — see the module header in lib/mcp/serve.ts.
#
# The entry is TypeScript inside the Next app, so it runs through tsx with the
# `react-server` condition: that makes the store facade's `server-only` import
# resolve to its empty module instead of throwing outside Next.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$HOME/.omnios/env"

# Same env the server itself runs with, so OMNIOS_DATA_DIR / OMNIOS_STORE point
# at the real workspace rather than seeding a second one.
[[ -f "$ENV_FILE" ]] && { set -a; source "$ENV_FILE"; set +a; }

cd "$REPO"
NODE_OPTIONS="--conditions react-server ${NODE_OPTIONS:-}" exec npx -y tsx lib/mcp/serve.ts
