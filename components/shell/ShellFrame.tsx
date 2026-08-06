'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { OS_HUE, hueForSpaceKey, tintStyle } from '@/lib/ui/space-tint';
import { CommandPalette, type Command } from './CommandPalette';
import { Icon } from '@/components/ui/Icon';

export interface ShellFrameProps {
  rail: React.ReactNode;
  strip: React.ReactNode;
  copilot: React.ReactNode;
  commands: readonly Command[];
  children: React.ReactNode;
}

/**
 * Derive the active space from the URL.
 *
 * Doing this on the client means the room re-tints the instant a link is
 * clicked, before any server response arrives — which is the difference between
 * "the page changed" and "I walked into a different room".
 */
function spaceFromPath(pathname: string): { key: string; kind: 'company' | 'personal' | 'os' } {
  const companyMatch = /^\/companies\/([^/]+)/.exec(pathname);
  if (companyMatch?.[1] && companyMatch[1] !== 'new') {
    return { key: `company:${companyMatch[1]}`, kind: 'company' };
  }
  if (pathname === '/life' || pathname.startsWith('/life/')) {
    return { key: 'personal', kind: 'personal' };
  }
  return { key: 'os', kind: 'os' };
}

export function ShellFrame({ rail, strip, copilot, commands, children }: ShellFrameProps) {
  const pathname = usePathname();
  const space = useMemo(() => spaceFromPath(pathname), [pathname]);
  const hue = useMemo(() => (space.kind === 'os' ? OS_HUE : hueForSpaceKey(space.key)), [space]);

  const [railOpen, setRailOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Navigating on a phone must close the drawer, or the destination is hidden
  // behind the thing that took you there.
  useEffect(() => {
    setRailOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      // Slash focuses the assistant, the way a terminal focuses a prompt — but
      // never while the founder is already typing somewhere.
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true;
      if (!typing && event.key === '/') {
        event.preventDefault();
        setCopilotOpen(true);
        window.requestAnimationFrame(() => {
          document.querySelector<HTMLTextAreaElement>('[data-copilot-input]')?.focus();
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const closePalette = useCallback(() => setPaletteOpen(false), []);

  return (
    <div
      className="os"
      style={tintStyle(hue) as React.CSSProperties}
      data-space-kind={space.kind}
      data-rail={railOpen ? 'open' : 'closed'}
      data-copilot={copilotOpen ? 'open' : 'hidden'}
    >
      {railOpen ? (
        <button
          type="button"
          className="scrim"
          aria-label="Close navigation"
          onClick={() => setRailOpen(false)}
        />
      ) : null}

      {rail}

      <div className="os-main">
        <div className="strip">
          <button
            type="button"
            className="btn btn--ghost btn--icon rail-toggle"
            aria-label="Open navigation"
            onClick={() => setRailOpen(true)}
          >
            <Icon name="menu" />
          </button>
          {/* Only the metrics scroll. The actions must stay reachable at every
              width — a command palette you cannot reach is not a command palette. */}
          <div className="strip-scroll">{strip}</div>
          <div className="strip-actions">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => setPaletteOpen(true)}
            >
              <Icon name="search" />
              <span className="palette-trigger-label">Search</span>
              <kbd className="kbd">⌘K</kbd>
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--icon"
              aria-label={copilotOpen ? 'Hide assistant' : 'Show assistant'}
              aria-pressed={copilotOpen}
              onClick={() => setCopilotOpen((open) => !open)}
            >
              <Icon name="panel" />
            </button>
          </div>
          <div className="seam" data-thinking="false" />
        </div>

        <main className="canvas" id="work">
          <div className="canvas-inner">{children}</div>
        </main>
      </div>

      {copilot}

      {paletteOpen ? <CommandPalette commands={commands} onClose={closePalette} /> : null}
    </div>
  );
}
