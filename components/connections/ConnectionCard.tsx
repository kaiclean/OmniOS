'use client';

import { useState, useTransition } from 'react';

import type { McpAutonomy, McpConnectionState, McpServerConfig, RiskTier } from '@/lib/domain';
import {
  MCP_AUTONOMY_EXPLANATION,
  configGaps,
  connectionStatusFor,
  requiresApproval,
} from '@/lib/domain';
import {
  probeMcpServer,
  removeMcpServer,
  setMcpServerEnabled,
  setMcpToolEnabled,
} from '@/lib/actions/mcp';
import { Badge, Note, RelativeTime } from '@/components/ui/primitives';
import { ServerForm } from './ServerForm';

const RISK_TONE: Readonly<Record<RiskTier, 'accent' | 'outline' | 'warn'>> = {
  read: 'outline',
  write: 'outline',
  destructive: 'warn',
  external: 'warn',
};

/**
 * One connection, with everything that can be done to it.
 *
 * Connecting is a button rather than something the page does on render: it
 * spawns a process or opens a socket, and a page that did that while drawing
 * itself would do it again on every navigation. What is drawn is the last
 * result, with the time it was taken, because "reachable at 14:02" and
 * "reachable now" are different claims.
 */
export function ConnectionCard({
  server,
  state,
  capabilities,
  defaultAutonomy,
}: {
  server: McpServerConfig;
  state?: McpConnectionState;
  capabilities: ReadonlyArray<{ id: string; label: string }>;
  defaultAutonomy: McpAutonomy;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [pending, startTransition] = useTransition();

  const status = connectionStatusFor(server, state);
  const gaps = configGaps(server);
  const tools = state?.tools ?? [];
  const gated = tools.filter((tool) => requiresApproval(tool.risk)).length;

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="grow">
          <div className="row wrap" style={{ gap: 'var(--s-2)' }}>
            <h3 className="panel-title">{server.name}</h3>
            <StatusBadge status={status} />
            {server.transport === 'stdio' ? (
              <Badge tone="outline">Local process</Badge>
            ) : (
              <Badge tone="outline">Remote</Badge>
            )}
          </div>
          <p className="panel-sub">
            {server.description || 'No description.'}{' '}
            <span className="mono">{server.id}</span>
          </p>
        </div>
        <div className="row" style={{ gap: 'var(--s-2)' }}>
          <button
            className="btn btn--secondary"
            type="button"
            disabled={pending || !server.enabled}
            onClick={() => startTransition(() => void probeMcpServer(server.id))}
          >
            {pending ? 'Connecting…' : 'Connect'}
          </button>
          <button
            className="btn btn--ghost"
            type="button"
            disabled={pending}
            onClick={() => startTransition(() => void setMcpServerEnabled(server.id, !server.enabled))}
          >
            {server.enabled ? 'Disable' : 'Enable'}
          </button>
          <button className="btn btn--ghost" type="button" onClick={() => setEditing((open) => !open)}>
            {editing ? 'Close' : 'Edit'}
          </button>
        </div>
      </div>

      <div className="panel-body stack" style={{ gap: 'var(--s-4)' }}>
        <div className="row wrap" style={{ gap: 'var(--s-2)' }}>
          <Badge tone={server.autonomy === 'trusted' ? 'warn' : 'outline'}>
            {server.autonomy === 'trusted'
              ? 'Runs without asking'
              : server.autonomy === 'ask-writes'
                ? 'Asks before changing anything'
                : 'Asks every time'}
          </Badge>
          <span className="hint">{MCP_AUTONOMY_EXPLANATION[server.autonomy]}</span>
        </div>

        {status === 'error' && state?.error ? (
          <Note tone="warn" icon="alert">
            <span className="mono" style={{ overflowWrap: 'anywhere' }}>
              {state.error}
            </span>
          </Note>
        ) : null}

        {status === 'needs-setup' ? (
          <Note tone="warn" icon="alert">
            This connection still needs {gaps.join(' and ')} before it can work. Edit it and
            replace the placeholder — Connect will refuse until it is filled in.
          </Note>
        ) : null}

        {status === 'connected' ? (
          <>
            <div className="row wrap" style={{ gap: 'var(--s-3)' }}>
              <span className="hint">
                {state?.serverName ?? server.id}
                {state?.serverVersion ? ` ${state.serverVersion}` : ''} · checked{' '}
                <RelativeTime at={state?.checkedAt} />
                {state?.latencyMs === undefined ? '' : ` · ${state.latencyMs}ms`}
              </span>
              <span className="hint">
                {gated === tools.length
                  ? 'Every tool here waits for your approval.'
                  : `${gated} of ${tools.length} wait for your approval.`}
              </span>
            </div>

            {tools.length === 0 ? (
              <p className="prose">This server connected but offers no tools.</p>
            ) : (
              <div className="list">
                {tools.map((tool) => (
                  <div key={tool.name} className="list-row">
                    <div className="grow">
                      <div className="list-primary mono truncate">{tool.name}</div>
                      <div className="list-secondary">{tool.description}</div>
                    </div>
                    <div className="list-meta row" style={{ gap: 'var(--s-2)' }}>
                      <Badge tone={RISK_TONE[tool.risk]}>{tool.risk}</Badge>
                      <button
                        className="btn btn--ghost"
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          startTransition(() => void setMcpToolEnabled(server.id, tool.name, false))
                        }
                      >
                        Switch off
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : status === 'never-connected' ? (
          <p className="prose">
            Never connected. Nothing is known about what this server offers until you connect it —
            OmniOS does not assume a tool list from the name.
          </p>
        ) : null}

        {server.disabledTools.length > 0 ? (
          <div className="stack" style={{ gap: 'var(--s-2)' }}>
            <span className="eyebrow">Switched off</span>
            <div className="chip-row">
              {server.disabledTools.map((name) => (
                <button
                  key={name}
                  className="btn btn--ghost mono"
                  type="button"
                  disabled={pending}
                  onClick={() => startTransition(() => void setMcpToolEnabled(server.id, name, true))}
                >
                  {name} · turn back on
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {editing ? (
          <>
            <div className="divider" />
            <ServerForm
              server={server}
              capabilities={capabilities}
              defaultAutonomy={defaultAutonomy}
              onDone={() => setEditing(false)}
            />
          </>
        ) : null}

        <div className="divider" />

        {confirmingRemoval ? (
          <div className="spread">
            <span className="hint">
              Removing forgets the configuration. Anything it already did stays recorded, and no
              secret is deleted.
            </span>
            <div className="row" style={{ gap: 'var(--s-2)' }}>
              <button className="btn btn--ghost" type="button" onClick={() => setConfirmingRemoval(false)}>
                Keep it
              </button>
              <button
                className="btn btn--danger"
                type="button"
                disabled={pending}
                onClick={() => startTransition(() => void removeMcpServer(server.id))}
              >
                Remove {server.name}
              </button>
            </div>
          </div>
        ) : (
          <div className="spread">
            <span className="hint">
              {server.lastConnectedAt
                ? <>Last reached <RelativeTime at={server.lastConnectedAt} />.</>
                : 'Not reached yet.'}
            </span>
            <button className="btn btn--ghost" type="button" onClick={() => setConfirmingRemoval(true)}>
              Remove
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: McpConnectionState['status'] }) {
  switch (status) {
    case 'connected':
      return <Badge tone="accent">Connected</Badge>;
    case 'error':
      return <Badge tone="warn">Failed</Badge>;
    case 'disabled':
      return <Badge tone="outline">Disabled</Badge>;
    case 'needs-setup':
      return <Badge tone="warn">Needs setup</Badge>;
    default:
      return <Badge tone="outline">Never connected</Badge>;
  }
}
