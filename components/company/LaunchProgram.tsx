'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

import {
  BUSINESS_MODELS,
  BUSINESS_MODEL_LABELS,
  BUSINESS_MODEL_NOTES,
  type BusinessModel,
} from '@/lib/business/playbook';
import { runLaunchProgram, type LaunchReport, type LaunchStepResult } from '@/lib/actions/launch';
import { Badge, Note } from '@/components/ui/primitives';

const OUTCOME_LABEL: Record<LaunchStepResult['outcome'], string> = {
  done: 'Done',
  'awaiting-approval': 'Waiting on you',
  'needs-connection': 'Needs a connection',
  'needs-arguments': 'Needs arguments',
  failed: 'Failed',
};

const OUTCOME_TONE: Record<LaunchStepResult['outcome'], 'accent' | 'outline' | 'warn'> = {
  done: 'accent',
  'awaiting-approval': 'warn',
  'needs-connection': 'outline',
  'needs-arguments': 'outline',
  failed: 'warn',
};

/**
 * Run the launch programme for this company.
 *
 * The report is deliberately not summarised into a single cheerful sentence.
 * What a founder needs from this is the split: what was actually done, what is
 * queued for them, and what could not be attempted at all — with the missing
 * connection named.
 */
export function LaunchProgram({
  companyId,
  suggestedModel,
  currency,
}: {
  companyId: string;
  suggestedModel: BusinessModel;
  currency: string;
}) {
  const [model, setModel] = useState<BusinessModel>(suggestedModel);
  const [budget, setBudget] = useState('2000');
  const [report, setReport] = useState<LaunchReport | null>(null);
  const [pending, startTransition] = useTransition();

  const counts = (outcome: LaunchStepResult['outcome']) =>
    report?.results.filter((result) => result.outcome === outcome).length ?? 0;

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <div className="stack" style={{ gap: 'var(--s-3)' }}>
        <span className="label" id="launch-model-label">
          Shape of the business
        </span>
        <div className="chip-row" role="radiogroup" aria-labelledby="launch-model-label">
          {BUSINESS_MODELS.map((option) => (
            <label key={option} className="check-chip">
              <input
                type="radio"
                name="launch-model"
                value={option}
                checked={model === option}
                onChange={() => setModel(option)}
              />
              {BUSINESS_MODEL_LABELS[option]}
            </label>
          ))}
        </div>
        <span className="hint">{BUSINESS_MODEL_NOTES[model]}</span>
      </div>

      <div className="field">
        <label className="label" htmlFor="launch-budget">
          Test budget ({currency})
        </label>
        <input
          className="input"
          id="launch-budget"
          type="number"
          min={0}
          step={100}
          value={budget}
          onChange={(event) => setBudget(event.target.value)}
        />
        <span className="hint">
          Booked as a forecast, not spent. This is the number the kill criteria are written against.
        </span>
      </div>

      <div className="spread">
        <span className="hint" role="status">
          {pending
            ? 'Working through the programme…'
            : report
              ? `${counts('done')} done · ${counts('awaiting-approval')} waiting on you · ${counts('needs-connection') + counts('needs-arguments')} blocked`
              : 'The strategy half runs now. Anything that reaches outside stops for your approval — or, when nothing is connected that can do it, is listed as blocked with the missing piece named.'}
        </span>
        <button
          className="btn btn--primary"
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await runLaunchProgram(companyId, model, {
                testBudgetMinor: Math.max(0, Math.round(Number(budget) || 0) * 100),
              });
              setReport(result);
            })
          }
        >
          {report ? 'Run again' : 'Run the launch programme'}
        </button>
      </div>

      {report ? (
        <>
          <div className="divider" />
          {counts('needs-connection') > 0 ? (
            <Note tone="warn" icon="alert">
              {counts('needs-connection')} of these could not be attempted because nothing is
              connected that can do them. They are listed below with what is missing — add it on{' '}
              <Link href="/connections">Connections</Link> and run this again.
            </Note>
          ) : null}

          <div className="list">
            {report.results.map((result) => (
              <div key={result.stepId} className="list-row" style={{ alignItems: 'flex-start' }}>
                <div className="grow stack" style={{ gap: 'var(--s-1)' }}>
                  <div className="row wrap" style={{ gap: 'var(--s-2)' }}>
                    <span className="list-primary">{result.title}</span>
                    <Badge tone={OUTCOME_TONE[result.outcome]}>{OUTCOME_LABEL[result.outcome]}</Badge>
                    {result.toolLabel ? <Badge tone="outline">{result.toolLabel}</Badge> : null}
                  </div>
                  <div className="list-secondary">{result.why}</div>
                  <span className="hint">{result.detail}</span>
                </div>
              </div>
            ))}
          </div>

          {counts('awaiting-approval') > 0 ? (
            <div className="spread">
              <span className="hint">
                Nothing that leaves this machine has run. It is queued with a preview of exactly what
                it would do.
              </span>
              <Link className="btn btn--secondary" href="/approvals">
                Review {counts('awaiting-approval')} waiting
              </Link>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
