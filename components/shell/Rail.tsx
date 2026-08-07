import Link from 'next/link';

import { primaryNavCapabilities } from '@/lib/capabilities/registry';
import type { SpaceView } from '@/lib/data/aggregate';
import { hueForSpaceKey } from '@/lib/ui/space-tint';
import { Icon, isIconName } from '@/components/ui/Icon';
import { NavLink, SpaceLink } from './NavLink';

export function Rail({
  spaces,
  openSuggestions,
  upgradesAwaiting,
}: {
  spaces: readonly SpaceView[];
  openSuggestions: number;
  upgradesAwaiting: number;
}) {
  const companies = spaces.filter((s) => s.kind === 'company');
  const personal = spaces.find((s) => s.kind === 'personal');

  return (
    <nav className="rail" aria-label="Primary">
      <div className="rail-head">
        <span className="rail-mark" aria-hidden="true">
          OS
        </span>
        <span className="rail-title">OmniOS</span>
      </div>

      <div className="rail-scroll">
        <div className="rail-group">
          <NavLink href="/" icon="home" label="Home" count={openSuggestions} exact />
          <NavLink href="/brain" icon="brain" label="Brain" />
          <NavLink href="/assistant" icon="assistant" label="Assistant" />
        </div>

        <div className="rail-group">
          <div className="rail-group-label spread">
            <span className="eyebrow">Spaces</span>
            <Link className="btn btn--ghost btn--icon btn--sm" href="/companies/new" aria-label="Create a company">
              <Icon name="plus" size={13} />
            </Link>
          </div>
          {companies.map((space) => (
            <SpaceLink
              key={space.id}
              href={space.href}
              label={space.label}
              hue={hueForSpaceKey(space.scopeKey)}
            />
          ))}
          {personal ? (
            <SpaceLink
              href={personal.href}
              label={`${personal.label} · Life`}
              hue={hueForSpaceKey('personal')}
            />
          ) : null}
          <NavLink href="/companies" icon="building" label="All companies" exact />
        </div>

        <div className="rail-group">
          <div className="rail-group-label">
            <span className="eyebrow">Capabilities</span>
          </div>
          {primaryNavCapabilities().map((capability) => (
            <NavLink
              key={capability.id}
              href={`/capabilities/${capability.id}`}
              icon={isIconName(capability.icon) ? capability.icon : 'gear'}
              label={capability.name}
            />
          ))}
        </div>

        <div className="rail-group">
          <div className="rail-group-label">
            <span className="eyebrow">Systems</span>
          </div>
          <NavLink href="/intelligence" icon="telescope" label="Intelligence" count={upgradesAwaiting} />
          <NavLink href="/studio" icon="sparkle" label="Creative Studio" />
          <NavLink href="/factory" icon="factory" label="Product Factory" />
          <NavLink href="/finance" icon="coins" label="Finance Center" />
          <NavLink href="/automations" icon="bolt" label="Automations" />
        </div>
      </div>

      <div className="rail-foot">
        <NavLink href="/settings" icon="settings" label="Settings" />
      </div>
    </nav>
  );
}
