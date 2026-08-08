'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

import { hireCustomAgent, hireFromPreset, setAgentEnabled } from '@/lib/actions/agents';
import { Badge, Empty, SectionHead } from '@/components/ui/primitives';

export interface RosterRowData {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly charter: string;
  readonly kind: 'built-in' | 'override' | 'custom';
  readonly enabled: boolean;
}

export interface PresetCardData {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly summary: string;
  readonly group: string;
  readonly hired: boolean;
}

/**
 * The roster, and the two ways to grow it.
 *
 * Hiring never grants power: an agent only routes, speaks and proposes, and its
 * proposals stop at the same gate as everything else. Switching a built-in off
 * writes a record; nothing edits code.
 */
export function TeamRoster({
  scopeKey,
  basePath,
  roster,
  presets,
  capabilityOptions,
  domainOptions,
}: {
  scopeKey: string;
  basePath: string;
  roster: readonly RosterRowData[];
  presets: readonly PresetCardData[];
  capabilityOptions: readonly { id: string; name: string }[];
  domainOptions: readonly string[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="stack" style={{ gap: 'var(--s-6)' }}>
      <div className="list">
        {roster.map((row) => (
          <div key={row.id} className="list-row" style={{ alignItems: 'flex-start' }}>
            <div className="grow stack" style={{ gap: 'var(--s-1)' }}>
              <span className="row" style={{ gap: 'var(--s-2)' }}>
                <span className="list-primary">{row.name}</span>
                <Badge tone={row.kind === 'built-in' ? 'outline' : 'accent'}>
                  {row.kind === 'built-in' ? 'built-in' : row.kind === 'override' ? 'customised' : 'hired'}
                </Badge>
                {!row.enabled ? <Badge tone="neutral">off</Badge> : null}
              </span>
              <span className="list-secondary">{row.role}</span>
              <span className="hint">{row.charter}</span>
            </div>
            <div className="row" style={{ gap: 'var(--s-2)' }}>
              {row.enabled ? (
                <Link className="btn btn--secondary btn--sm" href={`${basePath}/${row.id}`}>
                  Talk
                </Link>
              ) : null}
              <button
                className="btn btn--ghost btn--sm"
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await setAgentEnabled(scopeKey, row.id, !row.enabled);
                    setError(result.ok ? null : (result.error ?? 'Could not change that.'));
                  })
                }
              >
                {row.enabled ? 'Switch off' : 'Switch on'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {error ? <p className="note note--warn">{error}</p> : null}

      <SectionHead
        title="Hire"
        action={<span className="hint">An agent answers from this space’s records. Power stays behind the gate.</span>}
      />
      {presets.length === 0 ? (
        <Empty title="Every preset is on the roster" />
      ) : (
        <div className="capability-grid">
          {presets.map((preset) => (
            <div key={preset.id} className="panel">
              <div className="panel-body stack" style={{ gap: 'var(--s-2)' }}>
                <span className="eyebrow">{preset.group}</span>
                <span className="panel-title">{preset.name}</span>
                <span className="hint">{preset.summary}</span>
                <div>
                  <button
                    className="btn btn--secondary btn--sm"
                    type="button"
                    disabled={pending || preset.hired}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await hireFromPreset(scopeKey, preset.id);
                        setError(result.ok ? null : (result.error ?? 'Hiring failed.'));
                      })
                    }
                  >
                    {preset.hired ? 'On the roster' : pending ? 'Hiring…' : 'Hire'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <CustomAgentForm
        scopeKey={scopeKey}
        capabilityOptions={capabilityOptions}
        domainOptions={domainOptions}
        pending={pending}
        startTransition={startTransition}
        onError={setError}
      />
    </div>
  );
}

function CustomAgentForm({
  scopeKey,
  capabilityOptions,
  domainOptions,
  pending,
  startTransition,
  onError,
}: {
  scopeKey: string;
  capabilityOptions: readonly { id: string; name: string }[];
  domainOptions: readonly string[];
  pending: boolean;
  startTransition: React.TransitionStartFunction;
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [charter, setCharter] = useState('');
  const [domain, setDomain] = useState(domainOptions[0] ?? 'operations');
  const [matches, setMatches] = useState('');
  const [chosen, setChosen] = useState<readonly string[]>([]);

  return (
    <form
      className="panel"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await hireCustomAgent(scopeKey, {
            name,
            role,
            charter,
            domain,
            capabilityIds: chosen,
            matches,
          });
          onError(result.ok ? null : (result.error ?? 'Hiring failed.'));
          if (result.ok) {
            setName('');
            setRole('');
            setCharter('');
            setMatches('');
            setChosen([]);
          }
        });
      }}
    >
      <div className="panel-body stack" style={{ gap: 'var(--s-3)' }}>
        <span className="panel-title">Invent your own</span>
        <div className="row wrap" style={{ gap: 'var(--s-2)' }}>
          <input
            className="input"
            placeholder="Name — e.g. Sponsorship Scout"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={pending}
            style={{ minWidth: '16rem' }}
          />
          <input
            className="input grow"
            placeholder="Role — what this agent is for"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            disabled={pending}
          />
          <select
            className="select"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            aria-label="Domain"
            disabled={pending}
          >
            {domainOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
        <textarea
          className="input"
          placeholder="Charter — the stance it answers from, in one or two sentences"
          value={charter}
          onChange={(event) => setCharter(event.target.value)}
          disabled={pending}
          rows={2}
        />
        <input
          className="input"
          placeholder="Phrases that should reach it, comma-separated — e.g. sponsor, partnership, brand deal"
          value={matches}
          onChange={(event) => setMatches(event.target.value)}
          disabled={pending}
        />
        <div className="row wrap" style={{ gap: 'var(--s-2)' }}>
          {capabilityOptions.map((capability) => {
            const active = chosen.includes(capability.id);
            return (
              <button
                key={capability.id}
                className={active ? 'btn btn--secondary btn--sm' : 'btn btn--ghost btn--sm'}
                type="button"
                disabled={pending}
                aria-pressed={active}
                onClick={() =>
                  setChosen(active ? chosen.filter((id) => id !== capability.id) : [...chosen, capability.id])
                }
              >
                {capability.name}
              </button>
            );
          })}
        </div>
        <div className="spread">
          <span className="hint">
            Its briefings draw on the capabilities you tick, in this space only. Anything it does
            goes through the same approval gate as everything else.
          </span>
          <button className="btn btn--primary" type="submit" disabled={pending || name.trim().length < 3}>
            {pending ? 'Hiring…' : 'Hire agent'}
          </button>
        </div>
      </div>
    </form>
  );
}
