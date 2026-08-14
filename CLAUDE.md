# CLAUDE.md — OmniOS operating contract

## What this is

OmniOS is Kai's lifelong AI Operating System: every company, every reusable
capability, and private life in one place, with a single AI Executive Assistant
across all of it.

Read [`AI_OPERATING_SYSTEM_PRD.md`](./AI_OPERATING_SYSTEM_PRD.md) for the product
and [`docs/DECISIONS.md`](./docs/DECISIONS.md) for why the architecture is the
way it is, before changing anything structural.

Stack: Next.js 16 App Router · React 19 · TypeScript strict with
`noUncheckedIndexedAccess` · Zod at form boundaries · vitest · plain CSS with
design tokens. No UI framework, no ORM, no state library. Node 22 (`.nvmrc`).

## Truth hierarchy

1. What the app does when you run it
2. Tests
3. `AI_OPERATING_SYSTEM_PRD.md` and `docs/DECISIONS.md`
4. Comments

If those disagree, the code is right and the docs need fixing — say so.

## The six invariants

These are the product. Breaking one is never a refactor, it is a regression.

1. **Scope isolation is structural.** Every store read names a scope. There is no
   `readEverything()` and there must never be one. Cross-space aggregation lives
   only in `lib/data/aggregate.ts`; **nothing under `lib/ai/` may import it.**
2. **Nothing applies itself.** Three gates, one rule.
   - `UpgradeCandidate.stage` may reach `awaiting-approval` autonomously and no
     further. Anything that could write `applied` without a recorded human
     decision is a bug, not a feature.
   - An automation whose steps are `external` refuses to run and records
     `awaiting-approval` instead.
   - A tool executes only when `requiresApproval(tool.risk, policy)` is false.
     Ask the function, never hard-code the tier — `destructive` and `external`
     stop and wait for a recorded decision, and no caller may route around that.
     `ApprovalPolicy` may only ever *tighten*; adding a field to it that lets a
     gated tier run itself is the one change this file forbids outright.

   The gate has two halves and both are load-bearing. `runTool` refuses;
   `lib/actions/tools.ts` is where a decision gets written down, *before* the
   call runs. A path that executes a gated call without first persisting who
   decided and when is a regression even if the founder did click the button.

   A `PermissionGrant` is that same decision recorded in advance — exact
   (server, tool, scope) triple, optionally expiring, revocable, and every call
   under it names it by `grantId`. Grants reach only `mcp:*` tools;
   `parseMcpToolId` refusing built-in ids is what keeps `destructive` per-call
   forever, and `tests/grants.test.ts` pins it. Widening grant matching, adding
   a server wildcard, or letting a grant cover a built-in tool are security
   design changes, not refactors.
3. **Absence is an em dash.** A missing value renders `EMPTY`, never `0`. If a
   derived number lacks its inputs, return `null` and say so in the UI.
4. **Generation is deterministic.** Seed from a stable id via `createRng`.
   `Math.random()` and unseeded `new Date()` inside generators are forbidden —
   they break tests and silently reshuffle the founder's workspace on reload.
5. **Generated is labelled.** Anything OmniOS produced rather than observed
   carries `simulated: true` / `generated: true` and shows `<SimulatedMark />`.
6. **Secret plaintext has one way in and one way out.** It never reaches a
   `ToolCall`, a memory record, agent context, a page prop or a log. Only
   `resolveSecrets()` inside an executor may hold it, and only for the duration
   of the call. The vault's threat model is stated in the UI, not implied.

### What enforces them mechanically

`tests/boundaries.test.ts` is the one test that reads source instead of running
it, because these two leaks are silent and nothing else in the build would catch
them. It fails if:

- anything under `lib/ai/` imports `lib/data/aggregate` (invariant 1), or
  imports `lib/actions/` at all — which is *why* the proposing core lives in
  `lib/ai/tools/propose.ts` instead of being reached across the boundary;
- an `approval: {` literal is constructed anywhere but the two files allowed to:
  `lib/approvals/decide.ts` (a decision someone just made) and
  `lib/ai/tools/propose.ts` (one made in advance, as a grant). A third author is
  a regression even when it looks harmless.

ESLint adds one more: nothing may import `lib/data/adapters/*` directly — the
store facade is the only door to persistence.

## Repository map

```
proxy.ts             the edge access gate (Next 16's middleware successor)
app/(os)/            every OS route, wrapped by the shell layout
app/login/           the unlock screen, outside the (os) shell
app/api/             self-authenticating routes: telegram/webhook, health, brain-graph
components/
  shell/             rail, overview strip, copilot, command palette   (client)
  panels/            the capability panel renderer                    (server)
  assistant/ agents/ approvals/ connections/ …                        (interaction)
  ui/                primitives + the hand-drawn icon set
lib/
  domain/            types and the scope boundary — no I/O, no server-only
  data/              store facade, fs adapter, schema/normalisers, seed, aggregate, data-dir
  capabilities/      the capability registry + PANEL_KINDS
  generation/        deterministic HQ / life / intelligence / product plans
  ai/                assistant, router, specialists, context, compose, providers
    tools/           registry (data), executors, propose core, MCP bridge
  actions/           every mutation, as Server Actions
  approvals/         the deciding half of the gate
  auth/              session tokens, protection predicate, login rate limit
  mcp/               MCP client + probe
  telegram/          bot client, signing, approval delivery
  secrets/           the encrypted vault
  learning/          observation, reinforcement, evolution log, routing hints
  business/          the launch playbook
  brain/ personal/   brain-graph model; energy derivation
  ui/ format.ts      page context labels, space tint; all number/money formatting
ops/                 Mac runbook: setup, tunnel, heartbeat, backup, restore, launchd
styles/              tokens, base, shell, components
tests/               logic-layer tests (vitest, node environment)
```

### Where the interesting seams are

| Thing | File |
| --- | --- |
| Persistence swap point | `lib/data/store.ts` (one `adapter` line) |
| Where the data dir is resolved, and whether it is ephemeral | `lib/data/data-dir.ts` |
| Capability definitions | `lib/capabilities/registry.ts` |
| Specialist definitions (routing is declarative) | `lib/ai/specialists.ts` |
| Tool catalogue, risk tiers, previews | `lib/ai/tools/registry.ts` |
| The gate that refuses | `lib/ai/tools/executors.ts` → `runTool` |
| The gate that records | `lib/actions/tools.ts`, `lib/approvals/decide.ts` |
| Local reasoning with no API key | `lib/ai/compose.ts` |
| Model providers and selection | `lib/ai/providers.ts` |

## How the assistant works

One entry point: `ask()` in `lib/ai/assistant.ts`. The founder never picks an
agent; the delegation plan attached to the answer shows who was consulted and on
what evidence.

- **Grounding first, model second.** The analysis is computed from real records
  in `lib/ai/compose.ts` whether or not a provider exists. With a key, the model
  phrases facts it was handed — it is never given a blank prompt, because a
  system a founder plans their week from cannot invent numbers.
- **Acting is a loop, and the loop cannot outrun the gate.** `lib/ai/act.ts`
  turns a sentence into planned calls (model function-calling when available,
  `scoreTools` plus heuristics when not); `lib/ai/loop.ts` runs them, feeds
  results back and re-plans, bounded to twelve calls. Every call still goes
  through `proposeCore`. A `destructive` or `external` call stops at
  `awaiting-approval` and the loop **halts** rather than planning past it —
  continuing would assume the answer the gate exists to ask for. Only `read` and
  `write` results are ever carried between rounds.
- **It knows what it is.** `lib/ai/self.ts` derives a true account of current
  abilities from the registry and workspace, so a connected-but-unprobed server
  is described as exactly that, and a tool added tomorrow appears without an
  edit. `NOT_WIRED_TOOL_IDS` keeps unwired executors from being claimed.
- **Connected tools are plannable, not just executable.** `lib/ai/available.ts`
  unions built-in tools with bridged MCP tools for the planner. Model APIs only
  accept `^[a-zA-Z0-9_-]{1,64}$` function names, so `schemaName()` maps
  `mcp:server:tool` for the wire and callers resolve back through the catalogue.
- **Slash commands** live in `lib/ai/commands.ts` — client-safe on purpose, so
  the composer and the server parse from one source. A command names a tool and
  parses its args; validation, tier and gate still come from the registry.

## Adding things

- **A capability** → one entry in `lib/capabilities/registry.ts`. Navigation,
  routing, HQ generation, the command palette and the specialist router all read
  from there. If you found yourself editing a second file, the abstraction leaked
  — fix that instead.
- **A specialist** → one entry in `lib/ai/specialists.ts`. Routing is declarative;
  never add a branch to `lib/ai/router.ts`.
- **A panel kind** → add to `PANEL_KINDS`, then a renderer in
  `components/panels/CapabilityPanels.tsx`. Panels take scoped records and must
  not know whether they are drawing a company or a life.
- **A tool** → one entry in `lib/ai/tools/registry.ts` (data only — no store
  access, no `server-only`) plus an executor. Pick the tier by what the call
  does, never by what is convenient: anything that deletes or leaves the machine
  is `destructive`/`external`. The `preview` is a promise rendered before
  anything runs, so it must survive missing arguments instead of throwing.
- **A slash command** → one entry in `lib/ai/commands.ts`, naming an existing
  tool and parsing its arguments deterministically.
- **A mutation** → a Server Action in `lib/actions/`, validated at the boundary,
  ending in `revalidatePath('/', 'layout')`. Never trust an id posted by the
  browser: resolve it through its scope.
- **A persistence backend** → implement `WorkspaceStore` and change the one line
  in `lib/data/store.ts`. Nothing above it should need to change.
- **A field on the workspace root** → add it to `WorkspaceRoot`, give it a
  default in `normaliseRoot`, and add it to both roots in `lib/data/seed.ts`.
  The root is read as raw JSON, so a field without a default arrives `undefined`
  on every workspace that predates it, whatever the type says.
- **An outward capability** → never a bespoke integration. It arrives as an MCP
  server the founder connects, is bridged to a `ToolDefinition` by
  `lib/ai/tools/mcp-bridge.ts`, and inherits the gate for free.
- **A launch step** → one entry in `lib/business/playbook.ts`. Internal steps
  name a built-in tool and must validate against it; `tests/launch.test.ts`
  enforces both. Outward steps name what they need and never hard-wire a tool.

## Deployment shape (and why the app is careful about it)

- **One trusted machine, plus an outbound-only tunnel.** The store is filesystem
  JSON and single-process by design. Production binds `127.0.0.1`
  (`npm run start:local`) so a cloudflared/Tailscale tunnel is the only way in —
  no listeners. `ops/` is the whole runbook; `docs/MOBILE.md` explains it.
- **Auth is opt-in and rotation is revocation.** With `OMNIOS_ACCESS_KEY` unset,
  OmniOS is a localhost app with no auth. Set it and `proxy.ts` puts every page,
  Server Action and API behind a session cookie whose HMAC key *derives from the
  access key* — change the key and every cookie ever issued stops verifying.
  `lib/auth/token.ts` is WebCrypto-only because the edge proxy, Node handlers and
  vitest all import it; never pull `node:crypto` or `server-only` into it.
  Exempt because self-authenticating: the Telegram webhook (own secret, fails
  closed) and `/api/health` (key as header, for the heartbeat).
- **Serverless boots but is honest about it.** `lib/data/data-dir.ts` probes
  writability rather than sniffing `VERCEL`/`AWS` env vars — `vercel dev` leaks
  `VERCEL=1` onto real machines, and an env switch would silently move a
  founder's workspace *and vault* to `/tmp`. When storage is ephemeral the shell
  renders a banner saying so. A Vercel deployment is a stateless demo, never a
  home for data.
- **Backups include the vault key or they are worse than nothing.** `ops/backup.sh`
  archives the whole data dir; `ops/restore.sh` moves the current one aside
  instead of deleting it.

## Design rules

Design language is "Quiet Machine" — see the README and `styles/tokens.css`.

- The room is tinted, the instrument is not. Space hue belongs to canvas, rail,
  active marker, focus ring. **Never** to text, numbers, tables or charts.
- Only hue varies per space. Lightness and chroma are fixed so contrast is
  identical everywhere. Do not add a second accent.
- Depth from the surface ladder and hairlines. Shadow only for things that float;
  blur only on the modal scrim.
- No gradients on controls, no glow, no glassmorphism, no emoji in chrome, no
  counting-up numbers, no layout shift on data arrival.
- Use existing classes in `styles/components.css`. New ones get a comment saying
  why.

## Verification

```bash
nvm use && npm install   # Node 22
npm run dev              # http://localhost:3000
npm run verify           # typecheck -> lint -> tests -> production build
npm run test -- tests/grants.test.ts    # one file while iterating
```

CI (`.github/workflows/verify.yml`) runs `npm run verify` on every push and PR;
the order is deliberate so a failure reports the cheapest cause first.

Tests are vitest in a `node` environment over `tests/**/*.test.ts`. Two
conventions matter: `server-only` is aliased to a stub (`tests/stubs/server-only.ts`)
so store- and vault-reachable code is testable at all, and any test that touches
the store points `process.env.OMNIOS_DATA_DIR` at an `mkdtemp` directory and
deletes it after — never at the repo's `.omnios-data`.

Never report something as working without having run it. When a change touches
layout, render the app and look at it — three real layout bugs in this repo's
history were invisible to typechecking and obvious in a screenshot.

## Style

- Strict TypeScript, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`.
- Server Components by default; `'use client'` only where interaction needs it,
  and kept in `components/`.
- Comments explain **why**, never what. Delete any comment that restates code.
  The module headers in `lib/` carry the reasoning — when you change a module's
  behaviour, the header is part of the change.
- Money is integer minor units. Format through `lib/format.ts`, never by hand.
- Push back on a request that would break an invariant above; propose the version
  that does not.
