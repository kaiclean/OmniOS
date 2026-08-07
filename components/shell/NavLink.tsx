'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Icon, type IconName } from '@/components/ui/Icon';

export function NavLink({
  href,
  icon,
  label,
  count,
  exact,
}: {
  href: string;
  icon: IconName;
  label: string;
  count?: number;
  /** Home would otherwise match every route, so it opts into exact matching. */
  exact?: boolean;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link className="nav-item" href={href} aria-current={active ? 'page' : undefined}>
      <Icon name={icon} className="nav-icon" />
      <span className="truncate">{label}</span>
      {count !== undefined && count > 0 ? <span className="nav-count">{count}</span> : null}
    </Link>
  );
}

export function SpaceLink({
  href,
  label,
  hue,
}: {
  href: string;
  label: string;
  hue: number;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link className="space-item" href={href} data-active={active ? 'true' : 'false'}>
      <span
        className="space-dot"
        style={{ background: `oklch(0.76 0.118 ${hue})`, color: `oklch(0.76 0.118 ${hue})` }}
      />
      <span className="truncate">{label}</span>
    </Link>
  );
}
