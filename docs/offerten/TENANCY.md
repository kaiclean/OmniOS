# Offerten tenancy — founder decision recorded 2026-11-20

**Founder decision (2026-11-20): pilots stay as company scopes / company records
inside the founder's existing workspace for now. No separate authenticated
workspace per pilot yet; no pilot login is authorized by this decision.**
That is a data partition, **not authentication**, membership, row-level
authorization or a multi-tenant deployment.

The founder owns every space in OmniOS. One unlocked session can navigate them
all. `OMNIOS_ACCESS_KEY` gates the workspace as a whole; it does not identify a
pilot or authorize only one company. The Offerten action resolves a posted
company id against active workspace companies, which blocks fabricated scopes
but does not create per-user permissions.

## Choices

| Option | Current disposition |
| --- | --- |
| Founder reviews pilot company records inside the existing workspace | Chosen by the founder on 2026-11-20; no pilot login, real-data approval still pending |
| Pilot logs into OmniOS | Not part of the current decision. Any future pilot login requires a **separate workspace/data directory**, access key, separately protected vault key, process/port, backup and export ownership |
| Pilot receives access to another company tab in the founder's workspace | Not acceptable; tabs/scopes are not a tenant boundary |
| Shared hosted multi-tenant service | Not implemented; needs identity, membership/authorization, ownership enforcement, operational and legal design first |

This records the Phase 0 tenancy choice, not approval for real-data ingestion or
authenticated pilot access. If pilot login is considered later, record a new
decision and use a distinct persistent `OMNIOS_DATA_DIR`; never reuse the
founder's workspace or a stateless demo. Do not grant the pilot filesystem read
access to the founder's data or backups. Configure `OMNIOS_ACCESS_KEY` for remote
access and keep `OMNIOS_SECRET_KEY` outside the data directory. Existing
production loopback/tunnel guidance still applies.

Other open items remain pending (**—**): hosting location, ERP inventory/rights,
processor agreements, retention, VAT/rounding policy, any future pilot access
model, support access, incident handling and DPIA requirement. Until resolved,
only synthetic fixtures and local generated receipts are in scope.
