import Link from 'next/link';

import { acrossSpaces, loadSpaces, overviewSnapshot } from '@/lib/data/aggregate';
import { getWorkspace } from '@/lib/data/store';
import {
  EMPTY,
  daysBetween,
  formatDate,
  formatDurationMinutes,
  formatPercent,
  pluralise,
} from '@/lib/format';
import { deepWorkBudgetMinutes, energyLabel } from '@/lib/personal/energy';
import { specialistName } from '@/lib/ai/specialists';
import { hueForSpaceKey } from '@/lib/ui/space-tint';
import { Icon } from '@/components/ui/Icon';
import {
  Badge,
  Empty,
  ListRow,
  Note,
  PageHead,
  Panel,
  SectionHead,
  SimulatedMark,
} from '@/components/ui/primitives';

/**
 * Home is the only screen that sees everything.
 *
 * Its job is not to show more than the space pages — it is to show the
 * collisions the space pages structurally cannot: a deep-work day booked on top
 * of a bad night, a company priority competing with a person who has been
 * waiting three weeks. That trade-off is the reason life and business live in
 * one system rather than two good ones.
 */
export default async function HomePage() {
  const [workspace, spaces, snapshot] = await Promise.all([
    getWorkspace(),
    loadSpaces(),
    overviewSnapshot(),
  ]);

  const budget = deepWorkBudgetMinutes(snapshot.energy);
  const suggestions = acrossSpaces(spaces, 'suggestions')
    .filter((entry) => entry.item.status === 'open')
    .sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 } as const;
      return rank[a.item.impact] - rank[b.item.impact] || b.item.confidence - a.item.confidence;
    })
    .slice(0, 6);

  const risks = acrossSpaces(spaces, 'risks')
    .filter((entry) => entry.item.severity === 'high' || entry.item.severity === 'critical')
    .slice(0, 5);

  const personal = spaces.find((s) => s.kind === 'personal');
  const overduePeople = (personal?.data.relationships ?? []).filter(
    (r) => r.lastContactAt && daysBetween(r.lastContactAt) > r.cadenceDays,
  );

  const awaiting = workspace.upgrades.filter((u) => u.stage === 'awaiting-approval');
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Still up' : hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';

  return (
    <>
      <PageHead
        eyebrow={`${greeting}, ${workspace.personal.displayName}`}
        title="Everything, in one place"
        lede={
          snapshot.energy === null
            ? `${pluralise(spaces.length, 'space')} · nothing logged for recovery today, so the plan below assumes an average day rather than guessing.`
            : `${pluralise(spaces.length, 'space')} · energy ${energyLabel(snapshot.energy).toLowerCase()}, which honestly supports about ${formatDurationMinutes(budget)} of focused work.`
        }
        actions={
          <Link className="btn btn--primary" href="/companies/new">
            <Icon name="plus" />
            New company
          </Link>
        }
      />

      {awaiting.length > 0 ? (
        <Note tone="accent" icon="shield">
          {pluralise(awaiting.length, 'upgrade is', 'upgrades are')} sandboxed, measured and waiting
          on your decision. Nothing applies itself.{' '}
          <Link href="/intelligence/upgrades" className="link-inline">
            Review them
          </Link>
          .
        </Note>
      ) : null}

      <div className="grid" style={{ marginTop: 'var(--s-6)' }}>
        <Panel
          title="What I would do next"
          subtitle="Ranked across every space against today's energy"
          span={8}
          flush
        >
          {snapshot.topPriorities.length === 0 ? (
            <Empty title="Nothing open">Genuinely nothing is waiting. That is allowed.</Empty>
          ) : (
            <div className="list">
              {snapshot.topPriorities.map(({ task, spaceLabel, href }) => (
                <ListRow
                  key={task.id}
                  primary={<Link href={href}>{task.title}</Link>}
                  secondary={`${spaceLabel} · ${task.energy} · ${formatDurationMinutes(task.estimateMinutes)}`}
                  meta={task.dueDate ? formatDate(task.dueDate) : EMPTY}
                  trailing={<Badge tone={task.priority === 'p0' ? 'deny' : 'outline'}>{task.priority.toUpperCase()}</Badge>}
                />
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Spaces" span={4} flush>
          <div className="list">
            {spaces.map((space) => {
              const open = space.data.tasks.filter((t) => t.status !== 'done').length;
              return (
                <Link key={space.scopeKey} className="list-row" href={space.href}>
                  <span
                    className="space-dot"
                    style={{
                      background: `oklch(0.76 0.118 ${hueForSpaceKey(space.scopeKey)})`,
                      color: `oklch(0.76 0.118 ${hueForSpaceKey(space.scopeKey)})`,
                    }}
                  />
                  <span className="grow list-primary truncate">{space.label}</span>
                  <span className="list-meta">{open}</span>
                </Link>
              );
            })}
            <Link className="list-row" href="/companies/new">
              <Icon name="plus" className="nav-icon" />
              <span className="grow list-secondary">Create a company</span>
            </Link>
          </div>
        </Panel>

        <Panel
          title="Recommendations"
          subtitle="From the specialists, with the evidence they used"
          span={8}
          action={<SimulatedMark label="From your records" />}
          flush
        >
          {suggestions.length === 0 ? (
            <Empty title="Nothing to recommend" />
          ) : (
            <div className="list">
              {suggestions.map(({ item, space }) => (
                <div key={item.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                  <div className="grow stack" style={{ gap: 'var(--s-1)' }}>
                    <span className="spread">
                      <span className="list-primary">{item.title}</span>
                      <Badge tone={item.impact === 'high' ? 'accent' : 'outline'}>
                        {item.impact} impact
                      </Badge>
                    </span>
                    <p className="prose">{item.rationale}</p>
                    <span className="list-secondary">
                      {space.label} · {specialistName(item.specialistId)} · confidence{' '}
                      {formatPercent(item.confidence * 100)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Needs a human" span={4} flush>
          <div className="list">
            {risks.map(({ item, space }) => (
              <ListRow
                key={item.id}
                primary={item.label}
                secondary={space.label}
                trailing={<Badge tone="deny" dot>{item.severity}</Badge>}
              />
            ))}
            {overduePeople.slice(0, 3).map((person) => (
              <ListRow
                key={person.id}
                primary={person.name}
                secondary={`${daysBetween(person.lastContactAt ?? '')} days · you set ${person.cadenceDays}`}
                trailing={<Badge tone="warn">overdue</Badge>}
              />
            ))}
            {risks.length === 0 && overduePeople.length === 0 ? (
              <Empty title="Nothing pressing" />
            ) : null}
          </div>
        </Panel>
      </div>

      <SectionHead
        title="Systems"
        action={<span className="hint">Every capability, available to every space</span>}
      />
      <div className="capability-grid">
        <SystemCard href="/brain" icon="brain" title="Brain" detail="Memory across companies, life and shared capabilities" />
        <SystemCard href="/intelligence" icon="telescope" title="Intelligence" detail="What changed in the AI ecosystem that actually matters here" />
        <SystemCard href="/studio" icon="sparkle" title="Creative Studio" detail="Briefs in, on-brand assets out" />
        <SystemCard href="/factory" icon="factory" title="Product Factory" detail="An idea becomes a full product plan" />
        <SystemCard href="/finance" icon="coins" title="Finance Center" detail="Company and personal money, kept separate" />
        <SystemCard href="/automations" icon="bolt" title="Automations" detail="Work that does itself, with an approval gate" />
      </div>
    </>
  );
}

function SystemCard({
  href,
  icon,
  title,
  detail,
}: {
  href: string;
  icon: 'brain' | 'telescope' | 'sparkle' | 'factory' | 'coins' | 'bolt';
  title: string;
  detail: string;
}) {
  return (
    <Link className="panel card-link" href={href}>
      <div className="panel-body stack" style={{ gap: 'var(--s-2)' }}>
        <Icon name={icon} className="nav-icon" />
        <span className="panel-title">{title}</span>
        <span className="hint">{detail}</span>
      </div>
    </Link>
  );
}
