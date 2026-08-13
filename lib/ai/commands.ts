/**
 * The slash-command registry — client-safe on purpose, so the composer can
 * show what exists and the server can parse it from the same data. A command
 * names one tool and owns the deterministic parse from "everything after the
 * command word" to that tool's arguments; validation, risk tier and the gate
 * still come from the tool registry at execution time, exactly as if the same
 * call had arrived from a form.
 */

export interface SlashParse {
  readonly ok: boolean;
  readonly args?: Readonly<Record<string, string | number>>;
  /** Founder-facing guidance when the input cannot become a call. */
  readonly error?: string;
}

export interface SlashCommand {
  readonly command: string;
  readonly toolId: string;
  readonly hint: string;
  readonly parse: (rest: string) => SlashParse;
}

/** One required single-value argument — the original command shape. */
function oneArg(argName: string): (rest: string) => SlashParse {
  return (rest) => ({ ok: true, args: { [argName]: rest.trim() } });
}

/**
 * First line is one field, the lines after it are another. This is what makes
 * a document authorable from the composer at all: local parsing cannot carry
 * a prose body through free phrasing, and a founder should not need a model
 * to write something down.
 */
function titleAndBody(titleArg: string, bodyArg: string, error: string): (rest: string) => SlashParse {
  return (rest) => {
    const newline = rest.indexOf('\n');
    const title = (newline === -1 ? rest : rest.slice(0, newline)).trim();
    const body = newline === -1 ? '' : rest.slice(newline + 1).trim();
    if (!title || !body) return { ok: false, error };
    return { ok: true, args: { [titleArg]: title, [bodyArg]: body } };
  };
}

/** "49.90 Software subscription" → integer minor units plus a label. */
function amountAndLabel(direction: 'in' | 'out'): (rest: string) => SlashParse {
  return (rest) => {
    const match = /^([0-9][0-9']*(?:[.,][0-9]{1,2})?)\s+(.+)$/s.exec(rest.trim());
    if (!match?.[1] || !match[2]) {
      return {
        ok: false,
        error: `Say it like: /${direction === 'out' ? 'expense' : 'income'} 49.90 Software subscription — the amount first, then what it was.`,
      };
    }
    const amount = Number.parseFloat(match[1].replace(/'/g, '').replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: 'That amount did not parse as a number.' };
    }
    return {
      ok: true,
      // Minor units, rounded once here — the ledger stores integers only.
      args: { amountMinor: Math.round(amount * 100), direction, label: match[2].trim() },
    };
  };
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    command: 'task',
    toolId: 'create_task',
    hint: '/task <title> — create a task in this space',
    parse: oneArg('title'),
  },
  {
    command: 'goal',
    toolId: 'create_goal',
    hint: '/goal <outcome> — set a goal in this space',
    parse: oneArg('title'),
  },
  {
    command: 'remember',
    toolId: 'remember',
    hint: '/remember <fact> — store it in this space’s memory',
    parse: oneArg('text'),
  },
  {
    command: 'doc',
    toolId: 'write_doc',
    hint: '/doc <title> ⏎ <body…> — write a document; first line titles it',
    parse: titleAndBody(
      'title',
      'body',
      'A doc needs a body: the first line is the title, everything after the first line break is the document. Shift+Enter adds a line.',
    ),
  },
  {
    command: 'risk',
    toolId: 'add_risk',
    hint: '/risk <label> ⏎ <what happens if it lands> — flag a risk',
    parse: titleAndBody(
      'label',
      'detail',
      'A risk needs its consequence: the first line names it, the lines after say what happens if it lands. Shift+Enter adds a line.',
    ),
  },
  {
    command: 'expense',
    toolId: 'add_finance_entry',
    hint: '/expense <amount> <label> — money out, booked today',
    parse: amountAndLabel('out'),
  },
  {
    command: 'income',
    toolId: 'add_finance_entry',
    hint: '/income <amount> <label> — money in, booked today',
    parse: amountAndLabel('in'),
  },
];
