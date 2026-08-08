import { describe, expect, it } from 'vitest';

import { toolsForAgent } from '@/lib/ai/available';
import { toolsForScope } from '@/lib/ai/tools';
import { companyScope, personalScope, requiresApproval } from '@/lib/domain';

/**
 * An operator's charter, enforced.
 *
 * Hiring an agent declared `capabilityIds` and `toolIds`, the Team page showed
 * them, and nothing read either — so a Podcast Producer hired into a
 * construction company could file a finance entry or delete a record. The
 * charter the founder picked was decoration. These pin that it is not.
 */

const COMPANY = toolsForScope(companyScope('acme'));

describe('a charter subtracts and never adds', () => {
  it('is always a subset of what the space itself has', () => {
    const ids = new Set(COMPANY.map((tool) => tool.id));
    const scoped = toolsForAgent(COMPANY, {
      // Naming a tool the space does not have must not conjure it.
      toolIds: ['create_task', 'mcp:github:create_issue', 'not_a_real_tool'],
    });
    for (const tool of scoped) expect(ids.has(tool.id), tool.id).toBe(true);
  });

  it('confines a capability charter to that capability', () => {
    const scoped = toolsForAgent(COMPANY, { capabilityIds: ['marketing'] });
    const writes = scoped.filter((tool) => tool.risk !== 'read');
    expect(writes.length).toBeGreaterThan(0);
    for (const tool of writes) expect(tool.capabilityId, tool.id).toBe('marketing');
    // The concrete case from the audit.
    expect(scoped.some((tool) => tool.id === 'add_finance_entry')).toBe(false);
    expect(scoped.some((tool) => tool.id === 'delete_record')).toBe(false);
  });

  it('confines a tool charter to exactly those tools', () => {
    const scoped = toolsForAgent(COMPANY, { toolIds: ['create_task', 'write_doc'] });
    const writes = scoped.filter((tool) => tool.risk !== 'read').map((tool) => tool.id).sort();
    expect(writes).toEqual(['create_task', 'write_doc']);
  });

  it('lets an agent look things up whatever its charter', () => {
    // A charter that cannot read is a charter that guesses, which is the failure
    // it exists to prevent rather than the one it should cause.
    const scoped = toolsForAgent(COMPANY, { toolIds: ['write_doc'] });
    expect(scoped.some((tool) => tool.id === 'search_workspace')).toBe(true);
  });

  it('leaves an agent that declares nothing unrestricted', () => {
    // Built-in specialists have always been unrestricted. Granting them nothing
    // would read as broken rather than deliberately narrow.
    expect(toolsForAgent(COMPANY, {})).toHaveLength(COMPANY.length);
  });
});

describe('a charter is not a permission', () => {
  it('cannot make a gated tier run itself', () => {
    // Naming a destructive tool in a charter grants reachability, never
    // autonomy: the gate is downstream of every one of these.
    const scoped = toolsForAgent(COMPANY, { toolIds: ['delete_record', 'send_email'] });
    for (const tool of scoped) {
      if (tool.risk === 'destructive' || tool.risk === 'external') {
        expect(requiresApproval(tool.risk), tool.id).toBe(true);
      }
    }
  });

  it('applies in a personal space the same way', () => {
    const personal = toolsForScope(personalScope());
    const scoped = toolsForAgent(personal, { capabilityIds: ['health'] });
    const writes = scoped.filter((tool) => tool.risk !== 'read');
    for (const tool of writes) expect(tool.capabilityId, tool.id).toBe('health');
  });
});
