/**
 * The prompts OmniOS offers the founder before they type anything.
 *
 * These live here rather than in the copilot component because they are a
 * routing contract, not copy: a suggestion the router cannot place would have
 * the assistant answer its own suggestion with "no specialist owns this". A test
 * asserts every one of them reaches a real specialist.
 */

export const ASSISTANT_SUGGESTIONS: readonly string[] = [
  'What should I do today?',
  'How is cash flow across everything?',
  'What is slipping that I have not noticed?',
  'Who have I not spoken to in too long?',
];

/** Offered inside a company, where the founder-level questions make less sense. */
export const COMPANY_SUGGESTIONS: readonly string[] = [
  'How is cash flow looking?',
  'Which deals are worth chasing?',
  'What is blocking delivery?',
  'What should this company automate first?',
];
