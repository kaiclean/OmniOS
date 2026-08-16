#!/bin/zsh
# Daily snapshot of everything OmniOS knows. The data dir is one JSON tree plus
# the vault key — which makes a backup exactly as sensitive as the live data,
# so the archive dir is 700, every archive 600, and neither ever leaves this
# machine unencrypted. Restore counterpart: ops/restore.sh.
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$HOME/.omnios/env"
LOG_DIR="$HOME/Library/Logs/omnios"
LOG="$LOG_DIR/backup.log"
mkdir -p "$LOG_DIR"

log() { printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" >> "$LOG"; }

[[ -f "$ENV_FILE" ]] && { set -a; source "$ENV_FILE"; set +a; }

DATA_DIR="${OMNIOS_DATA_DIR:-$REPO/.omnios-data}"
BACKUP_DIR="${OMNIOS_BACKUP_DIR:-$HOME/.omnios/backups}"
KEEP="${OMNIOS_BACKUP_KEEP:-14}"

# The store writes either plain JSON (workspace.json) or one SQLite file
# (omnios.sqlite) depending on OMNIOS_STORE; a backup covers both the same way.
if [[ ! -f "$DATA_DIR/workspace.json" && ! -f "$DATA_DIR/omnios.sqlite" ]]; then
  log "SKIP nothing to back up yet at $DATA_DIR"
  exit 0
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

STAMP="$(date -u '+%Y%m%d-%H%M%S')"
ARCHIVE="$BACKUP_DIR/omnios-$STAMP.tar.gz"

# The store writes files atomically but a backup can still race a rename and
# see a file vanish mid-walk; one retry rides out that window.
snapshot() { tar -czf "$ARCHIVE" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")" 2>/dev/null; }
if ! snapshot; then
  sleep 2
  if ! snapshot; then
    rm -f "$ARCHIVE"
    log "FAIL could not archive $DATA_DIR"
    exit 1
  fi
fi
chmod 600 "$ARCHIVE"

if ! tar -tzf "$ARCHIVE" | grep -qE '(workspace\.json|omnios\.sqlite)$'; then
  rm -f "$ARCHIVE"
  log "FAIL archive verification — neither workspace.json nor omnios.sqlite in listing"
  exit 1
fi

SIZE="$(du -h "$ARCHIVE" | cut -f1 | tr -d ' ')"
log "OK $ARCHIVE ($SIZE)"

# Retention: newest KEEP survive. Deletions are logged — a silent prune is how
# "I have backups" turns out to be false the day it matters.
ls -1 "$BACKUP_DIR"/omnios-*.tar.gz 2>/dev/null | sort -r | tail -n "+$((KEEP + 1))" | while read -r OLD; do
  rm -f "$OLD"
  log "pruned $OLD"
done
exit 0
