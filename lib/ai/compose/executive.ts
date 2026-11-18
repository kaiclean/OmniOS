/**
 * The Chief of Staff composer and the general (orientation) composer.
 */

import type { Task } from '@/lib/domain';
import { daysBetween, formatDate, formatDurationMinutes, pluralise } from '@/lib/format';
import { calendarOf, memoryOf, relationshipsOf, suggestionsOf, type Origin } from '../context';
import type { ContextReferenceInput } from '../types';
import {
  ENERGY_MINUTES,
  blocks,
  bullet,
  energyToday,
  isOverdue,
  openTasks,
  ref,
  section,
  type Composer,
} from './helpers';

/** Chief of Staff: what to do next, given everything. */
export const composeExecutive: Composer = (ctx) => {
  const { score, label, budget } = energyToday(ctx);
  const tasks = openTasks(ctx);
  const overdue = tasks.filter((t) => isOverdue(t.item.dueDate, ctx.now));
  const blocked = tasks.filter((t) => t.item.status === 'blocked');
  const references: ContextReferenceInput[] = [];

  // Fill the day against the energy budget rather than listing everything open.
  const capacity = budget ?? 180;
  const picked: Array<Origin<Task>> = [];
  let spent = 0;
  for (const t of tasks) {
    const cost = t.item.estimateMinutes ?? ENERGY_MINUTES[t.item.energy];
    if (t.item.status === 'blocked') continue;
    if (spent + cost > capacity && picked.length >= 1) continue;
    picked.push(t);
    spent += cost;
    if (picked.length >= 4) break;
  }
  for (const t of picked) references.push(ref('task', t, t.item.title));

  const energyLine =
    score === null
      ? 'Energy is unknown today — nothing recent was logged, so this plan assumes an average day rather than guessing.'
      : `Energy is ${label.toLowerCase()} (${score}/100), which honestly supports about ${formatDurationMinutes(capacity)} of focused work.`;

  const lines = picked.map((t) => {
    const cost = t.item.estimateMinutes ?? ENERGY_MINUTES[t.item.energy];
    const where = ctx.slices.length > 1 ? ` · ${t.spaceLabel}` : '';
    const due = t.item.dueDate ? ` · due ${formatDate(t.item.dueDate)}` : '';
    return `${t.item.title} — ${t.item.priority.toUpperCase()} · ${formatDurationMinutes(cost)}${where}${due}`;
  });

  const tail: string[] = [];
  if (overdue.length) {
    tail.push(
      `${pluralise(overdue.length, 'item is', 'items are')} past their date. The oldest is "${overdue[0]?.item.title}".`,
    );
  }
  if (blocked.length) {
    const first = blocked[0];
    tail.push(
      `${pluralise(blocked.length, 'task is', 'tasks are')} blocked — "${first?.item.title}" is waiting on: ${first?.item.blockedReason ?? 'an unnamed dependency'}.`,
    );
  }
  const overdueRel = relationshipsOf(ctx).filter(
    (r) => r.item.lastContactAt && daysBetween(r.item.lastContactAt, ctx.now) > r.item.cadenceDays,
  );
  if (overdueRel.length) {
    tail.push(
      `${pluralise(overdueRel.length, 'person is', 'people are')} past the cadence you set — starting with ${overdueRel[0]?.item.name}.`,
    );
  }

  const body = blocks([
    energyLine,
    section('What I would do today', lines.length ? bullet(lines) : '• Nothing is open. That is allowed.'),
    tail.length ? section('Worth knowing', bullet(tail)) : null,
  ]);

  return {
    summary: `Ranked ${tasks.length} open items against today's energy and picked ${picked.length}.`,
    body,
    references,
    outputs: new Map([
      ['chief-of-staff', `Sequenced ${picked.length} items inside a ${formatDurationMinutes(capacity)} budget.`],
      ['health', score === null ? 'No recent recovery data to read.' : `Recovery reads ${label.toLowerCase()} at ${score}/100.`],
      ['project-manager', blocked.length ? `${blocked.length} blocked item(s) flagged.` : 'Nothing blocked.'],
    ]),
  };
};

/** Finance Lead: position, burn, and where the money actually goes. */

export const composeGeneral: Composer = (ctx, prompt) => {
  const tasks = openTasks(ctx);
  const sugg = suggestionsOf(ctx).filter((s) => s.item.status === 'open');
  const mem = memoryOf(ctx).filter((m) => m.item.kind === 'preference' || m.item.kind === 'decision');
  const cal = calendarOf(ctx).filter((c) => c.item.date === ctx.now.toISOString().slice(0, 10));

  const body = blocks([
    `I do not have a specialist that clearly owns "${prompt.trim()}", so here is where things stand and who would take it if you narrow it.`,
    section(
      'State',
      bullet([
        `${pluralise(tasks.length, 'open item')}${tasks[0] ? `, top of the list: "${tasks[0].item.title}"` : ''}`,
        `${pluralise(sugg.length, 'open recommendation')}`,
        `${pluralise(cal.length, 'block')} on the calendar today`,
      ]),
    ),
    mem.length
      ? section('Working from what I know about you', bullet(mem.slice(0, 3).map((m) => m.item.text)))
      : null,
  ]);

  return {
    // This label is visible as the collapsed plan line, so it reads as
    // disclosure, not as an internal routing log entry.
    summary: 'Answered directly from your records — no single specialist owned this one.',
    body,
    references: mem.slice(0, 2).map((m) => ref('memory', m, m.item.text.slice(0, 48))),
    outputs: new Map([['chief-of-staff', 'Took it directly; no specialist clearly owned it.']]),
    orientation: true,
  };
};
