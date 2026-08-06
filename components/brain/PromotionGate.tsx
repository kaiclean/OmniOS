'use client';

import { useMemo, useState, useTransition } from 'react';

import type { MemoryKind } from '@/lib/domain';
import { checkPromotion, promoteMemory } from '@/lib/actions/memory';

export interface PromotableRecord {
  readonly id: string;
  readonly scopeKey: string;
  readonly spaceLabel: string;
  readonly capabilityId: string;
  readonly capabilityName: string;
  readonly kind: MemoryKind;
  readonly text: string;
  /** Violations this record's text produces as it stands. Computed on the server. */
  readonly blockedBy: readonly string[];
}

/** `fact` is absent on purpose: a fact is true of one space, so it cannot generalise. */
const KINDS: ReadonlyArray<{ value: MemoryKind; label: string }> = [
  { value: 'lesson', label: 'Lesson — something that turned out to be true' },
  { value: 'pattern', label: 'Pattern — something that keeps happening' },
  { value: 'decision', label: 'Decision — a rule adopted on purpose' },
  { value: 'preference', label: 'Preference — how work should be done' },
  { value: 'style', label: 'Style — how things should read or look' },
];

type Verdict =
  | { readonly state: 'idle' }
  | { readonly state: 'refused'; readonly violations: readonly string[] }
  | { readonly state: 'clear' }
  | { readonly state: 'promoted'; readonly capabilityName: string }
  | { readonly state: 'error'; readonly message: string };

/**
 * The promotion gate, made operable.
 *
 * This is the only control in OmniOS that moves anything across a scope
 * boundary, so it is built to be refused rather than to succeed: the violations
 * come back verbatim from `promotionCheck`, and the founder rewrites until the
 * text no longer identifies a company, a person or an amount. Checking is
 * separate from promoting because learning the rule should not require writing
 * to shared memory to find out.
 */
export function PromotionGate({ records }: { records: readonly PromotableRecord[] }) {
  const first = records[0];
  const [selectedId, setSelectedId] = useState(first?.id ?? '');
  const [text, setText] = useState(first?.text ?? '');
  const [kind, setKind] = useState<MemoryKind>(promotableKind(first?.kind));
  const [verdict, setVerdict] = useState<Verdict>({ state: 'idle' });
  const [pending, start] = useTransition();

  const spaces = useMemo(() => [...new Set(records.map((record) => record.spaceLabel))], [records]);
  const selected = records.find((record) => record.id === selectedId);

  if (!selected) {
    return (
      <p className="prose">
        There is nothing in company or personal memory to promote yet. Records appear here as the
        assistant and your spaces accumulate them.
      </p>
    );
  }

  const select = (id: string) => {
    const record = records.find((entry) => entry.id === id);
    if (!record) return;
    setSelectedId(id);
    setText(record.text);
    setKind(promotableKind(record.kind));
    setVerdict({ state: 'idle' });
  };

  return (
    <div className="stack">
      <div className="field">
        <label className="label" htmlFor="promote-source">
          Record to generalise
        </label>
        <select
          className="select"
          id="promote-source"
          value={selectedId}
          onChange={(event) => select(event.target.value)}
        >
          {spaces.map((space) => (
            <optgroup key={space} label={space}>
              {records
                .filter((record) => record.spaceLabel === space)
                .map((record) => (
                  <option key={record.id} value={record.id}>
                    {record.capabilityName} · {truncate(record.text)}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <span className="hint">
          Lives in {selected.spaceLabel}. Promoting copies a generalised version into shared{' '}
          {selected.capabilityName} memory; the original stays where it is.
        </span>
      </div>

      {selected.blockedBy.length > 0 ? (
        <p className="hint">
          As written, this record would be refused: {selected.blockedBy.join('; ')}. Rewrite it below
          so it states what happened without saying where.
        </p>
      ) : null}

      <div className="field">
        <label className="label" htmlFor="promote-text">
          The generalised version
        </label>
        <textarea
          className="textarea"
          id="promote-text"
          value={text}
          maxLength={400}
          onChange={(event) => {
            setText(event.target.value);
            setVerdict({ state: 'idle' });
          }}
        />
        <span className="hint">
          Every other space will read this sentence. It has to be useful without the context it came
          from.
        </span>
      </div>

      <div className="field">
        <label className="label" htmlFor="promote-kind">
          What kind of thing it is
        </label>
        <select
          className="select"
          id="promote-kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as MemoryKind)}
        >
          {KINDS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      </div>

      {verdict.state === 'refused' ? (
        <div className="note note--warn" role="alert">
          <strong>Refused. Nothing was written to shared memory.</strong>
          <ul className="stack" style={{ gap: 'var(--s-1)', marginTop: 'var(--s-2)' }}>
            {verdict.violations.map((violation) => (
              <li key={violation}>· This text {violation}.</li>
            ))}
          </ul>
        </div>
      ) : null}

      {verdict.state === 'clear' ? (
        <p className="note note--accent" role="status">
          The gate would accept this. Nothing has been written yet.
        </p>
      ) : null}

      {verdict.state === 'promoted' ? (
        <p className="note note--accent" role="status">
          Promoted into shared {verdict.capabilityName} memory. Every space can read it now.
        </p>
      ) : null}

      {verdict.state === 'error' ? (
        <p className="note note--warn" role="alert">
          {verdict.message}
        </p>
      ) : null}

      <div className="row wrap">
        <button
          type="button"
          className="btn btn--secondary"
          disabled={pending || !text.trim()}
          onClick={() => {
            start(async () => {
              const result = await checkPromotion(selected.scopeKey, text);
              setVerdict(
                result.allowed
                  ? { state: 'clear' }
                  : { state: 'refused', violations: result.violations },
              );
            });
          }}
        >
          Check without promoting
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={pending || !text.trim()}
          onClick={() => {
            start(async () => {
              const result = await promoteMemory(selected.scopeKey, selected.id, text, kind);
              if (result.ok) {
                setVerdict({ state: 'promoted', capabilityName: selected.capabilityName });
              } else if (result.violations.length > 0) {
                setVerdict({ state: 'refused', violations: result.violations });
              } else {
                setVerdict({ state: 'error', message: result.error ?? 'That did not go through.' });
              }
            });
          }}
        >
          {pending ? 'Checking…' : 'Promote to shared'}
        </button>
      </div>
    </div>
  );
}

function promotableKind(kind: MemoryKind | undefined): MemoryKind {
  return kind && kind !== 'fact' ? kind : 'lesson';
}

function truncate(text: string): string {
  return text.length <= 64 ? text : `${text.slice(0, 63)}…`;
}
