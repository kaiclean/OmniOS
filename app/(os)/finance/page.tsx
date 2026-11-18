/**
 * Finance Center route. The computation lives in `./_parts/view.ts` and the
 * rendering in `./_parts/MoneySide.tsx`; this file loads the spaces and lays out
 * the two sides.
 */

import type { Metadata } from 'next';
import { acrossSpaces, loadSpaces } from '@/lib/data/aggregate';
import { pluralise } from '@/lib/format';
import { Badge, Note, PageHead } from '@/components/ui/primitives';
import { buildView } from './_parts/view';
import { MoneySide } from './_parts/MoneySide';

export const metadata: Metadata = { title: 'Finance Center' };

/**
 * The Finance Center.
 *
 * The page is built around one refusal: company money and personal money are
 * never added together. Everything below — totals, months, categories, anomalies
 * — is computed twice, once per side, and there is deliberately no combined
 * figure anywhere on the page for a reader to mistake for the truth.
 */
export default async function FinanceCenterPage() {
  const spaces = await loadSpaces();
  const rows = acrossSpaces(spaces, 'finance');
  const now = new Date();

  const companyRows = rows.filter((row) => row.space.kind === 'company');
  const personalRows = rows.filter((row) => row.space.kind === 'personal');

  const companies = spaces.filter((space) => space.kind === 'company');
  const personal = spaces.filter((space) => space.kind === 'personal');

  const company = buildView(companyRows, now);
  const life = buildView(personalRows, now);

  return (
    <>
      <PageHead
        eyebrow="Systems"
        title="Finance Center"
        lede="Every ledger you own, read across every space — kept in two halves that never meet."
        actions={
          <>
            <Badge tone="outline">{pluralise(companies.length, 'company', 'companies')}</Badge>
            <Badge tone="outline">{pluralise(rows.length, 'entry', 'entries')}</Badge>
          </>
        }
      />

      <Note tone="accent" icon="scale">
        <strong>Company money and personal money are never summed on this page.</strong> They have
        different owners, different tax treatment and different consequences when they are wrong, so
        a single combined figure would be an accurate description of nothing. The separation is
        structural: each half is computed from its own spaces and carries its own totals.
      </Note>

      <MoneySide
        title="Company money"
        blurb={`Consolidated across ${pluralise(companies.length, 'company workspace', 'company workspaces')}. Nothing personal is included.`}
        view={company}
        emptyHint="Create a company and its ledger appears here automatically."
      />

      <MoneySide
        title="Personal money"
        blurb={`${pluralise(personal.length, 'personal space')}. Nothing from any company is included.`}
        view={life}
        emptyHint="Personal entries recorded in Life show up here."
      />
    </>
  );
}
