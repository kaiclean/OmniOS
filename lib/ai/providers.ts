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
 * Adding a provider means adding one object here. Nothing above this file changes.
 */

import type { LlmProvider, LlmRequest, LlmResponse } from '@/lib/domain';

/**
 * The default. It does not call a model: it returns the grounded composition it
 * was handed, and reports `simulated: true` so the UI can say so plainly.
 */
export const simulatedProvider: LlmProvider = {
  id: 'local-reasoning',
  label: 'Local reasoning (no model)',
  simulated: true,
  available: () => true,
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

export const anthropicProvider: LlmProvider = {
  id: 'anthropic',
  label: 'Anthropic',
  simulated: false,
  available: () => Boolean(process.env.ANTHROPIC_API_KEY),
  async complete(request: LlmRequest): Promise<LlmResponse> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('anthropicProvider.complete called without ANTHROPIC_API_KEY');

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
        'x-api-key': apiKey,
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

const REGISTRY: readonly LlmProvider[] = [anthropicProvider, simulatedProvider];

/** The first available provider. The simulated one is always last and always available. */
export function activeProvider(): LlmProvider {
  return REGISTRY.find((p) => p.available()) ?? simulatedProvider;
}

export function providerStatus(): Array<{ id: string; label: string; available: boolean; simulated: boolean }> {
  return REGISTRY.map((p) => ({
    id: p.id,
    label: p.label,
    available: p.available(),
    simulated: p.simulated,
  }));
}
