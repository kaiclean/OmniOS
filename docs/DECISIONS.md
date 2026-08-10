# Repository analysis and architectural decisions

Four repositories under `@kaiclean` were audited before any code was written:
`OmniOS`, `OmniClaw`, `OmniDash`, `HermesClaw`. Each was read in depth — READMEs,
manifests, entry points, the largest source files — and, where it was possible,
installed, typechecked, tested and built to verify what actually runs rather than
what the documentation claims.

---

## 1. Decision matrix

| | **OmniOS** | **OmniClaw** | **OmniDash** | **HermesClaw** |
| --- | --- | --- | --- | --- |
| **Tech stack** | None — one README | Next.js 16, React 19, strict TS, Zod, Geist. Five runtime deps | Node 22, TS 5.8 strict, Express 4, React 19 + Vite 6, SQLite/Postgres/in-memory | Python 3.11, FastAPI, SQLite, Pydantic v2; ~9k lines of hand-written vanilla JS frontend |
| **Current purpose** | Empty; an unused AI Studio scaffold | KAI//SYSTEMS — a public evidence-first portfolio site | A self-hosted single-operator autonomous agent stack with an operator cockpit | An approval-gated agent turning saved Instagram reels into technical ideas |
| **Reusable for an AI OS** | The name and a clean namespace | Design-token discipline, the Zod-validated structured-content pattern, the verify pipeline, the pure-engine/thin-client split | The LLM provider catalogue and role routing, the 3-backend storage port with a conformance suite, risk classification + approval gating, durable leases, tool-forge drafts that are inert until a human renames them | Worktree-isolated execution, N-of-M approval quorum with digest-pinned votes, an event broker with replay, honest stream metrics |
| **Missing for the vision** | Everything | All server-side code, DB, auth, AI, multi-tenancy | Any domain model at all — `grep` for company/tenant/finance/crm/habit returns zero files; multi-user; a calm design system | Multi-tenancy (zero hits for company/workspace/tenant); Personal HQ; capabilities; real memory (`LIKE '%q%'`) |
| **UI quality** | None | Restrained Swiss editorial — but a marketing site, not a product UI | A well-executed sci-fi mission-control cockpit; 5,223 lines of CSS around `.orbital-*`, glass blur and glow; dark-only | A neon HUD in `Share Tech Mono`; the opposite pole from the target aesthetic |
| **DB** | None | None — hand-written TS literals | Genuinely good: one `RuntimeStore` interface, three backends, versioned migrations — wrong domain | Raw sqlite3, 15 tables rooted on `reels` |
| **Auth** | None | None | One shared bootstrap token, one operator | One shared secret; off by default |
| **AI readiness** | None | None — the "agent loops" are deterministic reducers | Strongest of the four: provider catalogue, 8 role chains, circuit breakers, cost gates, streaming | Middling: a provider Protocol and typed structured outputs; delegation is substring-matching agent names |
| **Scalability** | n/a | Statically prerendered; scales because it does nothing | Solid for one user — durable leases, lease-guarded singletons — but binds loopback and rules out serverless | One laptop, and honest about it |
| **Code quality** | n/a | High — strict TS clean, 24 tests green, CI on every push | High — strict TS clean, **658/659 tests passing** | High — `ruff` and `mypy` clean, **352 pytest + 71 vitest passing** |
| **Deployment** | None | Vercel-shaped and CI-verified | Self-host on one trusted machine | Docker for one Mac |
| **Verified runnable** | Nothing. `git ls-files` → 1 file | `npm ci`, typecheck, test, build — all green | `npm ci`, `tsc --noEmit`, 659 tests, build — all green | `pip install -e`, 352 pytest + 71 vitest — all green |
| **Fit score** | **2 / 10** | **3 / 10** | **6 / 10** | **5 / 10** |

### Why each score

**OmniOS — 2/10.** Verified empty three ways: `find` returns only `README.md`,
`git ls-files` returns 1 file, `git rev-list --objects --all` returns 3 objects.
It covers 0% of the destination. The 2 is for the name and a clean namespace, and
for one genuine property: it carries no conflicting product mission to demolish.

**OmniClaw — 3/10.** A well-built thing that is the wrong thing. Five runtime
dependencies, zero API routes, zero server actions, zero database, zero auth,
zero AI calls. And its `CLAUDE.md` is an *enforced contract for a different
product*: "KAI//SYSTEMS is the primary brand", demos must be "deterministic
browser-only simulations with no external actions", and it explicitly forbids
publishing "private health, recovery, relationship, family… information" — which
is the Personal HQ, named and prohibited.

**OmniDash — 6/10, the highest, and still not the base.** The backend is
genuinely rare: a 3-backend storage abstraction with a conformance suite, durable
TTL leases, role-routed multi-provider LLM with circuit breakers and cost gates,
human-approval risk gating, and a self-extension pipeline whose drafts are
mechanically inert until a human renames them — which *is* the Safe Upgrade
Pipeline, already built. But everything the vision is *about* is absent: no
domain model whatsoever, single-operator auth, a 4,256-line `OmniDashApp.tsx`,
5,223 lines of cockpit CSS, and 82% of its files (1,636 of 2,004) are a vendored
copy of a third-party repo that is load-bearing.

**HermesClaw — 5/10.** A strong *donor*, a weak *base*. Its worktree-isolated,
digest-pinned, quorum-approved execution pipeline with 352 passing tests is worth
weeks. But its root entity is an Instagram reel, its memory layer is
`LIKE '%query%'`, its delegation is substring matching, and ~40% of the codebase
is a neon HUD in vanilla ES5 that would have to be deleted wholesale.

---

## 2. The decision

**Build in `OmniOS`. Port from `OmniDash`, `HermesClaw` and `OmniClaw`.**

The brief said not to start from scratch unless no repository is usable. The
audit produced a sharper finding than "usable or not": **all three non-empty
repositories are working products with a different, stated mission, and none of
them contains any part of the domain this product is about.**

The decisive facts:

1. **No repository has the domain.** Across OmniDash and HermesClaw, `grep` for
   `company`, `tenant`, `workspace`, `finance`, `crm`, `habit` returns **zero**
   matches. The multi-space model — companies, personal life, shared capabilities
   — had to be written from nothing regardless of which repo was chosen.
2. **Adopting a base means destroying a working product.** OmniClaw is a live
   portfolio whose operating contract forbids exactly the health, relationship
   and family data the Personal HQ requires. OmniDash is a functioning agent
   console. Repurposing either deletes something that works, to gain a shell that
   points the wrong way.
3. **The reusable surface is patterns, not code.** OmniClaw's genuinely portable
   assets total a few hundred lines. OmniDash's best assets are *interfaces* — a
   storage port, a provider catalogue, an approval gate — which port as design,
   not as files, because they carry an Express server and a vendored dependency
   tree with them.
4. **`OmniOS` is the intended home.** It is named for this product, it is empty,
   and — uniquely — it has no mission to collide with.

This is not a greenfield rebuild dressed up. What was ported is listed below.

### What was actually carried across

| From | Pattern | Where it lives now |
| --- | --- | --- |
| OmniDash | One storage interface, swappable backends | `lib/data/store-port.ts` + `adapters/fs-store.ts` |
| OmniDash | Declarative provider catalogue; first-available selection | `lib/ai/providers.ts` |
| OmniDash | Specialists as *data*, so routing needs no branches | `lib/ai/specialists.ts` |
| OmniDash | Risk classification → human approval before anything acts | `DelegationPlan.requiresApproval`, `AutomationStep.external` |
| OmniDash | Self-extension that is inert until a human acts | `AUTONOMOUS_STAGES` in `lib/domain/intelligence.ts` |
| HermesClaw | Approval quorum pinned to a content digest | `UpgradeDecision`; `applied` unreachable without one |
| HermesClaw | Honest degradation — an em dash, never a fake number | `lib/format.ts`, `lib/personal/energy.ts` |
| OmniClaw | Design tokens as one CSS custom-property layer | `styles/tokens.css` |
| OmniClaw | Zod validation at the boundary, typed content beneath | `lib/actions/companies.ts` |
| OmniClaw | `verify` = typecheck + lint + test + build, in CI | `package.json`, `.github/workflows/verify.yml` |
| OmniClaw | Pure engine, thin client — logic testable without a DOM | `lib/generation/*`, `lib/ai/compose.ts` |

---

## 3. Architectural decisions

### D1 — Capabilities are the unit of construction, not companies
*Alternative rejected:* a company template cloned per company. Cloning means
fourteen copies drifting apart, and an improvement to Marketing reaching only new
companies. A registry means one definition, every space, retroactively.

### D2 — Panels are scope-agnostic
A panel asks for "tasks in this scope", never "this company's tasks". This is the
mechanism behind rendering one capability for a company *and* a life without a
branch. *Alternative rejected:* separate company and personal renderers — which
guarantees the personal side rots, since it would always be the second one
updated.

### D3 — Isolation lives in the shape of the API
There is no `readEverything()`. Every read names a scope; scopes are separate
files. Cross-space aggregation exists — the founder owns everything — but is
quarantined in `lib/data/aggregate.ts`, which agent code does not import.
*Alternative rejected:* a shared store with a `where scope = ?` convention. One
forgotten filter leaks a company into another company's context, and the failure
is silent.

### D4 — Filesystem JSON behind a port, not a database
*Alternatives rejected:* SQLite (a native build and a migration story before the
product exists) and Postgres/Supabase (a service to run and a network hop for a
single local user). JSON on disk is real persistence a founder can read, back up
and delete with a file manager, and the swap seam is one interface.

### D5 — Local grounding first, model second
The assistant always computes a real analysis from real records. With no API key
that analysis *is* the answer. With a key, the model receives extracted facts and
is asked to phrase them. *Alternative rejected:* prompt a model with raw context
and let it reason. It reads better and invents numbers, and a system a founder
plans their week from cannot invent numbers.

### D6 — No UI framework
*Alternative rejected:* Tailwind plus a component library. It would have been
faster and the result would look like every other product built the same way. The
brief asked for something that feels like a premium operating system, and a
design language — surface ladder, hairlines, one accent per space, achromatic
numerals — is not something a utility framework produces by default.

### D7 — Deterministic generation, never `Math.random()`
Every generator is seeded from a stable id. The same company always produces the
same headquarters across reloads and machines, which makes generation testable
with plain equality and stops a refresh silently reshuffling the founder's world.

---

## 4. Known limitations

- **Single user.** No accounts, no sharing, no permissions. The scope discriminant
  already carries the key a tenancy column would need, but nothing enforces
  ownership because there is exactly one owner.
- **Sample data ships by default.** Marked `generated` / `simulated` in the data
  model and visible in the UI, with a one-click reset — but it is still the first
  thing a new user sees.
- **No external integrations.** No calendar, email, bank or model provider is
  wired. Every one has a named seam; none is connected.
- **Automations do not execute.** Runs are recorded and logged honestly as
  simulated; anything marked external refuses to run and records
  `awaiting-approval` instead.
- **Memory retrieval is scope + capability + recency.** No embeddings yet.
  `MemoryRecord.embedding` exists so an index can be added without a migration.
- **Records are largely read-only in the UI.** Creation flows exist for companies,
  briefs, assets, product specs and automations; general inline editing does not.

---

## 5. Remote access (added with the mobile wave)

- **Access-key gate, opt-in.** With `OMNIOS_ACCESS_KEY` unset nothing changes:
  OmniOS stays a localhost app with no auth, as originally decided. Setting it
  puts every page, Server Action and API behind a session cookie whose HMAC key
  *derives from the access key* — rotation is revocation. The gate lives in
  `proxy.ts` (Next 16 deprecates `middleware.ts`); the decisions live in
  `lib/auth/paths.ts` where they are unit-tested. Exempt and self-authenticating:
  the Telegram webhook (own secret) and `/api/health` (key as header, for the
  heartbeat). `/api/brain-graph`, previously open, is inside the boundary.
- **The login page reuses the root layout.** The root layout reads only three
  cosmetic settings attributes; the workspace-rendering shell layout under
  `(os)` never mounts pre-auth. Forking root layouts would duplicate `<html>`
  and cause a theme flash for no security gain.
- **Deployment is one trusted machine plus an outbound-only tunnel.** The store
  is filesystem-based and single-process by design; serverless would break
  writes and regenerate `.secret-key` (making every secret undecryptable). The
  Vercel deployment is therefore a stateless demo only. Production binds
  `127.0.0.1` (`start:local`) so the tunnel — cloudflared or Tailscale, both
  outbound-only — is the sole way in: no listeners. See `docs/MOBILE.md` and
  `ops/`.
