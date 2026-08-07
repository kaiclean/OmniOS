import 'server-only';

/**
 * Language-model providers.
 *
 * OmniOS always grounds an answer locally first (see `compose.ts`), then hands the
 * grounding to a provider for wording. That ordering is deliberate:
 *
 * - with no API key, the local grounding *is* the answer — real analysis of real
 *   records, clearly labelled as locally generated;
 * - with a key, the model receives facts already extracted from the store and is
 *   asked to phrase them, which is the shape least likely to invent numbers.
 *
 * A key may come from the vault or from the environment, in that order. The vault
 * is first because it is the path a founder can actually use: pasting a key into
 * Connections beats editing a dotfile and restarting the server. Either way the
 * plaintext lives in a local variable for the duration of one request and is
 * never stored on a message, a run, or a log line.
 *
 * Adding a provider means adding one object here. Nothing above this file changes.
 */

import type { LlmProvider, LlmRequest, LlmResponse, LlmToolCall, LlmToolResponse, LlmToolSchema } from '@/lib/domain';
import { revealSecret } from '@/lib/secrets/vault';

/**
 * The vault first, then the environment.
 *
 * Returning `null` rather than throwing keeps "no key configured" an ordinary
 * state — it is the default state for a new install, not an error.
 */
async function apiKey(name: string): Promise<string | null> {
  const stored = await revealSecret(name);
  if (stored && stored.trim()) return stored.trim();
  const fromEnv = process.env[name];
  return fromEnv && fromEnv.trim() ? fromEnv.trim() : null;
}

/**
 * The default. It does not call a model: it returns the grounded composition it
 * was handed, and reports `simulated: true` so the UI can say so plainly.
 */
export const simulatedProvider: LlmProvider = {
  id: 'local-reasoning',
  label: 'Local reasoning (no model)',
  simulated: true,
  keyName: null,
  available: async () => true,
  async complete(request: LlmRequest): Promise<LlmResponse> {
    const last = [...request.messages].reverse().find((m) => m.role === 'user');
    return {
      text: last?.content ?? '',
      providerId: 'local-reasoning',
      simulated: true,
    };
  },
};

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_KEY = 'ANTHROPIC_API_KEY';

export const anthropicProvider: LlmProvider = {
  id: 'anthropic',
  label: 'Anthropic',
  simulated: false,
  keyName: ANTHROPIC_KEY,
  available: async () => (await apiKey(ANTHROPIC_KEY)) !== null,
  async complete(request: LlmRequest): Promise<LlmResponse> {
    const key = await apiKey(ANTHROPIC_KEY);
    if (!key) throw new Error(`anthropicProvider.complete called without ${ANTHROPIC_KEY}`);

    const system = request.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const messages = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const response = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.OMNIOS_ASSISTANT_MODEL || 'claude-opus-4-5',
        max_tokens: request.maxTokens ?? 1400,
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(system ? { system } : {}),
        messages,
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic request failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = (payload.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');

    return {
      text,
      providerId: 'anthropic',
      simulated: false,
      ...(payload.usage?.input_tokens === undefined ? {} : { tokensIn: payload.usage.input_tokens }),
      ...(payload.usage?.output_tokens === undefined
        ? {}
        : { tokensOut: payload.usage.output_tokens }),
    };
  },
};

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const OPENAI_KEY = 'OPENAI_API_KEY';

export const openAiProvider: LlmProvider = {
  id: 'openai',
  label: 'OpenAI',
  simulated: false,
  keyName: OPENAI_KEY,
  available: async () => (await apiKey(OPENAI_KEY)) !== null,
  async complete(request: LlmRequest): Promise<LlmResponse> {
    const key = await apiKey(OPENAI_KEY);
    if (!key) throw new Error(`openAiProvider.complete called without ${OPENAI_KEY}`);

    const response = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OMNIOS_OPENAI_MODEL || 'gpt-4.1',
        max_tokens: request.maxTokens ?? 1400,
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    return {
      text: payload.choices?.[0]?.message?.content ?? '',
      providerId: 'openai',
      simulated: false,
      ...(payload.usage?.prompt_tokens === undefined ? {} : { tokensIn: payload.usage.prompt_tokens }),
      ...(payload.usage?.completion_tokens === undefined
        ? {}
        : { tokensOut: payload.usage.completion_tokens }),
    };
  },
};

const OLLAMA_ENDPOINT = 'https://ollama.com/v1/chat/completions';
const OLLAMA_KEY = 'OLLAMA_API_KEY';
const OLLAMA_MODEL = 'glm-5.2:cloud';

/**
 * A floor on output tokens, and it is not arbitrary.
 *
 * GLM-5.2 is a reasoning model: it spends output tokens thinking before it emits
 * any content. Measured against the live endpoint — a 200-token budget returned
 * `finish_reason: length` with **zero characters** of content, having consumed
 * all 200. `ask()` reads empty text as "the provider gave nothing" and falls
 * back to the local composition, so the symptom is not an error. It is a
 * correctly configured key quietly producing replies marked "generated locally".
 *
 * The floor is per-provider rather than global because it is a property of the
 * model, not of the caller's intent.
 */
const OLLAMA_MIN_OUTPUT_TOKENS = 2048;

/**
 * Ollama Cloud, through its OpenAI-compatible endpoint.
 *
 * Deliberately last among the real providers: it is the "for now" brain — the
 * one that makes the assistant real the day the founder has an Ollama key and
 * nothing else. The moment an Anthropic or OpenAI key lands in the vault,
 * first-available-wins hands the assistant to it with no further change.
 */
export const ollamaProvider: LlmProvider = {
  id: 'ollama',
  label: 'Ollama Cloud',
  simulated: false,
  keyName: OLLAMA_KEY,
  available: async () => (await apiKey(OLLAMA_KEY)) !== null,
  async complete(request: LlmRequest): Promise<LlmResponse> {
    const key = await apiKey(OLLAMA_KEY);
    if (!key) throw new Error(`ollamaProvider.complete called without ${OLLAMA_KEY}`);

    const response = await fetch(OLLAMA_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OMNIOS_OLLAMA_MODEL || OLLAMA_MODEL,
        max_tokens: Math.max(request.maxTokens ?? 1400, OLLAMA_MIN_OUTPUT_TOKENS),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama Cloud request failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    return {
      text: payload.choices?.[0]?.message?.content ?? '',
      providerId: 'ollama',
      simulated: false,
      ...(payload.usage?.prompt_tokens === undefined ? {} : { tokensIn: payload.usage.prompt_tokens }),
      ...(payload.usage?.completion_tokens === undefined
        ? {}
        : { tokensOut: payload.usage.completion_tokens }),
    };
  },
};

/**
 * OpenAI-shaped function calling, shared by every provider that speaks it.
 * The model plans; nothing here executes.
 */
async function openAiStyleToolCall(
  endpoint: string,
  key: string,
  model: string,
  request: LlmRequest,
  tools: readonly LlmToolSchema[],
): Promise<LlmToolResponse> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      max_tokens: request.maxTokens ?? 1400,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      tools: tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      })),
    }),
  });
  if (!response.ok) throw new Error(`Tool-call request failed: ${response.status} ${response.statusText}`);

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
      };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const message = payload.choices?.[0]?.message;

  const calls: LlmToolCall[] = (message?.tool_calls ?? []).flatMap((entry) => {
    const name = entry.function?.name;
    if (!name) return [];
    try {
      const args = JSON.parse(entry.function?.arguments || '{}') as Record<string, unknown>;
      return [{ name, args }];
    } catch {
      // A model that returns unparseable arguments has planned nothing usable;
      // dropping the call is the honest reading of it.
      return [];
    }
  });

  return {
    text: message?.content ?? '',
    calls,
    ...(payload.usage?.prompt_tokens === undefined ? {} : { tokensIn: payload.usage.prompt_tokens }),
    ...(payload.usage?.completion_tokens === undefined
      ? {}
      : { tokensOut: payload.usage.completion_tokens }),
  };
}

ollamaProvider.completeWithTools = async (request, tools) => {
  const key = await apiKey(OLLAMA_KEY);
  if (!key) throw new Error(`completeWithTools called without ${OLLAMA_KEY}`);
  return openAiStyleToolCall(
    OLLAMA_ENDPOINT,
    key,
    process.env.OMNIOS_OLLAMA_MODEL || OLLAMA_MODEL,
    // Same floor as `complete`: a reasoning model starved of output tokens plans
    // nothing and returns nothing, which reads as "the model declined to act".
    { ...request, maxTokens: Math.max(request.maxTokens ?? 1400, OLLAMA_MIN_OUTPUT_TOKENS) },
    tools,
  );
};

openAiProvider.completeWithTools = async (request, tools) => {
  const key = await apiKey(OPENAI_KEY);
  if (!key) throw new Error(`completeWithTools called without ${OPENAI_KEY}`);
  return openAiStyleToolCall(
    OPENAI_ENDPOINT,
    key,
    process.env.OMNIOS_OPENAI_MODEL || 'gpt-4.1',
    request,
    tools,
  );
};

/**
 * Anthropic's tool API, which is not OpenAI-shaped.
 *
 * Its absence was silent and total. Anthropic is first in the registry and the
 * product tells the founder Claude is "preferred automatically when present", so
 * the default configuration reached `detectAct`, found no `completeWithTools`,
 * and fell to the keyword matcher — which ranks against the *static registry
 * only*. Every bridged connection tool became unplannable, and the multi-round
 * loop had nothing to plan with. "Read my notes file" with a filesystem server
 * connected returned nothing at all, because `read` is not an imperative hint.
 *
 * Two wire differences from the OpenAI shape, both of which silently produce
 * zero calls if missed: tools carry `input_schema` rather than `parameters`, and
 * a call arrives as a `tool_use` content block whose `input` is already an
 * object — not a JSON string needing a parse.
 */
anthropicProvider.completeWithTools = async (request, tools): Promise<LlmToolResponse> => {
  const key = await apiKey(ANTHROPIC_KEY);
  if (!key) throw new Error(`completeWithTools called without ${ANTHROPIC_KEY}`);

  const system = request.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const messages = request.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  const response = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.OMNIOS_ASSISTANT_MODEL || 'claude-opus-4-5',
      max_tokens: request.maxTokens ?? 1400,
      ...(system ? { system } : {}),
      messages,
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      })),
      tool_choice: { type: 'auto' },
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic tool request failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    content?: Array<{ type: string; text?: string; name?: string; input?: unknown }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const blocks = payload.content ?? [];

  const calls: LlmToolCall[] = [];
  for (const block of blocks) {
    if (block.type !== 'tool_use' || !block.name) continue;
    calls.push({
      name: block.name,
      args: block.input && typeof block.input === 'object' ? (block.input as Record<string, unknown>) : {},
    });
  }

  return {
    text: blocks
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join(''),
    calls,
    ...(payload.usage?.input_tokens === undefined ? {} : { tokensIn: payload.usage.input_tokens }),
    ...(payload.usage?.output_tokens === undefined ? {} : { tokensOut: payload.usage.output_tokens }),
  };
};

const REGISTRY: readonly LlmProvider[] = [
  anthropicProvider,
  openAiProvider,
  ollamaProvider,
  simulatedProvider,
];

/** The first available provider. The simulated one is always last and always available. */
export async function activeProvider(): Promise<LlmProvider> {
  const pinned = await pinnedProviderId();
  if (pinned && pinned !== 'auto') {
    const chosen = REGISTRY.find((provider) => provider.id === pinned);
    // A pin that names a provider with no key falls back to the simulator rather
    // than to a *different* real provider. Silently answering with a brain the
    // founder did not choose is worse than plainly answering locally.
    if (chosen) return (await chosen.available()) ? chosen : simulatedProvider;
  }

  for (const provider of REGISTRY) {
    if (await provider.available()) return provider;
  }
  return simulatedProvider;
}

/**
 * The founder's choice, from settings, then the environment.
 *
 * Read lazily and defensively: `activeProvider` runs on every turn and on the
 * shell render, and a workspace that cannot be read must degrade to
 * first-available rather than throw.
 */
async function pinnedProviderId(): Promise<string | null> {
  const fromEnv = process.env.OMNIOS_ASSISTANT_PROVIDER?.trim();
  if (fromEnv) return fromEnv;
  try {
    const { getWorkspace } = await import('@/lib/data/store');
    return (await getWorkspace()).settings.assistantProvider ?? null;
  } catch {
    return null;
  }
}

export interface ProviderInfo {
  readonly id: string;
  readonly label: string;
  readonly simulated: boolean;
  /** The secret this provider looks for, or null if it needs none. */
  readonly keyName: string | null;
}

/**
 * Names and shapes only — no availability, and therefore no vault read.
 *
 * Split out because rendering "which provider wrote this message" is a label
 * lookup on a record that already exists, and should not become an async call
 * that hits the disk once per row.
 */
export function providerCatalogue(): ProviderInfo[] {
  return REGISTRY.map((p) => ({ id: p.id, label: p.label, simulated: p.simulated, keyName: p.keyName }));
}

export function providerLabel(providerId: string): string {
  return REGISTRY.find((p) => p.id === providerId)?.label ?? providerId;
}

export async function providerStatus(): Promise<Array<ProviderInfo & { available: boolean }>> {
  const out: Array<ProviderInfo & { available: boolean }> = [];
  for (const p of REGISTRY) {
    out.push({
      id: p.id,
      label: p.label,
      simulated: p.simulated,
      keyName: p.keyName,
      available: await p.available(),
    });
  }
  return out;
}
