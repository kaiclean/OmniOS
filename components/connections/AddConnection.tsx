'use client';

import { useState } from 'react';

import type { McpAutonomy } from '@/lib/domain';
import { ServerForm } from './ServerForm';

/** Collapsed by default: the presets above answer most cases without this form. */
export function AddConnection({
  capabilities,
  defaultAutonomy,
}: {
  capabilities: ReadonlyArray<{ id: string; label: string }>;
  defaultAutonomy: McpAutonomy;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button className="btn btn--secondary" type="button" onClick={() => setOpen(true)}>
        Add a connection by hand
      </button>
    );
  }

  return (
    <ServerForm
      capabilities={capabilities}
      defaultAutonomy={defaultAutonomy}
      onDone={() => setOpen(false)}
    />
  );
}
