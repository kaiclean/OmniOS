'use client';

import { useActionState, useId, useState } from 'react';

import type { McpAutonomy, McpServerConfig, McpTransport } from '@/lib/domain';
import { MCP_AUTONOMY, MCP_AUTONOMY_EXPLANATION, MCP_TRANSPORTS } from '@/lib/domain';
import { saveMcpServer, type McpFormState } from '@/lib/actions/mcp';

const INITIAL: McpFormState = { ok: false };

const AUTONOMY_LABELS: Readonly<Record<McpAutonomy, string>> = {
  'ask-always': 'Ask every time',
  'ask-writes': 'Ask for anything that changes something',
  trusted: 'Run without asking',
};

const TRANSPORT_LABELS: Readonly<Record<McpTransport, string>> = {
  stdio: 'Local process',
  http: 'Remote URL',
};

function keyValueText(record: Readonly<Record<string, string>> | undefined): string {
  return Object.entries(record ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

/**
 * Add or edit one connection.
 *
 * The transport switch changes which half of the form is live, because a local
 * process and a remote URL have nothing in common except a name. Both halves are
 * always in the DOM so a founder can flip back without retyping — the server
 * only reads the fields belonging to the transport that was submitted.
 */
export function ServerForm({
  server,
  capabilities,
  defaultAutonomy,
  onDone,
}: {
  server?: McpServerConfig;
  capabilities: ReadonlyArray<{ id: string; label: string }>;
  defaultAutonomy: McpAutonomy;
  onDone?: () => void;
}) {
  const [state, action, pending] = useActionState(saveMcpServer, INITIAL);
  const [transport, setTransport] = useState<McpTransport>(server?.transport ?? 'stdio');
  const [autonomy, setAutonomy] = useState<McpAutonomy>(server?.autonomy ?? defaultAutonomy);
  const uid = useId();

  const editing = Boolean(server);

  return (
    <form action={action} className="stack">
      <div className="two-up">
        <div className="field">
          <label className="label" htmlFor={`${uid}-name`}>
            Name
          </label>
          <input
            className="input"
            id={`${uid}-name`}
            name="name"
            defaultValue={server?.name ?? ''}
            placeholder="Brand X Instagram"
            maxLength={60}
            aria-invalid={state.errors?.name ? true : undefined}
          />
          {state.errors?.name ? (
            <span className="hint delta--bad" role="alert">
              {state.errors.name}
            </span>
          ) : (
            <span className="hint">What you will recognise it by in an approval request.</span>
          )}
        </div>

        <div className="field">
          <label className="label" htmlFor={`${uid}-id`}>
            Identifier
          </label>
          <input
            className="input mono"
            id={`${uid}-id`}
            name="id"
            defaultValue={server?.id ?? ''}
            placeholder="brand-x-instagram"
            readOnly={editing}
            aria-invalid={state.errors?.id ? true : undefined}
          />
          {state.errors?.id ? (
            <span className="hint delta--bad" role="alert">
              {state.errors.id}
            </span>
          ) : (
            <span className="hint">
              {editing
                ? 'Fixed once created: every recorded tool call names it.'
                : 'Used to namespace this server’s tools so none can shadow a built-in.'}
            </span>
          )}
        </div>
      </div>

      <div className="field">
        <label className="label" htmlFor={`${uid}-description`}>
          What it is for
        </label>
        <input
          className="input"
          id={`${uid}-description`}
          name="description"
          defaultValue={server?.description ?? ''}
          maxLength={280}
          placeholder="Posts and reads the brand account."
        />
      </div>

      <div className="stack" style={{ gap: 'var(--s-3)' }}>
        <span className="label" id={`${uid}-transport-label`}>
          How OmniOS reaches it
        </span>
        <div className="chip-row" role="radiogroup" aria-labelledby={`${uid}-transport-label`}>
          {MCP_TRANSPORTS.map((option) => (
            <label key={option} className="check-chip">
              <input
                type="radio"
                name="transport"
                value={option}
                checked={transport === option}
                onChange={() => setTransport(option)}
              />
              {TRANSPORT_LABELS[option]}
            </label>
          ))}
        </div>
      </div>

      {transport === 'stdio' ? (
        <>
          <div className="two-up">
            <div className="field">
              <label className="label" htmlFor={`${uid}-command`}>
                Command
              </label>
              <input
                className="input mono"
                id={`${uid}-command`}
                name="command"
                defaultValue={server?.command ?? ''}
                placeholder="npx"
                aria-invalid={state.errors?.command ? true : undefined}
              />
              {state.errors?.command ? (
                <span className="hint delta--bad" role="alert">
                  {state.errors.command}
                </span>
              ) : null}
            </div>

            <div className="field">
              <label className="label" htmlFor={`${uid}-args`}>
                Arguments
              </label>
              <input
                className="input mono"
                id={`${uid}-args`}
                name="args"
                defaultValue={(server?.args ?? []).join(' ')}
                placeholder="-y @modelcontextprotocol/server-fetch"
              />
              <span className="hint">Space-separated. Quote anything containing a space.</span>
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor={`${uid}-env`}>
              Environment
            </label>
            <textarea
              className="textarea mono"
              id={`${uid}-env`}
              name="env"
              rows={3}
              defaultValue={keyValueText(server?.env)}
              placeholder={'GITHUB_TOKEN={{secret:GITHUB_TOKEN}}'}
            />
            <span className="hint">
              One <span className="mono">KEY=value</span> per line. Write{' '}
              <span className="mono">{'{{secret:NAME}}'}</span> rather than the credential itself —
              the placeholder is what gets saved, and it is replaced only when the process starts.
              The server receives these plus the few variables any process needs; it does not
              inherit the rest of your environment.
            </span>
          </div>
        </>
      ) : (
        <>
          <div className="field">
            <label className="label" htmlFor={`${uid}-url`}>
              URL
            </label>
            <input
              className="input mono"
              id={`${uid}-url`}
              name="url"
              defaultValue={server?.url ?? ''}
              placeholder="https://example.com/mcp"
              aria-invalid={state.errors?.url ? true : undefined}
            />
            {state.errors?.url ? (
              <span className="hint delta--bad" role="alert">
                {state.errors.url}
              </span>
            ) : (
              <span className="hint">https only, unless it is on localhost.</span>
            )}
          </div>

          <div className="field">
            <label className="label" htmlFor={`${uid}-headers`}>
              Headers
            </label>
            <textarea
              className="textarea mono"
              id={`${uid}-headers`}
              name="headers"
              rows={3}
              defaultValue={keyValueText(server?.headers)}
              placeholder={'Authorization=Bearer {{secret:MY_TOKEN}}'}
            />
            <span className="hint">
              One <span className="mono">Name=value</span> per line, with{' '}
              <span className="mono">{'{{secret:NAME}}'}</span> for anything sensitive.
            </span>
          </div>
        </>
      )}

      <div className="two-up">
        <div className="field">
          <label className="label" htmlFor={`${uid}-capability`}>
            Capability
          </label>
          <select
            className="select"
            id={`${uid}-capability`}
            name="capabilityId"
            defaultValue={server?.capabilityId ?? capabilities[0]?.id ?? 'operations'}
          >
            {capabilities.map((capability) => (
              <option key={capability.id} value={capability.id}>
                {capability.label}
              </option>
            ))}
          </select>
          <span className="hint">Where its tools are filed, and which specialist reaches for them.</span>
        </div>

        <div className="field">
          <label className="label" htmlFor={`${uid}-autonomy`}>
            Autonomy
          </label>
          <select
            className="select"
            id={`${uid}-autonomy`}
            name="autonomy"
            value={autonomy}
            onChange={(event) => setAutonomy(event.target.value as McpAutonomy)}
          >
            {MCP_AUTONOMY.map((option) => (
              <option key={option} value={option}>
                {AUTONOMY_LABELS[option]}
              </option>
            ))}
          </select>
          <span className="hint">{MCP_AUTONOMY_EXPLANATION[autonomy]}</span>
        </div>
      </div>

      <div className="chip-row">
        <label className="check-chip">
          <input type="checkbox" name="enabled" defaultChecked={server?.enabled ?? false} />
          Enabled
        </label>
      </div>

      <div className="spread">
        <span className="hint" role="status">
          {pending ? 'Saving…' : (state.message ?? 'Saving stores the configuration. It does not connect.')}
        </span>
        <div className="row" style={{ gap: 'var(--s-2)' }}>
          {onDone ? (
            <button className="btn btn--ghost" type="button" onClick={onDone} disabled={pending}>
              Close
            </button>
          ) : null}
          <button className="btn btn--primary" type="submit" disabled={pending}>
            {editing ? 'Save connection' : 'Add connection'}
          </button>
        </div>
      </div>
    </form>
  );
}
