import type { Metadata } from 'next';
import Link from 'next/link';

import type { ProductPlanSection } from '@/lib/domain';
import { PRODUCT_PLAN_SECTIONS } from '@/lib/domain';
import { loadSpaces, acrossSpaces } from '@/lib/data/aggregate';
import { specialistName } from '@/lib/ai/specialists';
import { formatDateLong, pluralise } from '@/lib/format';
import {
  Badge,
  DefinitionList,
  Empty,
  ListRow,
  Metric,
  MetricGrid,
  Note,
  PageHead,
  Panel,
  SectionHead,
  SimulatedMark,
} from '@/components/ui/primitives';
import { ProductIdeaForm } from '@/components/creative/ProductIdeaForm';

export const metadata: Metadata = { title: 'AI Product Factory' };

/** Section keys are terse for storage; these are what a founder should read. */
const SECTION_LABEL: Record<ProductPlanSection, string> = {
  requirements: 'Requirements',
  ux: 'UX',
  ui: 'UI',
  backend: 'Backend',
  frontend: 'Frontend',
  database: 'Database',
  api: 'API',
  documentation: 'Documentation',
  testing: 'Testing',
  deployment: 'Deployment',
  marketing: 'Marketing',
  launch: 'Launch',
};

const SECTION_ORDER = new Map(PRODUCT_PLAN_SECTIONS.map((section, index) => [section, index]));

const STATUS_TONE = {
  drafting: 'outline',
  planned: 'info',
  building: 'accent',
  launched: 'ok',
  parked: 'neutral',
} as const;

/**
 * The AI Product Factory.
 *
 * An idea, a problem, an audience and a space go in; a twelve-section
 * specification comes out, stored in that space as a real record. The plan is
 * generated locally and deterministically — no model is called — which is both
 * its honest limitation and the reason it is reproducible.
 *
 * The selected spec is a query parameter rather than client state, so the whole
 * page stays a Server Component and a plan is a link a founder can send.
 */
export default async function FactoryPage({
  searchParams,
}: {
  searchParams: Promise<{ spec?: string; space?: string }>;
}) {
  const { spec: specId, space } = await searchParams;
  const spaces = await loadSpaces();

  const specs = acrossSpaces(spaces, 'products').sort((a, b) =>
    a.item.createdAt < b.item.createdAt ? 1 : -1,
  );
  const selected = specs.find((entry) => entry.item.id === specId);

  const options = spaces.map((candidate) => ({ key: candidate.scopeKey, label: candidate.label }));
  // Plan into the space you are already reading a plan from — that is almost
  // always the intent, and it survives the redirect after a create.
  const defaultScopeKey =
    selected?.space.scopeKey ??
    spaces.find((candidate) => candidate.scopeKey === space)?.scopeKey ??
    options[0]?.key ??
    '';

  const openQuestionCount = specs.reduce((sum, entry) => sum + entry.item.openQuestions.length, 0);

  return (
    <>
      <PageHead
        eyebrow="Every space"
        title="AI Product Factory"
        lede="Describe an idea in four sentences. OmniOS expands it into a full specification — requirements through launch — attributed section by section to the specialist that would own it, and honest about what it could not know."
        actions={<SimulatedMark label="Generated plan" />}
      />

      <div className="grid">
        <Panel
          title="Describe it once"
          span={6}
          subtitle="Four answers. The plan is written into the space you choose."
        >
          {options.length === 0 ? (
            <Empty title="No spaces yet">A specification has to live somewhere.</Empty>
          ) : (
            <ProductIdeaForm spaces={options} defaultScopeKey={defaultScopeKey} />
          )}
        </Panel>

        <Panel title="How this plan is produced" span={6}>
          <DefinitionList
            items={[
              {
                term: 'Deterministic, not generative',
                detail:
                  'The same four answers always produce the same plan, on any machine. It is your input expanded against a fixed body of product practice — there is no model call and no network request.',
              },
              {
                term: 'Twelve sections, always',
                detail:
                  'Requirements, UX, UI, backend, frontend, database, API, documentation, testing, deployment, marketing and launch. Coverage is enforced in the type system, so a plan cannot quietly skip the boring half.',
              },
              {
                term: 'Attributed',
                detail:
                  'Every section names the specialist that would own it. Those are real entries in the roster the assistant delegates to, not decoration.',
              },
              {
                term: 'It admits what it does not know',
                detail:
                  'Every plan ends in open questions, including the fact that all of it was expanded from four sentences and has not met a user. A plan that sounds certain about pricing, volume and regulation would be lying.',
              },
            ]}
          />
        </Panel>
      </div>

      <SectionHead title="Specifications" />
      <div className="grid">
        <Panel
          title="Across every space"
          span={12}
          subtitle={`${pluralise(specs.length, 'specification')} · ${pluralise(openQuestionCount, 'open question')}`}
          flush
        >
          {specs.length === 0 ? (
            <Empty title="Nothing planned yet">
              The first plan takes about a minute to describe and produces roughly sixty specific
              decisions to argue with.
            </Empty>
          ) : (
            <div className="list">
              {specs.map(({ item, space: home }) => (
                <ListRow
                  key={item.id}
                  primary={
                    <Link href={`/factory?spec=${encodeURIComponent(item.id)}`}>{item.name}</Link>
                  }
                  secondary={item.problem}
                  meta={`${home.label} · ${item.blocks.length}/${PRODUCT_PLAN_SECTIONS.length} sections`}
                  trailing={
                    <span className="row" style={{ gap: 'var(--s-2)' }}>
                      {item.id === specId ? <Badge tone="accent">open</Badge> : null}
                      <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
                    </span>
                  }
                />
              ))}
            </div>
          )}
        </Panel>
      </div>

      {selected ? <SpecDetail entry={selected} /> : null}
    </>
  );
}

function SpecDetail({
  entry,
}: {
  entry: ReturnType<typeof acrossSpaces<'products'>>[number];
}) {
  const spec = entry.item;
  const blocks = [...spec.blocks].sort(
    (a, b) => (SECTION_ORDER.get(a.section) ?? 99) - (SECTION_ORDER.get(b.section) ?? 99),
  );
  const missing = PRODUCT_PLAN_SECTIONS.filter(
    (section) => !spec.blocks.some((block) => block.section === section),
  );
  const bulletCount = spec.blocks.reduce((sum, block) => sum + block.bullets.length, 0);

  return (
    <>
      <SectionHead
        title={spec.name}
        action={spec.simulated ? <SimulatedMark label="Generated plan" /> : undefined}
      />

      <div className="grid">
        <Panel
          title="What you asked for"
          span={12}
          subtitle={`${entry.space.label} · planned ${formatDateLong(spec.createdAt)}`}
          action={<Badge tone={STATUS_TONE[spec.status]}>{spec.status}</Badge>}
        >
          <div className="stack">
            <DefinitionList
              items={[
                { term: 'Idea', detail: spec.idea },
                { term: 'Problem it removes', detail: spec.problem },
                { term: 'Who it is for', detail: spec.audience },
              ]}
            />
            <MetricGrid>
              <Metric
                label="Sections"
                value={`${spec.blocks.length}/${PRODUCT_PLAN_SECTIONS.length}`}
                hint="Requirements through launch"
              />
              <Metric label="Decisions" value={String(bulletCount)} hint="Specific enough to argue with" />
              <Metric
                label="Open questions"
                value={String(spec.openQuestions.length)}
                hint="What the plan could not know"
              />
            </MetricGrid>
            {missing.length > 0 ? (
              <Note tone="warn" icon="alert">
                This specification predates the current section set and is missing{' '}
                {missing.map((section) => SECTION_LABEL[section]).join(', ')}. Re-plan the idea to
                fill them in.
              </Note>
            ) : null}
          </div>
        </Panel>

        {blocks.map((block) => (
          <Panel
            key={block.section}
            title={block.heading}
            span={4}
            subtitle={`${String((SECTION_ORDER.get(block.section) ?? 0) + 1).padStart(2, '0')} · ${SECTION_LABEL[block.section]}`}
            action={<Badge tone="outline">{specialistName(block.specialistId)}</Badge>}
          >
            <ul className="list-secondary stack" style={{ gap: 'var(--s-2)' }}>
              {block.bullets.map((bullet) => (
                <li key={bullet}>· {bullet}</li>
              ))}
            </ul>
          </Panel>
        ))}

        <Panel
          title="What this plan does not know"
          span={12}
          subtitle="Answer these before treating anything above as a decision."
          flush
          footer={
            <span>
              Generated from three sentences and a space. None of it has been tested against a real
              user, a real price or a real dataset.
            </span>
          }
        >
          {spec.openQuestions.length === 0 ? (
            <Empty title="No open questions recorded">
              A plan with nothing unresolved has usually stopped looking.
            </Empty>
          ) : (
            <div className="list">
              {spec.openQuestions.map((question) => (
                <ListRow key={question} primary={question} />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
