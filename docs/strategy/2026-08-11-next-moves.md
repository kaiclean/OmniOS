# OmniOS — next moves (2026-08-11)

## The decision

**Position: build ~85/100, endgoal ~45/100.** The software is real — 64 commits on main (+2 in PR #18), 245 files, ~39,400 lines of strict TypeScript, 390 tests green in CI at head `ceae930`, auth matrix and mobile UX verified against the running production build. But the endgoal is not software; it is *Kai operating his companies and life through OmniOS daily*. Measured against that: **0 deployments, 0 days of real use, and OmniOS has never held a real fact about Kai's life.** Every record in it is seeded and labelled simulated.

**Load-bearing uncertainty: "Kai will actually run his life through this."** Five capability waves shipped against that untested assumption. If it is false, most further capability work is invalidated. The test costs ~1 hour of setup plus one honest week — orders of magnitude cheaper than another build wave.

**Do these first (≈1 hour, mostly Kai-side):**
1. **Merge PR #18** — green, clean, everything queues behind it. (2 min)
2. **Rotate the Ollama API key** — it transited chat once; rotation was already the standing recommendation. (5 min)
3. **Deploy per `docs/MOBILE.md`** — generate key, run `ops/setup-mac.sh`, pick a tunnel, Add to Home Screen. (30–45 min) *Recommendation: start with Tailscale — 10 minutes, no domain required, zero public exposure. Add the Cloudflare hostname later if a public URL earns its keep.*

**Top move after that: make dogfooding real, then dogfood.** Replace the simulated companies with Kai's actual ones, verify the live-model path end-to-end once, then use OmniOS daily for a week with a friction journal. Build nothing new until that week has data. The next capability wave should be chosen by real friction, not by what is interesting to build.

---

## 1 · The endgoal, stated back

From `CLAUDE.md` and the PRD: one place holding every company, every reusable capability, and private life, with a single AI Executive Assistant across all of it — gated so nothing applies itself. **"Done" for the current phase:** OmniOS running on Kai's always-on Mac, reachable from the iPhone through the outbound-only tunnel, holding Kai's real companies and real life data, used every day, with the assistant consulted (and acting, behind the gates) on real decisions.

The stated goal and the revealed goal (last ~30 commits) diverge in one specific way: the commits build *capability and access*; none of them are *operation*. That divergence is the finding. The project has been driving toward "feature-complete" while the goal requires "in daily use." PR #18 exists precisely to close that gap — which is why deploying it beats building anything else.

## 2 · What is real, theatre, scaffolding

**Real (verified):** the approval gate and grants (pinned by `tests/grants.test.ts`, `tests/tools.test.ts`); scope isolation (pinned by `tests/boundaries.test.ts`); the act loop; the auth gate, token crypto and protection predicate (live curl matrix against the production build); PWA install assets; Telegram webhook (live-tested earlier); the full verify pipeline in CI, twice green at head.

**Honest theatre (labelled, by design — but still theatre against the endgoal):** every workspace record is seeded/simulated per invariant 5. The assistant's "Local reasoning · no model" mode is deterministic simulation. Correct as a demo posture; irrelevant as an operating system until real data arrives.

**Scaffolding (real, with a named debt-payment date):** the filesystem JSON store — fine for one user on one Mac; the bill arrives with concurrent writers (tunnel + Telegram + UI) and with the first data-loss scare, because **there is no backup story**. The `ops/` scripts and launchd plists — code-reviewed and shell-checked, never executed on the actual Mac; the bill arrives on first `setup-mac.sh` run. The live-model path — exercised against Ollama earlier in this project's history, but Anthropic tool-calling has never been verified against the live API, and the vault held only `OLLAMA_API_KEY` (remembered from this session; not re-verified today — reading the secrets file is correctly blocked).

## 3 · Options considered (generated wide, then scored)

| # | Move | EV toward endgoal | Cost | Reversible | Verdict |
|---|------|-------------------|------|------------|---------|
| A | **Dogfood week with friction journal** | Tests the whole point | ~0 build, 1 wk calendar | — | **Do (Wave 3)** |
| B | **Live-model smoke** (ask() + one gated act-loop round trip) | Proves the "AI" in AI OS | 0.5 d | yes | **Do (Wave 1)** |
| C | **Backup + restore drill** (`ops/backup.sh`, daily launchd, documented restore) | Protects everything, forever | 0.5 d | yes | **Do (Wave 2)** |
| D | E2E Playwright suite in CI (auth matrix + core journeys) | Compounding; every wave has cost hours of manual browser QA | 1–2 d | yes | Do after C |
| E | Daily brief (Telegram morning digest / Today panel) | Retention ritual; makes daily use sticky | 1 d | yes | Candidate after dogfood |
| F | **Real-data onboarding** (Kai's actual companies replace seeds) | Without it, dogfooding measures nothing | 0.5–1 d | yes | **Do (Wave 1)** |
| G | Connections "test provider" button + Anthropic live verify | Surfaces B permanently | folds into B | yes | Do with B |
| H | Attachments / voice in composer | Backlog capability | 1–2 d | yes | **Not yet** |
| I | Workspace types + adaptive metrics | Backlog capability | 1–2 d | yes | **Not yet** |
| J | Store locking / multi-writer hardening | No evidence it hurts yet | 1 d | yes | **Not yet** |
| K | Subtract: prune merged branches; single CI run per push (two `verify` runs fire today) | Hygiene | 0.5 h | yes | Fold into housekeeping |
| L | iOS capture path (share-sheet/Shortcut → Telegram → workspace) | Capture friction kills life-OS habits | 1 d | yes | Candidate after dogfood |

The ranking surprised the backlog: the stated backlog (H, I) lands in "not yet," and the top of the table is operation, verification, and durability — none of which were on it.

## 4 · The plan, in waves with gates

**Wave 0 — Ship the loop closed** *(Kai, ~1 h)*
Merge #18 → rotate Ollama key → `docs/MOBILE.md` runbook (key, `setup-mac.sh`, tunnel, PWA).
**Gate:** Security Center shows a heartbeat recorded by the launchd job; OmniOS opens from the iPhone over the tunnel; `lsof` shows loopback only.

**Wave 1 — Make dogfooding real** *(me, ~1 d)*
Real-data onboarding for Kai's actual companies and life spaces (simulated marks remain only on genuinely generated content); live-model smoke of ask() + one gated act-loop call; "Test provider" surfaced in Connections.
**Gate:** a real model answers a real question about real data; one gated tool call round-trips live with a recorded decision.

**Wave 2 — Durability** *(me, ~0.5 d)*
`ops/backup.sh` + daily launchd job + documented restore; execute one restore drill.
**Gate:** wipe → restore → identical render, proven once. *(E2E-in-CI (D) follows here if appetite allows.)*

**Wave 3 — Dogfood week** *(Kai + me, 1 wk calendar)*
Daily use; every annoyance captured in-app (`/remember` works for this) or to Telegram.
**Gate:** ≥5 days of use, ≥10 friction items captured.

**Wave 4 — Fix what the week surfaced** *(me, sized by Wave 3)*
Only after this does new capability (E daily brief, L capture path, H, I) compete for a slot — ranked by observed friction.

## 5 · Not worth doing yet — and what would change that

- **Attachments/voice (H)** — until the composer is the observed bottleneck in Wave 3.
- **Workspace types / adaptive metrics (I)** — until real data reveals its actual shape.
- **Store replacement or locking (J)** — until a concurrent-write bug is actually observed; the `WorkspaceStore` seam makes the swap one line when it comes.
- **Serverless/Vercel production deploy** — incompatible with the filesystem store; documented as demo-only. Would need a hosted store first, and nothing currently justifies one.
- **More agent/specialist capability** — the roster already exceeds observed usage, which is zero.

## 6 · Open questions (these are the real bottleneck)

1. **Merge #18?** Everything queues behind it. *(2 min)*
2. **Tunnel choice** — Tailscale (private, 10 min, no domain) vs Cloudflare (public URL, needs a domain on Cloudflare). Recommendation: Tailscale now, Cloudflare only if a public URL proves necessary.
3. **Provider of record** — stay on Ollama cloud (key exists) or add an Anthropic key to the vault for the primary assistant? Decides what Wave 1's smoke test targets.
4. **Key rotation confirmed?** Both the Ollama key (transited chat) and generation of the new `OMNIOS_ACCESS_KEY`.
5. **The real company list** — names and a handful of true numbers for Wave 1 onboarding. Only Kai has these.

---
*Numbers measured today: `git ls-files | wc -l` = 245; TS/TSX LOC = 39,371; commits on main = 64 (+2 on the PR branch); 34 test files; 390 tests per CI at `ceae930` (both `verify` runs green). Fractions (85/100 build, 45/100 endgoal) are judgments, argued above.*
