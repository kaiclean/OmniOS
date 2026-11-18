/**
 * Composers for health and personal life.
 */

import { daysBetween, formatDate, formatDurationMinutes } from '@/lib/format';
import { deepWorkBudgetMinutes, energyLabel, energyOf } from '@/lib/personal/energy';
import { habitsOf, healthOf, learningOf, lifeAdminOf, relationshipsOf } from '../context';
import { blocks, bullet, ref, section, type Composer } from './helpers';

export const composeHealth: Composer = (ctx) => {
  const days = healthOf(ctx)
    .filter((d) => d.item.sleepHours !== undefined)
    .sort((a, b) => (a.item.date < b.item.date ? 1 : -1));

  if (days.length === 0) {
    return {
      summary: 'No health data recorded.',
      body: 'There is nothing logged yet, so there is nothing honest to say about recovery. Once sleep and HRV are recorded, this becomes the input the weekly plan is built from.',
      references: [],
      outputs: new Map([['health', 'No data available.']]),
    };
  }

  const week = days.slice(0, 7);
  const avgSleep = week.reduce((s, d) => s + (d.item.sleepHours ?? 0), 0) / week.length;
  const energies = week.map((d) => energyOf(d.item)).filter((e): e is number => e !== null);
  const avgEnergy = energies.length ? Math.round(energies.reduce((s, e) => s + e, 0) / energies.length) : null;
  const low = week.filter((d) => (energyOf(d.item) ?? 100) < 55).length;
  const trained = week.filter((d) => (d.item.workoutMinutes ?? 0) > 0).length;
  const budget = deepWorkBudgetMinutes(avgEnergy);

  const nonNegotiable = ctx.personal.dna.nonNegotiables.find((n) => /sleep/i.test(n));
  const breach = nonNegotiable && avgSleep < 7;

  const body = blocks([
    section(
      'Last seven days',
      bullet([
        `Average sleep: ${avgSleep.toFixed(1)}h`,
        `Average energy: ${avgEnergy === null ? '—' : `${avgEnergy}/100 (${energyLabel(avgEnergy).toLowerCase()})`}`,
        `Days below 55 energy: ${low}`,
        `Training sessions: ${trained}`,
      ]),
    ),
    section(
      'What that permits',
      budget === null
        ? 'Not enough signal to set a deep-work budget.'
        : `About ${formatDurationMinutes(budget)} of deep work per day. Planning above that borrows from next week.`,
    ),
    breach
      ? `This breaches one of your own non-negotiables: "${nonNegotiable}". It is the first thing to fix, because every other number here is downstream of it.`
      : null,
  ]);

  return {
    summary: `Read ${week.length} days of recovery data.`,
    body,
    references: week.slice(0, 3).map((d) => ref('health', d, `Health ${d.item.date}`)),
    outputs: new Map([
      ['health', `Seven-day average energy ${avgEnergy ?? '—'}, sleep ${avgSleep.toFixed(1)}h.`],
      ['chief-of-staff', budget ? `Deep-work budget set to ${formatDurationMinutes(budget)}/day.` : 'Budget unset.'],
    ]),
  };
};

/** Life Architect: the people and habits that have no deadline. */
export const composePersonal: Composer = (ctx) => {
  const rels = relationshipsOf(ctx);
  const overdue = rels
    .filter((r) => r.item.lastContactAt && daysBetween(r.item.lastContactAt, ctx.now) > r.item.cadenceDays)
    .sort((a, b) => daysBetween(b.item.lastContactAt ?? '', ctx.now) - daysBetween(a.item.lastContactAt ?? '', ctx.now));

  const habits = habitsOf(ctx);
  const struggling = habits
    .map((h) => {
      const recent = h.item.completions.filter((d) => daysBetween(d, ctx.now) <= 28).length;
      const expected = h.item.targetPerWeek * 4;
      return { h, adherence: expected > 0 ? recent / expected : 1 };
    })
    .filter((x) => x.adherence < 0.7)
    .sort((a, b) => a.adherence - b.adherence);

  const admin = lifeAdminOf(ctx)
    .filter((a) => a.item.status !== 'done')
    .sort((a, b) => (a.item.dueDate ?? '9999') < (b.item.dueDate ?? '9999') ? -1 : 1);

  const learn = learningOf(ctx).filter((l) => l.item.status === 'active');

  const body = blocks([
    section(
      'People past their cadence',
      overdue.length
        ? bullet(
            overdue
              .slice(0, 4)
              .map(
                (r) =>
                  `${r.item.name} — ${daysBetween(r.item.lastContactAt ?? '', ctx.now)} days (you set ${r.item.cadenceDays})${r.item.nextIntent ? ` · ${r.item.nextIntent}` : ''}`,
              ),
          )
        : '• Everyone is within the cadence you set.',
    ),
    section(
      'Habits slipping',
      struggling.length
        ? bullet(struggling.slice(0, 3).map((x) => `${x.h.item.name} — ${Math.round(x.adherence * 100)}% of target`))
        : '• Nothing below 70% adherence.',
    ),
    section(
      'Next up',
      bullet(
        [
          admin[0] ? `${admin[0].item.title} — due ${formatDate(admin[0].item.dueDate)}` : null,
          learn[0] ? `${learn[0].item.title} — ${Math.round(learn[0].item.progress * 100)}% through` : null,
        ].filter((x): x is string => x !== null),
      ) || '• Nothing pending.',
    ),
  ]);

  return {
    summary: `Checked ${rels.length} relationships, ${habits.length} habits and ${admin.length} open life items.`,
    body,
    references: overdue.slice(0, 3).map((r) => ref('relationship', r, r.item.name)),
    outputs: new Map([
      ['life-coach', `${overdue.length} people overdue, ${struggling.length} habits slipping.`],
      ['chief-of-staff', 'None of this is urgent, which is exactly why it slips.'],
    ]),
  };
};

/** Strategist: are the goals still the plan, and what would break them. */
