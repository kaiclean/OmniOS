'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { OS_HUE, hueForSpaceKey, tintStyle } from '@/lib/ui/space-tint';
import { derivePageContext } from '@/lib/ui/page-context';
import { CommandPalette, type Command } from './CommandPalette';
import { Copilot, type CopilotProps } from './Copilot';
import { Icon } from '@/components/ui/Icon';

export interface ShellFrameProps {
  /** Server Components, fully rendered before they get here. */
  rail: React.ReactNode;
  strip: React.ReactNode;
  /**
   * The copilot arrives as *data*, not as an element.
   *
   * Passing a Client Component element from a Server Component into another
   * Client Component makes React materialise it as an unkeyed item in the
   * receiving component's child list, which warns; keying it then reorders the
   * children and breaks hydration. Since ShellFrame is itself a client
   * component it can just render Copilot directly, and the boundary disappears.
   * Rail and Strip are Server Components, so they must stay as elements.
   */
  copilot: CopilotProps;
  commands: readonly Command[];
  children: React.ReactNode;
}

export function ShellFrame({ rail, strip, copilot, commands, children }: ShellFrameProps) {
  const pathname = usePathname();
  // Derived on the client so the room re-tints the instant a link is clicked,
  // before any server response arrives. One shared derivation with the Copilot
  // and the server — two private copies of this regex had already disagreed.
  const page = useMemo(() => derivePageContext(pathname), [pathname]);
  const spaceKind = page.spaceKey.startsWith('company:')
    ? 'company'
    : page.spaceKey === 'personal'
      ? 'personal'
      : 'os';
  const hue = useMemo(
    () => (page.spaceKey === 'os' ? OS_HUE : hueForSpaceKey(page.spaceKey)),
    [page.spaceKey],
  );

  const [railOpen, setRailOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  /**
   * Two states, because the copilot is two different things.
   *
   * Above 1360px it is a permanent third column, and it should be there by
   * default. Below that it becomes a sheet over the founder's content, and a
   * sheet that opens itself on a phone is just a screen you have to dismiss
   * before you can read anything. Deciding at click time — rather than flipping
   * a shared state in an effect after mount — keeps both defaults correct on the
   * first paint, with no flash either way.
   */
  const [copilotOpen, setCopilotOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);

  const toggleCopilot = useCallback(() => {
    if (window.matchMedia('(max-width: 1360px)').matches) setSheetOpen((open) => !open);
    else setCopilotOpen((open) => !open);
  }, []);

  // Navigating on a phone must close whatever is covering the destination.
  // Done during render rather than in an effect so the overlay never paints for
  // a frame on top of the page it just navigated to.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setRailOpen(false);
    setSheetOpen(false);
  }

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
      data-space-kind={spaceKind}
      data-rail={railOpen ? 'open' : 'closed'}
      data-copilot={copilotOpen ? 'open' : 'hidden'}
      data-sheet={sheetOpen ? 'open' : 'closed'}
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
          {/* Strip brings its own `.strip-scroll` container: only the metrics
              scroll, and the actions stay reachable at every width — a command
              palette you cannot reach is not a command palette. It has to be a
              single element rather than a list, or React warns about a missing
              key on the boundary element itself. */}
          {strip}
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
              aria-label="Toggle assistant"
              aria-expanded={copilotOpen || sheetOpen}
              onClick={toggleCopilot}
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

      <Copilot {...copilot} />

      {paletteOpen ? <CommandPalette commands={commands} onClose={closePalette} /> : null}
    </div>
  );
}
