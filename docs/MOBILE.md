# OmniOS from your phone

OmniOS on an always-on Mac, reached from an iPhone anywhere, through a tunnel
that makes only outbound connections — **no open ports, no listeners** — behind
an access key that gates every page and API. A heartbeat proves the whole path
alive every 12 hours and restarts it if it is not.

## What the access key protects — and what it does not

Setting `OMNIOS_ACCESS_KEY` locks every page, Server Action and API behind a
signed session cookie. The Telegram webhook keeps its own secret, and
`/api/health` accepts the key as a header so the heartbeat can check from
outside. Rotating the key invalidates **every session ever issued** — the
cookie signature derives from it. What it does not do: encrypt data at rest
(the vault's `.secret-key` does that for secrets; workspace records are plain
JSON on your disk), or protect a stolen, unlocked Mac. If that is your threat,
FileVault and a lock screen are the tools.

## 1 · Prerequisites

- A Mac that stays on (Mac Mini is ideal). Node 22+ (`brew install node`).
- One of:
  - **Cloudflare Tunnel** — a public `https://os.your-domain.com` reachable
    from any network. Needs a domain on Cloudflare (free plan is fine).
    `brew install cloudflared`
  - **Tailscale** — zero public exposure; only devices in your tailnet reach
    it, and your iPhone runs the Tailscale app. `brew install tailscale`

## 2 · Access key and env file

```sh
openssl rand -base64 32        # this is your access key — keep it in a password manager
```

Run `ops/setup-mac.sh` once (next step) — it creates `~/.omnios/env` from
`ops/env.example` with `chmod 600`. Fill in `OMNIOS_ACCESS_KEY` and, once the
tunnel exists, `OMNIOS_PUBLIC_URL`. Optionally add `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_CHAT_ID` so a dead heartbeat pings your phone.

## 3 · Install the services

```sh
git clone https://github.com/kaiclean/OmniOS.git && cd OmniOS
ops/setup-mac.sh
```

The script checks prerequisites, builds the app, and installs three launchd
services: `com.omnios.server` (production server bound to **127.0.0.1 only**),
`com.omnios.tunnel` (if cloudflared is installed), and `com.omnios.heartbeat`
(every 12 hours + on boot). Re-run it any time — it is idempotent.

## 4a · Tunnel, option A: Cloudflare (public URL)

```sh
cloudflared tunnel login                 # opens the browser, pick your domain
cloudflared tunnel create omnios
cloudflared tunnel route dns omnios os.your-domain.com
cp ops/tunnel/cloudflared-config.example.yml ~/.cloudflared/config.yml
# edit config.yml: your username, the tunnel id from `create`, your hostname
ops/setup-mac.sh                         # picks up cloudflared, loads the tunnel service
```

Set `OMNIOS_PUBLIC_URL=https://os.your-domain.com` in `~/.omnios/env`.

## 4b · Tunnel, option B: Tailscale (private tailnet)

```sh
tailscale up
tailscale serve --bg https / http://127.0.0.1:3000
```

Install the Tailscale app on the iPhone, sign in to the same tailnet, and set
`OMNIOS_PUBLIC_URL=https://<your-mac>.<tailnet>.ts.net`. No tunnel service is
needed — Tailscale runs its own daemon. This option never exposes anything to
the public internet at all.

## 5 · iPhone

1. Open the URL in Safari. The unlock screen appears — enter the access key
   and let the password manager save it.
2. Share → **Add to Home Screen**. OmniOS installs as a standalone app: its
   own icon, no browser chrome, dark launch frame, safe-area aware.

## 6 · Verify

```sh
launchctl list | grep omnios                      # three services, exit code 0
lsof -nP -iTCP -sTCP:LISTEN | grep node           # ONLY 127.0.0.1:3000 — nothing else
ops/heartbeat.sh && tail -1 ~/Library/Logs/omnios/heartbeat.log   # "OK"
curl -s -o /dev/null -w '%{http_code}\n' https://YOUR_URL/        # 307 → /login
curl -s -o /dev/null -w '%{http_code}\n' https://YOUR_URL/api/brain-graph  # 401
```

In the app, **Security Center → Last heartbeat** shows the most recent beat,
and **Access key → Set** confirms the gate is up.

## 7 · Rotating the key

Edit `OMNIOS_ACCESS_KEY` in `~/.omnios/env`, then
`launchctl kickstart -k gui/$(id -u)/com.omnios.server`. Every existing
session dies instantly — the cookie signature derives from the key, so
rotation *is* revocation. Log in again on the phone and update the password
manager.

## Troubleshooting

- `launchctl list` missing a service → re-run `ops/setup-mac.sh`; read
  `~/Library/Logs/omnios/server.log`.
- Heartbeat logs `DOWN` then `RECOVERED` → the kickstart worked; nothing to do.
- `STILL DOWN` alert → check the tunnel first (`tunnel.log`), then the server
  log; `curl -H "X-OmniOS-Health-Key: $KEY" http://127.0.0.1:3000/api/health`
  from the Mac isolates server-vs-tunnel.
- Locked out after rotating → the old cookie is dead by design; log in again.
