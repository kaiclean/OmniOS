import 'server-only';

/**
 * Executors for personal life — health days, habits, relationships, calendar
 * blocks, life admin — and for accepting or dismissing a suggestion.
 *
 * Same contract as the company group: `write` tier, one scope per call, reached
 * only through `runTool`. A missing health value stays missing (invariant 3);
 * nothing in this file fills a gap with a default number.
 */

import {
  HABIT_CADENCES,
  LIFE_ADMIN_KINDS,
  RELATIONSHIP_CIRCLES,
  scopeKey,
  type CalendarBlock,
  type Habit,
  type HealthDay,
  type LifeAdminItem,
  type Relationship,
  type ToolExecutor,
} from '@/lib/domain';
import { insertRecords, readCollection, updateRecord } from '@/lib/data/store';
import { CALENDAR_BLOCK_KINDS, argNumber, argText } from '../index';
import { ok, refuse, dayOf, base, optText, enumArg, missing } from './shared';

const HEALTH_FIELDS = [
  'sleepHours',
  'sleepQuality',
  'restingHeartRate',
  'hrv',
  'steps',
  'workoutMinutes',
  'stress',
  'mood',
] as const;

export const logHealthDay: ToolExecutor = async (ctx, args) => {
  const date = argText(args, 'date');
  const readings: Partial<Record<(typeof HEALTH_FIELDS)[number], number>> = {};
  for (const field of HEALTH_FIELDS) {
    const value = argNumber(args, field);
    if (value !== undefined) readings[field] = value;
  }
  const workoutKind = optText(args, 'workoutKind');
  const notes = optText(args, 'notes');

  if (Object.keys(readings).length === 0 && !workoutKind && !notes) {
    return refuse('Nothing to record.', 'No reading was supplied for that day.');
  }

  const days = await readCollection(ctx.scope, 'health');
  const existing = days.find((day) => day.date === date);

  // `energy` is left unset on purpose. `energyOf` derives it at read time from
  // whatever is actually present, and returns null when there is too little —
  // storing a number here would freeze a guess into the record.
  const patch = {
    ...readings,
    ...(workoutKind ? { workoutKind } : {}),
    ...(notes ? { notes } : {}),
  };

  if (existing) {
    await updateRecord(ctx.scope, 'health', existing.id, patch);
    return ok(`Updated ${date}: ${Object.keys(patch).join(', ')}.`, [existing.id]);
  }

  const day: HealthDay = { ...base(ctx, 'health', date), date, ...patch };
  await insertRecords(ctx.scope, 'health', [day]);
  return ok(`Recorded ${date}: ${Object.keys(patch).join(', ')}.`, [day.id]);
};

export const addHabit: ToolExecutor = async (ctx, args) => {
  const name = argText(args, 'name');
  const target = argNumber(args, 'targetPerWeek');
  const habit: Habit = {
    ...base(ctx, 'habit', name),
    name,
    cadence: enumArg(args, 'cadence', HABIT_CADENCES, 'daily'),
    intent: argText(args, 'intent'),
    completions: [],
    targetPerWeek: Math.max(1, Math.min(7, Math.round(target ?? 5))),
    archived: false,
  };
  await insertRecords(ctx.scope, 'habits', [habit]);
  return ok(`Tracking the habit “${name}” (${habit.cadence}, ${habit.targetPerWeek}× a week).`, [habit.id]);
};

export const completeHabit: ToolExecutor = async (ctx, args) => {
  const habitId = argText(args, 'habitId');
  const habits = await readCollection(ctx.scope, 'habits');
  const habit = habits.find((candidate) => candidate.id === habitId);
  if (!habit) return missing(`Habit ${habitId}`);

  const date = argText(args, 'date', dayOf(ctx));
  if (habit.completions.includes(date)) {
    return ok(`“${habit.name}” was already recorded for ${date}.`, [habitId]);
  }

  await updateRecord(ctx.scope, 'habits', habitId, {
    completions: [date, ...habit.completions].sort().reverse(),
  });
  return ok(`Recorded “${habit.name}” as kept on ${date}.`, [habitId]);
};

export const addRelationship: ToolExecutor = async (ctx, args) => {
  const name = argText(args, 'name');
  const cadenceDays = argNumber(args, 'cadenceDays');
  const person: Relationship = {
    ...base(ctx, 'rel', name),
    name,
    circle: enumArg(args, 'circle', RELATIONSHIP_CIRCLES, 'friends'),
    relation: optText(args, 'relation'),
    cadenceDays: Math.max(1, Math.round(cadenceDays ?? 30)),
    nextIntent: optText(args, 'nextIntent'),
    notes: optText(args, 'notes'),
  };
  await insertRecords(ctx.scope, 'relationships', [person]);
  return ok(`Added ${name} to the ${person.circle} circle, every ${person.cadenceDays} days.`, [person.id]);
};

export const scheduleBlock: ToolExecutor = async (ctx, args) => {
  const title = argText(args, 'title');
  const startMinute = argNumber(args, 'startMinute');
  if (startMinute === undefined) {
    return refuse('No start time supplied.', 'A block needs a start expressed in minutes past midnight.');
  }
  const block: CalendarBlock = {
    ...base(ctx, 'block', title),
    title,
    date: argText(args, 'date'),
    startMinute: Math.max(0, Math.min(1439, Math.round(startMinute))),
    durationMinutes: Math.max(5, Math.round(argNumber(args, 'durationMinutes') ?? 60)),
    kind: enumArg(args, 'kind', CALENDAR_BLOCK_KINDS, 'deep-work'),
    spaceKey: scopeKey(ctx.scope),
  };
  await insertRecords(ctx.scope, 'calendar', [block]);
  return ok(
    `Blocked ${block.durationMinutes} minutes on ${block.date} for “${title}”. Nothing was written to an external calendar.`,
    [block.id],
  );
};

export const addLifeAdmin: ToolExecutor = async (ctx, args) => {
  const title = argText(args, 'title');
  const item: LifeAdminItem = {
    ...base(ctx, 'admin', title),
    title,
    kind: enumArg(args, 'kind', LIFE_ADMIN_KINDS, 'admin'),
    dueDate: optText(args, 'dueDate'),
    status: 'open',
    detail: optText(args, 'detail'),
    location: optText(args, 'location'),
  };
  await insertRecords(ctx.scope, 'lifeAdmin', [item]);
  return ok(`Added the ${item.kind} item “${title}”.`, [item.id]);
};

export function decideSuggestion(next: 'accepted' | 'dismissed'): ToolExecutor {
  return async (ctx, args) => {
    const suggestionId = argText(args, 'suggestionId');
    const suggestions = await readCollection(ctx.scope, 'suggestions');
    const suggestion = suggestions.find((candidate) => candidate.id === suggestionId);
    if (!suggestion) return missing(`Suggestion ${suggestionId}`);
    if (suggestion.status === next) return ok(`Already ${next}.`, [suggestionId]);

    await updateRecord(ctx.scope, 'suggestions', suggestionId, { status: next });
    return ok(
      `Marked “${suggestion.title}” as ${next}${next === 'accepted' ? '. Nothing it proposes was carried out.' : '.'}`,
      [suggestionId],
    );
  };
}
