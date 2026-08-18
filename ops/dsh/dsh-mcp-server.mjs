/**
 * A thin MCP server around DeepSeek Harness's headless profile.
 *
 * dsh ships an MCP *client* but no MCP *server*, and OmniOS's rule is that an
 * outward capability arrives only as an MCP server — one door, one lock. This
 * wrapper is that door for dsh: OmniOS connects to it like any other stdio
 * server, so every dsh run inherits the approval gate, risk tiers, grants and
 * Telegram delivery without a line of bespoke integration.
 *
 * It lives inside the repo rather than a package of its own so it resolves
 * @modelcontextprotocol/sdk from this repo's node_modules, same as the test
 * fixture server, and so its invariants are versioned with the app they guard.
 *
 * Two OmniOS invariants extend across this process boundary, enforced here
 * because the far side cannot:
 *
 * - Secret plaintext never crosses. dsh's session log persists everything
 *   model-visible, forever, so a task carrying a `{{secret:NAME}}` placeholder
 *   or anything shaped like a credential is refused before dsh spawns.
 *   Credentials a task genuinely needs belong in dsh's own credential seam.
 * - The child env is minimal: PATH and HOME only. OmniOS's environment may
 *   hold the access key or the data-dir location, and dsh has no business
 *   seeing either.
 */
import { spawn } from 'node:child_process';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const DSH_COMMAND = process.env.DSH_COMMAND || 'npx -y @deepseek-ai/dsh';
const DSH_PROFILE = process.env.DSH_PROFILE || 'headless';
const DEFAULT_TIMEOUT_SECONDS = Number(process.env.DSH_TIMEOUT_SECONDS) || 300;

/**
 * Shapes that mean "this is, or contains, a credential". The list is short and
 * high-precision on purpose: a false refusal costs an approval round-trip, but
 * a false pass writes a secret into an append-only log on another system.
 */
const SECRET_SHAPES = [
  { pattern: /\{\{\s*secret\s*:/i, label: 'a {{secret:NAME}} placeholder' },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'a private key block' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/, label: 'an AWS access key id' },
  { pattern: /\bghp_[A-Za-z0-9]{36}\b/, label: 'a GitHub personal access token' },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/, label: 'a GitHub fine-grained token' },
  { pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/, label: 'an API secret key' },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, label: 'a Slack token' },
];

export function secretShapeIn(text) {
  for (const { pattern, label } of SECRET_SHAPES) {
    if (pattern.test(text)) return label;
  }
  return null;
}

/** PATH and HOME only — see the module header. */
function childEnv() {
  return { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' };
}

function runDsh(args, timeoutSeconds) {
  const [command, ...baseArgs] = DSH_COMMAND.split(/\s+/).filter(Boolean);
  return new Promise((resolve) => {
    const child = spawn(command, [...baseArgs, ...args], {
      env: childEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutSeconds * 1000);
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: String(error?.message ?? error), timedOut: false });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

const text = (value, isError = false) => ({
  content: [{ type: 'text', text: value }],
  ...(isError ? { isError: true } : {}),
});

const server = new Server(
  { name: 'deepseek-harness', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'run_task',
      description:
        'Run one task through DeepSeek Harness (dsh --profile ' +
        DSH_PROFILE +
        ') and return its final answer. The task text must be self-contained and must ' +
        'never include credentials or {{secret:NAME}} placeholders — such tasks are refused.',
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'The self-contained task for the harness.' },
          timeout_seconds: {
            type: 'number',
            description: `Give up after this many seconds (default ${DEFAULT_TIMEOUT_SECONDS}).`,
          },
        },
        required: ['task'],
      },
    },
    {
      name: 'harness_status',
      description: 'Report whether DeepSeek Harness is installed and which version answers.',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = req.params.arguments ?? {};

  if (name === 'harness_status') {
    const result = await runDsh(['--version'], 60);
    if (result.code === 0) {
      return text(`DeepSeek Harness is available: ${result.stdout.trim() || 'version unknown'}`);
    }
    return text(
      `DeepSeek Harness did not answer (${DSH_COMMAND} --version failed: ${
        result.stderr.trim() || `exit ${result.code}`
      }). Install it or set DSH_COMMAND on this server's config.`,
      true,
    );
  }

  if (name === 'run_task') {
    const task = typeof args.task === 'string' ? args.task.trim() : '';
    if (!task) return text('run_task needs a non-empty "task".', true);

    const shape = secretShapeIn(task);
    if (shape) {
      return text(
        `Refused: the task contains ${shape}. Secret plaintext never crosses into the ` +
          'harness — its session log persists everything model-visible. Rewrite the task ' +
          "without the credential, or configure it in dsh's own credential seam.",
        true,
      );
    }

    const timeoutSeconds =
      typeof args.timeout_seconds === 'number' && args.timeout_seconds > 0
        ? Math.min(args.timeout_seconds, 3600)
        : DEFAULT_TIMEOUT_SECONDS;

    const result = await runDsh(['--profile', DSH_PROFILE, task], timeoutSeconds);
    if (result.timedOut) {
      return text(`The harness did not finish within ${timeoutSeconds}s and was stopped.`, true);
    }
    if (result.code !== 0) {
      return text(
        `The harness exited with ${result.code === null ? 'a spawn failure' : `code ${result.code}`}` +
          (result.stderr.trim() ? `: ${result.stderr.trim()}` : '.'),
        true,
      );
    }
    // Verbatim, including empty — inventing a cheerful "Done." would make "the
    // harness returned nothing" indistinguishable from "it succeeded and said so".
    return text(result.stdout.trim());
  }

  return text(`Unknown tool "${name}".`, true);
});

await server.connect(new StdioServerTransport());
