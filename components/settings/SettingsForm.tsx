'use client';

import { useActionState } from 'react';

import type { OsSettings } from '@/lib/data/schema';
import { REPORT_CADENCES } from '@/lib/domain';
import { updateSettings, type SettingsState } from '@/lib/actions/settings';

const INITIAL: SettingsState = { ok: false };

const THEMES: ReadonlyArray<{ value: OsSettings['theme']; label: string; detail: string }> = [
  { value: 'dark', label: 'Dark', detail: 'The default. Built for long sessions in one room.' },
  { value: 'light', label: 'Light', detail: 'Same system, same hairlines, more ambient light.' },
  { value: 'system', label: 'System', detail: 'Follows whatever the machine is currently doing.' },
];

const CADENCE_LABELS: Readonly<Record<(typeof REPORT_CADENCES)[number], string>> = {
  daily: 'Daily',
  'two-day': 'Every two days',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

/**
 * One form, one save.
 *
 * Every field here is stored on the workspace root and read by the root layout,
 * so a save re-renders the whole shell — the theme and motion settings take
 * effect on the server rather than through a class toggled in the browser, and
 * therefore survive a reload with no flash of the previous choice.
 */
export function SettingsForm({ settings }: { settings: OsSettings }) {
  const [state, action, pending] = useActionState(updateSettings, INITIAL);

  return (
    <form action={action} className="stack">
      {/* A div rather than a fieldset: nothing in the stylesheet resets the
          browser's default fieldset border, and adding one is not this form's
          job. The radio group keeps its semantics through role + aria. */}
      <div className="stack" style={{ gap: 'var(--s-3)' }}>
        <span className="label" id="theme-label">
          Theme
        </span>
        <div className="chip-row" role="radiogroup" aria-labelledby="theme-label">
          {THEMES.map((theme) => (
            <label key={theme.value} className="check-chip">
              <input
                type="radio"
                name="theme"
                value={theme.value}
                defaultChecked={settings.theme === theme.value}
              />
              {theme.label}
            </label>
          ))}
        </div>
        <span className="hint">
          {THEMES.find((theme) => theme.value === settings.theme)?.detail}
        </span>
      </div>

      <div className="stack" style={{ gap: 'var(--s-3)' }}>
        <span className="label">Motion and tint</span>
        <div className="chip-row">
          <label className="check-chip">
            <input type="checkbox" name="reduceMotion" defaultChecked={settings.reduceMotion} />
            Reduce motion
          </label>
          <label className="check-chip">
            <input type="checkbox" name="spaceTint" defaultChecked={settings.spaceTint} />
            Space tint
          </label>
        </div>
        <span className="hint">
          Reduced motion stops the seam pulsing and removes panel transitions; the system also
          honours your operating system setting without this being on. Space tint is the breath of
          hue each space gives the shell — turning it off leaves the interface fully achromatic.
        </span>
      </div>

      <div className="field">
        <label className="label" htmlFor="assistantName">
          Assistant name
        </label>
        <input
          className="input"
          id="assistantName"
          name="assistantName"
          defaultValue={settings.assistantName}
          maxLength={24}
          aria-describedby="assistantName-hint"
          aria-invalid={state.errors?.assistantName ? true : undefined}
        />
        <span className="hint" id="assistantName-hint">
          What the one assistant is called in the sidebar and in every reply header. It does not
          change how the assistant reasons.
        </span>
        {state.errors?.assistantName ? (
          <span className="hint delta--bad" role="alert">
            {state.errors.assistantName}
          </span>
        ) : null}
      </div>

      <div className="two-up">
        <div className="field">
          <label className="label" htmlFor="cadence">
            Report cadence
          </label>
          <select
            className="select"
            id="cadence"
            name="cadence"
            defaultValue={settings.reportSettings.cadence}
          >
            {REPORT_CADENCES.map((cadence) => (
              <option key={cadence} value={cadence}>
                {CADENCE_LABELS[cadence]}
              </option>
            ))}
          </select>
          <span className="hint">How often OmniOS writes a learning report.</span>
        </div>

        <div className="field">
          <label className="label" htmlFor="maxBullets">
            Bullets per report section
          </label>
          <input
            className="input"
            id="maxBullets"
            name="maxBullets"
            type="number"
            min={3}
            max={12}
            step={1}
            defaultValue={settings.reportSettings.maxBullets}
            aria-invalid={state.errors?.maxBullets ? true : undefined}
          />
          {state.errors?.maxBullets ? (
            <span className="hint delta--bad" role="alert">
              {state.errors.maxBullets}
            </span>
          ) : (
            <span className="hint">The cut-off before a report becomes a list nobody finishes.</span>
          )}
        </div>
      </div>

      <div className="stack" style={{ gap: 'var(--s-3)' }}>
        <span className="label">What a report may draw on</span>
        <div className="chip-row">
          <label className="check-chip">
            <input
              type="checkbox"
              name="includeHealth"
              defaultChecked={settings.reportSettings.includeHealth}
            />
            Health and recovery
          </label>
          <label className="check-chip">
            <input
              type="checkbox"
              name="includeFinance"
              defaultChecked={settings.reportSettings.includeFinance}
            />
            Money
          </label>
          <label className="check-chip">
            <input
              type="checkbox"
              name="includeEcosystem"
              defaultChecked={settings.reportSettings.includeEcosystem}
            />
            AI ecosystem
          </label>
        </div>
        <span className="hint">
          Switching one off removes that section from future reports. Reports already written are
          left exactly as they were.
        </span>
      </div>

      <div className="spread">
        <span className="hint" role="status">
          {pending ? 'Saving…' : (state.message ?? 'Changes apply the moment they are saved.')}
        </span>
        <button className="btn btn--primary" type="submit" disabled={pending}>
          Save settings
        </button>
      </div>
    </form>
  );
}
