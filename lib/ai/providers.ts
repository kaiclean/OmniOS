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

import type { LlmProvider, LlmRequest, LlmResponse } from '@/lib/domain';
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

const REGISTRY: readonly LlmProvider[] = [anthropicProvider, openAiProvider, simulatedProvider];

/** The first available provider. The simulated one is always last and always available. */
export async function activeProvider(): Promise<LlmProvider> {
  for (const provider of REGISTRY) {
    if (await provider.available()) return provider;
  }
  return simulatedProvider;
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
