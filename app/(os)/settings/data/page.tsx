import type { Metadata } from 'next';
import Link from 'next/link';

import { CAPABILITIES } from '@/lib/capabilities/registry';
import { COLLECTION_NAMES } from '@/lib/data/schema';
import { getWorkspace, readCollection, storeInfo } from '@/lib/data/store';
import type { Scope } from '@/lib/domain';
import { companyScope, personalScope, scopeKey, sharedScope } from '@/lib/domain';
import { DataEditor } from '@/components/settings/DataEditor';
import { Badge, PageHead, Panel } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Data editor' };

/**
 * The direct door to the founder's own records.
 *
 * Every scope and collection OmniOS stores, viewable and editable as the JSON it
 * physically is. The pickers are a plain GET form — the URL is the selection, so
 * a view of the data can be reloaded or shared with a future self. The editing
 * itself lives in the client form below, which posts through one Server Action
 * that validates structure before anything is written.
 */
export default async function DataEditorPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; collection?: string }>;
}) {
  const params = await searchParams;
  const workspace = await getWorkspace();
  const store = storeInfo();

  const scopes: ReadonlyArray<{ scope: Scope; key: string; label: string }> = [
    { scope: personalScope(), key: scopeKey(personalScope()), label: 'Personal life' },
    ...workspace.companies.map((company) => ({
      scope: companyScope(company.id),
      key: scopeKey(companyScope(company.id)),
      label: company.name,
    })),
    ...CAPABILITIES.map((capability) => ({
      scope: sharedScope(capability.id),
      key: scopeKey(sharedScope(capability.id)),
      label: `Shared · ${capability.name}`,
    })),
  ];

  const selectedScope = scopes.find((entry) => entry.key === params.scope) ?? scopes[0]!;
  const selectedCollection =
    COLLECTION_NAMES.find((name) => name === params.collection) ?? 'tasks';

  const records = await readCollection(selectedScope.scope, selectedCollection);
  const json = `${JSON.stringify(records, null, 2)}\n`;

  return (
    <>
      <PageHead
        eyebrow="Settings"
        title="Data editor"
        lede="Every record OmniOS stores, as the JSON it physically is. Pick a scope and a collection, edit or add records, save. No agent can reach this page — only you."
        actions={<Badge tone="outline">{store.label}</Badge>}
      />

      <div className="grid">
        <Panel
          title="What you are looking at"
          subtitle="One scope, one collection — isolation holds here too"
          span={4}
        >
          <form method="get" className="stack">
            <div className="field">
              <label className="label" htmlFor="scope-picker">
                Scope
              </label>
              <select className="select" id="scope-picker" name="scope" defaultValue={selectedScope.key}>
                {scopes.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="collection-picker">
                Collection
              </label>
              <select
                className="select"
                id="collection-picker"
                name="collection"
                defaultValue={selectedCollection}
              >
                {COLLECTION_NAMES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="spread">
              <Link className="hint" href="/settings">
                ← Back to Settings
              </Link>
              <button className="btn btn--secondary" type="submit">
                Load
              </button>
            </div>
          </form>
        </Panel>

        <Panel
          title="Records"
          subtitle="Structural checks only: valid JSON, an array, a unique string id on every record"
          span={8}
        >
          <DataEditor
            key={`${selectedScope.key}:${selectedCollection}`}
            scopeKey={selectedScope.key}
            scopeLabel={selectedScope.label}
            collection={selectedCollection}
            initialJson={json}
            recordCount={records.length}
          />
        </Panel>
      </div>
    </>
  );
}
