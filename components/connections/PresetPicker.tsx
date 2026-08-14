'use client';

import { useState, useTransition } from 'react';

import { MCP_PRESETS, configGaps, presetOwnsServerId } from '@/lib/domain';
import { addMcpPreset } from '@/lib/actions/mcp';
import { Badge } from '@/components/ui/primitives';

/**
 * Starting points, not bundled software.
 *
 * A preset writes a configuration and nothing else: the server itself still has
 * to be installed, the credential still has to exist, and the connection arrives
 * switched off. Saying so here matters, because a one-click list implies these
 * are integrations OmniOS ships, and they are not.
 */
export function PresetPicker({ existingIds }: { existingIds: readonly string[] }) {
  const [pending, startTransition] = useTransition();
  const [added, setAdded] = useState<string | null>(null);

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <div className="list">
        {MCP_PRESETS.map((preset) => {
          const already = existingIds.some((id) => presetOwnsServerId(preset, id));
          // Env keys were badged from day one; the positional placeholders
          // (a directory path, a connection string, a URL) were not, so those
          // presets looked one-click when they were three-step.
          const gaps = configGaps(preset);
          return (
            <div key={preset.id} className="list-row">
              <div className="grow">
                <div className="row wrap" style={{ gap: 'var(--s-2)' }}>
                  <span className="list-primary">{preset.name}</span>
                  {already ? <Badge tone="outline">Added</Badge> : null}
                  {preset.envKeys?.length ? (
                    <Badge tone="outline">needs {preset.envKeys.join(', ')}</Badge>
                  ) : null}
                  {gaps.length > 0 ? <Badge tone="outline">needs {gaps.join(', ')}</Badge> : null}
                </div>
                <div className="list-secondary">{preset.unlocks}</div>
              </div>
              <div className="list-meta">
                <button
                  className="btn btn--ghost"
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await addMcpPreset(preset.id);
                      setAdded(result.message ?? null);
                    })
                  }
                >
                  {already ? 'Add another' : 'Add'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <span className="hint" role="status">
        {added ??
          'A preset fills in the configuration and stops there. You still install the server, supply the credential, and enable it yourself.'}
      </span>
    </div>
  );
}
