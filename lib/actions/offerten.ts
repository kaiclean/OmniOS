'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { proposeCore } from '@/lib/ai/tools/propose';
import { getWorkspace, readCollection } from '@/lib/data/store';
import { companyScope } from '@/lib/domain';
import { exportOfferten } from '@/lib/offerten/service';

/**
 * Browser ids select a company the workspace actually owns, never a raw scope.
 * The UI has no second mutation path: even local edits obey confirmWrites.
 */
const CompanyId = z.string().min(1).max(160);
const ToolId = z.enum([
  'offerten.ingest', 'offerten.draft', 'offerten.compare', 'offerten.edit',
  'offerten.send', 'offerten.update_memory', 'offerten.export', 'offerten.delete',
]);
const Arguments = z.record(z.string().max(80), z.union([
  z.string().max(512_000), z.number().finite(), z.boolean(),
]));

async function ownedCompanyScope(id: unknown) {
  const parsed = CompanyId.safeParse(id);
  if (!parsed.success) throw new Error('Choose a valid company.');
  const workspace = await getWorkspace();
  const company = workspace.companies.find((item) =>
    item.id === parsed.data && !item.archivedAt && !item.disabledCapabilityIds.includes('offerten'));
  if (!company) throw new Error('This company is not available for Offerten.');
  return companyScope(company.id);
}

export async function proposeOfferten(
  companyId: string,
  toolId: string,
  raw: Readonly<Record<string, unknown>>,
) {
  try {
    const scope = await ownedCompanyScope(companyId);
    const tool = ToolId.safeParse(toolId);
    const args = Arguments.safeParse(raw);
    if (!tool.success || !args.success) {
      return { ok: false, awaitingApproval: false, toolCallId: '', summary: 'Invalid Offerten request.' };
    }
    const outcome = await proposeCore(scope, tool.data, args.data);
    revalidatePath('/', 'layout');
    return {
      ok: outcome.ok,
      awaitingApproval: outcome.awaitingApproval,
      toolCallId: outcome.toolCallId,
      summary: outcome.summary,
    };
  } catch {
    return {
      ok: false, awaitingApproval: false, toolCallId: '',
      summary: 'The request could not be completed. Refresh and check the company, inputs and revision.',
    };
  }
}

/** Full private exports cross only this explicit local download boundary. */
export async function downloadOffertenExport(companyId: string, callId: string) {
  try {
    const scope = await ownedCompanyScope(companyId);
    const calls = await readCollection(scope, 'toolCalls');
    const exported = calls.find((call) =>
      call.id === callId && call.toolId === 'offerten.export' && call.status === 'executed');
    if (!exported) return { ok: false as const, message: 'Approve and run a local export first.' };
    const bundle = await exportOfferten(scope);
    return { ok: true as const, json: JSON.stringify(bundle, null, 2) };
  } catch {
    return { ok: false as const, message: 'The local export could not be read.' };
  }
}
