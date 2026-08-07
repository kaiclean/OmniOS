'use client';

import { useActionState, useEffect, useRef } from 'react';

import { ASSET_KINDS } from '@/lib/domain';
import { createBrief, type CreativeFormState } from '@/lib/actions/creative';
import { Field } from './Field';

const INITIAL: CreativeFormState = { ok: false };

/**
 * The brief form.
 *
 * Two fields are required; the rest sharpen the prompt that assets are generated
 * from. A founder who fills in only the title and the objective still gets a
 * usable brief — the composed prompt simply omits the lines they skipped rather
 * than inventing them.
 */
export function NewBriefForm({ scopeKey, spaceLabel }: { scopeKey: string; spaceLabel: string }) {
  const [state, action, pending] = useActionState(createBrief, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    // The action returns a new object every submission, so a successful create
    // clears the form and a failed one keeps everything the founder typed.
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="stack">
      <input type="hidden" name="scopeKey" value={scopeKey} />

      <Field
        name="title"
        label="Brief"
        hint={`Stored in ${spaceLabel}.`}
        error={state.errors?.title}
        required
        placeholder="Launch announcement"
      />
      <Field
        name="objective"
        label="Objective"
        hint="What this brief is for, as you would say it out loud."
        error={state.errors?.objective}
        textarea
        required
      />
      <div className="two-up">
        <Field name="audience" label="Audience" error={state.errors?.audience} />
        <Field name="channel" label="Channel" error={state.errors?.channel} />
      </div>
      <Field
        name="keyMessage"
        label="Key message"
        hint="The one sentence that has to survive every format."
        error={state.errors?.keyMessage}
      />
      <div className="two-up">
        <Field
          name="mustInclude"
          label="Must include"
          hint="One per line."
          error={state.errors?.mustInclude}
          textarea
        />
        <Field
          name="mustAvoid"
          label="Must avoid"
          hint="One per line."
          error={state.errors?.mustAvoid}
          textarea
        />
      </div>
      <Field
        name="toneOverride"
        label="Tone override"
        hint="Left empty, the space's Brand DNA tone applies."
        error={state.errors?.toneOverride}
      />

      <div className="field">
        <span className="label" id="formats-label">
          Formats
          <span className="faint"> · required</span>
        </span>
        <div className="chip-row" role="group" aria-labelledby="formats-label">
          {ASSET_KINDS.map((kind) => (
            <label key={kind} className="check-chip">
              <input type="checkbox" name="formats" value={kind} />
              <span>{kind.replace(/-/g, ' ')}</span>
            </label>
          ))}
        </div>
        {state.errors?.formats ? (
          <span className="hint delta--bad" role="alert">
            {state.errors.formats}
          </span>
        ) : (
          <span className="hint">One asset record is produced per format you pick.</span>
        )}
      </div>

      {state.message ? (
        <p className={state.ok ? 'note note--accent' : 'note note--warn'} role="status">
          {state.message}
        </p>
      ) : null}

      <div className="spread">
        <span className="hint">Nothing is sent anywhere. This writes one record.</span>
        <button className="btn btn--primary" type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create brief'}
        </button>
      </div>
    </form>
  );
}
