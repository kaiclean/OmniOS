import 'server-only';

/**
 * The living graph — the workspace as a nervous system.
 *
 * Every node here is a real record; every edge is a relationship that actually
 * exists in the store. Nothing is decorative: if the graph shows a filament
 * between two clusters, it is because a shared memory genuinely bridges those
 * spaces, or a tool call genuinely touched that record. A visualisation that
 * invented structure would teach the founder to distrust the one screen whose
 * whole purpose is showing them what their system knows.
 *
 * Aggregation happens through `loadSpaces()` — the one sanctioned door — and
 * this module is a *view* for the founder's own eyes. Nothing under `lib/ai/`
 * imports it.
 */

import { capabilityIds, getCapability } from '@/lib/capabilities/registry';
import { loadSpaces } from '@/lib/data/aggregate';
import { readScope } from '@/lib/data/store';
import { sharedScope } from '@/lib/domain';
import type { ScopeData } from '@/lib/data/schema';

export const GRAPH_NODE_KINDS = [
  'core',
  'space',
  'capability',
  'task',
  'goal',
  'kpi',
  'doc',
  'memory',
  'shared-memory',
  'contact',
  'habit',
  'relationship',
  'brief',
  'asset',
  'product',
  'automation',
  'risk',
  'message',
] as const;
export type GraphNodeKind = (typeof GRAPH_NODE_KINDS)[number];

export interface GraphNode {
  readonly id: string;
  readonly kind: GraphNodeKind;
  readonly label: string;
  /** 'os' | 'shared' | 'company:<id>' | 'personal' — decides the cluster hue. */
  readonly spaceKey: string;
  /** Relative visual weight. Hubs carry their record counts. */
  readonly weight: number;
  readonly createdAt: string;
}

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  /** containment: record→hub. link: real cross-record relationship. */
  readonly kind: 'containment' | 'link' | 'bridge' | 'action';
}

export interface BrainGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly totalRecords: number;
  /** Records beyond the per-collection cap, so the UI never implies completeness. */
  readonly omitted: number;
  readonly generatedAt: string;
}

/**
 * Newest N of a collection. The graph is a living view, not an archive: the
 * newest records are the ones whose arrival the founder watches, and an
 * unbounded graph of ten thousand points stops being readable or smooth.
 */
const PER_COLLECTION_CAP = 28;

interface RecordSource {
  readonly kind: GraphNodeKind;
  readonly pick: (data: ScopeData) => ReadonlyArray<{
    id: string;
    createdAt: string;
    capabilityId?: string;
    label: string;
    linkTo?: string;
  }>;
}

const text = (value: string, max = 48): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

const SOURCES: readonly RecordSource[] = [
  {
    kind: 'task',
    pick: (d) =>
      d.tasks.map((t) => ({
        id: t.id,
        createdAt: t.createdAt,
        capabilityId: t.capabilityId,
        label: text(t.title),
        // A task serving a goal is a real relationship worth a filament.
        ...(t.goalId ? { linkTo: t.goalId } : {}),
      })),
  },
  {
    kind: 'goal',
    pick: (d) =>
      d.goals.map((g) => ({ id: g.id, createdAt: g.createdAt, capabilityId: g.capabilityId, label: text(g.title) })),
  },
  {
    kind: 'kpi',
    pick: (d) =>
      d.kpis.map((k) => ({ id: k.id, createdAt: k.createdAt, capabilityId: k.capabilityId, label: text(k.label) })),
  },
  {
    kind: 'doc',
    pick: (d) =>
      d.docs.map((doc) => ({ id: doc.id, createdAt: doc.createdAt, capabilityId: doc.capabilityId, label: text(doc.title) })),
  },
  {
    kind: 'memory',
    pick: (d) =>
      d.memory.map((m) => ({ id: m.id, createdAt: m.createdAt, capabilityId: m.capabilityId, label: text(m.text, 42) })),
  },
  {
    kind: 'contact',
    pick: (d) => d.contacts.map((c) => ({ id: c.id, createdAt: c.createdAt, label: text(c.name) })),
  },
  {
    kind: 'habit',
    pick: (d) => d.habits.map((h) => ({ id: h.id, createdAt: h.createdAt, label: text(h.name) })),
  },
  {
    kind: 'relationship',
    pick: (d) => d.relationships.map((r) => ({ id: r.id, createdAt: r.createdAt, label: text(r.name) })),
  },
  {
    kind: 'brief',
    pick: (d) => d.briefs.map((b) => ({ id: b.id, createdAt: b.createdAt, label: text(b.title) })),
  },
  {
    kind: 'asset',
    pick: (d) => d.assets.map((a) => ({ id: a.id, createdAt: a.createdAt, label: text(a.title) })),
  },
  {
    kind: 'product',
    pick: (d) => d.products.map((p) => ({ id: p.id, createdAt: p.createdAt, label: text(p.name) })),
  },
  {
    kind: 'automation',
    pick: (d) =>
      d.automations.map((a) => ({ id: a.id, createdAt: a.createdAt, capabilityId: a.capabilityId, label: text(a.name) })),
  },
  {
    kind: 'risk',
    pick: (d) =>
      d.risks.map((r) => ({ id: r.id, createdAt: r.createdAt, capabilityId: r.capabilityId, label: text(r.label) })),
  },
];

export async function buildBrainGraph(): Promise<BrainGraph> {
  const spaces = await loadSpaces();
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();
  let totalRecords = 0;
  let omitted = 0;

  const add = (node: GraphNode): void => {
    if (nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    nodes.push(node);
  };
  const connect = (from: string, to: string, kind: GraphEdge['kind']): void => {
    if (nodeIds.has(from) && nodeIds.has(to)) edges.push({ from, to, kind });
  };

  add({ id: 'core', kind: 'core', label: 'OmniOS', spaceKey: 'os', weight: 26, createdAt: '' });

  for (const space of spaces) {
    const hubId = `hub:${space.scopeKey}`;
    const recordCount = Object.values(space.data).reduce(
      (sum, collection) => sum + (Array.isArray(collection) ? collection.length : 0),
      0,
    );
    add({
      id: hubId,
      kind: 'space',
      label: space.label,
      spaceKey: space.scopeKey,
      weight: 14 + Math.min(10, recordCount / 40),
      createdAt: '',
    });
    connect(hubId, 'core', 'containment');

    const capabilityHubs = new Set<string>();
    const hubFor = (capabilityId: string | undefined): string => {
      const id = capabilityId && getCapability(capabilityId) ? capabilityId : 'operations';
      const capHubId = `cap:${space.scopeKey}:${id}`;
      if (!capabilityHubs.has(capHubId)) {
        capabilityHubs.add(capHubId);
        add({
          id: capHubId,
          kind: 'capability',
          label: getCapability(id)?.name ?? id,
          spaceKey: space.scopeKey,
          weight: 7,
          createdAt: '',
        });
        connect(capHubId, hubId, 'containment');
      }
      return capHubId;
    };

    // Deferred so a task can link to a goal that is added after it.
    const pendingLinks: Array<{ from: string; to: string }> = [];

    for (const source of SOURCES) {
      const records = source.pick(space.data);
      totalRecords += records.length;
      const newest = [...records]
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, PER_COLLECTION_CAP);
      omitted += records.length - newest.length;

      for (const record of newest) {
        add({
          id: record.id,
          kind: source.kind,
          label: record.label,
          spaceKey: space.scopeKey,
          weight: source.kind === 'goal' || source.kind === 'product' ? 3.4 : 2.2,
          createdAt: record.createdAt,
        });
        connect(record.id, hubFor(record.capabilityId), 'containment');
        if (record.linkTo) pendingLinks.push({ from: record.id, to: record.linkTo });
      }
    }

    for (const link of pendingLinks) connect(link.from, link.to, 'link');

    // Actions are synapses that already fired: a tool call touching a record is
    // a real event, drawn only when both ends made it into the graph.
    for (const call of space.data.toolCalls.slice(0, PER_COLLECTION_CAP)) {
      for (const affectedId of call.affectedIds) connect(affectedId, hubId, 'action');
    }
  }

  // Shared capability memory is the tissue between clusters: one lesson,
  // reachable from every space that capability serves. These are the filaments
  // that make the whole thing one brain rather than islands.
  for (const capabilityId of capabilityIds()) {
    const shared = await readScope(sharedScope(capabilityId));
    totalRecords += shared.memory.length;
    for (const record of shared.memory.slice(0, PER_COLLECTION_CAP)) {
      add({
        id: record.id,
        kind: 'shared-memory',
        label: text(record.text, 42),
        spaceKey: 'shared',
        weight: 3,
        createdAt: record.createdAt,
      });
      connect(record.id, 'core', 'containment');
      for (const space of spaces) {
        const capHubId = `cap:${space.scopeKey}:${capabilityId}`;
        if (nodeIds.has(capHubId)) connect(record.id, capHubId, 'bridge');
      }
    }
  }

  return {
    nodes,
    edges,
    totalRecords,
    omitted,
    generatedAt: new Date().toISOString(),
  };
}
