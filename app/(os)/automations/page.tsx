import type { Metadata } from 'next';
import Link from 'next/link';

import { CAPABILITIES, capabilityLabel } from '@/lib/capabilities/registry';
import { acrossSpaces, loadSpaces, type SpaceView } from '@/lib/data/aggregate';
import type { Automation, AutomationRun, AutomationStatus, RunStatus } from '@/lib/domain';
import { specialistName } from '@/lib/ai/specialists';
import {
  EMPTY,
  formatDate,
  formatDurationMinutes,
  formatNumber,
  formatRelative,
  pluralise,
} from '@/lib/format';
import { Icon } from '@/components/ui/Icon';
import {
  Badge,
  Empty,
  Metric,
  MetricGrid,
  Note,
  PageHead,
  Panel,
  SectionHead,
  SimulatedMark,
  type Tone,
} from '@/components/ui/primitives';
import { AutomationControls } from '@/components/automations/AutomationControls';

export const metadata: Metadata = { title: 'Automation Platform' };

type AutomationRow = { readonly item: Automation; readonly space: SpaceView };

/**
 * Groups in the order a founder needs them: what is working, what has broken,
 * what was deliberately stopped, what was written and never turned on.
 */
const GROUPS: ReadonlyArray<{ status: AutomationStatus; label: string; blurb: string }> = [
  { status: 'armed', label: 'Armed', blurb: 'Running on their trigger and counted as returning time.' },
  { status: 'failing', label: 'Failing', blurb: 'Armed, but the last run did not complete.' },
  { status: 'paused', label: 'Paused', blurb: 'Stopped on purpose. Nothing fires and nothing is counted.' },
  { status: 'draft', label: 'Draft', blurb: 'Written, never armed. Every minute here is unclaimed.' },
];

const STATUS_TONE: Record<AutomationStatus, Tone> = {
  armed: 'ok',
  draft: 'neutral',
  paused: 'outline',
  failing: 'deny',
};

const RUN_TONE: Record<RunStatus, Tone> = {
  success: 'ok',
  partial: 'warn',
  failed: 'deny',
  'awaiting-approval': 'warn',
};

/**
 * The Automation Platform.
 *
 * Every automation the founder owns, in one place, with the one thing that makes
 * the page trustworthy attached to each of them: a run button that refuses. An
 * automation with a step reaching outside OmniOS cannot be run from here — it
 * records an `awaiting-approval` run and names the steps it declined to take.
 */
export default async function AutomationPlatformPage() {
  const spaces = await loadSpaces();
  const automations = acrossSpaces(spaces, 'automations');
  const runs = acrossSpaces(spaces, 'automationRuns');

  // Runs are keyed by scope as well as id so history can never be borrowed from
  // an identically-named automation in another space.
  const runsByAutomation = new Map<string, AutomationRun[]>();
  for (const { item, space } of runs) {
    const key = `${space.scopeKey}:${item.automationId}`;
    const list = runsByAutomation.get(key);
    if (list) list.push(item);
    else runsByAutomation.set(key, [item]);
  }
  for (const list of runsByAutomation.values()) {
    list.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  }

  const armed = automations.filter((row) => row.item.status === 'armed');
  const drafted = automations.filter((row) => row.item.status === 'draft');

  const minutesReturned = armed.reduce(
    (sum, row) => sum + row.item.minutesSavedPerRun * row.item.runsThisMonth,
    0,
  );
  const minutesUnclaimed = drafted.reduce((sum, row) => sum + row.item.minutesSavedPerRun, 0);

  const gated = automations.filter((row) => needsApproval(row.item));
  const refusedRuns = runs.filter((row) => row.item.status === 'awaiting-approval').length;

  return (
    <>
      <PageHead
        eyebrow="Systems"
        title="Automation Platform"
        lede="Every automation across every space, what each one gives back, and what happens when you ask one to run."
        actions={
          <>
            <Badge tone="outline">{pluralise(automations.length, 'automation')}</Badge>
            <Badge tone="outline">{pluralise(spaces.length, 'space')}</Badge>
          </>
        }
      />

      <Note tone="accent" icon="shield">
        <strong>Running an automation here never performs an external action.</strong> A run writes a
        real record with its log, and any automation whose steps reach outside OmniOS is refused
        outright — it is stored as <em>awaiting approval</em>, claims no minutes, and names the steps
        it declined to take. {pluralise(gated.length, 'automation')} of {automations.length}{' '}
        {gated.length === 1 ? 'is' : 'are'} gated that way
        {refusedRuns > 0 ? `, and ${pluralise(refusedRuns, 'run has', 'runs have')} already been refused and kept` : ''}.
      </Note>

      <div className="grid" style={{ marginBottom: 'var(--s-8)' }}>
        <Panel
          title="This month"
          span={12}
          subtitle="Minutes are the automation's own estimate per run, multiplied by runs recorded this month."
          action={<SimulatedMark label="Derived from run counts" />}
        >
          <MetricGrid>
            <Metric
              label="Returned this month"
              value={formatDurationMinutes(minutesReturned)}
              hint={`${pluralise(armed.length, 'armed automation')}`}
            />
            <Metric
              label="Unclaimed per run"
              value={minutesUnclaimed === 0 ? EMPTY : formatDurationMinutes(minutesUnclaimed)}
              // Drafts have never run, so there is no cadence to multiply by and
              // OmniOS will not invent one. Per-run is the only honest figure.
              hint={`${pluralise(drafted.length, 'draft')} · never armed, so no cadence to multiply`}
            />
            <Metric
              label="Runs recorded"
              value={formatNumber(runs.length)}
              hint={refusedRuns === 0 ? 'None refused' : `${refusedRuns} refused at the gate`}
            />
            <Metric
              label="Approval-gated"
              value={formatNumber(gated.length)}
              hint="Cannot be run from this page"
            />
          </MetricGrid>
        </Panel>
      </div>

      {GROUPS.map((group) => {
        const inGroup = automations.filter((row) => row.item.status === group.status);
        return (
          <section key={group.status}>
            <SectionHead
              title={`${group.label} · ${formatNumber(inGroup.length)}`}
              action={<span className="hint">{group.blurb}</span>}
            />
            {inGroup.length === 0 ? (
              <Panel span={12}>
                <Empty title={`Nothing ${group.label.toLowerCase()}`} />
              </Panel>
            ) : (
              <div className="grid">
                {inGroup.map((row) => (
                  <AutomationCard
                    key={`${row.space.scopeKey}:${row.item.id}`}
                    automation={row.item}
                    space={row.space}
                    history={runsByAutomation.get(`${row.space.scopeKey}:${row.item.id}`) ?? []}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}

      <SectionHead title="Template catalogue" action={<span className="hint">What each capability brings, per space</span>} />
      <TemplateCatalogue automations={automations} spaces={spaces} />
    </>
  );
}

/** An external step is an approval requirement whether or not the record says so. */
function needsApproval(automation: Automation): boolean {
  return automation.requiresApproval || automation.steps.some((step) => step.external);
}

/* ------------------------------------------------------------------ card --- */

function AutomationCard({
  automation,
  space,
  history,
}: {
  automation: Automation;
  space: SpaceView;
  history: readonly AutomationRun[];
}) {
  const gated = needsApproval(automation);
  const capability = CAPABILITIES.find((entry) => entry.id === automation.capabilityId);

  return (
    <Panel
      title={automation.name}
      subtitle={automation.description}
      span={6}
      action={
        <span className="row wrap">
          {gated ? <Badge tone="warn">approval</Badge> : null}
          <Badge tone={STATUS_TONE[automation.status]} dot>
            {automation.status}
          </Badge>
        </span>
      }
      footer={
        <span className="spread wrap">
          <Link className="link-inline" href={space.href}>
            {space.label}
          </Link>
          <span>
            {capability ? capabilityLabel(capability, space.kind) : automation.capabilityId} ·{' '}
            {automation.trigger}
          </span>
        </span>
      }
    >
      <div className="stack" style={{ gap: 'var(--s-4)' }}>
        <div className="stack" style={{ gap: 'var(--s-1)' }}>
          <span className="spread list-secondary">
            <span className="faint">Trigger</span>
            <span>{automation.triggerDetail}</span>
          </span>
          <span className="spread list-secondary">
            <span className="faint">Returns per run</span>
            <span>
              {automation.minutesSavedPerRun === 0
                ? EMPTY
                : formatDurationMinutes(automation.minutesSavedPerRun)}
            </span>
          </span>
          <span className="spread list-secondary">
            <span className="faint">Runs this month</span>
            <span>{formatNumber(automation.runsThisMonth)}</span>
          </span>
          <span className="spread list-secondary">
            <span className="faint">Last run</span>
            <span>
              {automation.lastRunAt
                ? `${formatDate(automation.lastRunAt)} · ${formatRelative(automation.lastRunAt)}`
                : EMPTY}
            </span>
          </span>
        </div>

        <div className="stack" style={{ gap: 'var(--s-2)' }}>
          <span className="eyebrow">Steps</span>
          <div className="plan-body" style={{ padding: 0 }}>
            {automation.steps.map((step) => (
              <div key={step.id} className="plan-step">
                <span className="plan-step-name">{specialistName(step.specialistId)}</span>
                <span className="grow">{step.label}</span>
                {step.external ? <Badge tone="warn">external</Badge> : null}
              </div>
            ))}
          </div>
        </div>

        {gated ? (
          <Note tone="warn" icon="shield">
            This one will not run from here. Asking it to run records the request and the reason it
            was refused, and nothing is sent.
          </Note>
        ) : null}

        <AutomationControls
          spaceKey={space.scopeKey}
          automationId={automation.id}
          status={automation.status}
          requiresApproval={gated}
        />

        <RunHistory history={history} />
      </div>
    </Panel>
  );
}

function RunHistory({ history }: { history: readonly AutomationRun[] }) {
  if (history.length === 0) {
    return (
      <p className="hint">
        No runs recorded yet. A run written from here keeps its full log, including a refusal.
      </p>
    );
  }

  return (
    <details className="plan">
      <summary>
        <Icon name="chevron-right" size={12} />
        Run history · {formatNumber(history.length)}
      </summary>
      <div className="plan-body">
        {history.slice(0, 8).map((run) => (
          <div key={run.id} className="stack" style={{ gap: 'var(--s-2)' }}>
            <span className="spread wrap">
              <span className="plan-step-name">
                {formatDate(run.startedAt)} · {formatRelative(run.startedAt)}
              </span>
              <span className="row" style={{ gap: 'var(--s-2)' }}>
                {run.simulated ? <SimulatedMark label="Simulated" /> : null}
                <Badge tone={RUN_TONE[run.status]}>{run.status.replace('-', ' ')}</Badge>
              </span>
            </span>
            {run.lines.map((logLine, index) => (
              <div key={`${run.id}:${index}`} className="plan-step">
                {logLine.level === 'info' ? null : (
                  <Badge tone={logLine.level === 'warn' ? 'warn' : 'deny'}>{logLine.level}</Badge>
                )}
                <span className="grow">{logLine.message}</span>
              </div>
            ))}
            <span className="list-secondary">
              {run.minutesSaved === 0
                ? 'No minutes claimed for this run.'
                : `${formatDurationMinutes(run.minutesSaved)} claimed.`}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

/* -------------------------------------------------------------- catalogue -- */

/**
 * The catalogue is the registry, not a second list.
 *
 * Rows come from CAPABILITIES in registry order, so a capability added there
 * appears here with nothing to edit — and a capability that brings no automation
 * yet shows an em dash rather than being quietly dropped, which is the only way a
 * founder can see what is missing.
 */
function TemplateCatalogue({
  automations,
  spaces,
}: {
  automations: readonly AutomationRow[];
  spaces: readonly SpaceView[];
}) {
  return (
    <Panel
      title="Available per capability"
      span={12}
      subtitle="Every capability OmniOS grants a space, and the automation templates it currently carries."
      flush
    >
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Capability</th>
              <th scope="col">Templates</th>
              <th scope="col" className="num">Spaces</th>
              <th scope="col" className="num">Armed</th>
              <th scope="col" className="num">Per run</th>
              <th scope="col">Specialists</th>
            </tr>
          </thead>
          <tbody>
            {CAPABILITIES.map((capability) => {
              const owned = automations.filter((row) => row.item.capabilityId === capability.id);
              const names = [...new Set(owned.map((row) => row.item.name))].sort();
              const covered = new Set(owned.map((row) => row.space.scopeKey)).size;
              const applicable = spaces.filter((space) => capability.appliesTo.includes(space.kind)).length;
              const armedHere = owned.filter((row) => row.item.status === 'armed').length;
              // Per-run minutes of the distinct templates, not of every copy: two
              // companies running the same template do not make it worth twice as
              // much per run.
              const perRun = names.reduce((sum, name) => {
                const first = owned.find((row) => row.item.name === name);
                return sum + (first?.item.minutesSavedPerRun ?? 0);
              }, 0);

              return (
                <tr key={capability.id}>
                  <td>
                    <div className="list-primary">{capability.name}</div>
                    <div className="list-secondary">{capability.tagline}</div>
                  </td>
                  <td>
                    {names.length === 0 ? (
                      <span className="faint">{EMPTY}</span>
                    ) : (
                      <ul className="list-secondary">
                        {names.map((name) => (
                          <li key={name}>· {name}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="num">
                    {covered === 0 ? EMPTY : `${formatNumber(covered)}/${formatNumber(applicable)}`}
                  </td>
                  <td className="num">{armedHere === 0 ? EMPTY : formatNumber(armedHere)}</td>
                  <td className="num">{perRun === 0 ? EMPTY : formatDurationMinutes(perRun)}</td>
                  <td className="faint">
                    {capability.specialistIds.map((id) => specialistName(id)).join(', ')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
