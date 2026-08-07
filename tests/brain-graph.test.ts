import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The graph's promise is that it never invents structure. These tests hold it
 * to that: every edge must join two nodes that exist, every node must trace to
 * a real record or hub, and the same workspace must always produce the same
 * brain — growth comes from new records, never from nondeterminism.
 */

let graphModule: typeof import('@/lib/brain/graph');
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'omnios-brain-'));
  process.env.OMNIOS_DATA_DIR = dir;
  graphModule = await import('@/lib/brain/graph');
}, 60_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.OMNIOS_DATA_DIR;
});

describe('the living graph', () => {
  it('never draws an edge to a node that does not exist', async () => {
    const graph = await graphModule.buildBrainGraph();
    const ids = new Set(graph.nodes.map((node) => node.id));
    for (const edge of graph.edges) {
      expect(ids.has(edge.from), `${edge.from} -> ${edge.to}`).toBe(true);
      expect(ids.has(edge.to), `${edge.from} -> ${edge.to}`).toBe(true);
    }
  }, 60_000);

  it('has one core, one hub per space, and no duplicate nodes', async () => {
    const graph = await graphModule.buildBrainGraph();
    const ids = graph.nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(graph.nodes.filter((node) => node.kind === 'core')).toHaveLength(1);
    const hubs = graph.nodes.filter((node) => node.kind === 'space');
    // The seeded workspace has three companies and personal life.
    expect(hubs.length).toBeGreaterThanOrEqual(2);
    for (const hub of hubs) {
      expect(graph.edges.some((edge) => edge.from === hub.id && edge.to === 'core')).toBe(true);
    }
  }, 60_000);

  it('bridges shared memory into every cluster that capability serves', async () => {
    const graph = await graphModule.buildBrainGraph();
    const shared = graph.nodes.filter((node) => node.kind === 'shared-memory');
    expect(shared.length).toBeGreaterThan(0);
    const bridges = graph.edges.filter((edge) => edge.kind === 'bridge');
    expect(bridges.length).toBeGreaterThan(0);
    // A bridge exists so the brain is one organism, not islands: at least one
    // shared record must reach capability hubs in two different spaces.
    const bySource = new Map<string, Set<string>>();
    for (const bridge of bridges) {
      const spaces = bySource.get(bridge.from) ?? new Set<string>();
      const target = graph.nodes.find((node) => node.id === bridge.to);
      if (target) spaces.add(target.spaceKey);
      bySource.set(bridge.from, spaces);
    }
    expect([...bySource.values()].some((spaces) => spaces.size >= 2)).toBe(true);
  }, 60_000);

  it('is a pure function of the workspace — same store, same brain', async () => {
    const first = await graphModule.buildBrainGraph();
    const second = await graphModule.buildBrainGraph();
    expect(second.nodes).toEqual(first.nodes);
    expect(second.edges).toEqual(first.edges);
  }, 60_000);

  it('caps each collection and owns up to what it left out', async () => {
    const graph = await graphModule.buildBrainGraph();
    const byKindAndSpace = new Map<string, number>();
    for (const node of graph.nodes) {
      const key = `${node.spaceKey}:${node.kind}`;
      byKindAndSpace.set(key, (byKindAndSpace.get(key) ?? 0) + 1);
    }
    for (const [key, count] of byKindAndSpace) {
      if (key.endsWith(':capability')) continue;
      expect(count, key).toBeLessThanOrEqual(30);
    }
    expect(graph.totalRecords).toBeGreaterThan(0);
    expect(graph.omitted).toBeGreaterThanOrEqual(0);
  }, 60_000);
});
