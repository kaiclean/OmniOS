import type { Metadata } from 'next';
import Link from 'next/link';

import { getWorkspace } from '@/lib/data/store';
import { CURRENCIES } from '@/lib/domain';
import type { CurrencyCode, LearningReport, ReportBullet, ReportSection } from '@/lib/domain';
import {
  EMPTY,
  formatDateLong,
  formatDurationMinutes,
  formatMinorAmount,
  formatNumber,
  formatRelative,
  pluralise,
  titleCase,
} from '@/lib/format';
import {
  Badge,
  Empty,
  Metric,
  MetricGrid,
  Note,
  Panel,
  PageHead,
  SectionHead,
  SimulatedMark,
} from '@/components/ui/primitives';
import { MarkReadButton } from '@/components/intelligence/MarkReadButton';
import { ReportControls } from '@/components/intelligence/ReportControls';

export const metadata: Metadata = { title: 'Learning Reports' };

/**
 * Learning Reports.
 *
 * The one place OmniOS talks about itself. A report is not a changelog: it says
 * what was learned, what is waiting on the founder, and what it cost or saved —
 * and it separates the bullets that should change a decision from the ones that
 * are there so the first kind can be trusted.
 */
export default async function LearningReportsPage() {
  const workspace = await getWorkspace();
  const settings = workspace.settings.reportSettings;

  const reports = [...workspace.reports].sort((a, b) => {
    if (a.periodEnd !== b.periodEnd) return a.periodEnd < b.periodEnd ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });

  const unread = reports.filter((report) => !report.read).length;
  const minutesSaved = reports.reduce((total, report) => total + report.minutesSaved, 0);

  // Reports carry their own currency, so a workspace that has traded in two
  // currencies must not be shown one summed number pretending otherwise.
  const savedByCurrency = new Map<string, number>();
  for (const report of reports) {
    savedByCurrency.set(
      report.currency,
      (savedByCurrency.get(report.currency) ?? 0) + report.moneySavedMinor,
    );
  }
  const moneySaved =
    savedByCurrency.size === 0
      ? EMPTY
      : [...savedByCurrency.entries()]
          .map(([currency, amount]) => formatMinorAmount(amount, toCurrency(currency), { compact: true }))
          .join(' · ');

  const latest = reports[0];

  return (
    <>
      <PageHead
        eyebrow="Systems"
        title="Learning Reports"
        lede="What OmniOS learned, what it did with it, and what is still sitting with you. Written on a cadence you choose, from records you can open."
        actions={
          <>
            <Link className="btn btn--secondary" href="/intelligence">
              Intelligence Center
            </Link>
            <Link className="btn btn--secondary" href="/intelligence/upgrades">
              Upgrade pipeline
            </Link>
          </>
        }
      />

      <div className="grid" style={{ marginBottom: 'var(--s-8)' }}>
        <Panel span={8} title="Across every report">
          <MetricGrid>
            <Metric
              label="Reports"
              value={formatNumber(reports.length)}
              hint={latest ? `Latest ${formatRelative(latest.periodEnd)}` : undefined}
            />
            <Metric
              label="Unread"
              value={formatNumber(unread)}
              hint={unread === 0 ? 'All caught up' : 'Waiting to be read'}
            />
            <Metric
              label="Time saved"
              value={reports.length === 0 ? EMPTY : formatDurationMinutes(minutesSaved)}
              hint="Claimed by automation runs"
            />
            <Metric
              label="Money saved"
              value={moneySaved}
              hint={savedByCurrency.size > 1 ? 'Kept per currency' : 'Avoided spend'}
            />
          </MetricGrid>
          <div className="divider" />
          <Note icon="file">
            Both figures are OmniOS&apos;s own arithmetic over automation runs and finance records
            in this workspace. They are an estimate of what did not have to happen, not a measured
            saving, and they carry the generated mark wherever they appear.
          </Note>
        </Panel>

        <Panel span={4} title="Cadence" subtitle="Applies to the next report OmniOS writes">
          <ReportControls cadence={settings.cadence} />
          <div className="divider" />
          <div className="row wrap">
            {settings.includeHealth ? <Badge tone="outline">Health</Badge> : null}
            {settings.includeFinance ? <Badge tone="outline">Finance</Badge> : null}
            {settings.includeEcosystem ? <Badge tone="outline">Ecosystem</Badge> : null}
            <Badge tone="outline">{pluralise(settings.maxBullets, 'bullet')} max</Badge>
          </div>
        </Panel>
      </div>

      <SectionHead title={`Reports · ${formatNumber(reports.length)}`} />

      {reports.length === 0 ? (
        <Panel span={12}>
          <Empty title="No reports yet">
            Set a cadence above, or write one now from the records as they stand.
          </Empty>
        </Panel>
      ) : (
        <div className="stack" style={{ gap: 'var(--s-5)' }}>
          {reports.map((report) => (
            <ReportCard key={report.id} report={report} />
          ))}
        </div>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- report -- */

function ReportCard({ report }: { report: LearningReport }) {
  return (
    <Panel
      title={`${titleCase(report.cadence.replace(/-/g, ' '))} report`}
      subtitle={`${formatDateLong(report.periodStart)} → ${formatDateLong(report.periodEnd)}`}
      span={12}
      action={
        <div className="row wrap">
          {report.read ? (
            <Badge tone="outline">Read</Badge>
          ) : (
            <Badge tone="accent" dot>
              Unread
            </Badge>
          )}
          {report.simulated ? <SimulatedMark /> : null}
          <MarkReadButton reportId={report.id} read={report.read} />
        </div>
      }
      footer={`Written ${formatRelative(report.createdAt)} by OmniOS from this workspace's records.`}
    >
      <div className="stack" style={{ gap: 'var(--s-6)' }}>
        <p className="prose">
          <strong>{report.headline}</strong>
        </p>

        <MetricGrid>
          <Metric
            label="Time saved this period"
            value={formatDurationMinutes(report.minutesSaved)}
            hint="Automation runs × minutes per run"
          />
          <Metric
            label="Money saved this period"
            value={formatMinorAmount(report.moneySavedMinor, toCurrency(report.currency))}
            hint="Estimated, not invoiced"
          />
        </MetricGrid>

        {report.sections.length === 0 ? (
          <Empty title="This report has no sections" />
        ) : (
          <div className="stack" style={{ gap: 'var(--s-5)' }}>
            {report.sections.map((section) => (
              <ReportSectionBlock key={section.heading} section={section} />
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

function ReportSectionBlock({ section }: { section: ReportSection }) {
  return (
    <section className="stack" style={{ gap: 'var(--s-2)' }}>
      <h3 className="eyebrow">{section.heading}</h3>
      {section.bullets.length === 0 ? (
        <span className="faint">{EMPTY}</span>
      ) : (
        <ul>
          {section.bullets.map((bullet) => (
            <Bullet key={bullet.text} bullet={bullet} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Signal and context are not styled the same, and that is the point. A report
 * where the caveat looks as loud as the finding is a report nobody can skim.
 */
function Bullet({ bullet }: { bullet: ReportBullet }) {
  const className = bullet.weight === 'signal' ? 'bullet' : 'bullet bullet--context';
  return (
    <li className={className}>
      {bullet.href ? (
        <Link href={bullet.href} className="grow">
          {bullet.text}
        </Link>
      ) : (
        <span className="grow">{bullet.text}</span>
      )}
    </li>
  );
}

/**
 * Reports store their currency as a plain string, so a file written by an older
 * build cannot be trusted to hold a code the formatter knows. Fall back rather
 * than throw — a report is still worth reading with its currency label wrong.
 */
function toCurrency(value: string): CurrencyCode {
  return (CURRENCIES as readonly string[]).includes(value) ? (value as CurrencyCode) : 'CHF';
}
