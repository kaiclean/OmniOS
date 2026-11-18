/**
 * Composers for operations and development.
 */

import { formatDurationMinutes } from '@/lib/format';
import { automationsOf, risksOf, tasksOf } from '../context';
import { blocks, bullet, ref, section, type Composer } from './helpers';

export const composeOperations: Composer = (ctx) => {
  const autos = automationsOf(ctx);
  const armed = autos.filter((a) => a.item.status === 'armed');
  const draft = autos.filter((a) => a.item.status === 'draft');
  const savedPerMonth = armed.reduce((s, a) => s + a.item.minutesSavedPerRun * a.item.runsThisMonth, 0);
  const potential = draft.reduce((s, a) => s + a.item.minutesSavedPerRun * 4, 0);
  const bottlenecks = risksOf(ctx).filter((r) => r.item.kind === 'bottleneck');

  const body = blocks([
    section(
      'Automation',
      bullet([
        `${armed.length} armed, returning about ${formatDurationMinutes(savedPerMonth)} this month`,
        `${draft.length} drafted but not armed — roughly ${formatDurationMinutes(potential)} a month unclaimed`,
        `${autos.filter((a) => a.item.requiresApproval).length} would touch something outside OmniOS and stop for approval`,
      ]),
    ),
    section(
      'Where work queues',
      bullet(bottlenecks.slice(0, 3).map((b) => `${b.item.label} — ${b.item.mitigation ?? 'no mitigation recorded'}`)) ||
        '• No bottlenecks recorded.',
    ),
    section(
      'Read',
      draft.length
        ? `The cheapest win is arming "${draft[0]?.item.name}" — it is already written and touches nothing external.`
        : 'Everything drafted is armed. The next gain comes from removing a bottleneck, not adding an automation.',
    ),
  ]);

  return {
    summary: `Reviewed ${autos.length} automations and ${bottlenecks.length} bottlenecks.`,
    body,
    references: draft.slice(0, 2).map((a) => ref('automation', a, a.item.name)),
    outputs: new Map([
      ['operator', `${bottlenecks.length} bottleneck(s) on the register.`],
      ['automation', `${draft.length} automations ready to arm.`],
    ]),
  };
};

/** Development: what is moving and what is stuck. */
export const composeDevelopment: Composer = (ctx) => {
  const tasks = tasksOf(ctx).filter((t) => t.item.capabilityId === 'development');
  const blocked = tasks.filter((t) => t.item.status === 'blocked');
  const active = tasks.filter((t) => t.item.status === 'active');
  const roadmap = ctx.slices.flatMap((s) =>
    s.data.roadmap.map((r) => ({ item: r, spaceLabel: s.label, scopeKey: s.scopeKey, spaceKind: s.spaceKind })),
  );
  const building = roadmap.filter((r) => r.item.stage === 'building');

  const body = blocks([
    section(
      'In flight',
      bullet([
        ...building.slice(0, 3).map((r) => `${r.item.title} — building · confidence ${Math.round(r.item.confidence * 100)}%`),
        ...active.slice(0, 3).map((t) => `${t.item.title} — active`),
      ]) || '• Nothing in flight.',
    ),
    section(
      'Stuck',
      bullet(blocked.map((t) => `${t.item.title} — ${t.item.blockedReason ?? 'reason not recorded'}`)) ||
        '• Nothing blocked.',
    ),
    section(
      'Read',
      building.length > 2
        ? `${building.length} things are "building" at once. Finishing one beats advancing three.`
        : 'Work in progress is at a sane level. Keep it there.',
    ),
  ]);

  return {
    summary: `Read ${tasks.length} engineering tasks and ${roadmap.length} roadmap items.`,
    body,
    references: blocked.slice(0, 3).map((t) => ref('task', t, t.item.title)),
    outputs: new Map([
      ['engineer', `${active.length} active, ${blocked.length} blocked.`],
      ['project-manager', building.length > 2 ? 'Too much in flight.' : 'WIP under control.'],
    ]),
  };
};

/** Fallback: orient in the space rather than produce nothing. */
