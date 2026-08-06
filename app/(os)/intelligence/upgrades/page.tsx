import type { Metadata } from 'next';
import Link from 'next/link';

import { getWorkspace } from '@/lib/data/store';
import { AUTONOMOUS_STAGES, UPGRADE_STAGES } from '@/lib/domain';
import type {
  SandboxMetric,
  Severity,
  UpgradeCandidate,
  UpgradeDecisionKind,
  UpgradeStage,
} from '@/lib/domain';
import {
  EMPTY,
  formatDate,
  formatNumber,
  formatPercent,
  formatRelative,
  pluralise,
  titleCase,
} from '@/lib/format';
import {
  Badge,
  Chips,
  DefinitionList,
  Empty,
  Meter,
  Metric,
  MetricGrid,
  Note,
  Panel,
  PageHead,
  SectionHead,
  SimulatedMark,
  type Tone,
} from '@/components/ui/primitives';
import { DecisionButtons, ReopenButton } from '@/components/intelligence/DecisionButtons';

export const metadata: Metadata = { title: 'Safe Upgrade Pipeline' };

/** Everything past the founder gate. Derived so a new stage cannot be forgotten. */
const GATED_STAGES: readonly UpgradeStage[] = UPGRADE_STAGES.filter(
  (stage) => !AUTONOMOUS_STAGES.includes(stage),
);

/**
 * The Safe Upgrade Pipeline.
 *
 * This page is the product's central promise made inspectable. OmniOS discovers,
 * analyses, sandboxes, measures, compares and recommends — then it stops. Every
 * candidate is presented as a case a founder can actually judge: what would
 * change, what was tested, the numbers on both sides, what could go wrong and
 * what the system thinks, with its confidence stated rather than implied.
 *
 * The three buttons at the bottom of each case are the only route past that
 * point, and none of them applies anything. Approval records intent.
 */
export default async function UpgradePipelinePage() {
  const workspace = await getWorkspace();
  const upgrades = workspace.upgrades;

  const stageIndex = (stage: UpgradeStage): number => UPGRADE_STAGES.indexOf(stage);
  const undecided = upgrades
    .filter((candidate) => !candidate.decision)
    .sort(
      (a, b) =>
        stageIndex(b.stage) - stageIndex(a.stage) ||
        b.recommendationConfidence - a.recommendationConfidence,
    );
  const decided = upgrades
    .filter((candidate) => candidate.decision)
    .sort((a, b) => ((a.decision?.decidedAt ?? '') < (b.decision?.decidedAt ?? '') ? 1 : -1));

  const awaiting = upgrades.filter((candidate) => candidate.stage === 'awaiting-approval').length;
  const applied = upgrades.filter((candidate) => candidate.stage === 'applied').length;
  const sandboxed = upgrades.filter((candidate) => candidate.sandbox).length;

  const counts = new Map<UpgradeStage, number>();
  for (const candidate of upgrades) {
    counts.set(candidate.stage, (counts.get(candidate.stage) ?? 0) + 1);
  }

  return (
    <>
      <PageHead
        eyebrow="Systems"
        title="Safe Upgrade Pipeline"
        lede="Everything OmniOS thinks it should change about itself, presented as a case rather than a notification. Nothing here happens until you say so."
        actions={
          <Link className="btn btn--secondary" href="/intelligence">
            Where these came from
          </Link>
        }
      />

      <div className="stack" style={{ gap: 'var(--s-5)', marginBottom: 'var(--s-8)' }}>
        <Note tone="accent" icon="shield">
          <strong>Nothing on this page can apply itself.</strong> The system may reach{' '}
          <em>awaiting approval</em> on its own and no further. The only route to{' '}
          <em>applied</em> is a decision you record here, followed by a change someone makes
          deliberately — and {applied === 0 ? 'no candidate has taken it' : `${pluralise(applied, 'candidate')} has taken it`}.
        </Note>

        <section className="panel span-12">
          <header className="panel-head">
            <div className="grow">
              <h2 className="panel-title">The stages</h2>
              <p className="panel-sub">Solid stages the system reaches alone. Dashed stages need you.</p>
            </div>
          </header>
          <div className="panel-body stack">
            <div className="stage-track">
              {AUTONOMOUS_STAGES.map((stage) => (
                <StageStep key={stage} stage={stage} count={counts.get(stage) ?? 0} gated={false} />
              ))}
              <span className="stage-gate">
                Founder decision
              </span>
              {GATED_STAGES.map((stage) => (
                <StageStep key={stage} stage={stage} count={counts.get(stage) ?? 0} gated />
              ))}
            </div>

            <MetricGrid>
              <Metric
                label="In the pipeline"
                value={formatNumber(upgrades.length)}
                hint={`${pluralise(sandboxed, 'sandbox run')}`}
              />
              <Metric
                label="Awaiting your decision"
                value={formatNumber(awaiting)}
                hint={awaiting === 0 ? 'Nothing is blocked on you' : 'Blocked on you'}
              />
              <Metric label="Decided" value={formatNumber(decided.length)} hint="Recorded with reasoning" />
              <Metric
                label="Applied by the system"
                value={formatNumber(applied)}
                hint="Not reachable without you"
              />
            </MetricGrid>
          </div>
        </section>
      </div>

      <SectionHead title={`Waiting on you · ${formatNumber(undecided.length)}`} />
      {undecided.length === 0 ? (
        <Panel span={12}>
          <Empty title="Nothing is waiting for a decision">
            When the system finishes sandboxing something, the full case appears here.
          </Empty>
        </Panel>
      ) : (
        <div className="stack" style={{ gap: 'var(--s-5)' }}>
          {undecided.map((candidate) => (
            <CandidateCase key={candidate.id} candidate={candidate} />
          ))}
        </div>
      )}

      <SectionHead title={`Decided · ${formatNumber(decided.length)}`} />
      {decided.length === 0 ? (
        <Panel span={12}>
          <Empty title="No decisions recorded yet">
            Every decision you make is kept here with the reasoning you gave at the time.
          </Empty>
        </Panel>
      ) : (
        <div className="stack" style={{ gap: 'var(--s-5)' }}>
          {decided.map((candidate) => (
            <CandidateCase key={candidate.id} candidate={candidate} />
          ))}
        </div>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- stages -- */

function StageStep({
  stage,
  count,
  gated,
}: {
  stage: UpgradeStage;
  count: number;
  gated: boolean;
}) {
  return (
    <span
      className="stage-step"
      data-gated={gated ? 'true' : undefined}
      data-occupied={count > 0 ? 'true' : undefined}
    >
      <span>{humanise(stage)}</span>
      <span className="stage-step-count">{count > 0 ? formatNumber(count) : EMPTY}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ case -- */

function CandidateCase({ candidate }: { candidate: UpgradeCandidate }) {
  const { sandbox, decision } = candidate;

  return (
    <Panel
      title={candidate.title}
      subtitle={`Stage: ${humanise(candidate.stage)}`}
      span={12}
      action={
        <div className="row wrap">
          {decision ? (
            <Badge tone={decisionTone(decision.decision)}>{DECISION_LABEL[decision.decision]}</Badge>
          ) : (
            <Badge tone={candidate.stage === 'awaiting-approval' ? 'accent' : 'outline'}>
              {humanise(candidate.stage)}
            </Badge>
          )}
          {candidate.simulated ? <SimulatedMark /> : null}
        </div>
      }
      footer={
        decision
          ? `Decided by ${decision.decidedBy} · ${formatDate(decision.decidedAt)} · ${formatRelative(decision.decidedAt)}`
          : 'No decision recorded. This candidate is doing nothing to the running system.'
      }
    >
      <div className="stack" style={{ gap: 'var(--s-6)' }}>
        <DefinitionList
          items={[
            { term: 'What would change', detail: candidate.whatChanged },
            { term: 'Why it matters', detail: candidate.whyItMatters },
            { term: 'What was tested', detail: candidate.whatWasTested },
          ]}
        />

        {sandbox ? (
          <div className="stack" style={{ gap: 'var(--s-3)' }}>
            <div className="spread wrap">
              <span className="eyebrow">Sandbox · baseline against candidate</span>
              <span className="row wrap">
                <Badge tone="outline">{sandbox.harness}</Badge>
                <Badge tone="outline">{pluralise(sandbox.trials, 'trial')}</Badge>
                <Badge tone="outline">{formatDate(sandbox.ranAt)}</Badge>
                {sandbox.simulated ? <SimulatedMark label="Simulated run" /> : null}
              </span>
            </div>

            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Metric</th>
                    <th scope="col">Better when</th>
                    <th scope="col" className="num">
                      Baseline
                    </th>
                    <th scope="col" className="num">
                      Candidate
                    </th>
                    <th scope="col" className="num">
                      Change
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sandbox.metrics.map((metric) => (
                    <MetricComparison key={metric.label} metric={metric} />
                  ))}
                </tbody>
              </table>
            </div>

            {sandbox.notes.length > 0 ? (
              <ul className="stack" style={{ gap: 'var(--s-1)' }}>
                {sandbox.notes.map((note) => (
                  <li key={note} className="hint">
                    · {note}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <Note tone="warn" icon="alert">
            This candidate has not been through the sandbox. There is no baseline to compare
            against, so there is nothing here that can honestly be approved yet.
          </Note>
        )}

        <div className="two-up">
          <div className="stack" style={{ gap: 'var(--s-2)' }}>
            <span className="eyebrow">What it would buy</span>
            {candidate.benefits.length === 0 ? (
              <span className="faint">{EMPTY}</span>
            ) : (
              <ul className="stack" style={{ gap: 'var(--s-1)' }}>
                {candidate.benefits.map((benefit) => (
                  <li key={benefit} className="prose">
                    · {benefit}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="stack" style={{ gap: 'var(--s-2)' }}>
            <span className="eyebrow">What could go wrong</span>
            {candidate.risks.length === 0 ? (
              <span className="faint">{EMPTY}</span>
            ) : (
              <div className="stack" style={{ gap: 'var(--s-3)' }}>
                {candidate.risks.map((risk) => (
                  <div key={risk.label} className="stack" style={{ gap: 'var(--s-1)' }}>
                    <span className="row wrap">
                      <Badge tone={severityTone(risk.severity)}>{risk.severity}</Badge>
                      <span>{risk.label}</span>
                    </span>
                    <span className="hint">Mitigation: {risk.mitigation}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="stack" style={{ gap: 'var(--s-3)' }}>
          <div className="spread wrap">
            <span className="eyebrow">What OmniOS recommends</span>
            <span className="hint">
              Confidence {formatPercent(candidate.recommendationConfidence * 100, 0)}
            </span>
          </div>
          <p className="prose">{candidate.recommendation}</p>
          <Meter
            value={candidate.recommendationConfidence}
            tone={confidenceTone(candidate.recommendationConfidence)}
            label={`Recommendation confidence ${Math.round(candidate.recommendationConfidence * 100)} percent`}
          />
          {candidate.recommendationConfidence < 0.7 ? (
            <span className="hint">
              Below the point where the system would argue its own case. Read the numbers rather
              than the sentence.
            </span>
          ) : null}
        </div>

        {decision ? (
          <div className="stack" style={{ gap: 'var(--s-3)' }}>
            <span className="eyebrow">Your decision</span>
            <div className="row wrap">
              <Badge tone={decisionTone(decision.decision)}>{DECISION_LABEL[decision.decision]}</Badge>
              <Chips items={[decision.decidedBy, formatDate(decision.decidedAt)]} />
            </div>
            <p className="prose">{decision.note ?? EMPTY}</p>
            <ReopenButton candidateId={candidate.id} />
          </div>
        ) : (
          <div className="stack" style={{ gap: 'var(--s-3)' }}>
            <span className="eyebrow">Your decision</span>
            <DecisionButtons candidateId={candidate.id} />
          </div>
        )}
      </div>
    </Panel>
  );
}

/* --------------------------------------------------------------- metrics -- */

function MetricComparison({ metric }: { metric: SandboxMetric }) {
  const change = metric.candidate - metric.baseline;
  // `betterWhen` is the only thing that makes a direction good or bad — a fall in
  // latency and a fall in success rate are the same arithmetic and opposite news.
  const improved = metric.betterWhen === 'higher' ? change > 0 : change < 0;
  const tone = change === 0 ? 'flat' : improved ? 'good' : 'bad';
  const decimals = Number.isInteger(change) ? 0 : 1;
  const relative =
    metric.baseline === 0 ? null : (change / Math.abs(metric.baseline)) * 100;

  return (
    <tr>
      <td>{metric.label}</td>
      <td className="faint">{metric.betterWhen}</td>
      <td className="num">
        {formatNumber(metric.baseline, Number.isInteger(metric.baseline) ? 0 : 1)} {metric.unit}
      </td>
      <td className="num">
        {formatNumber(metric.candidate, Number.isInteger(metric.candidate) ? 0 : 1)} {metric.unit}
      </td>
      <td className={`num delta--${tone}`}>
        {change === 0
          ? 'no change'
          : `${change > 0 ? '+' : '−'}${formatNumber(Math.abs(change), decimals)} ${metric.unit}`}
        {relative === null || change === 0 ? null : (
          <span className="faint"> ({formatPercent(Math.abs(relative), relative % 1 === 0 ? 0 : 1)})</span>
        )}
      </td>
    </tr>
  );
}

/* ----------------------------------------------------------------- tones -- */

function severityTone(severity: Severity): Tone {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'deny';
    case 'medium':
      return 'warn';
    default:
      return 'outline';
  }
}

/** Past tense, because by the time it renders it is a record of something done. */
const DECISION_LABEL: Record<UpgradeDecisionKind, string> = {
  approve: 'Approved',
  reject: 'Rejected',
  'test-longer': 'Testing longer',
};

function decisionTone(decision: UpgradeDecisionKind): Tone {
  switch (decision) {
    case 'approve':
      return 'ok';
    case 'reject':
      return 'deny';
    default:
      return 'warn';
  }
}

function confidenceTone(value: number): 'ok' | 'warn' | 'deny' {
  if (value >= 0.8) return 'ok';
  if (value >= 0.6) return 'warn';
  return 'deny';
}

function humanise(value: string): string {
  return titleCase(value.replace(/-/g, ' '));
}
