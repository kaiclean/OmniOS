# Offerten tenancy — founder decision pending

**Current default: company-scope-only inside the founder's existing workspace.**
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
| Founder reviews synthetic or later explicitly authorized company material locally | Default implementation; no pilot login, real-data approval still pending |
| Pilot logs into OmniOS | **Separate workspace/data directory mandatory**, with separate access key, separately protected vault key, process/port, backup and export ownership |
| Pilot receives access to another company tab in the founder's workspace | Not acceptable; tabs/scopes are not a tenant boundary |
| Shared hosted multi-tenant service | Not implemented; needs identity, membership/authorization, ownership enforcement, operational and legal design first |

The founder must record the chosen deployment before any real pilot. If a pilot
logs in, use a distinct persistent `OMNIOS_DATA_DIR`; never reuse the founder's
workspace or a stateless demo. Do not grant the pilot filesystem read access to
the founder's data or backups. Configure `OMNIOS_ACCESS_KEY` for remote access
and keep `OMNIOS_SECRET_KEY` outside the data directory. Existing production
loopback/tunnel guidance still applies.

Unknowns owned by the founder: actual pilot identity/access model, hosting
location, ERP inventory/rights, processor agreements, retention, support access,
incident handling and DPIA requirement. Until resolved, only synthetic fixtures
and local generated receipts are in scope.
