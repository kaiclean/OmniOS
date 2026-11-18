/**
 * Tools for personal life (health, habits, relationships, calendar, life admin)
 * and for deciding a suggestion.
 *
 * Data only; tiers and previews unchanged from the single catalogue.
 */

import {
  HABIT_CADENCES,
  LIFE_ADMIN_KINDS,
  RELATIONSHIP_CIRCLES,
  type ToolArgs,
  type ToolDefinition,
} from '@/lib/domain';
import { EMPTY } from '@/lib/format';
import { argText, argNumber, say, quoted, BOTH, PERSONAL } from './shared';
import { CALENDAR_BLOCK_KINDS } from './collections';

export const LIFE_TOOLS = [
  /* ------------------------------------------------------------ life ----- */
  {
    id: 'log_health_day',
    label: 'Log a health day',
    description:
      'Record a day of body data. Every field is optional and nothing missing is filled in — energy is derived only when enough inputs are present.',
    risk: 'write',
    capabilityId: 'health',
    scopeKinds: PERSONAL,
    matches: ['slept', 'hours of sleep', 'log my sleep', 'my hrv', 'resting heart rate', 'log my workout', 'trained today', 'steps today', 'stressed today'],
    params: [
      { name: 'date', type: 'date', description: 'The day, YYYY-MM-DD.', required: true },
      { name: 'sleepHours', type: 'number', description: 'Hours slept.', required: false },
      { name: 'sleepQuality', type: 'number', description: '0 to 100.', required: false },
      { name: 'restingHeartRate', type: 'number', description: 'bpm.', required: false },
      {
        name: 'hrv',
        type: 'number',
        description: 'Heart rate variability in milliseconds. The strongest single input to the energy score.',
        required: false,
      },
      { name: 'steps', type: 'number', description: 'Step count.', required: false },
      { name: 'workoutMinutes', type: 'number', description: 'Minutes trained.', required: false },
      { name: 'workoutKind', type: 'string', description: 'What sort of training.', required: false },
      { name: 'stress', type: 'number', description: '0 to 100.', required: false },
      { name: 'mood', type: 'number', description: '0 to 100.', required: false },
      { name: 'notes', type: 'text', description: 'Anything else about the day.', required: false },
    ],
    preview: (args: ToolArgs) =>
      `Record ${argText(args, 'date', EMPTY)} in personal health: sleep ${say(argNumber(args, 'sleepHours'))}h, HRV ${say(argNumber(args, 'hrv'))}, stress ${say(argNumber(args, 'stress'))}, workout ${say(argNumber(args, 'workoutMinutes'))} min. Energy is derived from what is present, or left blank.`,
  },
  {
    id: 'add_habit',
    label: 'Add a habit',
    description: 'Start tracking a habit with a cadence and a weekly target.',
    risk: 'write',
    capabilityId: 'health',
    scopeKinds: PERSONAL,
    matches: ['start a habit', 'add a habit', 'i want to do this every day', 'build the habit of', 'track my streak'],
    params: [
      { name: 'name', type: 'string', description: 'The habit.', required: true },
      { name: 'cadence', type: 'enum', description: 'How often it is meant to happen.', required: false, enumValues: HABIT_CADENCES, default: 'daily' },
      { name: 'intent', type: 'text', description: 'Why — read back when the streak breaks.', required: true },
      { name: 'targetPerWeek', type: 'number', description: 'Times per week that counts as keeping it.', required: false, default: 5 },
    ],
    preview: (args: ToolArgs) =>
      `Start tracking the habit ${quoted(args, 'name', 'unnamed')} in personal life, ${argText(args, 'cadence', 'daily')}, targeting ${say(argNumber(args, 'targetPerWeek'))} times a week, with no completions yet.`,
  },
  {
    id: 'complete_habit',
    label: 'Complete a habit',
    description: 'Mark a habit done for a day. Completing the same day twice changes nothing.',
    risk: 'write',
    capabilityId: 'health',
    scopeKinds: PERSONAL,
    matches: ['did my habit', 'kept the streak', 'completed my', 'i did it today', 'tick the habit'],
    params: [
      { name: 'habitId', type: 'string', description: 'Id of a habit in personal life.', required: true },
      { name: 'date', type: 'date', description: 'The day it was kept. Defaults to today.', required: false },
    ],
    preview: (args: ToolArgs) =>
      `Mark habit ${argText(args, 'habitId', EMPTY)} as kept on ${argText(args, 'date', 'today')} in personal life.`,
  },
  {
    id: 'add_relationship',
    label: 'Add a relationship',
    description: 'Add a person to a circle with a contact cadence, so drifting apart becomes visible rather than accidental.',
    risk: 'write',
    capabilityId: 'relationships',
    scopeKinds: PERSONAL,
    matches: ['add to my circle', 'stay in touch with', 'add a friend', 'my mentor', 'keep up with', 'add a relationship'],
    params: [
      { name: 'name', type: 'string', description: 'Their name.', required: true },
      { name: 'circle', type: 'enum', description: 'Which circle they belong to.', required: false, enumValues: RELATIONSHIP_CIRCLES, default: 'friends' },
      { name: 'cadenceDays', type: 'number', description: 'Days between contact that feels right.', required: false, default: 30 },
      { name: 'relation', type: 'string', description: 'How they are related.', required: false },
      { name: 'nextIntent', type: 'string', description: 'What to do next time.', required: false },
      { name: 'notes', type: 'text', description: 'Anything worth remembering about them.', required: false },
    ],
    preview: (args: ToolArgs) =>
      `Add ${quoted(args, 'name', 'someone')} to the ${argText(args, 'circle', 'friends')} circle in personal life, with a contact cadence of ${say(argNumber(args, 'cadenceDays'))} days.`,
  },
  {
    id: 'schedule_block',
    label: 'Schedule a block',
    description:
      'Put a block on the calendar in this space. It writes a local calendar record; it does not touch any external calendar.',
    risk: 'write',
    capabilityId: 'operations',
    scopeKinds: BOTH,
    matches: ['block time', 'put it in the calendar', 'schedule a block', 'book two hours', 'deep work block', 'protect the morning'],
    params: [
      { name: 'title', type: 'string', description: 'What the block is for.', required: true },
      { name: 'date', type: 'date', description: 'The day, YYYY-MM-DD.', required: true },
      { name: 'startMinute', type: 'number', description: 'Minutes past midnight. 09:30 is 570.', required: true },
      { name: 'durationMinutes', type: 'number', description: 'How long it runs.', required: false, default: 60 },
      { name: 'kind', type: 'enum', description: 'What sort of block it is.', required: false, enumValues: CALENDAR_BLOCK_KINDS, default: 'deep-work' },
    ],
    preview: (args: ToolArgs) => {
      const start = argNumber(args, 'startMinute');
      const clock =
        start === undefined
          ? EMPTY
          : `${String(Math.floor(start / 60) % 24).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
      return `Block ${say(argNumber(args, 'durationMinutes'))} minutes from ${clock} on ${argText(args, 'date', EMPTY)} for ${quoted(args, 'title', 'untitled')} (${argText(args, 'kind', 'deep-work')}) in this space’s calendar only.`;
    },
  },
  {
    id: 'add_life_admin',
    label: 'Add a life admin item',
    description: 'Track an appointment, renewal, document or errand so it stops occupying working memory.',
    risk: 'write',
    capabilityId: 'life-ops',
    scopeKinds: PERSONAL,
    matches: ['renew my', 'book an appointment', 'i need to sort out', 'paperwork', 'my passport', 'insurance', 'tax return', 'life admin'],
    params: [
      { name: 'title', type: 'string', description: 'What needs handling.', required: true },
      { name: 'kind', type: 'enum', description: 'What sort of item.', required: false, enumValues: LIFE_ADMIN_KINDS, default: 'admin' },
      { name: 'dueDate', type: 'date', description: 'When it is due, YYYY-MM-DD.', required: false },
      { name: 'detail', type: 'text', description: 'What is involved.', required: false },
      { name: 'location', type: 'string', description: 'Where.', required: false },
    ],
    preview: (args: ToolArgs) =>
      `Add the ${argText(args, 'kind', 'admin')} item ${quoted(args, 'title', 'untitled')} to personal life admin, due ${argText(args, 'dueDate', EMPTY)}, open.`,
  },
  /* ----------------------------------------------------- suggestions ----- */
  {
    id: 'accept_suggestion',
    label: 'Accept a suggestion',
    description:
      'Mark a suggestion as accepted. Accepting records the decision; it does not carry the suggestion out.',
    risk: 'write',
    capabilityId: 'executive',
    scopeKinds: BOTH,
    matches: ['accept that suggestion', 'good idea, do it', 'take that recommendation', 'agree with the recommendation'],
    params: [{ name: 'suggestionId', type: 'string', description: 'Id of a suggestion in this space.', required: true }],
    preview: (args: ToolArgs) =>
      `Mark suggestion ${argText(args, 'suggestionId', EMPTY)} in this space as accepted. Nothing it proposes is carried out by this call.`,
  },
  {
    id: 'dismiss_suggestion',
    label: 'Dismiss a suggestion',
    description: 'Mark a suggestion as dismissed, so the specialist that made it is scored honestly.',
    risk: 'write',
    capabilityId: 'executive',
    scopeKinds: BOTH,
    matches: ['dismiss that', 'not interested', 'ignore that suggestion', 'reject the recommendation', 'no thanks'],
    params: [{ name: 'suggestionId', type: 'string', description: 'Id of a suggestion in this space.', required: true }],
    preview: (args: ToolArgs) =>
      `Mark suggestion ${argText(args, 'suggestionId', EMPTY)} in this space as dismissed.`,
  },
] as const satisfies readonly ToolDefinition[];
