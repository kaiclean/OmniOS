import 'server-only';

/**
 * Turning text into a vector, or honestly declining to.
 *
 * `MemoryRecord.embedding` has been a reserved field since memory shipped —
 * documented as "kept on the record so a vector index can be built later without
 * a migration". This is that index's front half, and it is written to be dormant
 * safely, because on this workspace it currently *is* dormant: Ollama Cloud
 * answers `/api/embed` with 401 and has no `/v1/embeddings` at all, Anthropic
 * publishes no embedding model, and no OpenAI key is stored. Measured, not
 * assumed.
 *
 * So the contract is: ask for an embedding, get one or get `null`. A caller that
 * gets `null` must fall back to something that works rather than return nothing,
 * and `recall.ts` does exactly that. The alternative — shipping a hash of the
 * words and calling it semantic — would make every retrieval look intelligent
 * while ranking no better than the keyword match it replaced, and there would be
 * no way to tell from the outside which one you were getting.
 *
 * The moment a key with embedding access is stored, retrieval becomes semantic
 * with no migration: records are embedded on write, and `recall.ts` prefers
 * vectors whenever both sides have them.
 */

import { revealSecret } from '@/lib/secrets/vault';

export interface EmbeddingResult {
  readonly vectors: readonly (readonly number[])[];
  readonly model: string;
  readonly dimensions: number;
}

interface EmbeddingProvider {
  readonly id: string;
  readonly keyName: string;
  readonly model: string;
  embed(key: string, texts: readonly string[]): Promise<EmbeddingResult>;
}

async function apiKey(name: string): Promise<string | null> {
  const stored = await revealSecret(name);
  if (stored?.trim()) return stored.trim();
  const fromEnv = process.env[name];
  return fromEnv?.trim() ? fromEnv.trim() : null;
}

/**
 * OpenAI's embeddings API, and the shape Ollama mirrors when a deployment
 * exposes it. `input` takes an array and the response preserves order, which is
 * what makes embedding a whole collection one round trip rather than N.
 */
const openAiEmbeddings: EmbeddingProvider = {
  id: 'openai',
  keyName: 'OPENAI_API_KEY',
  model: process.env.OMNIOS_EMBEDDING_MODEL || 'text-embedding-3-small',
  async embed(key, texts) {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: this.model, input: [...texts] }),
      // Embedding rides inside a `remember` write and inside a turn. A hung
      // provider must cost seconds and fall back to lexical, never stall the
      // write — the same rule the Telegram client follows for the same reason.
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) {
      throw new Error(`Embedding request failed: ${response.status} ${response.statusText}`);
    }
    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[]; index?: number }>;
    };
    // Sorted by index rather than trusted in order: the API documents ordering,
    // but a vector silently attached to the wrong record is unfindable later.
    const rows = [...(payload.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const vectors = rows.map((row) => row.embedding ?? []);
    return { vectors, model: this.model, dimensions: vectors[0]?.length ?? 0 };
  },
};

/**
 * Ollama's native embedding endpoint. Kept because it is the provider this
 * workspace already has a key for — it is only the *plan* that lacks embedding
 * access, and that can change without anything here changing.
 */
const ollamaEmbeddings: EmbeddingProvider = {
  id: 'ollama',
  keyName: 'OLLAMA_API_KEY',
  model: process.env.OMNIOS_EMBEDDING_MODEL || 'embeddinggemma',
  async embed(key, texts) {
    const response = await fetch('https://ollama.com/api/embed', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: this.model, input: [...texts] }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) {
      throw new Error(`Embedding request failed: ${response.status} ${response.statusText}`);
    }
    const payload = (await response.json()) as { embeddings?: number[][] };
    const vectors = payload.embeddings ?? [];
    return { vectors, model: this.model, dimensions: vectors[0]?.length ?? 0 };
  },
};

/** OpenAI first: it is the one whose embedding API is known to answer. */
const PROVIDERS: readonly EmbeddingProvider[] = [openAiEmbeddings, ollamaEmbeddings];

/**
 * Embed a batch, or return null.
 *
 * Never throws. A retrieval that fails is a retrieval that should quietly fall
 * back to lexical ranking — the founder asked a question, not for a report on
 * which vector service was reachable.
 */
export async function embedTexts(texts: readonly string[]): Promise<EmbeddingResult | null> {
  if (texts.length === 0) return null;

  for (const provider of PROVIDERS) {
    const key = await apiKey(provider.keyName);
    if (!key) continue;
    try {
      const result = await provider.embed(key, texts);
      // A provider that answered with the wrong number of vectors has not
      // answered: pairing them with records by position would misattribute
      // every one after the gap.
      if (result.vectors.length !== texts.length) continue;
      if (result.dimensions === 0) continue;
      return result;
    } catch {
      // Try the next provider. An outage is not a reason to lose the turn.
    }
  }
  return null;
}

/** Whether semantic retrieval is available at all, for the UI to state plainly. */
export async function embeddingsAvailable(): Promise<{ ready: boolean; provider: string | null }> {
  for (const provider of PROVIDERS) {
    if (await apiKey(provider.keyName)) return { ready: true, provider: provider.id };
  }
  return { ready: false, provider: null };
}

/**
 * Cosine similarity, in −1..1.
 *
 * Guards the degenerate cases rather than returning NaN: a zero vector and a
 * length mismatch both mean "these are not comparable", and a NaN propagating
 * into a sort produces an order that changes between runs.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
