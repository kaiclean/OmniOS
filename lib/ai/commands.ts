/**
 * The slash-command registry — client-safe on purpose, so the composer can
 * show what exists and the server can parse it from the same data. A command
 * is one named tool with one argument; everything else about it (validation,
 * risk tier, the gate) comes from the tool registry at execution time.
 */

export interface SlashCommand {
  readonly command: string;
  readonly toolId: string;
  readonly argName: string;
  readonly hint: string;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { command: 'task', toolId: 'create_task', argName: 'title', hint: '/task <title> — create a task in this space' },
  { command: 'goal', toolId: 'create_goal', argName: 'title', hint: '/goal <outcome> — set a goal in this space' },
  { command: 'remember', toolId: 'remember', argName: 'text', hint: '/remember <fact> — store it in this space’s memory' },
];
