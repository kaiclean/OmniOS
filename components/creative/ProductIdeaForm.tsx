'use client';

import { useActionState } from 'react';

import { planProduct, type CreativeFormState } from '@/lib/actions/creative';
import { Field } from './Field';

const INITIAL: CreativeFormState = { ok: false };

export interface SpaceOption {
  readonly key: string;
  readonly label: string;
}

/**
 * Four answers in, a twelve-section plan out.
 *
 * The action redirects to the finished spec, so there is no success state to
 * render here — the founder lands on the plan itself.
 */
export function ProductIdeaForm({
  spaces,
  defaultScopeKey,
}: {
  spaces: readonly SpaceOption[];
  defaultScopeKey: string;
}) {
  const [state, action, pending] = useActionState(planProduct, INITIAL);

  return (
    <form action={action} className="stack">
      <Field
        name="idea"
        label="The idea"
        hint="A sentence or two, as you would describe it to someone who has to build it."
        error={state.errors?.idea}
        textarea
        required
      />
      <Field
        name="problem"
        label="The problem it removes"
        hint="Not the feature — the thing that is currently painful."
        error={state.errors?.problem}
        required
      />
      <Field
        name="audience"
        label="Who it is for"
        hint="Be specific enough to exclude someone."
        error={state.errors?.audience}
        required
      />

      <div className="two-up">
        <Field
          name="name"
          label="Working name"
          hint="Optional — derived from the idea if you leave it."
          error={state.errors?.name}
        />
        <div className="field">
          <label className="label" htmlFor="scopeKey">
            Plan into
          </label>
          <select className="select" id="scopeKey" name="scopeKey" defaultValue={defaultScopeKey}>
            {spaces.map((space) => (
              <option key={space.key} value={space.key}>
                {space.label}
              </option>
            ))}
          </select>
          <span className="hint">The spec is stored in that space, not across them.</span>
        </div>
      </div>

      {state.message ? (
        <p className="note note--warn" role="alert">
          {state.message}
        </p>
      ) : null}

      <div className="spread">
        <span className="hint">Deterministic and local. No model is called.</span>
        <button className="btn btn--primary" type="submit" disabled={pending}>
          {pending ? 'Planning…' : 'Generate the plan'}
        </button>
      </div>
    </form>
  );
}
