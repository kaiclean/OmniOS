#!/bin/zsh
# The 12-hour heartbeat: proves the tunnel and the server are alive from the
# OUTSIDE, the way the founder's phone would reach them. Silent when healthy.
# On failure it kicks the launchd services once, re-checks, and only then
# raises a Telegram alert (if configured) — a heartbeat that cries on every
# blip trains its owner to ignore it.
set -uo pipefail

ENV_FILE="$HOME/.omnios/env"
LOG_DIR="$HOME/Library/Logs/omnios"
LOG="$LOG_DIR/heartbeat.log"
mkdir -p "$LOG_DIR"

log() { print -r -- "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $1" >> "$LOG"; }

if [[ ! -f "$ENV_FILE" ]]; then
  log "FAIL no env file at $ENV_FILE"
  exit 1
fi
set -a; source "$ENV_FILE"; set +a

if [[ -z "${OMNIOS_PUBLIC_URL:-}" || -z "${OMNIOS_ACCESS_KEY:-}" ]]; then
  log "FAIL OMNIOS_PUBLIC_URL or OMNIOS_ACCESS_KEY unset"
  exit 1
fi

check() {
  curl -fsS --max-time 20 \
    -H "X-OmniOS-Health-Key: $OMNIOS_ACCESS_KEY" \
    "$OMNIOS_PUBLIC_URL/api/health" 2>/dev/null | grep -q '"ok":true'
}

# Posture assert: the only node listener allowed is loopback:3000. Anything
# else is a listener that should not exist, and it goes in the alert.
listeners() {
  lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk '/node/ && $9 !~ /^127\.0\.0\.1:3000$/ {print $9}' | sort -u
}

if check; then
  STRAY="$(listeners)"
  if [[ -n "$STRAY" ]]; then
    log "OK but stray node listeners: ${STRAY//$'\n'/ }"
  else
    log "OK"
  fi
  exit 0
fi

log "DOWN — kickstarting services"
UID_NUM="$(id -u)"
launchctl kickstart -k "gui/$UID_NUM/com.omnios.server" 2>/dev/null || true
launchctl kickstart -k "gui/$UID_NUM/com.omnios.tunnel" 2>/dev/null || true
sleep 30

if check; then
  log "RECOVERED after kickstart"
  exit 0
fi

log "STILL DOWN after kickstart"
if [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]]; then
  curl -fsS --max-time 10 -X POST \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -H 'content-type: application/json' \
    -d "{\"chat_id\": \"${TELEGRAM_CHAT_ID}\", \"text\": \"OmniOS heartbeat: ${OMNIOS_PUBLIC_URL} is unreachable and a service restart did not recover it.\"}" \
    > /dev/null 2>&1 && log "alert sent via Telegram" || log "alert send failed"
fi
exit 1
