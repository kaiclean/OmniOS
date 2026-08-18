# DeepSeek Harness (dsh) — OmniOS runbook

DeepSeek Harness (`dsh`, github.com/deepseek-ai/deepseek-harness) is an
MIT-licensed agent harness where everything is a plugin. OmniOS uses it in two
directions, and both go through one door each:

1. **As a development workbench for OmniOS itself** — dsh's web profile pointed
   at this repository, composed by [`cordis.patch.yml`](./cordis.patch.yml).
2. **As a connected capability inside the OmniOS product** — dsh's headless
   profile wrapped in a thin MCP server
   ([`dsh-mcp-server.mjs`](./dsh-mcp-server.mjs)), connected in OmniOS like any
   other MCP server so it inherits the approval gate, risk tiers, grants and
   Telegram approval delivery for free. dsh ships an MCP *client* but no MCP
   *server*, which is why this wrapper exists.

The reverse direction — dsh agents grounded on OmniOS records — is
[`omnios-mcp-server.sh`](./omnios-mcp-server.sh), a scoped read-only MCP server
over the store facade that dsh's `mcp-client` plugin can connect to.

dsh is a **developer preview** with promised compatibility-breaking changes.
Nothing in OmniOS's product core depends on dsh internals; every touchpoint is
behind an existing seam (MCP, the ops runbook). Pin the version you install and
treat upgrades as deliberate changes.

## 1. dsh as the OmniOS development harness

Install and run on the trusted Mac:

```sh
npx @deepseek-ai/dsh web        # Web UI on http://127.0.0.1:3080
```

To run with the OmniOS development overlay:

```sh
npx @deepseek-ai/dsh web --patch "$(pwd)/ops/dsh/cordis.patch.yml"
```

The patch confines the filesystem seam to this repository, names
`npm run verify` as the sanctioned verification path, and keeps the sandbox
seam on so spawned processes are confined. `CLAUDE.md` is the operating
contract for any agent working in this repo, dsh included — point the harness's
prompt/persona section at it rather than duplicating it.

One-shot jobs for the ops toolkit use the headless profile — it prints one
answer to stdout, exits with a meaningful code, and opens no listening port,
matching this machine's outbound-only posture:

```sh
npx @deepseek-ai/dsh --profile headless "summarise the last failed npm run verify output"
```

### Backups: the Harness home is deliberately excluded

`ops/backup.sh` archives the OmniOS data dir (workspace + vault key) and
nothing else. dsh's Harness home (its append-only session logs, under dsh's own
home directory) is **excluded on purpose**: those logs record everything
model-visible in every coding session, forever, which makes them a
data-retention liability rather than workspace data. If you decide a
trajectory is worth keeping, export it from dsh explicitly. If you change this
decision, change `ops/backup.sh` and this paragraph together.

## 2. dsh inside OmniOS (the wrapper)

Connect it from **Connections** using the *DeepSeek Harness* preset, replacing
the placeholder with the absolute path to `ops/dsh/dsh-mcp-server.mjs`. The
wrapper exposes:

| Tool | What it does | Risk under `ask-always` |
| --- | --- | --- |
| `run_task` | Runs `dsh --profile headless "<task>"`, returns the answer | `external` — every run waits for approval |
| `harness_status` | Reports whether dsh is installed and its version | `external` (`read` under `ask-writes`) |

Configuration is by env on the server config: `DSH_COMMAND` (default
`npx -y @deepseek-ai/dsh`), `DSH_PROFILE` (default `headless`),
`DSH_TIMEOUT_SECONDS` (default `300`).

Three rules the wrapper enforces, because they are OmniOS invariants extended
across a process boundary:

- **No secret plaintext crosses the boundary.** A task containing a
  `{{secret:NAME}}` placeholder or anything shaped like a credential is
  refused before dsh is spawned. dsh persists everything model-visible in its
  session log; a leaked secret there is a leaked secret. Credentials a dsh
  task genuinely needs belong in dsh's own credential seam, configured in dsh.
- **The child env is minimal.** dsh is spawned with only `PATH`, `HOME` and
  the `DSH_*` knobs — never OmniOS's own environment, which may hold the
  access key or data-dir location.
- **Scope stays with the caller.** The wrapper receives task text only. The
  assistant composes that text from scoped reads, so a task launched from a
  company space carries only that scope's context; there is no aggregate view
  on this side of the boundary either.

Recurring, well-understood tasks can be pre-approved with a `PermissionGrant`
exactly like any other MCP tool — exact (server, tool, scope) triple, expiring,
revocable. Nothing about grants widens for dsh.

## 3. OmniOS records for dsh agents (the reverse direction)

`omnios-mcp-server.sh` starts a **read-only** MCP server over the OmniOS store
facade. Register it in dsh's `mcp-client` plugin (stdio transport) and every
dsh agent can ground on real workspace records:

| Tool | What it does |
| --- | --- |
| `list_spaces` | Names the personal space and each company — ids and names only |
| `get_scope_summary` | Record counts per collection for one named scope |
| `list_records` | Records from one collection in one named scope |

Every tool takes an explicit scope key (`personal`, `company:<id>`,
`shared:<capabilityId>`) and refuses without one — there is no
"read everything" over the wire, same as in-process. There are no mutating
tools; if dsh work should change the workspace, it comes back through the
OmniOS assistant and the approval gate, not through a side door.

The launcher needs `npx` (it runs the TypeScript entry through `tsx` with the
`react-server` condition so `server-only` modules load outside Next):

```sh
ops/dsh/omnios-mcp-server.sh
```
