import 'server-only';

import { notFound } from 'next/navigation';

import type { Company, MemoryRecord, PersonalProfile } from '@/lib/domain';
import { companyScope, personalScope, sharedScope } from '@/lib/domain';
import { capabilityIds } from '@/lib/capabilities/registry';
import type { ScopeData } from './schema';
import { getWorkspace, readScope } from './store';

/**
 * Everything a space page needs, loaded through the scope boundary.
 *
 * A company loader reads exactly one company scope plus shared capability
 * memory. It has no access to another company or to personal life, and there is
 * no parameter that would grant it — the isolation is in the shape of the API,
 * not in the discipline of the caller.
 */

export interface CompanySpace {
  readonly company: Company;
  readonly data: ScopeData;
  readonly sharedMemory: readonly MemoryRecord[];
  readonly basePath: string;
}

export interface PersonalSpace {
  readonly personal: PersonalProfile;
  readonly data: ScopeData;
  readonly sharedMemory: readonly MemoryRecord[];
  readonly basePath: string;
}

async function loadSharedMemory(): Promise<MemoryRecord[]> {
  const out: MemoryRecord[] = [];
  for (const capabilityId of capabilityIds()) {
    const data = await readScope(sharedScope(capabilityId));
    out.push(...data.memory);
  }
  return out;
}

export async function loadCompanySpace(companyId: string): Promise<CompanySpace> {
  const workspace = await getWorkspace();
  const company = workspace.companies.find((c) => c.id === companyId);
  if (!company) notFound();

  return {
    company,
    data: await readScope(companyScope(company.id)),
    sharedMemory: await loadSharedMemory(),
    basePath: `/companies/${company.id}`,
  };
}

export async function loadPersonalSpace(): Promise<PersonalSpace> {
  const workspace = await getWorkspace();
  return {
    personal: workspace.personal,
    data: await readScope(personalScope()),
    sharedMemory: await loadSharedMemory(),
    basePath: '/life',
  };
}
