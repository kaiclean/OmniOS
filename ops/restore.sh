#!/bin/zsh
# Restore a backup made by ops/backup.sh. Never destructive: the current data
# dir is moved aside, not deleted, so a restore can itself be undone.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$HOME/.omnios/env"

if [[ $# -ne 1 || ! -f "${1:-}" ]]; then
  echo "usage: ops/restore.sh <backup .tar.gz>"
  echo "backups live in \${OMNIOS_BACKUP_DIR:-~/.omnios/backups}"
  exit 1
fi
ARCHIVE="$1"

[[ -f "$ENV_FILE" ]] && { set -a; source "$ENV_FILE"; set +a; }
DATA_DIR="${OMNIOS_DATA_DIR:-$REPO/.omnios-data}"
PARENT="$(dirname "$DATA_DIR")"
BASE="$(basename "$DATA_DIR")"

if ! tar -tzf "$ARCHIVE" | grep -qE "^$BASE/(workspace\.json|omnios\.sqlite)$"; then
  echo "✗ $ARCHIVE does not contain $BASE/workspace.json or $BASE/omnios.sqlite — not an OmniOS backup for this data dir"
  exit 1
fi

if [[ -d "$DATA_DIR" ]]; then
  ASIDE="$DATA_DIR.pre-restore-$(date -u '+%Y%m%d-%H%M%S')"
  mv "$DATA_DIR" "$ASIDE"
  echo "✓ current data moved to $ASIDE (delete it yourself once satisfied)"
fi

tar -xzf "$ARCHIVE" -C "$PARENT"
echo "✓ restored $ARCHIVE → $DATA_DIR"

# A running server holds the old state in memory; bounce it if launchd is here.
if command -v launchctl >/dev/null 2>&1; then
  launchctl kickstart -k "gui/$(id -u)/com.omnios.server" 2>/dev/null \
    && echo "✓ server restarted" \
    || echo "· server not under launchd here — restart it yourself"
fi
