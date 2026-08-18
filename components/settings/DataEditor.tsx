'use client';

import { useActionState } from 'react';

import { saveCollectionData, type DataEditorState } from '@/lib/actions/data';

const INITIAL: DataEditorState = { ok: false };

/**
 * The raw half of the data editor: one textarea, one save.
 *
 * The scope and collection are chosen by the server-rendered pickers around this
 * form and arrive here as fixed hidden fields — the founder edits records, not
 * addresses. Saving replaces the whole collection, which is stated plainly next
 * to the button rather than discovered afterwards.
 */
export function DataEditor({
  scopeKey,
  scopeLabel,
  collection,
  initialJson,
  recordCount,
}: {
  scopeKey: string;
  scopeLabel: string;
  collection: string;
  initialJson: string;
  recordCount: number;
}) {
  const [state, action, pending] = useActionState(saveCollectionData, INITIAL);

  return (
    <form action={action} className="stack">
      <input type="hidden" name="scope" value={scopeKey} />
      <input type="hidden" name="collection" value={collection} />

      <div className="field">
        <label className="label" htmlFor="data-json">
          {collection} in {scopeLabel} · {recordCount} record{recordCount === 1 ? '' : 's'}
        </label>
        <textarea
          className="textarea mono"
          id="data-json"
          name="json"
          rows={20}
          defaultValue={initialJson}
          spellCheck={false}
          aria-describedby="data-json-hint"
        />
        <span className="hint" id="data-json-hint">
          A JSON array. Every record needs a unique string <span className="mono">id</span>; add a
          new object to add a record, delete one to remove it.
        </span>
      </div>

      {state.message ? (
        <p className={state.ok ? 'note' : 'note note--warn'} role={state.ok ? 'status' : 'alert'}>
          {state.message}
        </p>
      ) : null}

      <div className="spread">
        <span className="hint">
          {pending
            ? 'Saving…'
            : 'Saving replaces this whole collection in this scope. Other scopes are untouched.'}
        </span>
        <button className="btn" type="submit" disabled={pending}>
          Save collection
        </button>
      </div>
    </form>
  );
}
