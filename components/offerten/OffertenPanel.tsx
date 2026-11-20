import { getWorkspace, readCollection } from '@/lib/data/store';
import { companyScope } from '@/lib/domain';
import { getOffertenState } from '@/lib/offerten/service';
import { OffertenReview } from './OffertenReview';

/** Configuration and connector placeholders stay server-side, outside page props. */
export async function OffertenPanel({ companyId, title }: { companyId: string; title: string }) {
  const workspace = await getWorkspace();
  const company = workspace.companies.find((item) =>
    item.id === companyId && !item.archivedAt && !item.disabledCapabilityIds.includes('offerten'));
  if (!company) return null;
  const scope = companyScope(company.id);
  const state = await getOffertenState(scope);
  const calls = await readCollection(scope, 'toolCalls');
  const exported = [...calls].reverse().find((call) =>
    call.toolId === 'offerten.export' && call.status === 'executed');

  return (
    <OffertenReview
      companyId={company.id}
      title={title}
      quotes={state.quotes}
      metrics={state.metrics}
      ingestReceipts={state.receipts}
      sendReceipts={state.sends}
      exportCallId={exported?.id}
    />
  );
}
