# CLAUDE.md — OmniOS operating contract

## What this is

OmniOS is Kai's lifelong AI Operating System: every company, every reusable
capability, and private life in one place, with a single AI Executive Assistant
across all of it.

Read [`AI_OPERATING_SYSTEM_PRD.md`](./AI_OPERATING_SYSTEM_PRD.md) for the product
and [`docs/DECISIONS.md`](./docs/DECISIONS.md) for why the architecture is the
way it is, before changing anything structural.

## Truth hierarchy

1. What the app does when you run it
2. Tests
3. `AI_OPERATING_SYSTEM_PRD.md` and `docs/DECISIONS.md`
4. Comments

If those disagree, the code is right and the docs need fixing — say so.

## The five invariants

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
npm run verify   # typecheck -> lint -> tests -> production build
```

Never report something as working without having run it. When a change touches
layout, render the app and look at it — three real layout bugs in this repo's
history were invisible to typechecking and obvious in a screenshot.

## Style

- Strict TypeScript, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`.
- Server Components by default; `'use client'` only where interaction needs it,
  and kept in `components/`.
- Comments explain **why**, never what. Delete any comment that restates code.
- Money is integer minor units. Format through `lib/format.ts`, never by hand.
- Push back on a request that would break an invariant above; propose the version
  that does not.
