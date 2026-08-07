'use client';

import { useActionState } from 'react';

import type { AssistantTone, OsSettings } from '@/lib/data/schema';
import { ASSISTANT_TONES } from '@/lib/data/schema';
import type { McpAutonomy } from '@/lib/domain';
import { CURRENCIES, MCP_AUTONOMY, MCP_AUTONOMY_EXPLANATION, REPORT_CADENCES } from '@/lib/domain';
import { updateSettings, type SettingsState } from '@/lib/actions/settings';

const INITIAL: SettingsState = { ok: false };

const TONE_LABELS: Readonly<Record<AssistantTone, string>> = {
  direct: 'Direct',
  warm: 'Plain and human',
  analytical: 'Analytical',
};

const AUTONOMY_LABELS: Readonly<Record<McpAutonomy, string>> = {
  'ask-always': 'Ask every time',
  'ask-writes': 'Ask for anything that changes something',
  trusted: 'Run without asking',
};

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
export function SettingsForm({
  settings,
  capabilities,
  providers,
}: {
  settings: OsSettings;
  /** Passed in rather than imported: the registry is the server's to read. */
  capabilities: ReadonlyArray<{ id: string; label: string }>;
  /** Names and key-presence only — never a key, and never a decrypted value. */
  providers: ReadonlyArray<{ id: string; label: string; available: boolean }>;
}) {
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

      <div className="stack" style={{ gap: 'var(--s-3)' }}>
        <span className="label" id="tone-label">
          How it writes
        </span>
        <div className="chip-row" role="radiogroup" aria-labelledby="tone-label">
          {ASSISTANT_TONES.map((tone) => (
            <label key={tone} className="check-chip">
              <input
                type="radio"
                name="assistantTone"
                value={tone}
                defaultChecked={settings.assistantTone === tone}
              />
              {TONE_LABELS[tone]}
            </label>
          ))}
        </div>
        <span className="hint">
          Wording only. The analysis underneath is computed from your records the same way whichever
          you pick, so no tone can make a figure softer than it is.
        </span>
      </div>

      <div className="field">
        <label className="label" htmlFor="assistantProvider">
          Which brain it thinks with
        </label>
        <select
          className="select"
          id="assistantProvider"
          name="assistantProvider"
          defaultValue={settings.assistantProvider}
        >
          <option value="auto">Automatic — first one with a key</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
              {provider.available ? '' : ' — no key stored'}
            </option>
          ))}
        </select>
        <span className="hint">
          Automatic takes whichever provider has a key, in a fixed order. Pin one when you want a
          specific model — with several keys in the vault, order is a default, not your preference.
          A pinned provider with no key falls back to local reasoning rather than to a different
          model, so an answer never arrives from a brain you did not choose.
        </span>
      </div>

      <div className="two-up">
        <div className="field">
          <label className="label" htmlFor="currency">
            Currency
          </label>
          <select className="select" id="currency" name="currency" defaultValue={settings.currency}>
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          <span className="hint">
            The default for new money records. Existing entries keep the currency they were written
            in — nothing is silently reinterpreted.
          </span>
        </div>

        <div className="field">
          <label className="label" htmlFor="workdayStartHour">
            Working hours
          </label>
          <div className="row" style={{ gap: 'var(--s-2)' }}>
            <input
              className="input"
              id="workdayStartHour"
              name="workdayStartHour"
              type="number"
              min={0}
              max={23}
              step={1}
              defaultValue={settings.workdayStartHour}
              aria-label="First working hour"
            />
            <span className="hint">to</span>
            <input
              className="input"
              name="workdayEndHour"
              type="number"
              min={1}
              max={24}
              step={1}
              defaultValue={settings.workdayEndHour}
              aria-label="Last working hour"
              aria-invalid={state.errors?.workdayEndHour ? true : undefined}
            />
          </div>
          {state.errors?.workdayEndHour ? (
            <span className="hint delta--bad" role="alert">
              {state.errors.workdayEndHour}
            </span>
          ) : (
            <span className="hint">The window work is scheduled into, in 24-hour local time.</span>
          )}
        </div>
      </div>

      <div className="stack" style={{ gap: 'var(--s-3)' }}>
        <span className="label">Approvals</span>
        <div className="chip-row">
          <label className="check-chip">
            <input type="checkbox" name="confirmWrites" defaultChecked={settings.confirmWrites} />
            Ask before writing to the workspace
          </label>
        </div>
        <span className="hint">
          This tightens the gate; there is no switch that loosens it. Anything that deletes, or that
          reaches outside OmniOS, always waits for you — that is a property of the system rather
          than a preference, and no setting on this page can change it.
        </span>
      </div>

      <div className="field">
        <label className="label" htmlFor="defaultMcpAutonomy">
          Default autonomy for a new connection
        </label>
        <select
          className="select"
          id="defaultMcpAutonomy"
          name="defaultMcpAutonomy"
          defaultValue={settings.defaultMcpAutonomy}
        >
          {MCP_AUTONOMY.map((autonomy) => (
            <option key={autonomy} value={autonomy}>
              {AUTONOMY_LABELS[autonomy]}
            </option>
          ))}
        </select>
        <span className="hint">{MCP_AUTONOMY_EXPLANATION[settings.defaultMcpAutonomy]}</span>
      </div>

      <div className="stack" style={{ gap: 'var(--s-3)' }}>
        <span className="label">Capabilities in use</span>
        {/* The marker distinguishes "everything unticked" from "this section never
            rendered". Without it a partial post would read as switching the whole
            OS off. */}
        <input type="hidden" name="capabilitiesSubmitted" value="1" />
        <div className="chip-row">
          {capabilities.map((capability) => (
            <label key={capability.id} className="check-chip">
              <input
                type="checkbox"
                name={`capability:${capability.id}`}
                defaultChecked={!settings.disabledCapabilityIds.includes(capability.id)}
              />
              {capability.label}
            </label>
          ))}
        </div>
        <span className="hint">
          Switching one off hides it from navigation, the command palette and the specialist router.
          Nothing is deleted: the records stay in their scope files and reappear the moment you turn
          it back on.
        </span>
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
