'use server';

import { revalidatePath } from 'next/cache';

import type { Automation, AutomationRun, AutomationRunLine, Scope } from '@/lib/domain';
import { makeRecordId, parseScopeKey, scopeKey } from '@/lib/domain';
import { getWorkspace, insertRecords, readCollection, updateRecord } from '@/lib/data/store';
import { specialistName } from '@/lib/ai/specialists';

export interface AutomationActionResult {
  readonly ok: boolean;
  /** True when OmniOS declined to run something rather than failing to run it. */
  readonly refused?: boolean;
  readonly message?: string;
}

/**
 * Resolve a space key posted by the browser into a scope that actually exists.
 *
 * Parsing is not enough: an unknown company id parses cleanly and would create a
 * scope file for a company nobody owns. Shared scopes are refused outright —
 * capability memory holds generalised lessons, never runnable records.
 */
async function resolveSpace(key: string): Promise<{ scope: Scope; label: string } | null> {
  const scope = parseScopeKey(key);
  if (!scope || scope.kind === 'shared') return null;

  const workspace = await getWorkspace();
  if (scope.kind === 'personal') return { scope, label: workspace.personal.displayName };

  const company = workspace.companies.find((c) => c.id === scope.companyId && !c.archivedAt);
  return company ? { scope, label: company.name } : null;
}

/**
 * Read an automation through its scope rather than trusting the posted id.
 *
 * An automation belonging to another space is simply not in this collection, so
 * a crafted request cannot reach across the scope boundary to arm or run it.
 */
async function findAutomation(scope: Scope, automationId: string): Promise<Automation | undefined> {
  const automations = await readCollection(scope, 'automations');
  return automations.find((automation) => automation.id === automationId);
}

/* ------------------------------------------------------------ arm / pause -- */

/**
 * Arm or pause an automation.
 *
 * Only these two states are reachable from the interface. `draft` is where an
 * automation starts and `failing` is something the system observes, not
 * something a founder asserts — accepting either here would let the UI write a
 * status that contradicts what actually happened.
 */
export async function setAutomationArmed(
  spaceKey: string,
  automationId: string,
  armed: boolean,
): Promise<AutomationActionResult> {
  const space = await resolveSpace(spaceKey);
  if (!space) return { ok: false, message: 'That space no longer exists.' };

  const automation = await findAutomation(space.scope, automationId);
  if (!automation) return { ok: false, message: 'That automation is no longer in this space.' };

  const next = armed ? 'armed' : 'paused';
  if (automation.status === next) {
    return { ok: true, message: `Already ${next}. Nothing changed.` };
  }

  await updateRecord(space.scope, 'automations', automationId, { status: next });
  revalidatePath('/', 'layout');

  return {
    ok: true,
    message: armed
      ? `Armed in ${space.label}. It still cannot reach outside OmniOS.`
      : `Paused in ${space.label}. It will not be counted as returning time.`,
  };
}

/* ------------------------------------------------------------------- run --- */

function line(
  at: string,
  stepId: string,
  message: string,
  level: AutomationRunLine['level'] = 'info',
): AutomationRunLine {
  return { at, stepId, message, level };
}

/**
 * Run an automation now, and record what actually happened.
 *
 * Two things make this honest rather than theatre. First, every run is written
 * with `simulated: true` and log lines that say what *would* have been carried
 * out, by which specialist — no model is called and no external system is
 * contacted. Second, an automation that requires approval is refused: it still
 * produces a real run record, but with status `awaiting-approval`, zero minutes
 * claimed, and a line naming the steps that reach outside. That refusal is the
 * product's core promise, so it is enforced here in the only place that can
 * write a run — never in the component that draws the button.
 */
export async function runAutomationNow(
  spaceKey: string,
  automationId: string,
): Promise<AutomationActionResult> {
  const space = await resolveSpace(spaceKey);
  if (!space) return { ok: false, message: 'That space no longer exists.' };

  const automation = await findAutomation(space.scope, automationId);
  if (!automation) return { ok: false, message: 'That automation is no longer in this space.' };

  const externalSteps = automation.steps.filter((step) => step.external);
  // A step marked external is an approval requirement whether or not the record
  // says so. Trusting only `requiresApproval` would let a hand-edited automation
  // carry an external step past the gate.
  const needsApproval = automation.requiresApproval || externalSteps.length > 0;

  const now = new Date();
  const at = now.toISOString();
  const runId = makeRecordId('run', `${scopeKey(space.scope)}:${automation.id}:${at}`);

  const lines: AutomationRunLine[] = [
    line(at, 'run', `Manual run requested for “${automation.name}” (${automation.triggerDetail}).`),
  ];

  if (needsApproval) {
    lines.push(
      line(
        at,
        'gate',
        `Refused. ${externalSteps.length > 0 ? `${externalSteps.length} of ${automation.steps.length} steps reach outside OmniOS` : 'This automation is marked as requiring approval'}, and nothing outside OmniOS runs without you.`,
        'warn',
      ),
    );
    for (const step of externalSteps) {
      lines.push(
        line(at, step.id, `Blocked: ${step.label} — ${specialistName(step.specialistId)} (external).`, 'warn'),
      );
    }
    lines.push(
      line(at, 'gate', 'Nothing was sent, written outside this workspace, or scheduled. Recorded as awaiting your approval.'),
    );
  } else {
    for (const step of automation.steps) {
      lines.push(line(at, step.id, `${step.label} — would be carried out by ${specialistName(step.specialistId)}.`));
    }
    lines.push(
      line(at, 'run', 'Simulated locally. No model was called and no external system was contacted.'),
    );
  }

  const run: AutomationRun = {
    id: runId,
    scope: space.scope,
    createdAt: at,
    updatedAt: at,
    automationId: automation.id,
    startedAt: at,
    finishedAt: at,
    status: needsApproval ? 'awaiting-approval' : 'success',
    lines,
    // A refused run returns nothing, so it claims nothing. Minutes are only
    // credited for work the automation actually stood in for.
    minutesSaved: needsApproval ? 0 : automation.minutesSavedPerRun,
    simulated: true,
  };

  await insertRecords(space.scope, 'automationRuns', [run]);

  if (!needsApproval) {
    await updateRecord(space.scope, 'automations', automation.id, {
      lastRunAt: at,
      runsThisMonth: automation.runsThisMonth + 1,
    });
  }

  revalidatePath('/', 'layout');

  return needsApproval
    ? {
        ok: true,
        refused: true,
        message: `Refused and recorded as awaiting approval. ${externalSteps.length > 0 ? `${externalSteps.length} step${externalSteps.length === 1 ? '' : 's'} would reach outside OmniOS.` : 'This automation is marked as requiring your approval.'}`,
      }
    : {
        ok: true,
        message: `Run recorded in ${space.label}. Simulated locally — nothing left this workspace.`,
      };
}
