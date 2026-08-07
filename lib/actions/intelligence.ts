'use server';

import { revalidatePath } from 'next/cache';

import { REPORT_CADENCES, UPGRADE_DECISIONS, makeRecordId } from '@/lib/domain';
import type {
  LearningReport,
  ReportCadence,
  UpgradeDecision,
  UpgradeDecisionKind,
  UpgradeStage,
} from '@/lib/domain';
import { getWorkspace, saveWorkspace } from '@/lib/data/store';
import { generateLearningReport } from '@/lib/generation/intelligence';

export interface ActionResult {
  readonly ok: boolean;
  readonly error?: string;
}

const OK: ActionResult = { ok: true };

/**
 * Where each decision lands a candidate.
 *
 * `applied` is deliberately absent from this map, and that absence is the whole
 * safety property of the pipeline. Approving records that the founder *wants*
 * the change; it does not make the change. Nothing in this module — or anywhere
 * else that runs without a human — can write `stage: 'applied'`.
 */
const STAGE_AFTER: Record<UpgradeDecisionKind, UpgradeStage> = {
  approve: 'approved',
  reject: 'rejected',
  'test-longer': 'extended-testing',
};

/**
 * The browser sends a plain string. Narrowing here rather than trusting the
 * caller means a crafted request cannot invent a stage transition that the
 * pipeline does not define.
 */
function isDecision(value: string): value is UpgradeDecisionKind {
  return (UPGRADE_DECISIONS as readonly string[]).includes(value);
}

function isCadence(value: string): value is ReportCadence {
  return (REPORT_CADENCES as readonly string[]).includes(value);
}

export async function decideUpgrade(
  candidateId: string,
  decision: string,
  note = '',
): Promise<ActionResult> {
  if (!isDecision(decision)) {
    return { ok: false, error: 'That is not a decision this pipeline accepts.' };
  }

  const workspace = await getWorkspace();
  const candidate = workspace.upgrades.find((entry) => entry.id === candidateId);
  if (!candidate) return { ok: false, error: 'That upgrade candidate no longer exists.' };

  // An applied change is a fact about the running system, not a pending choice.
  // Re-deciding it here would produce a record that contradicts reality.
  if (candidate.stage === 'applied') {
    return { ok: false, error: 'That candidate is already applied and cannot be re-decided here.' };
  }

  const trimmed = note.trim().slice(0, 600);
  const record: UpgradeDecision = {
    decidedAt: new Date().toISOString(),
    decision,
    decidedBy: workspace.personal.displayName,
    ...(trimmed ? { note: trimmed } : {}),
  };

  await saveWorkspace((current) => ({
    ...current,
    upgrades: current.upgrades.map((entry) =>
      entry.id === candidateId
        ? { ...entry, stage: STAGE_AFTER[decision], decision: record, updatedAt: record.decidedAt }
        : entry,
    ),
  }));

  revalidatePath('/', 'layout');
  return OK;
}

/** Reopens a decided candidate so a founder can change their mind before acting on it. */
export async function reopenUpgrade(candidateId: string): Promise<ActionResult> {
  const workspace = await getWorkspace();
  const candidate = workspace.upgrades.find((entry) => entry.id === candidateId);
  if (!candidate) return { ok: false, error: 'That upgrade candidate no longer exists.' };
  if (candidate.stage === 'applied') {
    return { ok: false, error: 'An applied change cannot be returned to the queue.' };
  }

  await saveWorkspace((current) => ({
    ...current,
    upgrades: current.upgrades.map((entry) => {
      if (entry.id !== candidateId) return entry;
      const { decision: _decision, ...rest } = entry;
      return { ...rest, stage: 'awaiting-approval' as const, updatedAt: new Date().toISOString() };
    }),
  }));

  revalidatePath('/', 'layout');
  return OK;
}

/* ------------------------------------------------------- learning reports -- */

export async function setReportCadence(cadence: string): Promise<ActionResult> {
  if (!isCadence(cadence)) return { ok: false, error: 'That is not a cadence OmniOS reports on.' };

  await saveWorkspace((current) => ({
    ...current,
    settings: {
      ...current.settings,
      reportSettings: { ...current.settings.reportSettings, cadence },
    },
  }));

  revalidatePath('/', 'layout');
  return OK;
}

export async function generateReportNow(): Promise<ActionResult> {
  const workspace = await getWorkspace();
  const now = new Date();
  const generated = generateLearningReport(
    workspace.settings.reportSettings.cadence,
    workspace.discoveries,
    workspace.upgrades,
    now,
  );

  // The generator derives its id from the cadence alone — deterministic seeding
  // is what makes the sample workspace reproducible — so two on-demand reports
  // of the same cadence would collide. Re-key on the instant instead.
  const report: LearningReport = {
    ...generated,
    id: makeRecordId('rep', `${generated.cadence}:${now.toISOString()}`),
  };

  await saveWorkspace((current) => ({ ...current, reports: [report, ...current.reports] }));

  revalidatePath('/', 'layout');
  return OK;
}

export async function markReportRead(reportId: string, read = true): Promise<ActionResult> {
  const workspace = await getWorkspace();
  if (!workspace.reports.some((report) => report.id === reportId)) {
    return { ok: false, error: 'That report no longer exists.' };
  }

  await saveWorkspace((current) => ({
    ...current,
    reports: current.reports.map((report) =>
      report.id === reportId ? { ...report, read, updatedAt: new Date().toISOString() } : report,
    ),
  }));

  revalidatePath('/', 'layout');
  return OK;
}
