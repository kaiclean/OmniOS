'use client';

import { useActionState } from 'react';

import { COMPANY_STAGES, CURRENCIES } from '@/lib/domain';
import { createCompany, type CreateCompanyState } from '@/lib/actions/companies';
import { Icon } from '@/components/ui/Icon';

const INITIAL: CreateCompanyState = { ok: false };

export function CreateCompanyForm({
  generates,
}: {
  generates: ReadonlyArray<{ label: string; detail: string }>;
}) {
  const [state, action, pending] = useActionState(createCompany, INITIAL);

  return (
    <form action={action} className="grid">
      <div className="panel span-8">
        <div className="panel-body stack">
          <Field
            name="name"
            label="Company name"
            hint="The only field that is actually required. Everything else has a default you can edit later."
            error={state.errors?.name}
            required
            autoFocus
          />
          <Field
            name="description"
            label="What it does"
            hint="One or two sentences, as you would say it out loud."
            error={state.errors?.description}
            textarea
          />
          <div className="two-up">
            <Field name="industry" label="Industry" error={state.errors?.industry} />
            <div className="field">
              <label className="label" htmlFor="stage">
                Stage
              </label>
              <select className="select" id="stage" name="stage" defaultValue="idea">
                {COMPANY_STAGES.map((stage) => (
                  <option key={stage} value={stage}>
                    {stage}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Field
            name="mission"
            label="Mission"
            hint="What this company is for. Written for you, not for a website."
            error={state.errors?.mission}
            textarea
          />
          <Field
            name="vision"
            label="Vision"
            hint="What it looks like when this has worked."
            error={state.errors?.vision}
            textarea
          />
          <div className="two-up">
            <Field
              name="businessModel"
              label="Business model"
              hint="How money actually arrives."
              error={state.errors?.businessModel}
            />
            <div className="field">
              <label className="label" htmlFor="baseCurrency">
                Currency
              </label>
              <select className="select" id="baseCurrency" name="baseCurrency" defaultValue="CHF">
                {CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Field
            name="goals"
            label="Opening goals"
            hint="One per line. These become real goal records, not decoration."
            error={state.errors?.goals}
            textarea
          />

          {state.message ? (
            <p className="note note--warn" role="alert">
              {state.message}
            </p>
          ) : null}

          <div className="spread">
            <span className="hint">
              Nothing here is permanent. Every field is editable inside the headquarters.
            </span>
            <button className="btn btn--primary" type="submit" disabled={pending}>
              {pending ? 'Building headquarters…' : 'Create company'}
            </button>
          </div>
        </div>
      </div>

      <aside className="panel span-4">
        <header className="panel-head">
          <h2 className="panel-title">What you get</h2>
        </header>
        <div className="panel-body stack" style={{ gap: 'var(--s-4)' }}>
          <p className="hint">
            The moment you submit, OmniOS generates a complete, populated headquarters. You do not
            configure it, and you do not build it capability by capability.
          </p>
          {generates.map((item) => (
            <div key={item.label} className="row" style={{ alignItems: 'flex-start' }}>
              <Icon name="check" />
              <div className="grow">
                <div style={{ fontSize: 'var(--fs-small)' }}>{item.label}</div>
                <div className="hint">{item.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </form>
  );
}

function Field({
  name,
  label,
  hint,
  error,
  textarea,
  required,
  autoFocus,
}: {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  textarea?: boolean;
  required?: boolean;
  autoFocus?: boolean;
}) {
  const describedBy = [hint ? `${name}-hint` : null, error ? `${name}-error` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="field">
      <label className="label" htmlFor={name}>
        {label}
        {required ? <span className="faint"> · required</span> : null}
      </label>
      {textarea ? (
        <textarea
          className="textarea"
          id={name}
          name={name}
          aria-describedby={describedBy || undefined}
          aria-invalid={error ? true : undefined}
        />
      ) : (
        <input
          className="input"
          id={name}
          name={name}
          required={required}
          // Single-purpose page: the founder navigated here to type this field.
          autoFocus={autoFocus}
          aria-describedby={describedBy || undefined}
          aria-invalid={error ? true : undefined}
        />
      )}
      {hint ? (
        <span className="hint" id={`${name}-hint`}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="hint delta--bad" id={`${name}-error`} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
