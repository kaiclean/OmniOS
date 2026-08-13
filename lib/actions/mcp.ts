'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  MCP_AUTONOMY,
  MCP_PRESETS,
  MCP_TRANSPORTS,
  credentialShape,
  isValidServerId,
  referencedSecretNames,
} from '@/lib/domain';
import type { McpConnectionState, McpServerConfig } from '@/lib/domain';
import { getWorkspace, saveWorkspace } from '@/lib/data/store';
import { probeServer } from '@/lib/mcp/client';
import { hasSecret } from '@/lib/secrets/vault';

/**
 * Connections — adding, editing and probing the servers OmniOS can reach.
 *
 * Every action here writes the *config*. None of them writes a credential: an
 * env value or header may reference `{{secret:NAME}}`, and that placeholder is
 * what gets persisted. The plaintext is fetched inside the MCP client at the
 * moment a transport is built, and never comes back out.
 *
 * Probing is a deliberate, explicit act rather than something pages do on
 * render. Connecting spawns a process or opens a socket, and a Server Component
 * that did that on every request would spawn one on every navigation.
 */

const KeyValueSchema = z
  .string()
  .trim()
  .max(4000)
  .transform((raw): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key) out[key] = value;
    }
    return out;
  });

const ServerSchema = z
  .object({
    id: z
      .string()
      .trim()
      .toLowerCase()
      .refine(isValidServerId, 'Use lower-case letters, numbers and hyphens, 2–40 characters.'),
    name: z.string().trim().min(1, 'Give the server a name.').max(60),
    description: z.string().trim().max(280).default(''),
    transport: z.enum(MCP_TRANSPORTS),
    command: z.string().trim().max(400).default(''),
    argsText: z.string().trim().max(2000).default(''),
    url: z.string().trim().max(600).default(''),
    env: KeyValueSchema,
    headers: KeyValueSchema,
    autonomy: z.enum(MCP_AUTONOMY),
    capabilityId: z.string().trim().min(1).max(60),
    enabled: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.transport === 'stdio' && !value.command) {
      ctx.addIssue({ code: 'custom', path: ['command'], message: 'A local server needs a command to run.' });
    }
    if (value.transport === 'http') {
      if (!value.url) {
        ctx.addIssue({ code: 'custom', path: ['url'], message: 'A remote server needs a URL.' });
        return;
      }
      let parsed: URL;
      try {
        parsed = new URL(value.url);
      } catch {
        ctx.addIssue({ code: 'custom', path: ['url'], message: 'That is not a valid URL.' });
        return;
      }
      const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      if (parsed.protocol !== 'https:' && !local) {
        ctx.addIssue({
          code: 'custom',
          path: ['url'],
          message: 'Use https. Plain http is only allowed for localhost.',
        });
      }
    }
  });

export interface McpFormState {
  readonly ok: boolean;
  readonly errors?: Readonly<Record<string, string>>;
  readonly message?: string;
  readonly serverId?: string;
}

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}

function toggle(form: FormData, key: string): boolean {
  return form.get(key) !== null;
}

/** Shell-ish splitting that honours quotes, because paths have spaces in them. */
function splitArgs(raw: string): string[] {
  const matches = raw.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return matches.map((token) =>
    (token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))
      ? token.slice(1, -1)
      : token,
  );
}

/**
 * Warn about a placeholder pointing at a secret that does not exist.
 *
 * Not an error: a founder may reasonably wire the server first and add the key
 * second. But an unresolved placeholder is passed to the server verbatim, which
 * fails in a way that looks like the server's fault, so it is worth saying.
 */
async function missingSecrets(config: McpServerConfig): Promise<string[]> {
  const referenced = new Set<string>();
  for (const value of [...Object.values(config.env ?? {}), ...Object.values(config.headers ?? {})]) {
    for (const name of referencedSecretNames(value)) referenced.add(name);
  }
  const missing: string[] = [];
  for (const name of referenced) {
    if (!(await hasSecret(name))) missing.push(name);
  }
  return missing;
}

export async function saveMcpServer(
  _previous: McpFormState,
  form: FormData,
): Promise<McpFormState> {
  const parsed = ServerSchema.safeParse({
    id: field(form, 'id'),
    name: field(form, 'name'),
    description: field(form, 'description'),
    transport: field(form, 'transport'),
    command: field(form, 'command'),
    argsText: field(form, 'args'),
    url: field(form, 'url'),
    env: field(form, 'env'),
    headers: field(form, 'headers'),
    autonomy: field(form, 'autonomy'),
    capabilityId: field(form, 'capabilityId'),
    enabled: toggle(form, 'enabled'),
  });

  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && !errors[key]) errors[key] = issue.message;
    }
    return { ok: false, errors, message: 'Nothing was saved.' };
  }

  const input = parsed.data;

  // A connection's env values and headers persist to workspace.json and are
  // read back as page props. A raw credential pasted here would sit in plaintext
  // on disk and echo into the browser — the vault exists precisely so it never
  // does. Refuse a credential-shaped value and point at the placeholder form.
  const rawValues = [
    ...Object.values(input.transport === 'stdio' ? input.env : {}),
    ...Object.values(input.transport === 'http' ? input.headers : {}),
  ];
  for (const value of rawValues) {
    const shape = credentialShape(value);
    if (shape) {
      return {
        ok: false,
        message: `That looks like it contains a ${shape}. Store it in the vault — Keys and secrets — and reference it here as {{secret:NAME}} instead of pasting the value.`,
      };
    }
  }

  const now = new Date().toISOString();
  const workspace = await getWorkspace();
  const existing = workspace.mcpServers.find((server) => server.id === input.id);

  const config: McpServerConfig = {
    id: input.id,
    name: input.name,
    description: input.description,
    transport: input.transport,
    ...(input.transport === 'stdio'
      ? { command: input.command, args: splitArgs(input.argsText), env: input.env }
      : { url: input.url, headers: input.headers }),
    enabled: input.enabled,
    autonomy: input.autonomy,
    capabilityId: input.capabilityId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    // Editing a server never silently re-enables a tool the founder switched off.
    disabledTools: existing?.disabledTools ?? [],
  };

  await saveWorkspace((current) => ({
    ...current,
    mcpServers: existing
      ? current.mcpServers.map((server) => (server.id === config.id ? config : server))
      : [...current.mcpServers, config],
  }));

  const missing = await missingSecrets(config);
  revalidatePath('/', 'layout');
  return {
    ok: true,
    serverId: config.id,
    message: missing.length
      ? `Saved. No secret named ${missing.join(' or ')} exists yet — add it before connecting.`
      : `Saved. Connect it to see what it offers.`,
  };
}

export async function addMcpPreset(presetId: string): Promise<McpFormState> {
  const preset = MCP_PRESETS.find((candidate) => candidate.id === presetId);
  if (!preset) return { ok: false, message: 'That preset does not exist.' };

  const workspace = await getWorkspace();
  // A second copy of a preset gets its own id rather than overwriting the first;
  // two filesystem servers pointed at two directories is a reasonable thing to want.
  let id = preset.id;
  for (let n = 2; workspace.mcpServers.some((server) => server.id === id); n += 1) {
    id = `${preset.id}-${n}`;
  }

  const now = new Date().toISOString();
  const env: Record<string, string> = {};
  for (const key of preset.envKeys ?? []) env[key] = `{{secret:${key}}}`;

  const config: McpServerConfig = {
    id,
    name: preset.name,
    description: preset.description,
    transport: preset.transport,
    ...(preset.transport === 'stdio'
      ? { command: preset.command ?? '', args: [...(preset.args ?? [])], env }
      : { url: preset.url ?? '', headers: {} }),
    // Added switched off on purpose. A preset carries placeholders and sometimes a
    // `<PATH>` the founder still has to fill in, so connecting it immediately would
    // spawn a process that is guaranteed to fail and blame the server for it.
    enabled: false,
    autonomy: preset.suggestedAutonomy,
    capabilityId: preset.capabilityId,
    createdAt: now,
    updatedAt: now,
    disabledTools: [],
  };

  await saveWorkspace((current) => ({ ...current, mcpServers: [...current.mcpServers, config] }));
  revalidatePath('/', 'layout');
  return { ok: true, serverId: id, message: `${preset.name} added. Finish the setup, then enable it.` };
}

export async function removeMcpServer(serverId: string): Promise<void> {
  const now = new Date().toISOString();
  await saveWorkspace((current) => ({
    ...current,
    mcpServers: current.mcpServers.filter((server) => server.id !== serverId),
    mcpStates: current.mcpStates.filter((state) => state.serverId !== serverId),
    // Revoke this server's standing grants, don't leave them live. Server ids are
    // reused (re-adding a preset reuses its id), so a dormant grant would silently
    // apply to a different connection the founder later stands up under that id.
    // Revoked, never deleted: calls that ran under it still reference it by id.
    grants: current.grants.map((grant) =>
      grant.serverId === serverId && !grant.revokedAt ? { ...grant, revokedAt: now } : grant,
    ),
  }));
  revalidatePath('/', 'layout');
}

export async function setMcpServerEnabled(serverId: string, enabled: boolean): Promise<void> {
  const now = new Date().toISOString();
  await saveWorkspace((current) => ({
    ...current,
    mcpServers: current.mcpServers.map((server) =>
      server.id === serverId ? { ...server, enabled, updatedAt: now } : server,
    ),
  }));
  revalidatePath('/', 'layout');
}

/** Switch one tool off without disconnecting the server it lives on. */
export async function setMcpToolEnabled(
  serverId: string,
  toolName: string,
  enabled: boolean,
): Promise<void> {
  const now = new Date().toISOString();
  await saveWorkspace((current) => ({
    ...current,
    mcpServers: current.mcpServers.map((server) => {
      if (server.id !== serverId) return server;
      const disabled = new Set(server.disabledTools);
      if (enabled) disabled.delete(toolName);
      else disabled.add(toolName);
      return { ...server, disabledTools: [...disabled], updatedAt: now };
    }),
  }));
  revalidatePath('/', 'layout');
}

/**
 * Connect, list, disconnect, and store what came back.
 *
 * The stored state is what every page renders, so a page never has to connect to
 * draw itself. It also means the UI can show that a server *was* reachable at a
 * given time without claiming it is reachable now — those are different facts and
 * the timestamp is shown alongside.
 */
export async function probeMcpServer(serverId: string): Promise<McpConnectionState | null> {
  const workspace = await getWorkspace();
  const config = workspace.mcpServers.find((server) => server.id === serverId);
  if (!config) return null;

  const state = await probeServer(config);
  const now = new Date().toISOString();

  await saveWorkspace((current) => ({
    ...current,
    mcpStates: [...current.mcpStates.filter((s) => s.serverId !== serverId), state],
    mcpServers: current.mcpServers.map((server) =>
      server.id === serverId
        ? {
            ...server,
            updatedAt: now,
            ...(state.status === 'connected'
              ? { lastConnectedAt: state.checkedAt, lastError: undefined }
              : state.error
                ? { lastError: state.error }
                : {}),
          }
        : server,
    ),
  }));

  revalidatePath('/', 'layout');
  return state;
}

export async function probeAllMcpServers(): Promise<void> {
  const workspace = await getWorkspace();
  // Sequential on purpose: probing spawns a child process per stdio server, and
  // firing a dozen at once on a laptop is a worse experience than waiting.
  for (const server of workspace.mcpServers) {
    if (server.enabled) await probeMcpServer(server.id);
  }
  revalidatePath('/', 'layout');
}
