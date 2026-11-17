# Security policy

## Supported version

Only the `main` branch is supported.

## Reporting a problem

Please report privately. Use GitHub's private vulnerability reporting on this repository (Security tab, "Report a vulnerability"), or contact the maintainer through the GitHub profile of the repository owner. Please do not open a public issue for a suspected vulnerability.

## Threat model

OmniOS is a single-founder app that runs on one trusted machine. What the code does about it:

- **Remote access.** With `OMNIOS_ACCESS_KEY` set, `proxy.ts` puts pages, Server Actions and APIs behind a signed, HttpOnly session cookie. The production start script binds `127.0.0.1` and the runbook uses an outbound-only tunnel (`ops/`).
- **Outward and irreversible actions.** Tools tiered `destructive` or `external` run only after a recorded human decision (`lib/domain/tools.ts`, `lib/approvals/decide.ts`).
- **Approval from Telegram.** The webhook fails closed without its secret and verifies a chat-bound HMAC (`app/api/telegram/webhook/route.ts`, `lib/telegram/signing.ts`).
- **Secrets.** Stored in an AES-256-GCM vault and kept out of agent context, tool calls and logs (`lib/secrets/vault.ts`). The workspace directory is git-ignored (`.gitignore`).
- **Data separation.** Reads are scoped per company or personal space; a test guards the one aggregation module (`tests/boundaries.test.ts`).

## Out of scope

- Multi-user or multi-tenant deployments; OmniOS has a single-operator model.
- Anyone with an unlocked session on the host machine or read access to its data directory.
- Third-party MCP servers and model providers the operator chooses to connect.
- Vulnerabilities in dependencies that are not reachable through OmniOS.
