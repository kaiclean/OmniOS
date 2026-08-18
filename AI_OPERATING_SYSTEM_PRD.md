# OmniOS — Product Requirements Document

**Status:** V1 foundation implemented and running.
**Owner:** Kai Lienhard.
**Repository:** `kaiclean/OmniOS`, branch `claude/ai-operating-system-rfgnfj`.
**Last updated:** 2026-08-06.

---

## 1. Product vision

OmniOS is a lifelong operating system for one founder's whole world — every
company they run, every company they will start, and their private life —
managed by a single AI Executive Assistant that sees across all of it.

It is not an assistant, a dashboard, or a productivity app. Those three describe
what it looks like; they miss what it is for. A founder running several companies
does not fail because they lack a task list. They fail because the trade-offs
that actually matter — *this launch versus that recovery week, this hire versus
that runway, this company's momentum versus that relationship going quiet* — are
invisible to every tool they own, because each tool sees one slice.

OmniOS exists to hold the whole picture in one place, and to put one intelligence
on top of it that can reason about the trade-offs a human cannot see because the
data lives in eleven different apps.

**The one-sentence test:** if a decision requires knowing something about a
company *and* something about the founder's life, no other tool can make it and
OmniOS can.

---

## 2. Problem statement

A multi-company founder currently operates like this:

| What they need to know | Where it lives today |
| --- | --- |
| What each company is actually doing | Notion, Linear, a spreadsheet, their head |
| Whether the money works | Accounting software, a bank app, a spreadsheet |
| What they promised whom | Email, WhatsApp, memory |
| Whether their body can carry this week | A watch app they check but never act on |
| Which relationships have gone quiet | Nowhere |
| What they decided six months ago and why | Nowhere |
| Whether a new AI tool is worth adopting | Twitter, anxiety |

Five consequences follow, and each one is a requirement in disguise:

1. **No single vantage point.** Nothing can compare a company priority against a
   health cost, so the health cost always loses until it stops being optional.
2. **Every new company starts from zero.** The tenth company gets the same blank
   Notion as the first, despite nine companies' worth of accumulated process.
3. **Knowledge does not compound.** A marketing approach that worked in one
   company is not available to the next, because nothing structured recorded it.
4. **Private life is treated as the residual.** It gets whatever is left, which
   over a decade is how founders lose the thing the companies were meant to serve.
5. **AI adoption is vibes-driven.** New models and tools are adopted because they
   trended, not because they were tested against this founder's actual workload.

---

## 3. Target user

**Primary — and, deliberately, the only one for V1:** Kai. A technical founder
running more than one company, building more, who thinks in systems, distrusts
unevidenced claims, and needs the system to survive decades of use.

Designing for exactly one user is a feature at this stage. It permits decisions a
multi-tenant product could not make: local-first storage, no accounts, no
sharing model, an assistant that reads private health data. Those constraints are
revisited in §17, not pretended away.

**Secondary, later:** other multi-company founders and operator-owners with the
same shape of problem. Explicitly *not* teams, agencies, or enterprises — those
require a permission model whose absence is what makes V1 possible.

---

## 4. Core philosophy

Six principles. Every one of them is implemented, and each names the file that
enforces it.

### 4.1 Capabilities, not companies
The unit of construction is a **Capability** — Marketing, Finance, Operations,
Health — defined once and granted to every space automatically. Creating a
company does not create capability code; it creates a company record, and the
registry already knows how to render a complete headquarters for it.
→ `lib/capabilities/registry.ts`

### 4.2 Private life is a first-class space
Personal life is a full space with its own DNA, capabilities and record types —
the same engine as a company, not a widget attached to one. It differs by
*material* (warmer surfaces, more air) rather than by being a lesser citizen.
→ `lib/generation/personal-hq.ts`, `styles/tokens.css`

### 4.3 One intelligence, many specialists
The founder talks to exactly one assistant. Behind it, a router scores the
request against ~25 specialists and composes a delegation plan. The founder never
picks an agent — but can always audit which ones ran, with what confidence, on
what evidence.
→ `lib/ai/router.ts`, `lib/ai/specialists.ts`

### 4.4 Isolation is structural, not conventional
Company data, personal data and shared capability knowledge are separated by the
*shape of the API*, not by discipline. There is no `readEverything()`. Every read
names a scope. Cross-space aggregation exists — the founder owns all of it — but
is quarantined in one file that agent code may not import.
→ `lib/domain/scope.ts`, `lib/data/store.ts`, `lib/data/aggregate.ts`

### 4.5 The system never upgrades itself
It may discover, analyse, sandbox, measure, compare and recommend. Then it stops
and waits for a human. `applied` is unreachable without a recorded decision.
→ `lib/domain/intelligence.ts`

### 4.6 Absence renders as an em dash
No invented number, ever. If recovery data is missing, the energy score is `null`
and the assistant says it is planning blind — because the alternative is a system
that plans a founder's week against a figure it made up.
→ `lib/personal/energy.ts`, `lib/format.ts`

---

## 5. MVP scope — what V1 is

Implemented and working:

- **Premium OS shell** — left rail, unified overview strip, permanent AI copilot,
  ⌘K command palette, per-space re-tinting, full keyboard path, light and dark.
- **Companies** — list, create flow, and a generated headquarters per company.
- **Create Company** — a short form produces a complete, populated HQ: DNA, brand
  DNA, competitors, audience, expansion, 12 KPIs, 16 opening tasks, roadmap, 6
  automations, SOPs, CRM, a 12-month ledger, risk register, recommendations.
- **Company HQ** — Executive Overview plus 13 capability pages, all registry-driven.
- **Personal HQ** — Life Overview, Personal DNA, Health & Performance,
  Relationships, Learning & Growth, Life Admin.
- **Capability pages at OS level** — one platform seen across every space at once.
- **Executive Assistant** — routing, delegation plans, real analysis over real
  records, disclosure of specialists and evidence, per-scope conversation.
- **Memory** — three scopes with a gated promotion path into shared knowledge.
- **AI Intelligence Center** — discovery feed with relevance scoring and reasons.
- **Safe Upgrade Pipeline** — sandbox results, benefits, risks, and approve /
  reject / test-longer.
- **Learning Reports** — configurable cadence, signal-weighted sections.
- **Creative Studio** — brand DNA, briefs, asset library, deterministic previews.
- **AI Product Factory** — idea in, twelve-section product plan out.
- **Finance Center** — company and personal money, separated, forecasts excluded
  from actuals, anomaly detection.
- **Automation Platform** — templates, arming, run logs, and a refusal path for
  anything that would act outside OmniOS.
- **Settings** — theme, motion, tint, assistant name, storage location, provider
  status, and reset to an empty workspace.

### Explicitly out of scope for V1

Multi-user accounts · real bank/calendar/email integrations · image or video
generation · hosted deployment · mobile app · vector search · voice. Each has a
named seam (§12) so it can be added without an architectural rewrite.

---

## 6. Long-term scope

**Year 1** — real LLM provider wired; calendar and email read access; bank
import; embeddings over memory; automations that actually execute behind the
approval gate; iOS companion for capture and the daily brief.

**Year 3** — knowledge graph over cross-capability learning; the assistant
drafting and executing multi-step plans with per-step approval; company creation
that includes legal, banking and domain setup; a second founder using it.

**Decade** — a system that has watched one founder make thousands of decisions
and can say, with evidence, "the last four times you committed to something at
this energy level, you reversed it within a week."

---

## 7. Key user journeys

1. **Morning.** Opens Home. Sees energy, the honest deep-work ceiling it implies,
   and the top five items across every space ranked against that ceiling — not a
   list of everything open.
2. **New company at 23:00.** Types a name and three sentences. Ninety seconds
   later walks into a headquarters with a populated ledger, roadmap, risk
   register and a first week of work.
3. **A question that spans everything.** "Can I take on the Zurich project?" —
   the assistant reads capacity, cash, recovery and existing commitments across
   every space, and answers with the constraint that actually binds.
4. **Entering a company.** Clicks it. The whole shell re-tints. They are in that
   company's environment, not looking at its page.
5. **An upgrade decision.** A notification says an upgrade is waiting. They read
   what changed, what was tested, the measured comparison, the risks — and press
   Approve, Reject, or Test longer.
6. **A relationship going quiet.** Nobody asked. The system noticed three people
   are past the cadence the founder chose, and said so without moralising.

---

## 8. Core modules

| Module | Path | Responsibility |
| --- | --- | --- |
| Domain | `lib/domain/` | Types and the scope boundary |
| Capabilities | `lib/capabilities/` | Registry and panel composition |
| Data | `lib/data/` | Store port, filesystem adapter, seeds, aggregation |
| Generation | `lib/generation/` | Deterministic HQ, life, intelligence, product plans |
| AI | `lib/ai/` | Specialists, router, context, composers, providers, assistant |
| Personal | `lib/personal/` | Energy derivation |
| UI | `components/`, `styles/` | Shell, primitives, panels, design tokens |
| Actions | `lib/actions/` | Every mutation, as Server Actions |

---

## 9. Capability-based architecture

A Capability is a data record declaring: identity, which space kinds it applies
to, which panels it renders, which panels it contributes to a space's overview,
and which specialists staff it.

```ts
interface Capability {
  id: string;
  name: string;
  namePersonal?: string;      // a life wants a warmer word for the same thing
  appliesTo: ('company' | 'personal')[];
  panels: PanelSpec[];        // its own page
  overviewPanels?: PanelSpec[]; // its contribution to the space's overview
  specialistIds: string[];
  primaryNav?: boolean;       // pinned to the OS-level rail
}
```

Panels are scope-agnostic renderers. A panel asks for "tasks in this scope", never
"this company's tasks". That single decision is what makes one definition serve a
company and a life without a branch — and why adding a capability is a registry
edit, not a feature.

**Thirteen company capabilities ship:** Strategy · Marketing · Sales · Branding ·
Development · Finance · Operations · People · Legal · Research · Creative Studio ·
Automation · Executive — plus four for personal life only: Health, Relationships,
Learning and Life Admin. Seventeen in the registry.

---

## 10. Company HQ concept

Opening a company should feel like entering that company's environment. Three
mechanisms deliver it:

1. **Space tint.** Every space owns a hue derived deterministically from its id.
   The shell re-tints on entry. Only hue varies — lightness and chroma are fixed,
   so no company can mint an inaccessible accent. (`lib/ui/space-tint.ts`)
2. **Complete on arrival.** The HQ is populated before the founder's first visit.
3. **Registry-driven navigation.** The capability strip is generated, so a
   company that switches Legal off simply stops having a Legal tab.

---

## 11. Personal OS concept

The Personal HQ carries Personal DNA (identity, values, life goals, health
philosophy, non-negotiables), Life Overview, Health & Performance, Relationships,
Learning & Growth, and Life Admin.

It differs from a company by material, not by rank: warmer canvas, larger radii,
more air. Same building, different flooring.

**Energy is the load-bearing number.** Derived from sleep, sleep quality, HRV,
stress and movement, weighted, and returned as `null` when under half the
weighting is present. The assistant uses it to set an honest deep-work ceiling.
An invented energy score would be worse than none, because the entire week would
be planned against it.

---

## 12. Unified AI Executive Assistant

**One surface. No agent picker. Ever.**

The pipeline:

```
prompt
  → route()        score against every specialist allowed in this scope
  → loadContext()  read the scope (or, in founder mode, every owned space)
  → compose()      real analysis over real records
  → provider       optional: a model phrases the grounded analysis
  → plan           who ran, at what confidence, on what evidence
```

**Local grounding first, model second.** With no API key, the local reasoning
engine *is* the answer — genuine analysis of actual records, clearly labelled. It
reads the ledger, ranks tasks against the energy budget, finds stale pipeline,
computes recovery trends. With a key, the model receives facts already extracted
from the store and is asked to phrase them, which is the arrangement least likely
to invent a number.

**Two context modes, and the difference is a product guarantee.** *Space mode*
reads one scope plus shared capability memory — never another company, never
personal life. *Founder mode* aggregates every space the founder owns, because
that is the entire reason life and business share a system. The mode comes from
the route, is shown in the UI, and a scoped conversation cannot silently become
a founder-mode one.

---

## 13. Specialist agent architecture

Twenty-five specialists across strategy, marketing, sales, development, finance,
legal, branding, research, operations, project management, executive assistance,
data, design, video, photography, social, automation, support, security, personal
life and health.

Each declares a charter, the capabilities it staffs, the phrases it claims, the
scope kinds it may run in, and what it would do once real execution is wired.
Routing is declarative: adding a specialist never means editing the router.

Scope restriction is enforced, not documented — the Performance Coach cannot be
invoked inside a company scope, so a company conversation can never reach the
founder's health data.

---

## 14. Memory and knowledge architecture

Three scopes:

| Scope | Contains | Readable by |
| --- | --- | --- |
| `company:<id>` | Everything one company knows | That company only |
| `personal` | Everything about the founder's life | Personal scope only |
| `shared:<capabilityId>` | Generalised, de-identified lessons | Every space |

Promotion into shared knowledge passes `promotionCheck()`, which refuses text
containing an email, IBAN, phone number, monetary amount, credential-shaped
token, wallet address, or the source scope's name. **A lesson may generalise; a
fact may not.** The refusal shows the founder exactly which rule blocked it.

`MemoryRecord` already carries an optional `embedding` field, so a vector index
can be added later without migrating the record shape.

---

## 15. Data separation model

- One file per scope on disk. Isolation is physical, not a filter someone might
  forget to apply.
- Every store read takes a scope. There is no call that reads everything.
- Cross-space aggregation lives in `lib/data/aggregate.ts`, is explicit at every
  call site, and is never imported by agent code.
- Company ids are hashed into filenames, so a hostile id cannot escape the data
  directory.

---

## 16. Safe upgrade pipeline

```
discovered → analysed → sandboxed → measured → compared → recommended
           → awaiting-approval  ←── the system stops here, always
           → approved | rejected | extended-testing        (human only)
           → applied                                        (human only)
```

Every candidate carries what changed, why it matters, what was tested, the
sandbox comparison with `betterWhen` direction per metric, benefits, risks with
severity and mitigation, and a recommendation with its confidence.

---

## 17. UI/UX principles — "Quiet Machine"

An instrument, not a dashboard. Density without noise. Colour as structure.

1. **The room is tinted; the instrument is not.** Hue belongs to canvas, rail,
   active marker, focus ring. Never to text, numbers, tables or charts. A number
   must not change colour because of which space you are in.
2. **Depth from light, not shadow.** Surface ladder plus a 1px raking highlight.
   Shadow only where something genuinely floats; blur exactly once, on the modal
   scrim.
3. **A number is a column, not a sentence.** Tabular figures everywhere.
4. **Motion reports state; it never performs.** The one ambient animation in the
   system is the seam under the overview strip, and only while the assistant is
   actually working.
5. **Absence is an em dash.**

Anti-patterns, enforced by review: gradients on controls, glows, neon,
glassmorphism, a second accent, emoji in chrome, counting-up numbers, layout
shift on data arrival, hover-only affordances, or a confidence percentage
presented as if it were measured.

---

## 18. Technical architecture

Next.js 16 App Router · React 19 · TypeScript strict with
`noUncheckedIndexedAccess` · Zod for form boundaries · Geist, self-hosted · plain
CSS with design tokens — no UI framework, because a founder-grade product cannot
look like its component library.

Server Components by default; client components only where interaction requires
them. Every mutation is a Server Action.

**Persistence:** JSON under `.omnios-data/`, one file per scope, atomic writes,
per-file write serialisation. Real, inspectable, backup-able, no service to run.
`OMNIOS_STORE=sqlite` swaps in the SQLite adapter (one database file, one row per
scope, built on `node:sqlite` so still no service and no native build); an
existing JSON workspace is imported on first run and left in place.

**The swap seam** is one interface, `WorkspaceStore` (`lib/data/store-port.ts`).
Postgres or Supabase means writing one object and changing the adapter pick in
`lib/data/store.ts`. No page, component, action or agent changes — the SQLite
adapter proves the seam.

---

## 19. Database model proposal

Present shape maps directly onto tables: `companies`, `personal_profile`,
`settings`, `discoveries`, `upgrade_candidates`, `learning_reports`, plus one
table per scoped collection with a `scope_kind` / `scope_id` pair as the leading
index and a row-level-security predicate on it — the same boundary the file
layout enforces today. `memory.embedding` becomes a `vector` column.

---

## 20. API and service architecture

Server Actions are the primary boundary — that removes an entire class of
endpoint-authorisation bugs while there is one user. The few HTTP routes that
exist are the ones that genuinely need to be reached from outside a browser
session, and each carries its own authentication: `/api/telegram/webhook`
(Telegram's secret-token header), `/api/health` (the access key as a header,
for the heartbeat), and `/api/brain-graph` (behind the session cookie via
`proxy.ts`). The access gate in `lib/auth/paths.ts` places every route except
the self-authenticating ones inside the boundary.

---

## 21. Milestones

| # | Milestone | Status |
| --- | --- | --- |
| 1 | Domain, scope boundary, store port, capability registry | Done |
| 2 | Design language, OS shell, command palette | Done |
| 3 | Company generation and HQ | Done |
| 4 | Personal HQ and energy model | Done |
| 5 | Assistant, router, specialists, local reasoning | Done |
| 6 | Intelligence Center, Safe Upgrade Pipeline, Reports | Done |
| 7 | Studio, Factory, Finance, Automations, Brain, Settings | Done |
| 8 | Real LLM provider, streaming, editable records | Next |
| 9 | Calendar and email read integration | Next |
| 10 | Embeddings over memory; real automation execution | Later |

---

## 22. Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Sample data mistaken for real data | High | `generated` / `simulated` marks in the data model and visible in UI; one-click reset to empty |
| Single-user assumptions harden | Medium | Scope discriminant already carries the tenancy key a users table would need |
| JSON store outgrows itself | Medium | `WorkspaceStore` port; swap is one object |
| Local reasoning mistaken for a model | Medium | Provider labelled on every turn |
| Capability registry becomes a monolith | Medium | Panels are data; adding one is a registry edit |
| Health data is highly sensitive | High | Local-only, never leaves the machine, never reachable from a company scope |

---

## 23. Future integrations

Calendar (read, then write behind approval) · email (triage, then draft) · banking
and accounting (import, then reconciliation) · Anthropic and local models · image
and video generation for the Studio · GitHub for Development · a live feed for
the Intelligence Center · an iOS capture and brief companion.

Each has a declared seam in `.env.example` and a named interface in `lib/`.

---

## 24. What would make this fail

Worth writing down, because the failure modes are more instructive than the plan:

1. **It becomes a second place to enter data.** If the founder maintains OmniOS
   *and* their real tools, it is dead. Integrations are not a nice-to-have; they
   are the survival condition.
2. **The assistant is impressive but not useful.** Prose is not the product. The
   grounding is. If a real model is wired in a way that lets it invent numbers,
   the whole trust model collapses.
3. **The private-life layer feels like surveillance.** It has to reduce load, not
   add a scoreboard. "Three people are past the cadence *you* chose" is
   acceptable; a streak counter on family is not.
