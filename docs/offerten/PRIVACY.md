# Offerten privacy — revDSG engineering checklist

This is an engineering checklist, **not a legal opinion, compliance
certification or completed DPIA**. Only synthetic fixture data is authorized for
this delivery. Owner of all unresolved rollout decisions: **founder**.

## Purpose and minimization

- Purpose: prepare and review a company's quote using its own evidence; compare
  an independently entered hand calculation and record the owner's decision.
- Import only quote/position fields needed for that purpose. Do not import
  employees, health data, mailboxes or full ERP tables just because accessible.
- Customer/site identifiers may be personal data. Private costs, margins,
  negotiations and owner explanations are confidential even without a person's
  name. A generated mark does not make real personal data safe.
- Customer documents use a strict allowlist and fixed safe reason text; internal
  calculations, rule facts and commentary are never customer attachments.

## Local processing and secrets

- Founder decision (2026-11-20): pilot company scopes / company records stay
  inside the founder's workspace; no separate authenticated workspace per pilot
  yet. Scope separation is not user authorization and does not permit pilot
  login; see [TENANCY.md](./TENANCY.md).
- Connector configuration may store vault **placeholders only**, never password
  text. The executor-facing ingestion path can validate configured vault
  references through its secret resolver for the duration of the call; unresolved
  references fail before ingestion. Plaintext is never passed to the fixture,
  retained, logged or put in a tool record. The fixture authenticates nothing and
  opens no network link. SQL connector types are declarations, not live adapters.
  Future executors must resolve secrets only for the duration of a call.
- The vault encrypts at rest, but its generated `.secret-key` shares the data
  directory unless `OMNIOS_SECRET_KEY` is provided separately. Set and protect
  that key before sync/backup or any real pilot. A copied whole data directory
  with its key is not protected against the holder.
- Filesystem access, unlocked sessions, browser exports and backups are in the
  trusted-operator threat boundary, not a multi-user security guarantee.

## Provider-transfer ban for private quoting data

- No private Offerten record, cost, margin, owner explanation, catalogue or
  derived memory may enter generic assistant/provider context, embedding
  requests, generic recall/search, MCP read tools or shared memory promotion.
- Private quote recall is explicitly company-local and local-only; no query
  embedding or cross-company/shared fallback. Do not fine-tune on fixture or
  real customer material in this delivery.
- A configured general model provider is **not** consent to transfer Offerten
  internals. Live sending/provider work requires a separate reviewed design.
- Telegram notifications use the ordinary gate; keep previews to package
  identity/revision and safe labels, never private amounts or payloads.

## Export, deletion and retention

- An approved/executed local export can be downloaded explicitly inside that
  company. Read the file back, check the bundle's SHA-256 and confirm it includes
  the company's quotes, catalogue, configuration placeholders, rules, receipts,
  audit and derived private memory. It is not a public customer document.
- Destructive deletion must go through the ordinary decision gate. Read back
  state and verify working quote data, derived Markdown/index/memory and private
  copies in tool payloads are absent; retain decision metadata for accountability.
- Downloaded exports, filesystem snapshots and backup archives are not remotely
  erased by app deletion. Their deletion and legal retention review belong to
  the operator.
- Working quote retention: **— (founder decision pending)**. No automatic
  real-data retention policy is implied. Pricing-rule expiry is an applicability
  limit, not a promise that all underlying data is deleted.

## Pre-pilot discovery register

| Item | Owner | Status |
| --- | --- | --- |
| ERP product/version, data owner, tables, row volume, sensitive fields, read-only mapping and export format | Founder | — |
| Hosting location, tunnel/operator access and backup locations | Founder | — |
| Processor agreements (PAs), subprocessors and cross-border transfer assessment | Founder | — |
| DPIA necessity and, if required, completed assessment | Founder with qualified advice | — |
| Data-subject notice/access/correction/deletion process | Founder | — |
| Retention, VAT, language, currency and rounding policy | Founder | — |
| Pilot tenancy / authenticated workspace choice | Founder | Decided 2026-11-20: company scopes / company records inside the founder's workspace; no separate authenticated workspace per pilot yet, no pilot login |

Do not treat unchecked items as accepted risk or a live-pilot authorization.
