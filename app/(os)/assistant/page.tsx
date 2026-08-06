import type { Metadata } from 'next';
import Link from 'next/link';

import { conversation } from '@/lib/ai/assistant';
import { activeProvider } from '@/lib/ai/providers';
import { ASSISTANT_SUGGESTIONS } from '@/lib/ai/prompts';
import { SPECIALISTS, getSpecialist } from '@/lib/ai/specialists';
import { getCapability } from '@/lib/capabilities/registry';
import { getWorkspace } from '@/lib/data/store';
import type { AssistantMessage, Company, DelegationPlan, DelegationStep } from '@/lib/domain';
import { EMPTY, formatNumber, formatPercent, formatRelative, pluralise } from '@/lib/format';
import {
  Badge,
  Empty,
  Meter,
  Metric,
  MetricGrid,
  Note,
  PageHead,
  Panel,
  SectionHead,
  SimulatedMark,
  type Tone,
} from '@/components/ui/primitives';
import { Composer } from '@/components/assistant/Composer';

export const metadata: Metadata = { title: 'Assistant' };

/**
 * Founder mode, full page.
 *
 * The sidebar copilot keeps its delegation plans collapsed because it sits beside
 * work in progress. This page is the opposite: it exists to be read after the
 * fact, so every plan opens by default and every answer carries who was
 * consulted, how confident the router was, which records were used, and whether
 * a model wrote the sentences or this machine did.
 */
export default async function AssistantPage() {
  const [workspace, messages] = await Promise.all([getWorkspace(), conversation({ kind: 'founder' })]);
  const provider = activeProvider();

  const answers = messages.filter((message) => message.role === 'assistant');
  const plans = answers.flatMap((message) => (message.plan ? [message.plan] : []));
  const steps = plans.flatMap((plan) => plan.steps);
  const consulted = countBy(steps.map((step) => step.specialistId));
  const evidence = new Set(plans.flatMap((plan) => plan.contextUsed.map((ref) => ref.id)));
  const locallyReasoned = answers.filter((message) => message.simulated).length;
  const awaitingApproval = plans.filter((plan) => plan.requiresApproval).length;
  const latest = messages[messages.length - 1];

  const meanConfidence =
    steps.length === 0 ? null : steps.reduce((sum, step) => sum + step.confidence, 0) / steps.length;

  return (
    <>
      <PageHead
        eyebrow="OS"
        title={workspace.settings.assistantName}
        lede="One assistant, reading every space you own because you are the one asking. Each answer keeps the plan that produced it: which specialists were consulted, how sure the router was, and exactly which of your records were read."
        actions={
          <>
            <Badge tone={provider.simulated ? 'outline' : 'accent'}>{provider.label}</Badge>
            <Link className="btn btn--secondary" href="/brain">
              Memory & roster
            </Link>
          </>
        }
      />

      <section className="panel" style={{ marginBottom: 'var(--s-8)' }}>
        <div className="panel-body">
          <MetricGrid>
            <Metric label="Answers" value={formatNumber(answers.length)} hint={pluralise(messages.length, 'turn')} />
            <Metric
              label="Specialists consulted"
              value={formatNumber(consulted.size)}
              hint={`of ${SPECIALISTS.length} on the roster`}
            />
            <Metric
              label="Records used as evidence"
              value={formatNumber(evidence.size)}
              hint="Distinct, across every answer"
            />
            <Metric
              label="Mean routing confidence"
              value={meanConfidence === null ? EMPTY : formatPercent(meanConfidence * 100)}
              hint="The router's, not the answer's"
            />
            <Metric
              label="Reasoned locally"
              value={`${formatNumber(locallyReasoned)}/${formatNumber(answers.length)}`}
              hint={provider.simulated ? 'No model configured' : `${provider.label} available`}
            />
            <Metric
              label="Last exchange"
              value={latest ? formatRelative(latest.at) : EMPTY}
              hint={awaitingApproval > 0 ? `${pluralise(awaitingApproval, 'plan')} needed approval` : 'No approvals pending'}
            />
          </MetricGrid>
        </div>
      </section>

      <div className="grid">
        <div className="stack span-8" style={{ gap: 'var(--s-5)' }}>
          <Panel
            title="Conversation"
            subtitle="Founder mode — every space you own, aggregated for your own question"
            footer="Stored in your personal scope. No company headquarters can read this thread."
          >
            {messages.length === 0 ? (
              <Empty title="Nothing asked yet">
                Ask something below. The first answer will arrive with its delegation plan already
                open.
              </Empty>
            ) : (
              <div className="stack" style={{ gap: 'var(--s-5)' }}>
                {messages.map((message) => (
                  <Turn key={message.id} message={message} companies={workspace.companies} personalName={workspace.personal.displayName} />
                ))}
              </div>
            )}
          </Panel>

          <Panel title={`Ask ${workspace.settings.assistantName}`}>
            <Composer
              assistantName={workspace.settings.assistantName}
              suggestions={ASSISTANT_SUGGESTIONS}
            />
          </Panel>
        </div>

        <div className="stack span-4" style={{ gap: 'var(--s-5)' }}>
          <Panel title="Where the words come from">
            <div className="stack" style={{ gap: 'var(--s-3)' }}>
              <div className="row wrap">
                <Badge tone={provider.simulated ? 'outline' : 'accent'}>{provider.label}</Badge>
                {provider.simulated ? <SimulatedMark label="No model called" /> : null}
              </div>
              {provider.simulated ? (
                <>
                  <p className="prose">
                    No language model is configured, so nothing on this page was written by one.
                    Every answer above was composed on this machine by reading your records
                    directly — the numbers are computed, the sentences are assembled from templates,
                    and no request left the process.
                  </p>
                  <p className="prose">
                    Setting <span className="mono">ANTHROPIC_API_KEY</span> changes only the wording
                    step. The analysis stays here.
                  </p>
                </>
              ) : (
                <>
                  <p className="prose">
                    Answers are grounded here first: OmniOS computes the analysis from your records,
                    then hands that analysis to {provider.label} to phrase. Figures are never invented
                    by the model because the model is not asked to find them.
                  </p>
                  <p className="prose">
                    That does mean your question and the computed analysis leave this machine. Turns
                    marked as locally reasoned did not — they were produced here after a provider
                    call failed or was skipped.
                  </p>
                </>
              )}
            </div>
          </Panel>

          <Panel
            title="Specialists consulted"
            subtitle="Across this whole thread"
            flush
            footer="Chosen by the router from your wording. There is no agent picker anywhere in OmniOS."
          >
            {consulted.size === 0 ? (
              <Empty title="No delegations yet" />
            ) : (
              <div className="list">
                {[...consulted.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([specialistId, count]) => {
                    const specialist = getSpecialist(specialistId);
                    return (
                      <div key={specialistId} className="list-row">
                        <div className="grow">
                          <div className="list-primary truncate">{specialist?.name ?? specialistId}</div>
                          <div className="list-secondary">{specialist?.role ?? 'Unknown specialist'}</div>
                        </div>
                        <div className="list-meta">{pluralise(count, 'step')}</div>
                      </div>
                    );
                  })}
              </div>
            )}
          </Panel>

          <Panel title="What it will not do">
            <ul className="stack" style={{ gap: 'var(--s-2)' }}>
              {[
                'Act outside OmniOS. Any step that would touch the outside world is marked and stops for approval.',
                'Read one company while answering inside another. Founder mode aggregates only because you asked at OS level.',
                'Invent a figure. If a number is not in your records, the answer says it is unknown.',
                'Promote anything into shared memory on its own.',
              ].map((line) => (
                <li key={line} className="hint">
                  · {line}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      {plans.length > 0 ? (
        <>
          <SectionHead title="Reading a delegation plan" />
          <Note icon="assistant">
            A plan is not a log of what an agent did — nothing external has run. It records which
            specialists the router selected for your sentence, what each was asked to contribute, how
            confident the selection was, and which of your records were read to answer. Steps marked
            as needing approval are the ones that would leave this system if execution were wired up.
          </Note>
        </>
      ) : null}
    </>
  );
}

/* ----------------------------------------------------------------- turn --- */

function Turn({
  message,
  companies,
  personalName,
}: {
  message: AssistantMessage;
  companies: readonly Company[];
  personalName: string;
}) {
  if (message.role === 'founder') {
    return (
      <div className="msg msg--founder">
        <div className="msg-body">{message.text}</div>
        <span className="msg-meta">You · {formatRelative(message.at)}</span>
      </div>
    );
  }

  return (
    <div className="msg msg--assistant">
      <div className="msg-body">{message.text}</div>
      <div className="msg-meta">
        <span>{formatRelative(message.at)}</span>
        <span aria-hidden="true">·</span>
        <span>{message.providerId}</span>
        {message.simulated ? <SimulatedMark label="Reasoned locally" /> : null}
      </div>
      {message.plan ? (
        <PlanDetail plan={message.plan} companies={companies} personalName={personalName} />
      ) : null}
    </div>
  );
}

/**
 * Open by default. On the sidebar this is a disclosure the founder may ignore;
 * here it is the reason the page exists, and hiding it behind a click would make
 * auditing an answer a deliberate act rather than the default reading.
 */
function PlanDetail({
  plan,
  companies,
  personalName,
}: {
  plan: DelegationPlan;
  companies: readonly Company[];
  personalName: string;
}) {
  return (
    <details className="plan" open>
      <summary>{plan.summary}</summary>
      <div className="plan-body">
        {plan.steps.map((step) => (
          <PlanStep key={step.id} step={step} />
        ))}

        <div className="plan-step">
          <div className="grow stack" style={{ gap: 'var(--s-2)' }}>
            <div className="plan-step-name">
              Evidence used · {pluralise(plan.contextUsed.length, 'record')}
            </div>
            {plan.contextUsed.length === 0 ? (
              <div className="faint">
                {EMPTY} nothing in your records matched this question closely enough to cite.
              </div>
            ) : (
              <ul className="stack" style={{ gap: 'var(--s-1)' }}>
                {plan.contextUsed.map((reference) => (
                  <li key={`${reference.kind}:${reference.id}`} className="faint">
                    · {reference.label}{' '}
                    <span className="mono">
                      [{reference.kind} · {scopeLabel(reference.scopeKey, companies, personalName)}]
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {plan.requiresApproval ? (
          <p className="note note--warn">{plan.approvalReason}</p>
        ) : null}
      </div>
    </details>
  );
}

function PlanStep({ step }: { step: DelegationStep }) {
  const specialist = getSpecialist(step.specialistId);
  return (
    <div className="plan-step">
      {/* The same fixed numeric column the discovery feed uses, so confidences
          across a plan line up as digits rather than drifting with name length. */}
      <div className="intel-score">
        <span className="intel-score-value">{formatPercent(step.confidence * 100)}</span>
        <Meter
          value={step.confidence}
          tone={step.confidence >= 0.6 ? 'ok' : 'warn'}
          label={`Routing confidence ${Math.round(step.confidence * 100)} out of 100`}
        />
      </div>

      <div className="grow stack" style={{ gap: 'var(--s-2)' }}>
        <div className="row wrap">
          <span className="plan-step-name">{specialist?.name ?? step.specialistId}</span>
          <Badge tone={statusTone(step.status)}>{step.status.replace(/-/g, ' ')}</Badge>
        </div>
        <div>{step.objective}</div>
        {step.output ? <div className="faint">{step.output}</div> : null}
        {specialist ? (
          <div className="faint">
            {specialist.role} · covers{' '}
            {specialist.capabilityIds
              .map((id) => getCapability(id)?.name ?? id)
              .join(', ')}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function statusTone(status: DelegationStep['status']): Tone {
  switch (status) {
    case 'needs-approval':
      return 'warn';
    case 'done':
      return 'ok';
    case 'skipped':
      return 'outline';
    default:
      return 'info';
  }
}

/* ---------------------------------------------------------------- utils --- */

function countBy(ids: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

/** A scope key is storage detail; the founder needs the name of the space. */
function scopeLabel(key: string, companies: readonly Company[], personalName: string): string {
  if (key === 'personal') return personalName;
  if (key.startsWith('company:')) {
    const id = key.slice('company:'.length);
    return companies.find((company) => company.id === id)?.name ?? id;
  }
  if (key.startsWith('shared:')) {
    const id = key.slice('shared:'.length);
    return `shared · ${getCapability(id)?.name ?? id}`;
  }
  return key;
}
