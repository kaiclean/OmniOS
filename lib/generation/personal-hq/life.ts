/**
 * Health, habits, relationships, learning, life admin and the calendar.
 *
 * A health value that was not recorded stays absent; nothing here invents a
 * number to fill a gap.
 */

import type {
  CalendarBlock,
  Habit,
  HealthDay,
  LearningItem,
  LifeAdminItem,
  Relationship,
} from '@/lib/domain';
import { deriveEnergy } from '@/lib/personal/energy';
import { round, type Rng } from '../rng';
import { addDays, base, dayOnly, iso } from './shared';

/* --------------------------------------------------------------- health --- */

export function makeHealth(rng: Rng, now: Date): HealthDay[] {
  const days: HealthDay[] = [];
  for (let back = 89; back >= 0; back -= 1) {
    const date = addDays(now, -back);
    const weekday = date.getUTCDay();
    const weekend = weekday === 0 || weekday === 6;

    // A real founder's data has gaps — a forgotten ring, a night away.
    const logged = rng.bool(0.88);
    if (!logged) {
      days.push({ ...base('health', `d${back}`, now), date: dayOnly(date), notes: 'Not tracked' });
      continue;
    }

    const sleepHours = round(rng.float(weekend ? 6.6 : 5.6, weekend ? 8.9 : 8.1), 1);
    const sleepQuality = Math.round(clamp(rng.float(45, 96) + (sleepHours - 7) * 6, 20, 99));
    const hrv = Math.round(clamp(rng.float(38, 82) + (sleepHours - 7) * 4, 22, 99));
    const stress = Math.round(clamp(rng.float(18, 74) - (sleepHours - 7) * 5, 5, 95));
    const trained = rng.bool(weekend ? 0.5 : 0.62);
    const workoutMinutes = trained ? rng.int(28, 85) : 0;

    const day: HealthDay = {
      ...base('health', `d${back}`, now),
      date: dayOnly(date),
      sleepHours,
      sleepQuality,
      restingHeartRate: Math.round(clamp(rng.float(48, 62) - (hrv - 55) * 0.08, 44, 70)),
      hrv,
      steps: rng.int(3_200, 14_500),
      workoutMinutes,
      ...(trained ? { workoutKind: rng.pick(['Strength', 'Zone 2', 'Climbing', 'Ski touring', 'Swim']) } : {}),
      stress,
      mood: Math.round(clamp(rng.float(40, 95) - stress * 0.2, 15, 99)),
    };
    days.push({ ...day, energy: deriveEnergy(day).score ?? undefined });
  }
  return days;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/* --------------------------------------------------------------- habits --- */

export function makeHabits(rng: Rng, now: Date): Habit[] {
  const seeds: ReadonlyArray<[string, Habit['cadence'], string, number, number]> = [
    ['Lights out before 23:00', 'daily', 'Sleep is the input everything else depends on.', 7, 0.72],
    ['Strength training', 'weekly', 'Keeps the body able to carry the work.', 3, 0.66],
    ['Morning deep work block', 'weekdays', 'The only hours that reliably produce the hard thing.', 5, 0.81],
    ['Walk without a phone', 'daily', 'Where most of the good decisions actually happen.', 5, 0.55],
    ['Weekly review', 'weekly', 'Closes the loop so nothing quietly rots.', 1, 0.7],
    ['One screen-free day', 'weekly', 'Non-negotiable, and the first thing to slip.', 1, 0.42],
  ];
  return seeds.map(([name, cadence, intent, targetPerWeek, rate], i) => {
    const completions: string[] = [];
    for (let back = 0; back < 60; back += 1) {
      if (rng.bool(rate * (cadence === 'weekly' ? 0.3 : 1))) {
        completions.push(dayOnly(addDays(now, -back)));
      }
    }
    return {
      ...base('habit', `${i}:${name}`, now),
      name,
      cadence,
      intent,
      completions,
      targetPerWeek,
      archived: false,
    };
  });
}

/* -------------------------------------------------------- relationships --- */

export function makeRelationships(rng: Rng, now: Date): Relationship[] {
  const seeds: ReadonlyArray<[string, Relationship['circle'], string, number]> = [
    ['Mum', 'family', 'Mother', 7],
    ['Dad', 'family', 'Father', 10],
    ['Lena', 'family', 'Sister', 14],
    ['Marc', 'inner', 'Oldest friend', 14],
    ['Sofia', 'inner', 'Close friend', 21],
    ['Daniel', 'friends', 'Climbing partner', 30],
    ['Priya', 'mentors', 'Former manager, still the best advice', 60],
    ['Tobias', 'network', 'Runs an agency, good for introductions', 90],
    ['Nina', 'friends', 'Studied together', 45],
  ];
  return seeds.map(([name, circle, relation, cadenceDays], i) => ({
    ...base('rel', `${i}:${name}`, now),
    name,
    circle,
    relation,
    cadenceDays,
    lastContactAt: iso(addDays(now, -rng.int(1, Math.round(cadenceDays * 1.9)))),
    nextIntent: rng.bool(0.4)
      ? rng.pick(['Call, not text', 'Invite for dinner', 'Send the book we talked about', 'Ask how the move went'])
      : undefined,
  }));
}

/* ------------------------------------------------------------- learning --- */

export function makeLearning(rng: Rng, now: Date): LearningItem[] {
  const seeds: ReadonlyArray<[string, LearningItem['kind'], string, string, string[]]> = [
    [
      'Thinking in Systems',
      'book',
      'Donella Meadows',
      'Because most of my problems are structural, not effort problems.',
      ['strategy', 'operations'],
    ],
    [
      'Designing Data-Intensive Applications',
      'book',
      'Martin Kleppmann',
      'To stop guessing about storage and consistency.',
      ['development'],
    ],
    [
      'Financial modelling for operators',
      'course',
      '—',
      'So the forecast is mine, not an accountant’s black box.',
      ['finance'],
    ],
    ['Colour and light for photography', 'skill', '—', 'Better product imagery without hiring it out.', ['creative']],
    ['German technical writing', 'skill', '—', 'Documentation that reads natively for local clients.', ['operations']],
    ['Sleep and circadian performance', 'paper', '—', 'Because everything downstream depends on it.', ['health']],
  ];
  return seeds.map(([title, kind, author, why, appliesTo], i) => {
    const progress = round(rng.float(0.05, 0.95), 2);
    return {
      ...base('learn', `${i}:${title}`, now),
      title,
      kind,
      ...(author === '—' ? {} : { author }),
      progress,
      status: (progress > 0.92 ? 'finished' : progress < 0.08 ? 'queued' : 'active') as LearningItem['status'],
      why,
      insights:
        progress > 0.3
          ? [
              'The leverage is almost never where the effort feels heaviest.',
              'Write the note when the idea lands, not when the book ends.',
            ].slice(0, rng.int(1, 2))
          : [],
      appliesTo,
    };
  });
}

/* ----------------------------------------------------------- life admin --- */

export function makeLifeAdmin(rng: Rng, now: Date): LifeAdminItem[] {
  const seeds: ReadonlyArray<[string, LifeAdminItem['kind'], number, string]> = [
    ['Dentist — six-month check', 'appointment', 21, 'Stans'],
    ['Renew passport', 'renewal', 62, ''],
    ['File Q3 tax paperwork', 'admin', 35, ''],
    ['Health insurance comparison before deadline', 'admin', 48, ''],
    ['Trip to Milan — book train and hotel', 'travel', 26, 'Milan'],
    ['Car service', 'appointment', 12, ''],
    ['Archive last year’s documents', 'document', 90, ''],
    ['Physio follow-up', 'appointment', 5, 'Luzern'],
  ];
  return seeds.map(([title, kind, inDays, location], i) => ({
    ...base('life', `${i}:${title}`, now),
    title,
    kind,
    dueDate: dayOnly(addDays(now, inDays)),
    status: (inDays < 10 ? 'scheduled' : 'open') as LifeAdminItem['status'],
    ...(location ? { location } : {}),
    detail: rng.bool(0.3) ? 'Moved once already — do not move again.' : undefined,
  }));
}

/* ------------------------------------------------------------- calendar --- */

export function makeCalendar(rng: Rng, now: Date, companyKeys: readonly string[]): CalendarBlock[] {
  const blocks: CalendarBlock[] = [];
  for (let ahead = 0; ahead < 7; ahead += 1) {
    const date = addDays(now, ahead);
    const weekday = date.getUTCDay();
    if (weekday === 0) {
      blocks.push({
        ...base('cal', `rest:${ahead}`, now),
        title: 'Screen-free day',
        date: dayOnly(date),
        startMinute: 9 * 60,
        durationMinutes: 480,
        kind: 'rest',
        spaceKey: 'personal',
      });
      continue;
    }
    blocks.push({
      ...base('cal', `deep:${ahead}`, now),
      title: 'Deep work',
      date: dayOnly(date),
      startMinute: 8 * 60 + 30,
      durationMinutes: 150,
      kind: 'deep-work',
      spaceKey: companyKeys[ahead % Math.max(1, companyKeys.length)] ?? 'personal',
    });
    if (weekday !== 6) {
      blocks.push({
        ...base('cal', `meet:${ahead}`, now),
        title: rng.pick(['Client call', 'Supplier review', 'Team sync', 'Advisor call']),
        date: dayOnly(date),
        startMinute: 14 * 60 + rng.int(0, 3) * 30,
        durationMinutes: 45,
        kind: 'meeting',
        spaceKey: companyKeys[(ahead + 1) % Math.max(1, companyKeys.length)] ?? 'personal',
      });
      blocks.push({
        ...base('cal', `train:${ahead}`, now),
        title: rng.pick(['Strength', 'Zone 2', 'Climbing']),
        date: dayOnly(date),
        startMinute: 18 * 60,
        durationMinutes: 60,
        kind: 'personal',
        spaceKey: 'personal',
      });
    }
  }
  return blocks;
}
