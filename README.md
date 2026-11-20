# OmniOS

An operating system for a founder: every company, every capability, and private
life in one place — with a single AI Executive Assistant that can see across all
of it.

Not an assistant, not a dashboard, not a productivity app. A founder running
several companies does not fail for lack of a task list; they fail because the
trade-offs that matter — *this launch versus that recovery week, this hire versus
that runway, this company's momentum versus a relationship going quiet* — are
invisible to every tool they own, because each tool sees one slice.

> **The test:** if a decision needs something from a company *and* something from
> the founder's life, no other tool can make it and OmniOS can.

Full product definition: [`AI_OPERATING_SYSTEM_PRD.md`](./AI_OPERATING_SYSTEM_PRD.md).
Repository decisions and their reasoning: [`docs/DECISIONS.md`](./docs/DECISIONS.md).

---

## Run it

```bash
nvm use            # Node 22
npm install
npm run dev        # http://localhost:3000
```

First launch seeds a **sample workspace** — two demo companies and a populated
personal life — because an operating system with nothing in it cannot show what
it is. Everything generated is marked as such in the data model and in the
interface, and Settings has a one-click reset to an empty workspace once your
real spaces exist.

**No API key is needed.** With no model configured, the Executive Assistant runs
a local reasoning engine over your actual records: it reads the ledger, ranks
work against your energy budget, finds stale pipeline, computes recovery trends.
That is a real answer, and it is labelled as locally generated. Setting
`ANTHROPIC_API_KEY` adds a model that phrases the same grounded analysis — it is
never handed a blank prompt, which is the arrangement least likely to invent a
number.

```bash
npm run verify     # typecheck + lint + tests + production build
```

Your workspace lives in `.omnios-data/` as plain JSON, one file per scope. It is
git-ignored. Point `OMNIOS_DATA_DIR` at a synced folder to carry it between
machines, or set `OMNIOS_STORE=sqlite` to keep the same workspace in a single
SQLite file instead — an existing JSON workspace is imported automatically the
first time, and the JSON files are left in place so you can switch back. Every
record is also editable directly at Settings → Data editor. See `.env.example`
for every seam an integration can plug into.

---

## Status and limits

Stated plainly, so nothing here is read as more than it is:

- **Single founder, single process.** The workspace is local files (or one SQLite
  file); the login rate limiter is in-process state (`lib/auth/rate-limit.ts`).
  There is no multi-user model.
- **Access control is opt-in.** With no `OMNIOS_ACCESS_KEY` the app is open on
  localhost; the key is required for any remote use (`proxy.ts`, `ops/tunnel`).
- **The vault shares a disk with its key** unless `OMNIOS_SECRET_KEY` is set. The
  generated key is stored next to the ciphertext in the data directory
  (`.secret-key`), so the vault protects a `secrets.json` that leaks on its own,
  but not a synced or backed-up copy of the whole data directory, and not someone
  holding your unlocked machine. Set `OMNIOS_SECRET_KEY` before pointing
  `OMNIOS_DATA_DIR` at a synced folder (`lib/secrets/vault.ts`).
- **Finance, creative and intelligence-feed providers are seams, not
  integrations.** They are inert until configured (`.env.example`).
- **No tool acts outward without a recorded human decision.** The MCP server in
  `lib/mcp/serve.ts` is read-only by design. Configuring a model provider is
  itself the decision to send prompts and record-derived context to that
  provider (`lib/ai/providers.ts`).
- **No `LICENSE` file yet**, so no reuse rights are granted.
- Why this repo exists next to OmniClaw, OmniDash and HermesClaw:
  [`docs/DECISIONS.md`](./docs/DECISIONS.md).
- Module map and approval gates: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md). Reporting a vulnerability: [`SECURITY.md`](./SECURITY.md).

---

## What is in it

| | |
| --- | --- |
| **Companies** | A create form produces a complete headquarters: DNA, brand, competitors, KPIs, roadmap, ledger, CRM, SOPs, automations, risks, recommendations |
| **Company HQ** | Executive Overview plus 14 capability pages, all registry-driven |
| **Personal HQ** | Personal DNA, Life Overview, Health & Performance, Relationships, Learning, Life Admin |
| **Capabilities** | 14 reusable company platforms granted to every company automatically, plus 4 for personal life; Offerten review stays inside one company |
| **Offerten** | Fixture ingest, evidence-led quote drafts, agent/hand-price comparison, private costs and margin, revision-checked owner edits, local export/deletion and approval-gated fixture send receipts; no live ERP or delivery |
| **Assistant** | One surface, ~25 specialists behind it, with the delegation plan and evidence always inspectable |
| **Brain** | Three memory scopes with a gated promotion path into shared knowledge |
| **Intelligence** | Discovery feed with relevance scoring, and a Safe Upgrade Pipeline that never applies itself |
| **Studio · Factory · Finance · Automations** | Creative briefs and assets, idea-to-product-plan, separated company/personal money, automations with an approval gate |

---

## Offerten — a local review workflow, not a live quoting integration

Open a company → **Offerten**. Request fixture ingest, approve it in the existing
Approvals inbox (or the configured Telegram door), create a draft, review the
customer document separately from private unit economics, and save owner edits
and an independent hand calculation. A send request is pinned to a revision:
editing invalidates the old package. Approval records a **generated local fixture
receipt**, not an email, ERP write or customer delivery. All mutations use the
normal tool gate; `confirmWrites` also holds drafts, edits, memory and exports.

Missing inputs and unmeasured outcomes remain `—`; fixture rows are not observed
performance. Customer reasons use safe fixed labels, not private cost/rule text.
Offerten memory is company-local and excluded from generic assistant context,
search, MCP reads, promotion and provider transfer. Full exports are private
local downloads, not customer attachments. This is not a multi-user pilot: a
company scope is **not authentication**. If a pilot logs in, it requires a
separate workspace/data directory and access key, not another company tab.

No real customer data, live database credentials, sending, or model fine-tuning
is part of this fixture delivery. The founder must decide ERP discovery,
tenancy, hosting, processor agreements, retention and any DPIA before a real
pilot. Design, schemas and boundaries: [`docs/offerten/DESIGN.md`](./docs/offerten/DESIGN.md);
walkthrough: [`FLOW.md`](./docs/offerten/FLOW.md); engineering privacy checklist:
[`PRIVACY.md`](./docs/offerten/PRIVACY.md); tenancy decision:
[`TENANCY.md`](./docs/offerten/TENANCY.md).

---

## How it is built

Next.js 16 App Router · React 19 · TypeScript strict with
`noUncheckedIndexedAccess` · Zod at form boundaries · Geist, self-hosted · plain
CSS with design tokens. No UI framework — a founder-grade product should not look
like its component library.

Server Components by default. Every mutation is a Server Action. Persistence is
JSON on disk behind a one-interface port, so Postgres or Supabase is a single
adapter away.

### Five decisions worth knowing

**1. Capabilities, not companies.** The unit of construction is a Capability,
defined once in `lib/capabilities/registry.ts` and granted to every space.
Creating a company creates a *record*, not code — the registry already knows how
to render its headquarters. Adding a capability is a registry edit; it appears in
navigation, routing, HQ generation, the command palette and the specialist router
without another file changing.

**2. Panels are scope-agnostic.** A panel asks for "tasks in this scope", never
"this company's tasks". That is why one capability definition serves a company
*and* a life with no branch.

**3. Isolation is structural.** There is no `readEverything()`. Every store read
names a scope, and scopes are separate files on disk. Cross-space aggregation
exists — the founder owns all of it — but lives in one quarantined file that
agent code does not import. A company conversation cannot reach another company
or your health data, because there is no API shape that would let it.

**4. The system never upgrades itself.** It discovers, analyses, sandboxes,
measures and recommends — then stops. `applied` is unreachable without a recorded
human decision.

**5. Absence renders as an em dash.** No invented number. If recovery data is
missing, the energy score is `null` and the assistant says it is planning blind —
because the alternative is planning your week against a figure it made up.

---

## Design language — "Quiet Machine"

An instrument, not a dashboard.

- **The room is tinted; the instrument is not.** Each space owns a hue derived
  deterministically from its id, and the whole shell re-tints when you enter it —
  entering a company should feel like entering that company's environment. Only
  *hue* varies; lightness and chroma are fixed in `oklch`, so every space carries
  identical contrast and no company can mint an inaccessible accent. Text,
  numbers, tables and charts stay achromatic everywhere.
- **Depth from light, not shadow.** A surface ladder and a 1px raking highlight.
  Shadow only where something genuinely floats.
- **Motion reports state; it never performs.** The single ambient animation is
  the seam under the overview strip, and only while the assistant is working.
- Personal life differs by *material* — warmer canvas, more air. Same building,
  different flooring.

---

## Layout

```
proxy.ts           the edge access gate (Next 16's middleware successor)
app/(os)/          routes — the OS shell wraps every one
app/login/         the unlock screen, outside the (os) shell
app/api/           self-authenticating routes: telegram/webhook, health, brain-graph
components/
  shell/           rail, overview strip, copilot, command palette  (client)
  panels/          the capability panel renderer                   (server)
  approvals/ agents/ meetings/ connections/                        (interaction)
  offerten/        company-only generated quote review and owner edits
  ui/              primitives and the hand-drawn icon set
lib/
  domain/          types + the scope boundary
  auth/            session tokens, protection predicate, rate limit
  capabilities/    the registry
  data/            store port, filesystem adapter, seeds, aggregation
  generation/      deterministic HQ / life / intelligence / product plans
  ai/              specialists, router, context, composers, providers, tools
  approvals/       the deciding half of the gate
  business/        the launch playbook
  secrets/         the encrypted vault
  mcp/             MCP client + probe
  telegram/        bot + approval delivery
  brain/           the 3D brain graph model
  learning/        loop findings and reports
  personal/        energy derivation
  offerten/        private fixture catalogue, schemas, pricing, memory, service
  actions/         every mutation, as Server Actions
ops/               the Mac runbook: setup, tunnel, heartbeat, backup, launchd
styles/            tokens, base, shell, components
tests/             logic-layer tests (vitest, node)
```

Generation is seeded, never `Math.random()`: the same company always produces the
same headquarters across reloads and machines, which is what makes it testable
and what stops a refresh silently reshuffling your world.
