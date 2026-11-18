/**
 * Panels for planning and execution: KPIs, goals, tasks, roadmap, automations.
 *
 * Server Components. Each receives scoped records through `PanelContext` and
 * draws them; none knows whether the space is a company or a life.
 */

import {
  EMPTY,
  formatDate,
  formatDurationMinutes,
  formatPercent,
  pluralise,
  titleCase,
} from '@/lib/format';
import { Icon } from '@/components/ui/Icon';
import {
  Badge,
  Empty,
  KpiTile,
  ListRow,
  Meter,
  MetricGrid,
  Panel,
} from '@/components/ui/primitives';
import { scoped, type PanelProps } from './shared';

/* ------------------------------------------------------------------ kpis -- */

export function KpiPanel({ title, span, spec, ctx }: PanelProps) {
  const kpis = scoped(ctx.data.kpis, spec, ctx);
  return (
    <Panel title={title} span={span}>
      {kpis.length === 0 ? (
        <Empty title="No metrics yet">Metrics appear as this capability accumulates records.</Empty>
      ) : (
        <MetricGrid>
          {kpis.map((kpi) => (
            <KpiTile key={kpi.id} kpi={kpi} />
          ))}
        </MetricGrid>
      )}
    </Panel>
  );
}

/* ----------------------------------------------------------------- goals -- */

const GOAL_TONE = {
  'on-track': 'ok',
  'at-risk': 'warn',
  'off-track': 'deny',
  achieved: 'accent',
  paused: 'neutral',
} as const;

export function GoalsPanel({ title, span, spec, ctx }: PanelProps) {
  const goals = scoped(ctx.data.goals, spec, ctx);
  return (
    <Panel title={title} span={span} flush>
      {goals.length === 0 ? (
        <Empty title="No goals set">A space without goals cannot tell you what is off track.</Empty>
      ) : (
        <div className="list">
          {goals.map((goal) => (
            <div key={goal.id} className="list-row" style={{ alignItems: 'flex-start' }}>
              <div className="grow stack" style={{ gap: 'var(--s-2)' }}>
                <div className="spread">
                  <span className="list-primary">{goal.title}</span>
                  <Badge tone={GOAL_TONE[goal.status]}>{goal.status.replace('-', ' ')}</Badge>
                </div>
                <Meter
                  value={goal.progress}
                  label={goal.title}
                  tone={goal.status === 'on-track' ? 'ok' : goal.status === 'at-risk' ? 'warn' : undefined}
                />
                <div className="spread list-secondary">
                  <span>
                    {titleCase(goal.horizon.replace('-', ' '))}
                    {goal.targetDate ? ` · ${formatDate(goal.targetDate)}` : ''}
                  </span>
                  <span>{formatPercent(goal.progress * 100)}</span>
                </div>
                {goal.why ? <span className="list-secondary">{goal.why}</span> : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ----------------------------------------------------------------- tasks -- */

const PRIORITY_ORDER = { p0: 0, p1: 1, p2: 2, p3: 3 } as const;

export function TasksPanel({ title, span, spec, ctx }: PanelProps) {
  const tasks = scoped(ctx.data.tasks, spec, ctx).sort(
    (a, b) =>
      Number(a.status === 'done') - Number(b.status === 'done') ||
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
  );
  const open = tasks.filter((t) => t.status !== 'done').length;

  return (
    <Panel
      title={title}
      span={span}
      subtitle={`${pluralise(open, 'open item')} · ${tasks.length - open} done`}
      flush
    >
      {tasks.length === 0 ? (
        <Empty title="Nothing here">Work added to this capability shows up here.</Empty>
      ) : (
        <div className="list">
          {tasks.slice(0, spec.limit ?? 12).map((task) => (
            <ListRow
              key={task.id}
              done={task.status === 'done'}
              primary={task.title}
              secondary={
                task.status === 'blocked' && task.blockedReason
                  ? `Blocked — ${task.blockedReason}`
                  : `${task.priority.toUpperCase()} · ${task.energy} · ${formatDurationMinutes(task.estimateMinutes)}`
              }
              meta={task.dueDate ? formatDate(task.dueDate) : EMPTY}
              trailing={
                task.status === 'blocked' ? (
                  <Badge tone="deny" dot>
                    blocked
                  </Badge>
                ) : task.status === 'active' ? (
                  <Badge tone="accent" dot>
                    active
                  </Badge>
                ) : null
              }
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

/* --------------------------------------------------------------- roadmap -- */

const STAGE_TONE = {
  idea: 'neutral',
  planned: 'info',
  building: 'accent',
  shipped: 'ok',
  parked: 'outline',
} as const;

export function RoadmapPanel({ title, span, spec, ctx }: PanelProps) {
  const items = scoped(ctx.data.roadmap, spec, ctx);
  const stages = ['building', 'planned', 'idea', 'shipped', 'parked'] as const;

  return (
    <Panel title={title} span={span}>
      {items.length === 0 ? (
        <Empty title="Nothing on the roadmap" />
      ) : (
        <div className="roadmap">
          {stages.map((stage) => {
            const inStage = items.filter((i) => i.stage === stage);
            if (inStage.length === 0) return null;
            return (
              <div key={stage} className="roadmap-col">
                <div className="spread">
                  <span className="eyebrow">{stage}</span>
                  <span className="list-meta">{inStage.length}</span>
                </div>
                {inStage.map((item) => (
                  <div key={item.id} className="roadmap-card">
                    <span>{item.title}</span>
                    <div className="spread list-secondary">
                      <span>{item.horizon}</span>
                      <Badge tone={STAGE_TONE[item.stage]}>{formatPercent(item.confidence * 100)}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

/* ----------------------------------------------------------- automations -- */

const AUTOMATION_TONE = { armed: 'ok', draft: 'neutral', paused: 'outline', failing: 'deny' } as const;

export function AutomationsPanel({ title, span, spec, ctx }: PanelProps) {
  const automations = scoped(ctx.data.automations, spec, ctx);
  const saved = automations
    .filter((a) => a.status === 'armed')
    .reduce((sum, a) => sum + a.minutesSavedPerRun * a.runsThisMonth, 0);

  return (
    <Panel
      title={title}
      span={span}
      subtitle={`${formatDurationMinutes(saved)} returned this month`}
      flush
      footer={
        <span className="row">
          <Icon name="shield" size={13} />
          Nothing reaches outside OmniOS without your approval.
        </span>
      }
    >
      {automations.length === 0 ? (
        <Empty title="No automations yet" />
      ) : (
        <div className="list">
          {automations.map((automation) => (
            <ListRow
              key={automation.id}
              primary={automation.name}
              secondary={`${automation.triggerDetail} · ${pluralise(automation.steps.length, 'step')}`}
              meta={
                automation.status === 'armed'
                  ? `${formatDurationMinutes(automation.minutesSavedPerRun)}/run`
                  : `${formatDurationMinutes(automation.minutesSavedPerRun)} potential`
              }
              trailing={
                <span className="row" style={{ gap: 'var(--s-2)' }}>
                  {automation.requiresApproval ? <Badge tone="warn">approval</Badge> : null}
                  <Badge tone={AUTOMATION_TONE[automation.status]} dot>
                    {automation.status}
                  </Badge>
                </span>
              }
            />
          ))}
        </div>
      )}
    </Panel>
  );
}
