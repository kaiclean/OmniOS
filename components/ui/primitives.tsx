/**
 * UI primitives.
 *
 * Server components by default — none of these hold state. Anything interactive
 * lives in components/shell/ and is explicitly marked `'use client'`, so the
 * client bundle stays small and it is obvious at a glance which parts of the
 * interface actually need JavaScript.
 */

import type { ReactNode } from 'react';

import { Icon, type IconName } from './Icon';
import type { PanelSpan } from '@/lib/capabilities/panels';
import { EMPTY, deltaOf, formatKpiValue, formatRelative } from '@/lib/format';
import type { Kpi } from '@/lib/domain';

/* ---------------------------------------------------------------- panel --- */

export function Panel({
  title,
  subtitle,
  span = 12,
  action,
  footer,
  flush,
  children,
}: {
  title?: string;
  subtitle?: string;
  span?: PanelSpan;
  action?: ReactNode;
  footer?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`panel span-${span}`}>
      {title ? (
        <header className="panel-head">
          <div className="grow">
            <h2 className="panel-title">{title}</h2>
            {subtitle ? <p className="panel-sub">{subtitle}</p> : null}
          </div>
          {action}
        </header>
      ) : null}
      <div className={flush ? 'panel-body panel-body--flush' : 'panel-body'}>{children}</div>
      {footer ? <footer className="panel-foot">{footer}</footer> : null}
    </section>
  );
}

export function PageHead({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="page-title">{title}</h1>
        {lede ? <p className="page-lede">{lede}</p> : null}
      </div>
      {actions ? <div className="row wrap">{actions}</div> : null}
    </header>
  );
}

export function SectionHead({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="section-head">
      <h2 className="section-title">{title}</h2>
      {action}
    </div>
  );
}

/* ---------------------------------------------------------------- badge --- */

export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'deny' | 'info' | 'outline';

export function Badge({
  tone = 'neutral',
  dot,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
}) {
  const cls = tone === 'neutral' ? 'badge' : `badge badge--${tone}`;
  return (
    <span className={cls}>
      {dot ? <span className="dot" /> : null}
      {children}
    </span>
  );
}

/**
 * The honesty mark. Applied to anything OmniOS generated rather than observed.
 * It is deliberately quiet and deliberately unavoidable.
 */
export function SimulatedMark({ label = 'Generated' }: { label?: string }) {
  return (
    <span className="sim-mark" title="Produced by OmniOS from your records — not an external measurement.">
      {label}
    </span>
  );
}

/* --------------------------------------------------------------- metric --- */

/**
 * The rail: a hairline history under a metric. Achromatic on purpose — the room
 * carries the space tint, the numbers never do.
 */
export function Spark({
  series,
  target,
  tone = 'flat',
  height = 24,
}: {
  series: readonly number[];
  target?: number;
  tone?: 'good' | 'bad' | 'flat';
  height?: number;
}) {
  if (series.length < 2) return null;

  const width = 100;
  const values = [...series, ...(target === undefined ? [] : [target])];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 2;
  const usable = height - pad * 2;

  const x = (i: number) => (i / (series.length - 1)) * width;
  const y = (v: number) => pad + (1 - (v - min) / range) * usable;

  const path = series.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)} ${y(v).toFixed(2)}`).join(' ');
  const lastValue = series[series.length - 1] as number;
  const tipClass = tone === 'flat' ? 'rail-spark-tip' : `rail-spark-tip rail-spark-tip--${tone}`;

  return (
    <svg
      className="rail-spark"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {target === undefined ? null : (
        <line className="rail-spark-target" x1="0" x2={width} y1={y(target)} y2={y(target)} />
      )}
      <path d={path} />
      <circle className={tipClass} cx={x(series.length - 1)} cy={y(lastValue)} r="1.8" />
    </svg>
  );
}

export function Metric({
  label,
  value,
  delta,
  series,
  target,
  hint,
}: {
  label: string;
  value: string;
  delta?: { text: string; tone: 'good' | 'bad' | 'flat' };
  series?: readonly number[];
  target?: number;
  hint?: string;
}) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
      {series && series.length > 1 ? (
        <Spark series={series} target={target} tone={delta?.tone ?? 'flat'} />
      ) : null}
      <div className="metric-foot">
        <span>{hint ?? ''}</span>
        {delta ? <span className={`delta--${delta.tone}`}>{delta.text}</span> : null}
      </div>
    </div>
  );
}

/** A KPI record rendered as a metric tile — the one place KPI formatting lives. */
export function KpiTile({ kpi }: { kpi: Kpi }) {
  const delta = deltaOf(kpi);
  const hint =
    kpi.target === undefined
      ? kpi.period
      : `Target ${formatKpiValue({ value: kpi.target, format: kpi.format, currency: kpi.currency })}`;
  return (
    <Metric
      label={kpi.label}
      value={formatKpiValue(kpi)}
      delta={delta}
      series={kpi.series}
      target={kpi.target}
      hint={hint}
    />
  );
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="metric-grid">{children}</div>;
}

/* ---------------------------------------------------------------- meter --- */

export function Meter({
  value,
  tone,
  label,
}: {
  /** 0..1 */
  value: number;
  tone?: 'ok' | 'warn' | 'deny';
  label?: string;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      role="meter"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? 'Progress'}
      className="meter"
    >
      <div
        className={tone ? `meter-fill meter-fill--${tone}` : 'meter-fill'}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- lists --- */

export function ListRow({
  primary,
  secondary,
  meta,
  done,
  trailing,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
  meta?: ReactNode;
  done?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <div className="list-row" data-done={done ? 'true' : undefined}>
      <div className="grow">
        <div className="list-primary truncate">{primary}</div>
        {secondary ? <div className="list-secondary">{secondary}</div> : null}
      </div>
      {meta ? <div className="list-meta">{meta}</div> : null}
      {trailing}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-title">{title}</span>
      {children ? <span>{children}</span> : null}
    </div>
  );
}

/* ----------------------------------------------------------------- misc --- */

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="stack" style={{ gap: 'var(--s-1)' }}>
      <span className="eyebrow">{label}</span>
      <span>{value || EMPTY}</span>
    </div>
  );
}

export function DefinitionList({ items }: { items: ReadonlyArray<{ term: string; detail: ReactNode }> }) {
  return (
    <dl className="stack">
      {items.map((item) => (
        <div key={item.term} className="stack" style={{ gap: 'var(--s-1)' }}>
          <dt className="eyebrow">{item.term}</dt>
          <dd className="prose">{item.detail || EMPTY}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Chips({ items, tone }: { items: readonly string[]; tone?: Tone }) {
  if (items.length === 0) return <span className="faint">{EMPTY}</span>;
  return (
    <div className="chip-row">
      {items.map((item) => (
        <Badge key={item} tone={tone ?? 'outline'}>
          {item}
        </Badge>
      ))}
    </div>
  );
}

export function Note({
  tone,
  icon,
  children,
}: {
  tone?: 'accent' | 'warn';
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <div className={tone ? `note note--${tone}` : 'note'}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        {icon ? <Icon name={icon} /> : null}
        <div className="grow">{children}</div>
      </div>
    </div>
  );
}

/**
 * A timestamp rendered relative to now, without lying about hydration.
 *
 * `formatRelative` defaults to `new Date()`. In a Client Component that is two
 * different instants: the server renders "59 minutes ago", the browser hydrates
 * a moment later and computes "1 hour ago", and React tears the tree down with
 * "server rendered text didn't match". It fired on /approvals every time.
 *
 * `suppressHydrationWarning` is the honest fix rather than a silencer: both
 * strings are correct for the instant that produced them, and the mismatch is
 * time passing, not a bug. Keeping the server's text also means no re-render, so
 * nothing shifts on hydration — which is the design rule this would otherwise
 * break if we swapped an absolute date for a relative one after mount.
 */
export function RelativeTime({ at }: { at: string | Date | null | undefined }) {
  return <span suppressHydrationWarning>{formatRelative(at)}</span>;
}
