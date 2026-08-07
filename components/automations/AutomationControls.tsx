'use client';

import { useState, useTransition } from 'react';

import type { AutomationStatus } from '@/lib/domain';
import { runAutomationNow, setAutomationArmed } from '@/lib/actions/automations';
import { Badge, type Tone } from '@/components/ui/primitives';

interface Outcome {
  readonly text: string;
  readonly tone: 'ok' | 'warn' | 'bad';
}

/** A refusal is not a failure, and the interface must not let them look alike. */
const OUTCOME_TONE: Record<Outcome['tone'], Tone> = { ok: 'ok', warn: 'warn', bad: 'deny' };
const OUTCOME_LABEL: Record<Outcome['tone'], string> = {
  ok: 'recorded',
  warn: 'refused',
  bad: 'error',
};

/**
 * Arm, pause and run.
 *
 * This is a client component for one reason: the answer matters more than the
 * action. A run that is refused looks exactly like a run that succeeded if the
 * page simply revalidates, so the result comes back into the interface as text —
 * including, deliberately, the refusal. The gate itself lives in the Server
 * Action; nothing here decides whether the run is allowed.
 */
export function AutomationControls({
  spaceKey,
  automationId,
  status,
  requiresApproval,
}: {
  spaceKey: string;
  automationId: string;
  status: AutomationStatus;
  requiresApproval: boolean;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, startTransition] = useTransition();
  const armed = status === 'armed';

  const toggle = () => {
    setOutcome(null);
    startTransition(async () => {
      const result = await setAutomationArmed(spaceKey, automationId, !armed);
      setOutcome({
        text: result.message ?? (result.ok ? 'Done.' : 'That change could not be recorded.'),
        tone: result.ok ? 'ok' : 'bad',
      });
    });
  };

  const run = () => {
    setOutcome(null);
    startTransition(async () => {
      const result = await runAutomationNow(spaceKey, automationId);
      setOutcome({
        text: result.message ?? (result.ok ? 'Run recorded.' : 'That run could not be recorded.'),
        tone: !result.ok ? 'bad' : result.refused ? 'warn' : 'ok',
      });
    });
  };

  return (
    <div className="stack" style={{ gap: 'var(--s-2)' }}>
      <div className="row wrap">
        <button type="button" className="btn btn--secondary btn--sm" disabled={pending} onClick={toggle}>
          {pending ? 'Working…' : armed ? 'Pause' : 'Arm'}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={pending}
          onClick={run}
          title={
            requiresApproval
              ? 'This automation needs your approval. Running it records the request and refuses to act.'
              : 'Records a simulated run with its log. Nothing leaves this workspace.'
          }
        >
          {pending ? 'Working…' : requiresApproval ? 'Attempt run' : 'Run now'}
        </button>
      </div>

      {outcome ? (
        <p className="row wrap" role={outcome.tone === 'ok' ? 'status' : 'alert'}>
          <Badge tone={OUTCOME_TONE[outcome.tone]}>{OUTCOME_LABEL[outcome.tone]}</Badge>
          <span className="hint grow">{outcome.text}</span>
        </p>
      ) : null}
    </div>
  );
}
