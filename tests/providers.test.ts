import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LlmToolSchema } from '@/lib/domain';
import { anthropicProvider, openAiProvider, ollamaProvider } from '@/lib/ai/providers';

/**
 * The tool-calling wire contract, per provider.
 *
 * Anthropic shipped without `completeWithTools` at all, and because it is first
 * in the registry — and the product tells the founder Claude is "preferred
 * automatically when present" — the default configuration silently fell back to
 * the keyword matcher. That matcher ranks against the static registry only, so
 * every bridged connection tool became unplannable and the multi-round loop had
 * nothing to plan with. Nothing failed; the assistant just quietly could not do
 * things.
 *
 * These pin the shape rather than the behaviour, because the shape is what fails
 * silently: Anthropic wants `input_schema` where OpenAI wants `parameters`, and
 * sending the wrong one returns a cheerful 200 with zero tool calls.
 */

const TOOLS: LlmToolSchema[] = [
  {
    name: 'create_task',
    description: 'Create a task.',
    parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
  },
];

function captureFetch(payload: unknown) {
  const seen: { url?: string; body?: any; headers?: Record<string, string> } = {};
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    seen.url = url;
    seen.body = JSON.parse(String(init.body));
    seen.headers = init.headers as Record<string, string>;
    return { ok: true, status: 200, json: async () => payload } as unknown as Response;
  });
  return seen;
}

afterEach(() => vi.unstubAllGlobals());

describe('every real provider can plan tool calls', () => {
  it.each([
    ['anthropic', anthropicProvider],
    ['openai', openAiProvider],
    ['ollama', ollamaProvider],
  ])('%s implements completeWithTools', (_id, provider) => {
    // The absence of this method is not an error anywhere — `detectAct` simply
    // falls back — so only a test can notice a provider that cannot act.
    expect(typeof provider.completeWithTools).toBe('function');
  });
});

describe('anthropic speaks its own dialect', () => {
  it('sends input_schema, not parameters, and reads tool_use blocks back', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    const seen = captureFetch({
      content: [
        { type: 'text', text: 'Creating that now.' },
        { type: 'tool_use', name: 'create_task', input: { title: 'Call the auditor' } },
      ],
      usage: { input_tokens: 11, output_tokens: 22 },
    });

    const result = await anthropicProvider.completeWithTools!(
      { messages: [{ role: 'user', content: 'create a task' }] },
      TOOLS,
    );

    // The silent-failure shape: `parameters` here returns 200 and zero calls.
    expect(seen.body.tools[0]).toHaveProperty('input_schema');
    expect(seen.body.tools[0]).not.toHaveProperty('parameters');
    expect(seen.body.tool_choice).toEqual({ type: 'auto' });
    expect(seen.headers?.['anthropic-version']).toBe('2023-06-01');

    // `input` arrives as an object here, unlike OpenAI's JSON string — parsing
    // it as a string yields "[object Object]" and loses every argument.
    expect(result.calls).toEqual([{ name: 'create_task', args: { title: 'Call the auditor' } }]);
    expect(result.text).toBe('Creating that now.');
    expect(result.tokensIn).toBe(11);
    expect(result.tokensOut).toBe(22);
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('reports a non-2xx rather than returning an empty plan', async () => {
    // `detectAct` catches and falls back to the local path. That is only correct
    // if a refusal actually throws — a silent empty plan would read as "the
    // model declined to act", which is a different and wrong answer.
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 401, statusText: 'Unauthorized' }) as Response);
    await expect(
      anthropicProvider.completeWithTools!({ messages: [{ role: 'user', content: 'x' }] }, TOOLS),
    ).rejects.toThrow(/401/);
    delete process.env.ANTHROPIC_API_KEY;
  });
});
