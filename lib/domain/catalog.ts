/**
 * The connector catalog — every service OmniOS knows how to talk about, with
 * honest states.
 *
 * This is a map, not an inventory. A catalog entry does not mean OmniOS ships
 * an integration; it means OmniOS knows what the service is for, which MCP
 * server usually provides it, and what connecting it would unlock. The states
 * a card can show are derived from what is actually configured — an entry
 * whose server has never been probed says so, and nothing in this file can
 * make a service look connected when it is not.
 *
 * Every service still arrives the same way: as an MCP server on Connections,
 * through the same gate. The catalog exists so the founder browses by need
 * ("post to social") rather than by protocol.
 */

export const CONNECTOR_CATEGORIES = [
  'communication',
  'calendar',
  'files',
  'development',
  'business',
  'ai',
] as const;
export type ConnectorCategory = (typeof CONNECTOR_CATEGORIES)[number];

export const CONNECTOR_CATEGORY_LABELS: Record<ConnectorCategory, string> = {
  communication: 'Communication',
  calendar: 'Calendar & scheduling',
  files: 'Files & knowledge',
  development: 'Development',
  business: 'Business',
  ai: 'AI & models',
};

export interface CatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly category: ConnectorCategory;
  /** What connecting it unlocks, in the founder's terms. */
  readonly unlocks: string;
  /** An MCP preset that supplies it in one click, when one exists. */
  readonly presetId?: string;
  /** How it usually arrives when there is no preset. */
  readonly how: string;
}

export const CONNECTOR_CATALOG: readonly CatalogEntry[] = [
  // Communication
  { id: 'gmail', name: 'Gmail', category: 'communication', unlocks: 'Reading, drafting and — with your approval — sending email.', how: 'An MCP server with a Gmail token, e.g. a community Gmail MCP server run locally.' },
  { id: 'outlook', name: 'Outlook', category: 'communication', unlocks: 'Email and calendar in Microsoft accounts.', how: 'A Microsoft Graph MCP server with an app token.' },
  { id: 'slack', name: 'Slack', category: 'communication', unlocks: 'Posting updates where a team already is.', presetId: 'slack', how: 'The Slack preset plus a bot token in the vault.' },
  { id: 'discord', name: 'Discord', category: 'communication', unlocks: 'Community posts and moderation.', how: 'A community Discord MCP server with a bot token.' },
  { id: 'whatsapp', name: 'WhatsApp-compatible messaging', category: 'communication', unlocks: 'Messages to customers who live in chat apps.', how: 'A bridge MCP server against the WhatsApp Business API.' },
  // Calendar
  { id: 'google-calendar', name: 'Google Calendar', category: 'calendar', unlocks: 'Real scheduling: the assistant sees and books actual time.', how: 'A Google Calendar MCP server with OAuth credentials you create in Google Cloud.' },
  { id: 'outlook-calendar', name: 'Outlook Calendar', category: 'calendar', unlocks: 'Scheduling for Microsoft-centric teams.', how: 'The same Microsoft Graph MCP server as Outlook email.' },
  // Files
  { id: 'filesystem', name: 'Local files', category: 'files', unlocks: 'Drafting documents and reading project files on this machine.', presetId: 'filesystem', how: 'The Filesystem preset pointed at a directory you nominate.' },
  { id: 'google-drive', name: 'Google Drive', category: 'files', unlocks: 'The documents your businesses already live in.', how: 'A Google Drive MCP server with OAuth credentials.' },
  { id: 'dropbox', name: 'Dropbox', category: 'files', unlocks: 'Files synced across machines.', how: 'A community Dropbox MCP server with an access token.' },
  { id: 'notion', name: 'Notion', category: 'files', unlocks: 'Pages and databases your notes already live in.', how: 'The official Notion MCP server with an integration token.' },
  // Development
  { id: 'github', name: 'GitHub', category: 'development', unlocks: 'Repositories, issues and pull requests — shipping real code changes.', presetId: 'github', how: 'The GitHub preset plus a personal access token in the vault.' },
  { id: 'gitlab', name: 'GitLab', category: 'development', unlocks: 'The same, for GitLab-hosted work.', how: 'A GitLab MCP server with a project token.' },
  { id: 'vercel', name: 'Vercel', category: 'development', unlocks: 'Deploying sites — the storefront step of a launch programme.', how: 'A Vercel MCP server with a deploy token.' },
  { id: 'cloudflare', name: 'Cloudflare', category: 'development', unlocks: 'DNS, workers and storage for anything you host.', how: 'The official Cloudflare MCP server with an API token.' },
  { id: 'supabase', name: 'Supabase', category: 'development', unlocks: 'A real database behind a product.', how: 'The official Supabase MCP server with a project token.' },
  { id: 'postgres', name: 'Postgres', category: 'development', unlocks: 'Reading production data into Finance and Development.', presetId: 'postgres', how: 'The Postgres preset with a connection string in the vault.' },
  { id: 'browser', name: 'Browser automation', category: 'development', unlocks: 'Anything that needs a real page — including sites with no API.', presetId: 'puppeteer', how: 'The Browser preset; no credentials needed.' },
  // Business
  { id: 'stripe', name: 'Stripe', category: 'business', unlocks: 'Payments, customers and revenue as they actually happen.', how: 'The official Stripe MCP server with a restricted API key.' },
  { id: 'social', name: 'Social platforms', category: 'business', unlocks: 'Publishing the content the Creative Studio produces, and reading what it earned.', how: 'A per-platform MCP server (X, LinkedIn, Instagram…) with that platform’s API credentials.' },
  { id: 'analytics', name: 'Web analytics', category: 'business', unlocks: 'Traffic and conversion pulled back into KPIs.', how: 'An MCP server for your analytics provider (Plausible, GA…).' },
  { id: 'ads', name: 'Advertising platforms', category: 'business', unlocks: 'Campaign spend and performance where the launch budget goes.', how: 'A per-network MCP server with ad-account credentials.' },
  // AI
  { id: 'ollama-cloud', name: 'Ollama Cloud', category: 'ai', unlocks: 'The assistant’s wording brain — already supported natively.', how: 'A key named OLLAMA_API_KEY in the vault. No server needed; OmniOS speaks to it directly.' },
  { id: 'anthropic', name: 'Anthropic', category: 'ai', unlocks: 'Claude as the assistant’s brain, preferred automatically when present.', how: 'A key named ANTHROPIC_API_KEY in the vault.' },
  { id: 'openai', name: 'OpenAI', category: 'ai', unlocks: 'GPT as the assistant’s brain.', how: 'A key named OPENAI_API_KEY in the vault.' },
  { id: 'web-fetch', name: 'Web fetch', category: 'ai', unlocks: 'Reading the open web — research, competitors, documentation.', presetId: 'fetch', how: 'The Web fetch preset; no credentials needed.' },
];

export const CONNECTOR_STATES = [
  'connected',
  'configured',
  'error',
  'one-click',
  'needs-server',
] as const;
export type ConnectorState = (typeof CONNECTOR_STATES)[number];

export const CONNECTOR_STATE_LABELS: Record<ConnectorState, string> = {
  connected: 'Connected',
  configured: 'Configured · not yet probed',
  error: 'Configured · failing',
  'one-click': 'Preset available',
  'needs-server': 'Needs an MCP server',
};
