# Universal OmniAgent — implementation plan

The requirement, in one sentence: the assistant is present on every screen, knows
exactly where the founder is standing, can change the workspace it is looking at
through structured actions, remembers conversations, and can take a new install
from zero to configured — without the founder ever explaining context or reading
documentation.

Seven phases, each independently shippable and verified before the next starts.
The invariants in `CLAUDE.md` bind every phase; where a phase touches one, the
mechanism that preserves it is named here.

## Cross-cutting decisions

- **Page context is derived, never trusted.** One pure module
  (`lib/ui/page-context.ts`) replaces the two duplicate route regexes in
  `ShellFrame` and `Copilot`. The client sends only `targetKey` + `pathname`;
  the server re-derives the `PageContext` from the pathname, so a crafted
  payload cannot claim a capability the route doesn't have. `AssistantTarget`
  gains an optional `page?` field. **`loadContext` ignores `page` entirely** —
  context affects wording, help and tool preference, never which scopes are
  read. A test pins this.
- **One composer instance, three chromes.** `Copilot` stays the single stateful
  owner in `ShellFrame`; mode (`bar | panel | full`) is a data attribute that
  swaps CSS chrome. The element never unmounts, so draft, attachments, thread
  and recording state survive every transition. Full-screen is a mode, not
  navigation; `/assistant` becomes the Conversations page.
- **Acting inherits the gate.** Natural-language commands are parsed into
  planned tool calls — by the configured model via function-calling when a key
  exists, by `scoreTools` + heuristics when not — and *both* paths end in the
  existing propose → approve → run flow. `destructive`/`external` land as
  `awaiting-approval` exactly as they do everywhere else. The model never picks
  the scope; the server resolves it before proposing.
- **Layouts are data, defaults stay in the registry.** One `PageLayout` record
  per (scope, capability) holds ordered sections and panels; the registry
  remains the source of defaults; `effectiveLayout = override ?? default`.
  Runtime narrowing before render, because the store does not validate.
- **Conversations discriminate on `targetKey`, never on scope file** — founder
  mode and the personal space share one file, and a field is the only safe
  separator. Legacy messages become a derived "Earlier" thread; no migration.
- **Setup state is derived, never stored.** Root-level facts only inside
  `lib/ai` (invariant 1); per-space facts join only in pages via `aggregate.ts`.

## Phase 1 — PageContext foundation

`lib/ui/page-context.ts` (`PageKind`, `PageContext`, `derivePageContext`,
`targetKeyForPage`, `pageContextLabelParts`) + `tests/page-context.test.ts`.
ShellFrame and Copilot drop their private regexes. `askAssistant` gains a
`pathname` param, sanitised and re-derived server-side. `systemPrompt(tone,
page)` finally consumes `TONE_INSTRUCTION` (defined in settings, previously
unread) and adds one framing line naming where the founder is standing.
`scoreTools` gains `preferCapabilityId` (+1.5 when the tool belongs to the open
capability). Copilot shows the context indicator ("Meridian Build / Marketing")
and company-page empty states use the previously dead `COMPANY_SUGGESTIONS`.
Tests pin: id stability with/without `page`, `loadContext` isolation,
`/companies/new` is not a company.

## Phase 2 — One composer, three chromes; attachments, voice, mentions

Modes as above (`data-assistant` on `.os`). Rich composer: auto-expanding
textarea, attachment strip, mic button (Web Speech API, feature-detected,
absent when unsupported), `@`/`/` popover. Attachments: stored under
`<dataDir>/attachments/` via `lib/data/attachments.ts`, id-addressed through an
index (no client paths → no traversal), served by `app/api/attachments/[id]`;
`AssistantMessage.attachments?` (optional → backward compatible); uploads via a
separate FormData action, 8 MB / 4 files / mime allowlist;
`serverActions.bodySizeLimit: '10mb'`. Text-ish attachments are inlined (16 KB)
into composition input. Scope-broadening buttons (Current page / Whole company /
All companies / Personal / Whole system) set a `scopeOverride` that wins over
the pathname. Slash commands v1: `/help`, `/setup`, `/new`, `/tool <id>`.

## Phase 3 — Acting pipeline

`lib/ai/act.ts`: `detectAct(prompt, {scope, preferCapabilityId, provider})` →
`{mode: 'answer'|'act'|'clarify', calls}`. Model path via new optional
`LlmProvider.completeWithTools()` (Anthropic tools API, OpenAI function
calling), schemas derived mechanically from `ToolDefinition.params`. Local path:
top `scoreTools` hit above threshold + quoted-string/date/enum extraction;
below threshold the assistant says plainly it couldn't parse. Propose core
extracted to `lib/ai/tools/propose.ts` so `ask()` never imports `lib/actions`;
`lib/actions/tools.ts` delegates, keeping the decision-recording half where the
contract says it lives. Replies state per call: ran / waiting (with inline
Approve/Reject cards → existing actions) / failed (validation verbatim). Scope
inference is conservative: space mode → that scope; founder mode → company
named in prompt, else current page's company, else clarify. Tests mirror
`tests/launch.test.ts`: phrasing table, schema derivation over all tools, gate
assertion through the propose core.

## Phase 4 — Schema-driven page layouts

`lib/domain/layout.ts` (`PageLayout extends ScopedRecord` with ordered
`sections[].panels[]`, `ADDABLE_PANEL_KINDS` excluding dna/null-prone and
capability-hard-coded kinds, `normalisePageLayout`), `lib/capabilities/layout.ts`
(`defaultLayoutFor`, `effectiveLayout`), `layouts` collection (three-edit change
in `schema.ts`). Eight tools: `layout_add_section`, `layout_rename_section`,
`layout_move_section`, `layout_remove_section` (destructive),
`layout_add_panel`, `layout_move_panel`, `layout_set_panel`,
`layout_remove_panel` (destructive), `layout_reset` (destructive) — honest
previews, span as string enum coerced in the executor. Capability pages render
per-section `SectionHead` + `CapabilityPanels`, with a quiet "Layout customised
· reset" affordance that goes through the gate. v1 covers capability pages
only. "Add a Gym section" = `layout_add_section` + `layout_add_panel(habits)`;
"weight tracker" = `add_kpi` + `layout_add_panel(kpi-grid)`.

## Phase 5 — Persistent named conversations

`conversations` collection; `Conversation {title, autoTitle, targetKey,
pageContext?, startedAt, lastAt, turns, favourite, archived}`;
`AssistantMessage.conversationId?`. `ask()` creates/updates the conversation in
the same storage scope; `heuristicTitle` (deterministic ~48 chars).
`loadConversation` (currently zero callers) becomes the thread-hydration path,
fixing the initialMessages-never-resync bug. `/assistant` becomes
Conversations: search, favourites, space/date filters; opening one navigates to
its stored pathname with `?assistant=<id>` and the Copilot restores thread +
scope. Tests: legacy grouping, founder/personal separation by `targetKey`,
threading, title determinism.

## Phase 6 — Setup state, welcome flow, connector knowledge base

`lib/business/setup.ts`: `deriveRootSetup()` (root facts only — providers, mcp
servers/states, vault names, company count, `onboardedAt`; importable from
`lib/ai`) and `deriveFullSetup()` (adds per-space facts via aggregate; pages
only). `WorkspaceRoot.onboardedAt?` backfilled to `createdAt` in
`normaliseRoot` so existing workspaces never see welcome. `workspaceExists()`
(non-seeding read) gates a redirect to `/welcome` — a route outside `(os)`,
chat-styled scripted flow: name → sample-or-empty workspace → optional provider
key → tour. `buildInitialWorkspace({mode, displayName})` gains empty mode.
`get_setup_state` read tool + `composeSetup` answer "what do I still need to
set up" with prioritised reasons. `McpPreset` gains `requirements`, `authNote`,
`troubleshooting`, `healthCheck`; Connections renders them; Home shows the
setup panel until 100%. Descoped: OAuth flows (no infra — the KB gives manual
token steps and the probe is the health check).

## Phase 7 — Contextual help, glossary, proactive recommendations

`lib/help/pages.ts` (`helpFor(page)` — what this screen is, what you can do,
related setup, concepts) and `lib/help/glossary.ts` (KPI, CRM, OAuth, MCP,
scope, risk tier, vault, simulated…). `composeHelp` answers "what is this /
what should I do here / fix this" from descriptor + glossary + setup gaps; one
declarative `guide` specialist entry routes it. `deriveContextRecommendations`
is pure and computed on render (max 2 in the Copilot empty state) — nothing
stored, so no spam and no decay machinery. Exhaustive test: `helpFor` non-null
for every `PageKind`; every referenced concept exists in the glossary.

## Descoped from v1

OAuth flows (no infra); vision analysis of image attachments (stored and
rendered only); model-generated conversation titles (determinism); multi-scope
fan-out ("add X to every company" proposes per named scope, max 3, or asks);
EDIT-as-form on proposals (chat is the editor); layout overrides beyond
capability pages; new widget kinds via chat (renderers are code); streaming
output; targeted revalidation.
