import { describe, expect, it } from 'vitest';

import { describeSelf } from '@/lib/ai/self';
import { NOT_WIRED_TOOL_IDS } from '@/lib/ai/tools/executors';
import { personalScope } from '@/lib/domain';
import { toolsForScope } from '@/lib/ai/tools';

/**
 * Self-knowledge.
 *
 * These exist because of one real reply: asked whether OmniOS could run an
 * Instagram agent, the assistant said it did not know what was available and
 * suggested checking "with whoever manages your OmniOS setup, or an
 * integrations section I might not have visibility into". There is nobody else
 * and there is no such section — and nothing had ever told it so.
 */

const base = {
  tools: toolsForScope(personalScope()),
  servers: [],
  states: [],
  unwiredToolIds: NOT_WIRED_TOOL_IDS,
};

describe('the assistant is told what it can do', () => {
  it('lists the records it can actually create', () => {
    const text = describeSelf(base);
    expect(text).toContain('create a task');
    expect(text).toContain('remember something');
  });

  it('names what it can read, now that reading is possible', () => {
    expect(describeSelf(base)).toContain('search this space');
  });

  it('says gated tools stop and wait, rather than listing them as abilities', () => {
    const text = describeSelf(base);
    expect(text).toMatch(/stop and wait for the founder to approve/i);
  });

  it('never offers a tool whose executor refuses by design', () => {
    const text = describeSelf(base);
    // They appear once, named as unwired — not in the list of things it can do.
    expect(text).toContain('not wired to any provider');
    expect(text).toContain('Do not offer them as things you can do');
  });
});

describe('it is honest about the outward gap, and does not deflect', () => {
  it('states plainly that nothing outward is reachable with no connections', () => {
    const text = describeSelf(base);
    expect(text).toContain('No connections are configured');
    expect(text).toMatch(/cannot browse the web/i);
    expect(text).toMatch(/post to social media/i);
  });

  /** The exact failure this module was written for. */
  it('forbids sending the founder to ask somebody else', () => {
    const text = describeSelf(base);
    expect(text).toContain('Never tell the founder to ask someone else');
    expect(text).toContain('there is no such section');
  });

  it('reports connections truthfully once some exist', () => {
    const text = describeSelf({
      ...base,
      servers: [{ id: 'fetch', enabled: true } as never],
      states: [{ serverId: 'fetch', status: 'connected' } as never],
    });
    expect(text).toContain('1 connection(s) configured, 1 currently reachable');
    expect(text).not.toContain('No connections are configured');
  });

  it('does not claim a configured-but-unreachable server works', () => {
    const text = describeSelf({
      ...base,
      servers: [{ id: 'github', enabled: true } as never],
      states: [{ serverId: 'github', status: 'error' } as never],
    });
    expect(text).toContain('0 currently reachable');
  });

  it('quotes the failing connection’s stored reason, not just the count', () => {
    const text = describeSelf({
      ...base,
      servers: [{ id: 'fetch', name: 'Web fetch', enabled: true, transport: 'stdio', args: ['mcp-server-fetch'] } as never],
      states: [
        {
          serverId: 'fetch',
          status: 'error',
          error: 'Command not found. Check that it is installed and on PATH. (spawn uvx ENOENT)',
        } as never,
      ],
    });
    expect(text).toContain('spawn uvx ENOENT');
    expect(text).toContain('Web fetch');
  });

  it('says a placeholder config needs setup rather than calling it broken', () => {
    const text = describeSelf({
      ...base,
      servers: [
        {
          id: 'filesystem',
          name: 'Filesystem',
          enabled: true,
          transport: 'stdio',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '<ABSOLUTE_PATH>'],
        } as never,
      ],
      states: [],
    });
    expect(text).toContain('a directory path');
    expect(text).not.toContain('no error was recorded');
  });

  it('names a configured server the founder simply never connected', () => {
    const text = describeSelf({
      ...base,
      servers: [{ id: 'fetch', name: 'Web fetch', enabled: true, transport: 'stdio', args: ['mcp-server-fetch'] } as never],
      states: [],
    });
    expect(text).toContain('not yet connected — nothing is known about this configuration');
  });
});

describe('it cannot go stale', () => {
  it('is derived from the live registry, so a new tool appears without an edit here', () => {
    const withoutOne = describeSelf({ ...base, tools: base.tools.filter((t) => t.id !== 'create_task') });
    expect(withoutOne).not.toContain('create a task');
    expect(describeSelf(base)).toContain('create a task');
  });

  it('says so plainly when it has no way to read anything', () => {
    const blind = describeSelf({ ...base, tools: base.tools.filter((t) => t.risk !== 'read') });
    expect(blind).toContain('you have no read tools');
  });
});
