import { NextResponse } from 'next/server';

import { buildBrainGraph } from '@/lib/brain/graph';

/**
 * The graph as JSON, polled by the client so the brain grows while you watch.
 * Read-only, founder-facing, and never cached: the entire point is that a
 * record created two seconds ago appears on the next poll.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const graph = await buildBrainGraph();
  return NextResponse.json(graph, { headers: { 'cache-control': 'no-store' } });
}
