'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { REPORT_CADENCES, companyScope, personalScope, sharedScope } from '@/lib/domain';
import { capabilityIds } from '@/lib/capabilities/registry';
import { buildEmptyWorkspace } from '@/lib/data/seed';
import { dropScope, getWorkspace, saveWorkspace, writeScopeData } from '@/lib/data/store';

/**
 * Settings, and the one destructive action in OmniOS.
 *
 * Both write through `saveWorkspace`, so the root file stays the single source of
 * truth for anything cross-space. Neither touches a company or personal scope
 * except the reset, which drops them deliberately and says so first.
 */

const SettingsSchema = z.object({
  theme: z.enum(['dark', 'light', 'system']),
  reduceMotion: z.boolean(),
  spaceTint: z.boolean(),
  assistantName: z
    .string()
    .trim()
    .min(1, 'The assistant needs a name.')
    .max(24, 'That name is too long to sit in the sidebar.'),
  cadence: z.enum(REPORT_CADENCES),
  includeHealth: z.boolean(),
  includeFinance: z.boolean(),
  includeEcosystem: z.boolean(),
  maxBullets: z
    .number()
    .int()
    .min(3, 'A report with fewer than three bullets is a notification.')
    .max(12, 'Past twelve bullets nobody reads the last one.'),
});

export interface SettingsState {
  readonly ok: boolean;
  readonly errors?: Readonly<Record<string, string>>;
  readonly message?: string;
}

function readField(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}

/** An unchecked checkbox is absent from the payload, not `false`. */
function readToggle(form: FormData, key: string): boolean {
  return form.get(key) !== null;
}

export async function updateSettings(
  _previous: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const parsed = SettingsSchema.safeParse({
    theme: readField(form, 'theme'),
    reduceMotion: readToggle(form, 'reduceMotion'),
    spaceTint: readToggle(form, 'spaceTint'),
    assistantName: readField(form, 'assistantName'),
    cadence: readField(form, 'cadence'),
    includeHealth: readToggle(form, 'includeHealth'),
    includeFinance: readToggle(form, 'includeFinance'),
    includeEcosystem: readToggle(form, 'includeEcosystem'),
    maxBullets: Number(readField(form, 'maxBullets')),
  });

  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && !errors[key]) errors[key] = issue.message;
    }
    return { ok: false, errors, message: 'Nothing was saved.' };
  }

  const input = parsed.data;
  await saveWorkspace((current) => ({
    ...current,
    settings: {
      theme: input.theme,
      reduceMotion: input.reduceMotion,
      spaceTint: input.spaceTint,
      assistantName: input.assistantName,
      reportSettings: {
        cadence: input.cadence,
        includeHealth: input.includeHealth,
        includeFinance: input.includeFinance,
        includeEcosystem: input.includeEcosystem,
        maxBullets: input.maxBullets,
      },
    },
  }));

  revalidatePath('/', 'layout');
  return { ok: true, message: 'Saved.' };
}

/* --------------------------------------------------------------- reset ---- */

export interface ResetState {
  readonly ok: boolean;
  readonly error?: string;
}

/** Typed exactly, in capitals. Anything else is treated as a change of mind. */
const RESET_PHRASE = 'RESET';

export async function resetToEmptyWorkspace(
  _previous: ResetState,
  form: FormData,
): Promise<ResetState> {
  if (readField(form, 'confirm').trim() !== RESET_PHRASE) {
    return { ok: false, error: `Type ${RESET_PHRASE} to confirm. Nothing was deleted.` };
  }

  const workspace = await getWorkspace();

  // Scope files are dropped explicitly rather than by wiping the data directory.
  // A wipe would leave the store with no root, and the very next read would
  // re-seed the full sample workspace — the opposite of what was asked for.
  for (const company of workspace.companies) {
    await dropScope(companyScope(company.id));
  }
  await dropScope(personalScope());
  for (const capabilityId of capabilityIds()) {
    await dropScope(sharedScope(capabilityId));
  }

  const { root, scopes } = buildEmptyWorkspace(workspace.personal.displayName);
  for (const [scope, data] of scopes) {
    await writeScopeData(scope, data);
  }
  // The settings the founder has already chosen are theirs, not sample data.
  await saveWorkspace(() => ({ ...root, settings: workspace.settings }));

  revalidatePath('/', 'layout');
  redirect('/');
}
