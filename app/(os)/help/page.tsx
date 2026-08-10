import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHead, Panel, SectionHead } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'How OmniOS works' };

/**
 * The mental model, written down. Static on purpose: this page describes the
 * architecture's promises, and those change by pull request, not by data.
 */
export default function HelpPage() {
  return (
    <>
      <PageHead
        eyebrow="OS"
        title="How OmniOS works"
        lede="Five ideas explain everything else. Read this once and every screen becomes predictable."
      />

      <div className="grid">
        <Concept
          title="1 · Spaces are walls, not folders"
          body="Every company and your personal life is a space with its own records. Nothing inside a space can read another space — not the assistant, not an agent, not a meeting. Only you see across them, on founder pages like Home, Mission Control and the Timeline."
          links={[{ href: '/companies', label: 'All companies' }]}
        />
        <Concept
          title="2 · One assistant, many voices"
          body="You talk to one assistant. It routes each question to specialists — built-ins plus any agents you hire per space. Mention one directly with @name, or open a Team page to talk to a single agent whose briefings and tools are limited to the capabilities on its charter."
          links={[{ href: '/assistant', label: 'Assistant' }]}
        />
        <Concept
          title="3 · Nothing applies itself"
          body="Everything the system wants to do is a tool call with a risk tier. Reading and reversible writing run on their own. Anything that deletes or reaches outside stops, shows you exactly what would happen, and waits. Your decision is recorded — who and when — before anything runs. A standing grant is that decision made in advance: narrow, expiring, revocable."
          links={[
            { href: '/approvals', label: 'Approvals' },
            { href: '/security', label: 'Security Center' },
          ]}
        />
        <Concept
          title="4 · Meetings end in execution"
          body="A Team Room seats the right specialists for your topic. They answer from the space's real records and can disagree. When you are ready, the discussion becomes a plan; approving it creates real tasks through the same gate as everything else. The tasks are the execution state — there is no second progress tracker."
          links={[{ href: '/life/room', label: 'Your council' }]}
        />
        <Concept
          title="5 · Everything leaves a trail"
          body="Actions, decisions, meetings, runs, grants and upgrades are projected onto one timeline straight from the records — there is no separate history to fall out of date. Mission Control shows what is live and what waits on you right now."
          links={[
            { href: '/timeline', label: 'Timeline' },
            { href: '/mission-control', label: 'Mission Control' },
          ]}
        />
        <Concept
          title="Reaching outside"
          body="OmniOS has no bespoke integrations. The outside world arrives as MCP servers you connect; their tools inherit the gate automatically, tiered by the autonomy you chose. No connection, no reach — the assistant will say so plainly rather than pretend."
          links={[{ href: '/connections', label: 'Connections' }]}
        />
      </div>

      <SectionHead title="The composer, quickly" />
      <div className="grid">
        <Panel span={12} flush>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">You type</th>
                  <th scope="col">What happens</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>a question</td>
                  <td>The assistant answers from this space&apos;s records, looking things up first when it needs to.</td>
                </tr>
                <tr>
                  <td>an instruction</td>
                  <td>It plans tool calls. Safe ones run; gated ones queue under Approvals.</td>
                </tr>
                <tr>
                  <td><code>@engineer …</code></td>
                  <td>That specialist answers, instead of whoever routing would pick.</td>
                </tr>
                <tr>
                  <td><code>/task …</code> · <code>/goal …</code> · <code>/remember …</code></td>
                  <td>Exactly one record is proposed — no model, no ambiguity, same gate.</td>
                </tr>
                <tr>
                  <td>the conversation selector</td>
                  <td>Named threads per space. A thread is just its messages — start one, and it exists once you speak.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <SectionHead title="Glossary" />
      <div className="grid">
        <Panel span={12} flush>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Term</th>
                  <th scope="col">Meaning</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Scope</td><td>The wall around one space&apos;s records. Every read and write names one.</td></tr>
                <tr><td>Capability</td><td>A domain of work — Marketing, Finance, Health — available to every space.</td></tr>
                <tr><td>Risk tier</td><td>read · write · destructive · external. The tier, never the caller, decides whether a call waits.</td></tr>
                <tr><td>The gate</td><td>Where gated calls stop. Approving records who decided and when, then runs the call.</td></tr>
                <tr><td>Standing grant</td><td>An approval recorded in advance for one connection tool in one space, optionally expiring, always revocable.</td></tr>
                <tr><td>Agent</td><td>A voice on a space&apos;s roster — built-in or hired — with a charter, routing phrases, and capability-limited tools.</td></tr>
                <tr><td>Simulated</td><td>Produced locally from your records rather than by a model — always labelled, never silently.</td></tr>
                <tr><td>MCP server</td><td>The only door to the outside. Its tools arrive pre-gated.</td></tr>
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}

function Concept({
  title,
  body,
  links,
}: {
  title: string;
  body: string;
  links: readonly { href: string; label: string }[];
}) {
  return (
    <Panel span={6} title={title}>
      <div className="stack" style={{ gap: 'var(--s-3)' }}>
        <p className="prose">{body}</p>
        <div className="row wrap" style={{ gap: 'var(--s-2)' }}>
          {links.map((link) => (
            <Link key={link.href} className="btn btn--secondary btn--sm" href={link.href}>
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </Panel>
  );
}
