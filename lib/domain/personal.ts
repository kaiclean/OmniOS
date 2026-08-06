/**
 * Personal life — a first-class space, not a side panel.
 *
 * It reuses every shared record type (tasks, goals, KPIs, finance, automations)
 * and adds the shapes that only a life has: a body, relationships, and learning.
 * The Executive Assistant reads both sides, which is the entire reason the two
 * live in one system: it cannot balance a founder's week without seeing both.
 */

import type { CurrencyCode, DateOnly, ScopedRecord, Timestamp } from './work';
import type { BrandDNA } from './company';

/** The identity layer for a life — the personal equivalent of Company DNA. */
export interface PersonalDNA {
  readonly identity: string;
  readonly values: readonly string[];
  readonly lifeGoals: readonly string[];
  readonly longTermVision: string;
  readonly healthPhilosophy: string;
  readonly financialGoals: readonly string[];
  readonly lifestylePreferences: readonly string[];
  readonly nonNegotiables: readonly string[];
}

export interface PersonalProfile {
  readonly id: 'personal';
  readonly displayName: string;
  readonly timezone: string;
  readonly baseCurrency: CurrencyCode;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly dna: PersonalDNA;
  /** A founder is a brand too. Same shape, so Creative Studio has one code path. */
  readonly personalBrand: BrandDNA;
  readonly disabledCapabilityIds: readonly string[];
}

/* ------------------------------------------------------------- health ------ */

/**
 * One day of body data. Every field is optional because real life has gaps, and
 * an OS that invents a number it does not have is worse than one that shows a dash.
 */
export interface HealthDay extends ScopedRecord {
  readonly date: DateOnly;
  readonly sleepHours?: number;
  readonly sleepQuality?: number;
  readonly restingHeartRate?: number;
  readonly hrv?: number;
  readonly steps?: number;
  readonly workoutMinutes?: number;
  readonly workoutKind?: string;
  readonly stress?: number;
  readonly mood?: number;
  /** 0..100, derived — see lib/personal/energy.ts. Never invented when inputs are missing. */
  readonly energy?: number;
  readonly notes?: string;
}

export const HABIT_CADENCES = ['daily', 'weekdays', 'weekly', 'monthly'] as const;
export type HabitCadence = (typeof HABIT_CADENCES)[number];

export interface Habit extends ScopedRecord {
  readonly name: string;
  readonly cadence: HabitCadence;
  readonly intent: string;
  /** Most recent dates the habit was completed, newest first. */
  readonly completions: readonly DateOnly[];
  readonly targetPerWeek: number;
  readonly archived: boolean;
}

/* ------------------------------------------------------ relationships ------ */

export const RELATIONSHIP_CIRCLES = ['family', 'inner', 'friends', 'mentors', 'network'] as const;
export type RelationshipCircle = (typeof RELATIONSHIP_CIRCLES)[number];

export interface Relationship extends ScopedRecord {
  readonly name: string;
  readonly circle: RelationshipCircle;
  readonly relation?: string;
  /** How often the founder *wants* to be in touch. Drives gentle nudges, not guilt. */
  readonly cadenceDays: number;
  readonly lastContactAt?: Timestamp;
  readonly nextIntent?: string;
  readonly notes?: string;
}

/* ---------------------------------------------------------- learning ------- */

export const LEARNING_KINDS = ['book', 'course', 'skill', 'paper', 'practice'] as const;
export type LearningKind = (typeof LEARNING_KINDS)[number];

export interface LearningItem extends ScopedRecord {
  readonly title: string;
  readonly kind: LearningKind;
  readonly author?: string;
  /** 0..1 */
  readonly progress: number;
  readonly status: 'queued' | 'active' | 'finished' | 'abandoned';
  readonly why: string;
  readonly insights: readonly string[];
  readonly appliesTo: readonly string[];
}

/* ------------------------------------------------------ life operations ---- */

export const LIFE_ADMIN_KINDS = [
  'appointment',
  'travel',
  'document',
  'renewal',
  'admin',
] as const;
export type LifeAdminKind = (typeof LIFE_ADMIN_KINDS)[number];

export interface LifeAdminItem extends ScopedRecord {
  readonly title: string;
  readonly kind: LifeAdminKind;
  readonly dueDate?: DateOnly;
  readonly status: 'open' | 'scheduled' | 'done';
  readonly detail?: string;
  readonly location?: string;
}

/* ------------------------------------------------------------ calendar ---- */

export interface CalendarBlock extends ScopedRecord {
  readonly title: string;
  readonly date: DateOnly;
  readonly startMinute: number;
  readonly durationMinutes: number;
  readonly kind: 'deep-work' | 'meeting' | 'admin' | 'rest' | 'personal' | 'travel';
  /** Which space the block belongs to — a founder's calendar is one calendar. */
  readonly spaceKey: string;
}
