'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { COMPANY_STAGES, CURRENCIES, companyScope } from '@/lib/domain';
import type { CompanyDraft } from '@/lib/domain';
import { generateCompanyWorkspace } from '@/lib/generation/company-hq';
import { dropScope, getWorkspace, saveWorkspace, writeScopeData } from '@/lib/data/store';

/**
 * The Create Company form.
 *
 * Only `name` is genuinely required. A founder with an idea at 23:00 should be
 * able to type a name and get a working headquarters; everything else has a
 * sensible default and can be edited afterwards. Demanding a mission statement
 * before the product will do anything is how tools get abandoned.
 */
const DraftSchema = z.object({
  name: z.string().trim().min(2, 'A company needs a name.').max(80, 'That name is too long.'),
  description: z.string().trim().max(400).default(''),
  industry: z.string().trim().max(80).default(''),
  mission: z.string().trim().max(400).default(''),
  vision: z.string().trim().max(400).default(''),
  businessModel: z.string().trim().max(400).default(''),
  goals: z.string().max(600).default(''),
  stage: z.enum(COMPANY_STAGES).default('idea'),
  baseCurrency: z.enum(CURRENCIES).default('CHF'),
});

export interface CreateCompanyState {
  readonly ok: boolean;
  readonly errors?: Readonly<Record<string, string>>;
  readonly message?: string;
}

function readField(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}

export async function createCompany(
  _previous: CreateCompanyState,
  form: FormData,
): Promise<CreateCompanyState> {
  const parsed = DraftSchema.safeParse({
    name: readField(form, 'name'),
    description: readField(form, 'description'),
    industry: readField(form, 'industry'),
    mission: readField(form, 'mission'),
    vision: readField(form, 'vision'),
    businessModel: readField(form, 'businessModel'),
    goals: readField(form, 'goals'),
    stage: readField(form, 'stage') || undefined,
    baseCurrency: readField(form, 'baseCurrency') || undefined,
  });

  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && !errors[key]) errors[key] = issue.message;
    }
    return { ok: false, errors };
  }

  const input = parsed.data;
  const draft: CompanyDraft = {
    name: input.name,
    description: input.description || `${input.name} — description not written yet.`,
    industry: input.industry || 'Unspecified',
    mission: input.mission || `Build ${input.name} into something worth relying on.`,
    vision: input.vision || `${input.name}, operating without needing to be watched.`,
    businessModel: input.businessModel || 'Not decided yet.',
    goals: input.goals
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 6),
    stage: input.stage,
    baseCurrency: input.baseCurrency,
  };

  const workspace = await getWorkspace();
  const { company, data } = generateCompanyWorkspace(draft);

  if (workspace.companies.some((existing) => existing.id === company.id)) {
    return {
      ok: false,
      errors: { name: 'A company with that name already exists.' },
    };
  }

  // Scope data first: if the process dies between the two writes, an orphaned
  // scope file is harmless, whereas a company with no headquarters is not.
  await writeScopeData(companyScope(company.id), data);
  await saveWorkspace((current) => ({ ...current, companies: [...current.companies, company] }));

  revalidatePath('/', 'layout');
  redirect(`/companies/${company.id}`);
}

export async function archiveCompany(companyId: string): Promise<void> {
  await saveWorkspace((current) => ({
    ...current,
    companies: current.companies.map((company) =>
      company.id === companyId ? { ...company, archivedAt: new Date().toISOString() } : company,
    ),
  }));
  revalidatePath('/', 'layout');
}

export async function restoreCompany(companyId: string): Promise<void> {
  await saveWorkspace((current) => ({
    ...current,
    companies: current.companies.map((company) => {
      if (company.id !== companyId) return company;
      const { archivedAt: _archived, ...rest } = company;
      return rest;
    }),
  }));
  revalidatePath('/', 'layout');
}

/** Permanent. Removes the company and drops its entire scope file from disk. */
export async function deleteCompany(companyId: string): Promise<void> {
  await saveWorkspace((current) => ({
    ...current,
    companies: current.companies.filter((company) => company.id !== companyId),
  }));
  await dropScope(companyScope(companyId));
  revalidatePath('/', 'layout');
  redirect('/companies');
}
