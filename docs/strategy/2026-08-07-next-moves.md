# OmniOS — endgame strategy, 2026-08-07

## The decision, above the fold

**Position: roughly 35 of 100** against the stated endgoal, with the foundation
disproportionately ahead of the product surface. 23 commits, 163 files, ~29,800
lines of strict TypeScript, 263 passing tests, 30 gated tools, 15 routes —
and a safety architecture (risk tiers, approvals, vault, MCP bridge) that is
genuinely load-bearing, not theatre.

**The load-bearing uncertainty:** every external action OmniOS can take has
only ever been proven against a test fixture this project wrote for itself.
No real third-party MCP server has ever been connected. No real model call has
ever been made — every conversation so far ran on keyword routing and
templates. The entire outward half of the product — the half the founder asked
for ("create a website, post to social, manage the account") — rests on two
assumptions nobody has tested: that a real server's tools bridge cleanly, and
that the provider path works on first contact with a real key.

**Retiring that risk costs ~15 minutes and no code:**

1. On `/connections`, add the **Web fetch** preset (`npx -y
   @modelcontextprotocol/server-fetch`) — it needs **no credentials** — enable
   it, press Connect. If tools appear with risk tiers, the entire
   outward chain (probe → bridge → gate) is proven against reality.
2. Store an `ANTHROPIC_API_KEY` in the vault on the same page. Ask the
   assistant one question. If the reply stops carrying "generated locally",
   the provider path is proven.

**The top move after that:** ship the acting pipeline (universal-assistant
Phase 3, `docs/UNIVERSAL_ASSISTANT_PLAN.md`) before meetings, agents, or
workspace types. Every remaining spec — meetings that execute, missions,
"add a Gym section" — reduces to *natural language → gated tool calls*. Built
before acting works, the meeting system is chat theatre; built after, it
inherits execution for free.

## Stated goal vs revealed goal

Stated (PRD, CLAUDE.md): a lifelong AI Operating System the founder actually
runs companies and life from, with one assistant that acts.

Revealed (last 12 commits): trust and acting infrastructure — the gate, the
vault, MCP, the launch programme, page context, the brain graph. The
divergence is honest (infrastructure was genuinely missing) but it hides the
uncomfortable fact: **the workspace still contains only the generated sample.
The founder's real companies have never been entered.** A lifelong OS with
zero days of real usage has not yet tested its central hypothesis — that its
owner will operate from it. No amount of further building tests that; only
usage does. The reset-to-empty flow already exists (Settings → Reset).

## What is real / theatre / scaffolding

**Real (verified by running):** the approval gate end-to-end (8 external calls
queued, one approved, executed against a live MCP server over stdio, decider
recorded); vault crypto (empirically tested); deterministic generation; the
brain graph (aggregation-door only, 5 integrity tests); page context
isolation (guard test).

**Honest theatre (declared, deliberate):** `send_email` / `publish_post` /
`call_webhook` executors refuse by design — they exist to prove the gate.
Fine, but they mean "the assistant can publish" is still a false sentence
until a real connector replaces them.

**Scaffolding with a due date:** `CustomAgent` — a complete type and
collection that nothing reads; the debt comes due in the meetings/agents
phase. The Copilot's never-resyncing `initialMessages` — due in conversations
(Phase 5). Filesystem JSON store — fine for one founder, due only if
multi-device ever matters.

## Cheap wins (do before anything else)

| # | Win | Size |
|---|-----|------|
| 1 | Connect the credential-less **fetch** MCP preset for real; probe it | ~10 min, user action |
| 2 | Put a real provider key in the vault; ask one question | ~5 min, user action |
| 3 | `npm audit` — 3 high + 1 critical flagged; confirm they are dev-only (playwright chain) or fix | ~20 min |
| 4 | Decide sample vs real workspace; if real, run the existing Reset and create the first real company | ~15 min, user action |

## Option table (scored, top 6 of 13 generated)

| Move | EV toward goal | Cost | Reversible | Kill criterion |
|---|---|---|---|---|
| Real-server + real-key test (above) | Retires the largest risk in the codebase | 15 min | Yes | Bridge or provider fails → fix before building anything on them |
| Acting pipeline (Phase 3: detectAct + completeWithTools + inline proposals) | Every spec downstream needs it | 2–3 days | Yes | Local path <60% on the phrasing table and no key available → revisit |
| Rich composer + modes (Phase 2) | The daily-use surface | 2 days | Yes | — |
| Trust layer with scoped grants | Makes autonomous execution real | 2–3 days | Grants revocable by design | A grant path that loosens `destructive` → stop, redesign |
| Playwright smoke suite (compounding) | This session found 9+ bugs only by rendering; codify it | ~half day | Yes | — |
| Meetings system | High visible value | 4–5 days | Yes | Building it before acting works → it demos but cannot execute |

Generated and rejected for now: workspace types first (independent but doesn't
unblock anything), DB backend swap (no current pain), streaming output
(polish), model-titled conversations (determinism), deleting the launch
programme in favour of missions (it is the missions prototype — keep).

## Waves

- **Wave 0 — prove reality** (today, mostly founder actions): cheap wins 1–4.
  *Gate: a real remote tool listed with risk tiers on Connections, and one
  assistant reply not marked "generated locally".*
- **Wave 1 — the assistant acts** (Phases 2+3): rich composer, modes,
  detectAct, inline approve/reject in chat. *Gate: "create a task called X for
  tomorrow" works by typing it; "post an update" queues an external call with
  a preview, end-to-end in a browser.*
- **Wave 2 — trust** (grants, catalog, security center, audit view). *Gate: a
  time-limited grant lets a specific external tool run ungated, is logged, and
  revoking it restores the queue — all covered by tests.*
- **Wave 3 — the organisation** (meetings on top of acting+grants, custom
  agents wired into the router, direct chats via conversations). *Gate: a
  meeting produces a plan whose approved steps execute as tool calls with an
  execution view.*
- **Wave 4 — the OS feel** (conversations, layouts/page-editing, onboarding,
  help). *Gate: fresh install to configured workspace entirely through the
  welcome flow.*
- **Wave 5 — breadth** (workspace types, adaptive metrics, mission control,
  timeline).

## Not worth doing yet

- **More sample-data generators** — the sample is rich enough; real usage is
  the scarce input now.
- **OAuth infrastructure** — until two real MCP connectors are in daily use,
  manual tokens through the vault are proportionate.
- **New panel kinds / more 3D polish** — the brain is stunning; it earns more
  investment when the data underneath it comes from real work.
- **Voice beyond Web Speech, multi-user, DB adapter** — no current forcing
  function.

## Open questions (only the founder can answer)

1. Do you have an Anthropic or OpenAI key to put in the vault today? (Wave 0
   hinges on it; everything conversational is templates until then.)
2. Which real outward service matters first — GitHub (ship code) or a social
   platform (publish content)? That decides which real connector Wave 2's
   grant design is tested against.
3. Is the sample workspace done its job? If yes, reset and enter Meridian-
   whatever-is-real; the learning engine has been waiting for real
   interactions since it was built.
