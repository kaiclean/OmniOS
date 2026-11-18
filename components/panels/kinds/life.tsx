/**
 * Panels for personal life: health, habits, relationships, learning, life
 * admin, calendar, and the memory panel.
 *
 * Server Components. A missing health value stays missing (invariant 3): the
 * energy figure is derived from real inputs or it is not shown.
 */

import {
  EMPTY,
  daysBetween,
  formatDate,
  formatDurationMinutes,
  formatNumber,
  formatPercent,
} from '@/lib/format';
import { deriveEnergy, energyLabel, energyOf } from '@/lib/personal/energy';
import {
  Badge,
  Empty,
  ListRow,
  Meter,
  Metric,
  MetricGrid,
  Panel,
} from '@/components/ui/primitives';
import { scoped, type PanelProps, type SimplePanelProps } from './shared';

/* ---------------------------------------------------------------- health -- */

export function HealthPanel({ title, span, ctx }: SimplePanelProps) {
  const days = [...ctx.data.health].sort((a, b) => (a.date < b.date ? -1 : 1));
  const tracked = days.filter((d) => d.sleepHours !== undefined);
  const latest = tracked[tracked.length - 1];
  const week = tracked.slice(-7);

  if (!latest) {
    return (
      <Panel title={title} span={span}>
        <Empty title="Nothing logged">
          Recovery drives how the assistant plans your week. Without it, it plans blind and says so.
        </Empty>
      </Panel>
    );
  }

  const energy = energyOf(latest);
  const breakdown = deriveEnergy(latest);
  const avgSleep = week.reduce((s, d) => s + (d.sleepHours ?? 0), 0) / (week.length || 1);
  // Drop days whose energy cannot be derived rather than plotting them as 0 —
  // a zero draws a crash that never happened. Absence leaves a gap, not a dip.
  const energySeries = tracked
    .slice(-28)
    .map((d) => energyOf(d))
    .filter((value): value is number => value !== null);

  return (
    <Panel
      title={title}
      span={span}
      subtitle={`Last logged ${formatDate(latest.date)} · ${days.length - tracked.length} untracked days in range`}
    >
      <div className="stack">
        <MetricGrid>
          <Metric
            label="Energy"
            value={energy === null ? EMPTY : formatNumber(energy)}
            hint={energyLabel(energy)}
            series={energySeries}
          />
          <Metric label="Sleep · 7-day avg" value={`${formatNumber(avgSleep, 1)}h`} hint="Target 7h" target={7} />
          <Metric label="HRV" value={formatNumber(latest.hrv)} hint="Last night" />
          <Metric label="Resting HR" value={formatNumber(latest.restingHeartRate)} hint="Last night" />
        </MetricGrid>

        <div>
          <p className="eyebrow" style={{ marginBottom: 'var(--s-2)' }}>
            What the score is made of
          </p>
          <div className="stack" style={{ gap: 'var(--s-2)' }}>
            {breakdown.contributions.map((c) => (
              <div key={c.label} className="spread">
                <span className="list-secondary">{c.label}</span>
                <span className="row" style={{ width: '9rem' }}>
                  <Meter value={c.points / c.of} label={c.label} />
                  <span className="list-meta">
                    {c.points}/{c.of}
                  </span>
                </span>
              </div>
            ))}
            {breakdown.missing.length > 0 ? (
              <p className="list-secondary">Not recorded: {breakdown.missing.join(', ')}</p>
            ) : null}
          </div>
        </div>
      </div>
    </Panel>
  );
}

export function HabitsPanel({ title, span, ctx }: SimplePanelProps) {
  const habits = ctx.data.habits.filter((h) => !h.archived);
  return (
    <Panel title={title} span={span} flush>
      {habits.length === 0 ? (
        <Empty title="No habits tracked" />
      ) : (
        <div className="list">
          {habits.map((habit) => {
            const recent = habit.completions.filter((d) => daysBetween(d) <= 28).length;
            const expected = habit.targetPerWeek * 4;
            const adherence = expected > 0 ? Math.min(1, recent / expected) : 0;
            return (
              <div key={habit.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                <div className="grow stack" style={{ gap: 'var(--s-2)' }}>
                  <span className="spread">
                    <span className="list-primary">{habit.name}</span>
                    <span className="list-meta">{formatPercent(adherence * 100)}</span>
                  </span>
                  <Meter
                    value={adherence}
                    label={habit.name}
                    tone={adherence > 0.75 ? 'ok' : adherence > 0.5 ? 'warn' : 'deny'}
                  />
                  <span className="list-secondary">{habit.intent}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

export function RelationshipsPanel({ title, span, ctx }: SimplePanelProps) {
  const circles = ['family', 'inner', 'friends', 'mentors', 'network'] as const;
  const people = ctx.data.relationships;

  return (
    <Panel
      title={title}
      span={span}
      subtitle="Cadence you chose, not a productivity metric."
    >
      {people.length === 0 ? (
        <Empty title="Nobody added yet" />
      ) : (
        <div className="stack">
          {circles.map((circle) => {
            const inCircle = people.filter((p) => p.circle === circle);
            if (inCircle.length === 0) return null;
            return (
              <div key={circle} className="stack" style={{ gap: 'var(--s-2)' }}>
                <span className="eyebrow">{circle}</span>
                <div className="chip-row">
                  {inCircle.map((person) => {
                    const since = person.lastContactAt ? daysBetween(person.lastContactAt) : null;
                    const overdue = since !== null && since > person.cadenceDays;
                    return (
                      <span key={person.id} className={overdue ? 'person person--overdue' : 'person'}>
                        <span>{person.name}</span>
                        <span className="list-meta">{since === null ? EMPTY : `${since}d`}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

export function LearningPanel({ title, span, ctx }: SimplePanelProps) {
  const items = ctx.data.learning;
  return (
    <Panel title={title} span={span} flush>
      {items.length === 0 ? (
        <Empty title="Nothing in progress" />
      ) : (
        <div className="list">
          {items.map((item) => (
            <div key={item.id} className="list-row" style={{ alignItems: 'flex-start' }}>
              <div className="grow stack" style={{ gap: 'var(--s-2)' }}>
                <span className="spread">
                  <span className="list-primary">
                    {item.title}
                    {item.author ? <span className="faint"> · {item.author}</span> : null}
                  </span>
                  <Badge tone="outline">{item.kind}</Badge>
                </span>
                <Meter value={item.progress} label={item.title} />
                <span className="list-secondary">{item.why}</span>
                {item.insights.length > 0 ? (
                  <ul className="list-secondary">
                    {item.insights.map((insight) => (
                      <li key={insight}>· {insight}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function LifeAdminPanel({ title, span, ctx }: SimplePanelProps) {
  const items = [...ctx.data.lifeAdmin]
    .filter((i) => i.status !== 'done')
    .sort((a, b) => ((a.dueDate ?? '9999') < (b.dueDate ?? '9999') ? -1 : 1));
  return (
    <Panel title={title} span={span} flush>
      {items.length === 0 ? (
        <Empty title="Nothing open" />
      ) : (
        <div className="list">
          {items.map((item) => (
            <ListRow
              key={item.id}
              primary={item.title}
              secondary={item.detail ?? item.location ?? undefined}
              meta={formatDate(item.dueDate)}
              trailing={<Badge tone="outline">{item.kind}</Badge>}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

export function CalendarPanel({ title, span, ctx }: SimplePanelProps) {
  const blocks = [...ctx.data.calendar].sort((a, b) =>
    a.date === b.date ? a.startMinute - b.startMinute : a.date < b.date ? -1 : 1,
  );
  const days = [...new Set(blocks.map((b) => b.date))].slice(0, 7);

  return (
    <Panel title={title} span={span} flush>
      {days.length === 0 ? (
        <Empty title="Nothing scheduled" />
      ) : (
        <div className="list">
          {days.map((day) => (
            <div key={day} className="list-row" style={{ alignItems: 'flex-start' }}>
              <div className="grow stack" style={{ gap: 'var(--s-1)' }}>
                <span className="eyebrow">{formatDate(day)}</span>
                {blocks
                  .filter((b) => b.date === day)
                  .map((block) => (
                    <span key={block.id} className="spread">
                      <span className="list-primary">{block.title}</span>
                      <span className="list-meta">{formatDurationMinutes(block.durationMinutes)}</span>
                    </span>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------------- memory -- */

export function MemoryPanel({ title, span, spec, ctx }: PanelProps) {
  const own = scoped(ctx.data.memory, spec, ctx);
  const owner = spec.capabilityId ?? ctx.capabilityId;
  const shared = (ctx.sharedMemory ?? []).filter(
    (m) => spec.capabilityFilter === 'all' || m.capabilityId === owner,
  );

  return (
    <Panel title={title} span={span} flush>
      {own.length === 0 && shared.length === 0 ? (
        <Empty title="Nothing learned yet" />
      ) : (
        <div className="list">
          {own.map((record) => (
            <ListRow
              key={record.id}
              primary={record.text}
              secondary={record.kind}
              meta={formatPercent(record.strength * 100)}
            />
          ))}
          {shared.map((record) => (
            <ListRow
              key={record.id}
              primary={record.text}
              secondary={`${record.kind} · shared across every space`}
              trailing={<Badge tone="info">shared</Badge>}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}
