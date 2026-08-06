'use client';

import { useState, useTransition } from 'react';

import type { ReportCadence } from '@/lib/domain';
import { generateReportNow, setReportCadence } from '@/lib/actions/intelligence';

const CADENCES: ReadonlyArray<{ value: ReportCadence; label: string; detail: string }> = [
  { value: 'daily', label: 'Daily', detail: 'A short one every morning. Best while something is in flight.' },
  { value: 'two-day', label: 'Every two days', detail: 'Enough gap that a report has something to say.' },
  { value: 'weekly', label: 'Weekly', detail: 'The default. Long enough to see a trend, short enough to act on it.' },
  { value: 'monthly', label: 'Monthly', detail: 'For periods you are deliberately not steering week to week.' },
];

/**
 * Cadence lives in workspace settings rather than in this component's state, so
 * the select writes through on change instead of waiting for a save button. The
 * pending label exists because a silent write looks identical to a lost one.
 */
export function ReportControls({ cadence }: { cadence: ReportCadence }) {
  const [error, setError] = useState<string | null>(null);
  const [savingCadence, startCadence] = useTransition();
  const [generating, startGenerate] = useTransition();

  const active = CADENCES.find((entry) => entry.value === cadence);

  return (
    <div className="stack">
      <div className="field">
        <label className="label" htmlFor="report-cadence">
          How often OmniOS writes one
        </label>
        <select
          className="select"
          id="report-cadence"
          name="cadence"
          value={cadence}
          disabled={savingCadence}
          onChange={(event) => {
            const next = event.target.value;
            setError(null);
            startCadence(async () => {
              const result = await setReportCadence(next);
              if (!result.ok) setError(result.error ?? 'That cadence could not be saved.');
            });
          }}
        >
          {CADENCES.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
        <span className="hint">
          {savingCadence ? 'Saving…' : (active?.detail ?? 'Pick how often a report should arrive.')}
        </span>
      </div>

      <div className="stack" style={{ gap: 'var(--s-2)' }}>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={generating}
          onClick={() => {
            setError(null);
            startGenerate(async () => {
              const result = await generateReportNow();
              if (!result.ok) setError(result.error ?? 'That report could not be written.');
            });
          }}
        >
          {generating ? 'Writing…' : 'Generate a report now'}
        </button>
        <span className="hint">
          Covers the period the current cadence implies, using the records as they stand right now.
        </span>
      </div>

      {error ? (
        <p className="hint delta--bad" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
