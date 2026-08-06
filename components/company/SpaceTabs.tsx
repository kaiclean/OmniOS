'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface SpaceTab {
  readonly href: string;
  readonly label: string;
  readonly exact?: boolean;
}

/**
 * The capability strip inside a space.
 *
 * Built from the registry, so a company and a life get the same component with
 * different entries — and a new capability appears in both without an edit here.
 */
export function SpaceTabs({ tabs }: { tabs: readonly SpaceTab[] }) {
  const pathname = usePathname();

  return (
    <nav className="tab-row" aria-label="Capabilities">
      {tabs.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            className="tab"
            href={tab.href}
            aria-current={active ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
