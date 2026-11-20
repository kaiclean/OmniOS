# Offerten fixture walkthrough

Use an isolated, persistent test workspace and a synthetic company. Do not point
the fixture exercise at the founder's real workspace. No real credentials,
customer data, live ERP, message delivery or fine-tuning are needed.

1. Open a company → **Offerten**. Personal life has no Offerten capability.
   The page labels generated material, displays missing measurements as `—`,
   and does not show connector secrets/configuration.
2. Select **Request fixture ingest**. Nothing imports until the existing
   Approvals inbox records the decision. A configured signed Telegram button
   reaches the same deciding function, not a separate gate.
3. Approve the pending fixture request and return. The generated ingest receipt
   reports synthetic quote/position counts, verified readback and SHA-256.
4. Enter a fixture customer, site and positions (use **Add position** / **Remove
   position**, up to 20 per draft), optional internal unit costs and
   independently calculated hand unit price. Currency defaults to CHF and
   language to German; VAT blank means unknown. Select **Create generated
   draft**. With `confirmWrites`, approve that write in the same inbox first.
   An optional manual baseline must be an owner-stated measurement; elapsed time
   is clocked internally from draft creation to approval, not entered or guessed.
5. Inspect agent price, hand price and deviation. A missing input produces `—`,
   not a fabricated zero. Read the customer-document preview separately from
   the **internal calculation** (cost, revenue, margin, private commentary).
6. Enter an owner price/correction, missing or corrected quantity, private reason
   or hand price and save.
   The write includes `expectedRevision`; a stale tab must refresh rather than
   overwrite a newer review. Public reasons remain safe fixed labels.
7. Optionally record a comparison or update private quote memory. Memory stays
   in this company, has explicit source/expiry, and is excluded from generic
   provider/search/MCP paths. It is not model training.
8. Select **Request fixture send · revision N** after reviewing that exact
   revision's customer document. The inbox records who decided and when before
   execution. Editing before approval makes the old revision fail; request the
   new revision instead. Successful execution creates a labelled local receipt
   with revision and customer-document hash. **No customer message is sent.**
9. Select **Prepare local export**, approve if writes are held, then **Download
   private export**. Read it back locally and verify company scope, complete
   working data/private memory and SHA-256. Do not upload it to a model or send
   it to a customer.
10. Select **Request deletion** and approve the destructive call. Read back the
    page and export state to check quote and derived private data removal.
    Accountability metadata may remain; delete local exports/backups separately
    according to the founder's eventual retention policy.

## Honest outcomes

Fixture ingestion, draft generation and a local send receipt do not establish
customer acceptance, time saved or production reliability. Owner-review metrics
require persisted decisions, with at least three observations for the displayed
owner acceptance rate; no acceptance or duration baseline is seeded.
Displayed relative price deviation compares independent hand calculation to
agent price; original-proposal versus final owner corrections are separate
observations, not a substitute for hand calculation.
An independent hand comparison requires both actual prices. Approval of a
fixture send is not customer acceptance. UI and tests prove only the paths
actually exercised; this walkthrough is not a claim that every deployment or
live-pilot acceptance check has passed.
