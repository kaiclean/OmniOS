'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Icon, type IconName } from '@/components/ui/Icon';

export interface Command {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly href: string;
  readonly icon: IconName;
  /** Extra words the founder might type to reach this. */
  readonly keywords?: string;
}

/**
 * Subsequence match, the way editors do it: "mkfin" reaches "Meridian Build ·
 * Finance". Exact substring hits still rank above scattered ones.
 */
function score(query: string, haystack: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const h = haystack.toLowerCase();
  const direct = h.indexOf(q);
  if (direct !== -1) return 1000 - direct;

  let qi = 0;
  let hits = 0;
  let lastIndex = -1;
  let gapPenalty = 0;
  for (let hi = 0; hi < h.length && qi < q.length; hi += 1) {
    if (h[hi] === q[qi]) {
      if (lastIndex !== -1) gapPenalty += hi - lastIndex - 1;
      lastIndex = hi;
      hits += 1;
      qi += 1;
    }
  }
  if (qi < q.length) return 0;
  return Math.max(1, 500 - gapPenalty - hits);
}

export function CommandPalette({
  commands,
  onClose,
}: {
  commands: readonly Command[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const scored = commands
      .map((command) => ({
        command,
        score: score(query, `${command.group} ${command.label} ${command.keywords ?? ''}`),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, 40).map((entry) => entry.command);
  }, [commands, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const go = (index: number) => {
    const target = results[index];
    if (!target) return;
    onClose();
    router.push(target.href);
  };

  return (
    <div
      className="sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet-card">
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Jump to a space, capability or view…"
          value={query}
          aria-label="Search"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((i) => Math.min(i + 1, results.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              go(active);
            }
          }}
        />
        <div className="palette-list" ref={listRef}>
          {results.length === 0 ? (
            <p className="empty">Nothing matches “{query}”.</p>
          ) : (
            results.map((command, index) => (
              <button
                key={command.id}
                type="button"
                className="palette-item"
                data-active={index === active ? 'true' : 'false'}
                onMouseEnter={() => setActive(index)}
                onClick={() => go(index)}
              >
                <Icon name={command.icon} />
                <span className="truncate">{command.label}</span>
                <span className="palette-hint">{command.group}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
