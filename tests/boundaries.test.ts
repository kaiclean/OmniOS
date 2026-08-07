import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The invariants that no type checker can see.
 *
 * Invariant 1 says cross-space aggregation lives only in `lib/data/aggregate.ts`
 * and that nothing under `lib/ai/` may import it. Invariant 2 says a gated call
 * runs only against a recorded human decision. Both were, until this file,
 * enforced by discipline: nothing in the build would fail if someone added the
 * import or wrote a decision from a third place, and the leak each produces is
 * silent. These tests are cheap and they fail loudly.
 */

const ROOT = resolve(__dirname, '..');

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(full)));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) files.push(full);
  }
  return files;
}

/** Import specifiers only — a mention in a comment is documentation, not a dependency. */
function importedModules(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /^\s*import\s[^'"]*from\s+['"]([^'"]+)['"]/gm,
    /^\s*import\s+['"]([^'"]+)['"]/gm,
    /^\s*export\s[^'"]*from\s+['"]([^'"]+)['"]/gm,
    /\bawait\s+import\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) found.push(match[1]);
    }
  }
  return found;
}

describe('invariant 1 — lib/ai cannot read across spaces', () => {
  it('imports lib/data/aggregate nowhere', async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles(join(ROOT, 'lib', 'ai'))) {
      const source = await readFile(file, 'utf8');
      if (importedModules(source).some((specifier) => specifier.includes('data/aggregate'))) {
        offenders.push(relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('imports lib/actions nowhere', async () => {
    // This is why the proposing core lives in `lib/ai/tools/propose.ts` rather
    // than being reached across the boundary from `ask()`.
    const offenders: string[] = [];
    for (const file of await sourceFiles(join(ROOT, 'lib', 'ai'))) {
      const source = await readFile(file, 'utf8');
      if (importedModules(source).some((specifier) => /(^|\/)lib\/actions\//.test(specifier))) {
        offenders.push(relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('invariant 2 — a decision has exactly two authors', () => {
  /**
   * `runTool` refuses a gated tier without an approval, so the set of files that
   * may *construct* one is the real perimeter. Today it is two, and each has a
   * different warrant: `lib/approvals/decide.ts` records a decision someone just
   * made, and `lib/ai/tools/propose.ts` carries one made in advance as a grant.
   * A third author is a regression even if it looks harmless.
   *
   * `decide.ts` is not a Server Action, and that is the point: it takes the
   * decider as an argument, so it must not be reachable from a browser that
   * could pass one. Every entry point fixes its own — the app passes the local
   * founder, the webhook passes the chat a signature bound it to.
   */
  it('is constructed in exactly the two files that are allowed to', async () => {
    const allowed = new Set([join('lib', 'approvals', 'decide.ts'), join('lib', 'ai', 'tools', 'propose.ts')]);
    const offenders: string[] = [];

    for (const root of ['lib', 'app', 'components']) {
      for (const file of await sourceFiles(join(ROOT, root))) {
        const rel = relative(ROOT, file);
        if (allowed.has(rel)) continue;
        const source = await readFile(file, 'utf8');
        if (/approval\s*:\s*\{/.test(source)) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('is only ever carried into runTool alongside the grant that justifies it', async () => {
    // The grant path is the one place `propose.ts` may hand `runTool` an
    // approval. If that construction ever stops being guarded by a found grant,
    // a gated call would execute on nothing at all.
    const source = await readFile(join(ROOT, 'lib', 'ai', 'tools', 'propose.ts'), 'utf8');
    const approvalSites = [...source.matchAll(/approval\s*:\s*\{/g)];
    expect(approvalSites).toHaveLength(1);
    expect(source).toMatch(/if\s*\(gated\s*&&\s*grant\)/);
    // And a grant may only ever be found for a tool that came from a connection.
    expect(source).toMatch(/gated\s*&&\s*remote/);
  });
});
