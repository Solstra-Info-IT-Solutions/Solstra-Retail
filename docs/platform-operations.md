# Platform operations deployment notes

## Required environment configuration

- `WEBHOOK_SECRET_ENCRYPTION_KEY`: exactly 32 random bytes encoded as 64 hexadecimal characters. Generate with `openssl rand -hex 32`. Webhook signing secrets are encrypted with AES-256-GCM before they are stored. Do not rotate this key without re-encrypting existing integration secrets.
- `PLATFORM_ADMIN_USER_IDS`: comma-separated authenticated User ObjectIds allowed to use cross-tenant SaaS operator APIs. Leave unset to disable platform-wide tenant administration. Do not add ordinary tenant owner IDs.
- `BACKUP_REPLICATION_ENDPOINT`: optional public HTTPS receiver on port 443 that accepts raw `application/gzip` POST requests. The receiver must store the archive and verify the `x-solstra-backup-sha256` header.
- `BACKUP_REPLICATION_TOKEN`: optional bearer token for the off-site backup receiver. Keep it in the deployment secret manager; never commit it.

## Automation and notifications

Automation rules are tenant-scoped and support the event types `SALE_CREATED`, `EXPENSE_PENDING_APPROVAL`, `LOW_STOCK` and `MANUAL`. Actions currently supported are in-app notifications and queued webhook delivery. Rule executions have a unique tenant/rule/event key and can be retried after a failed execution. Successful sales and expense creation emit events; other event types can be triggered by an authorized workspace administrator or future domain integrations.

Notifications are delivered to each active user in the tenant and have per-user read state. Email, SMS and WhatsApp can be queued through a tenant-configured HTTPS provider adapter. The adapter receives `{ channel, to, subject, message, metadata }` as JSON and a bearer token; successful HTTP responses are treated as accepted delivery. The adapter must implement provider-specific message dispatch, delivery receipts and suppression policies.

## Webhook integrations

Only HTTPS endpoints on port 443 are accepted. Local/private IP ranges and localhost names are rejected, redirects are not followed, and deliveries are signed using HMAC-SHA256 in the `x-solstra-signature` header. The receiver should verify the signature against the exact raw request body. Delivery retries use exponential backoff and stop after five attempts. The background worker checks due deliveries once per minute.

## Offline POS

The browser caches recently retrieved product catalogue entries and stores queued sale payloads in IndexedDB. When connectivity returns, the POS submits batches to `POST /api/v1/platform/offline/sync`. The server validates each sale using the normal sales workflow, tenant scope, stock checks, accounting transaction and existing sale idempotency key. A queued offline sale is **not a finalized invoice** until the server reports `SUCCEEDED`. Stock, price, promotion and customer state can change while offline; the server is authoritative and may reject a stale queued sale for review. Do not clear browser site data while the queue is pending.

## Backups and recovery

Backup policies support daily or weekly schedules. The API worker claims due policies atomically and creates compressed tenant-scoped JSON archives in MongoDB GridFS, with SHA-256 verification and configurable retention (1–90 days). User password hashes are excluded. Archives can be listed, downloaded and validated against their workspace identity.

GridFS is in the same MongoDB deployment, so these snapshots protect against some application-level mistakes but **are not a disaster-recovery copy for loss of the MongoDB cluster/account**. Configure `BACKUP_REPLICATION_ENDPOINT` and `BACKUP_REPLICATION_TOKEN` to POST scheduled archives to a separately administered receiver. Replication is recorded per artifact; a successful HTTP acknowledgement is not a substitute for testing the receiver's storage and restore process. Restore is deliberately validation-only in this release; production restore should be performed in an isolated database with a reviewed migration and reconciliation plan.

## SaaS operator controls

Cross-tenant tenant listing, plan changes, suspension and usage summaries are protected by `PLATFORM_ADMIN_USER_IDS`. Changes require a reason and create append-only `saas_admin_audit` records. Workspace user, product and branch creation is checked against the configured tenant capacity fields. Subscription invoices can be requested by workspace owners/admins. The current release supports manual platform-operator payment reconciliation at fixed monthly plan rates (Starter ₹499, Growth ₹1,499, Business ₹3,999; Enterprise by quotation) and optional Razorpay checkout/webhook settlement. It does not support recurring mandate auto-debit or calculate GST on subscription invoices.

## Inventory valuation reconciliation

The valuation reconciliation endpoint is read-only. It reports products awaiting verified opening valuation and flags warehouse allocations that exceed aggregate quantity or value. Unallocated aggregate stock is permitted. It does not automatically rewrite historical inventory cost, accounting journals or stock movements.

## Advanced inventory lifecycle

The Advanced Inventory workspace exposes batch receipts and expiry lists, serial registry management, draft stocktakes with explicit completion, and dynamic pricing rule management. POS checkout now requires selecting the exact available warehouse serials when a product has registered serial inventory. Serial states are moved to SOLD in the same database transaction as the invoice, and credit-note returns restore serialized units to IN_STOCK only when the return is restocked; non-restocked serials remain in RETURNED quarantine state. When a warehouse/product has batch records, POS consumes unexpired batches by FEFO and records exact batch allocations on invoice lines. Restocked credit-note returns restore those quantities to the original unexpired batches; expired batch returns must be quarantined by issuing the credit note without restocking. Products with legacy unbatched stock remain sellable when no batch records exist for the selected warehouse.


## GST e-invoice preparation and external accounting interchange

- Reports expose `GET /api/v1/reports/gst/einvoice-readiness?from=YYYY-MM-DD&to=YYYY-MM-DD` for issued B2B invoices. It checks seller/recipient GSTIN format, invoice number length, state codes, recipient name, HSN/UQC/quantity/taxable values and GST component reconciliation.
- The preflight is a data-quality checklist only. It does not decide statutory e-invoice applicability/turnover thresholds or generate IRNs itself. The separate GSP adapter workflow can submit approved invoice payloads and retain returned IRN/acknowledgement metadata when a certified provider is configured; it does not itself certify statutory applicability or produce a signed QR code.
- `GET /api/v1/reports/accounting/journal-export?from=YYYY-MM-DD&to=YYYY-MM-DD` downloads posted journal lines as a generic accounting interchange CSV. Map ledger codes/names and reconcile opening balances before importing into Tally or another accounting package. A separate Tally XML voucher export is also available as an import draft; neither file is a live synchronization connector.

## Natural-language business assistant

- `POST /api/v1/reports/assistant/query` accepts a 3–300 character question and maps it to an explicit allowlist of tenant-scoped reports: sales, profit/margin, top products, low stock, GST reconciliation and cash flow.
- Supported periods include today, yesterday, last 7 days, last 30 days, this month-to-date and last month.
- This is a deterministic report-query assistant, not an LLM. It does not execute arbitrary database queries or perform business mutations. Unknown questions return supported topics and suggested phrasing.

## Offline POS reliability

- IndexedDB v3 uses composite tenant/user scope keys for offline invoice queue entries and product cache entries. Existing v2 queue and product cache records are migrated during the version upgrade.
- Failed offline invoice syncs retain the original payload and idempotency key, record attempt metadata and use exponential retry backoff capped at 60 minutes. Server-side invoice creation remains authoritative and validates current stock, prices, permissions and GST.
- Offline invoice queue entries are not finalized invoices until server sync returns `SUCCEEDED`. The product catalogue and stock values shown offline are last-synced snapshots; refresh online before high-risk sales.


## Subscription payment gateway

- Subscription invoices can be checked out through Razorpay using `POST /api/v1/platform/billing/invoices/:id/checkout`.
- Configure `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` in the deployment secret manager. Never commit these values.
- Configure the Razorpay webhook URL as `POST /api/v1/platform/billing/webhook/razorpay` and subscribe to `payment.captured`. The API verifies the HMAC-SHA256 signature against the exact raw request body, checks order, amount and currency, and activates the subscription in a MongoDB transaction.
- Webhook delivery is idempotent by invoice/order/payment reference. The manual platform-operator reconciliation endpoint remains available as an operational fallback.
- Checkout is disabled when credentials are absent. Test with Razorpay test keys and webhook secret before production; automatic recurring mandate collection is not included.

## GST GSP submission adapter

- Owner/admin can submit a preflight-approved issued B2B invoice using `POST /api/v1/reports/gst/einvoice/:invoiceId/submit`.
- Configure `GST_GSP_ADAPTER_URL` and `GST_GSP_ADAPTER_TOKEN`. The endpoint must be a public HTTPS endpoint on port 443. Requests use a stable submission idempotency key and a 30-second timeout.
- The adapter contract is `SOLSTRA_GST_EINVOICE_V1`; it receives the invoice snapshot and must translate it to the currently applicable IRP/GSP request format. A successful response must contain `irn` and `ackNo`, with optional `ackDt` and `referenceId`.
- Submission attempts, status, IRN and acknowledgement metadata are stored tenant-scoped. Repeated submissions of a successful invoice return the existing IRN rather than creating another submission.
- This connector does not make Solstra a GSP or guarantee statutory compliance. Use an approved GSP, verify current government schema/version and applicability, test in sandbox, and reconcile the returned IRN/QR/acknowledgement with the provider before production. Signed QR payload is not stored in this release.

## Historical migration preflight

- Owner/admin can call `GET /api/v1/reports/migration/readiness` for a read-only assessment of opening inventory valuation, posted journal balance, supplier invoice dates and chart-of-accounts availability.
- The endpoint flags positive-stock products without verified opening valuation, posted journals whose debit/credit totals differ by more than ₹0.01, and purchases missing supplier invoice dates.
- Journal imbalance details are capped at 50 in the response. This is a preflight only; it does not import or rewrite historical stock, ledger or GST records. Resolve every flagged item and approve source-ledger reconciliation before posting controlled opening balances.

## Production health probes

- `GET /api/v1/health` remains a liveness probe.
- `GET /api/v1/health/ready` is a readiness probe and returns HTTP 503 until the MongoDB connection is ready and the required database configuration is present.
- Use readiness for load-balancer/orchestrator traffic gating. It intentionally does not expose connection strings, secrets, or tenant data.


## GST return and e-way bill GSP submissions

- Owner/admin submission history is available at `GET /api/v1/reports/gst/submissions?page=1`.
- Submit a completed GSTR-1 period using `POST /api/v1/reports/gst/submissions/GSTR1/YYYY-MM`; submit GSTR-3B with `GSTR3B/YYYY-MM`. The selected month must be fully ended. GSTR-3B submission is blocked when inward purchase tax classification is incomplete.
- Submit an issued invoice for e-way bill processing using `POST /api/v1/reports/gst/submissions/EWAY_BILL/:invoiceId`. The adapter receives the invoice and any transport metadata already present on its source record. Provider/GSP must validate transporter, vehicle, distance, movement type and current statutory applicability before IRP generation.
- These workflows send a normalized Solstra adapter contract to `GST_GSP_ADAPTER_URL` with `GST_GSP_ADAPTER_TOKEN`. The GSP adapter must translate the payload to the current GSTN/GSP schema and return an acknowledgement number plus provider reference.
- Payload SHA-256 and idempotency keys prevent duplicate successful submissions. A changed payload for an already submitted period/source is blocked and requires the provider's formal amendment workflow.
- This is a connector framework, not direct GSTN certification or a filing-ready legal determination. Verify sandbox certification, GSTN schema versions, filing eligibility, tax calculations, transport data and provider callbacks before production use.

## Communication delivery receipts

- Provider adapters receive a stable delivery ID and tenant ID in message metadata. After accepting a message, providers should POST a JSON receipt to `POST /api/v1/platform/communications/callback/:deliveryId`.
- Sign the exact raw callback body with HMAC-SHA256 using the configured provider API token and send the lowercase hex digest in `x-solstra-communication-signature`.
- The callback body must include `deliveryId`, `status` (`delivered` or `failed`), and may include `providerMessageId` and `reason`.
- The API verifies the signature with timing-safe comparison and updates delivery status, provider message reference and delivery/failure timestamp. Do not send customer message content in provider callbacks.

## Backup restore drills

- Owner/admin can run `POST /api/v1/platform/backups/:id/restore-drill` for an existing tenant backup. Results are listed at `GET /api/v1/platform/backups/restore-drills`.
- A drill verifies stored SHA-256, gzip decompression, archive format, tenant identity, collection structure and per-document tenant ownership. The result records counts and checksum.
- A successful drill is an archive-integrity validation only. It does not write to a production database or prove application-level restore compatibility. Perform a full restore rehearsal in an isolated MongoDB deployment before production disaster-recovery sign-off.

## Operational metrics and alerts

- Owner/admin can query `GET /api/v1/platform/operations/metrics` for tenant-scoped API/database status, webhook and communication queue counts, offline sync backlog, latest backup age, latest replication status and actionable alerts.
- Alerts currently identify database disconnection, dead-letter deliveries, missing/stale backups and failed latest backup replication.
- Metrics are a polling API for an external monitoring system or the Platform Operations workspace. Configure an external monitor to poll periodically and route critical alerts to an on-call channel; this endpoint does not itself deliver PagerDuty/email/SMS alerts or replace infrastructure monitoring.


## Tally accounting interchange

- Owner/admin and report-authorized users can download posted journals as XML using `GET /api/v1/reports/accounting/tally-xml?from=YYYY-MM-DD&to=YYYY-MM-DD`.
- The export includes posted voucher date/number/narration and debit/credit ledger entries. Unbalanced journals or invalid negative/two-sided ledger lines are rejected. Export is capped at 2,000 vouchers and reports truncation.
- The file is an interchange draft, not a live Tally connector or a guarantee of compatibility with every Tally release. Replace the company placeholder, map ledger names, validate voucher types/sign conventions and import into a test company first. Reconcile opening balances and voucher totals before production use.

## Product catalogue migration

- Owner/admin can submit up to 200 product rows to `POST /api/v1/products/import/preview` as `{ "rows": [...] }`, then submit the same corrected rows to `POST /api/v1/products/import/commit`.
- Required fields: `name`, `purchasePrice`, `sellingPrice`, `mrp`. Optional fields include `sku`, `barcode`, `description`, `gstRate`, `hsnCode`, `unit` and `trackStock`.
- Preview checks field constraints, GST rates, duplicate SKUs within the file and existing tenant SKUs. Commit creates valid products independently and returns row-level failures. SKU uniqueness makes safe retry of already-created rows possible.
- Import intentionally creates products with zero opening stock. Opening quantity and valuation must be reconciled and posted through the separate controlled inventory valuation workflow. Do not include customer data, credentials or secrets in import rows.

## Comparative business assistant

- Ask the existing assistant to `compare sales this month vs last month`, `compare sales last 7 days` or `compare revenue last 30 days`.
- It compares issued invoice net sales after credit notes over the selected period with the immediately preceding complete period, returning INR amount and percentage movement.
- The assistant remains deterministic and allowlisted. It does not send business data to an external LLM, issue arbitrary database queries, forecast sales or execute mutations.

## Off-site backup receiver acknowledgement

- A replication receiver must return JSON `{ "status": "STORED", "sha256": "<exact x-solstra-backup-sha256>", "tenantId": "<exact x-solstra-tenant-id>" }` after durable storage.
- Solstra marks replication successful only when the receiver confirms the exact archive checksum and tenant identity. A generic HTTP 200 or mismatched acknowledgement is treated as replication failure and remains retryable.
- Receiver acknowledgement still does not prove a full restore. Keep independent storage retention, access controls, immutable/versioned copies and scheduled isolated restore rehearsals.


## Offline POS idempotency conflict protection

- Each offline sale sync record stores a SHA-256 fingerprint of its validated request payload alongside the tenant-scoped idempotency key.
- Reusing the same key with a different payload returns `CONFLICT`; it is not silently replayed or processed as a new sale.
- The browser queue marks a conflicting item as blocked and excludes it from automatic retries. Staff must inspect the original queued invoice and create a fresh key only when intentionally creating a distinct invoice.
- Older sync records without a payload fingerprint remain replayable for already-succeeded operations; the first retry of a legacy failed/processing record binds it to the payload being retried.

## Demand forecast baseline

- `GET /api/v1/reports/analytics/demand-forecast?horizonDays=30` supports 7–90 day horizons.
- Uses 90 days of tenant-scoped issued invoice item quantities, weighting the latest 30-day daily rate at 70% and the preceding 60-day rate at 30%; adds seven days of safety stock and compares against current aggregate product stock.
- Returns expected demand, recent trend, safety stock and suggested reorder quantity. It is statistical decision support, not a trained ML model or automatic purchase order.
- Credit-note returns are not yet subtracted from demand history, and branch/warehouse stock and supplier lead times are not modeled by this endpoint. Continue to use warehouse-specific replenishment policies for operational purchasing.

## GST e-invoice IRN cancellation

- Owner/admin users can submit a preflight-ready B2B invoice through `POST /api/v1/reports/gst/einvoice/:invoiceId/submit`, review the register at `GET /api/v1/reports/gst/einvoice-submissions`, and request cancellation through `POST /api/v1/reports/gst/einvoice/:invoiceId/cancel` with a 10–500 character reason.
- Submission payloads are SHA-256 fingerprinted. A changed invoice payload cannot be resubmitted under the same invoice identity after an attempt has been recorded.
- Cancellation is accepted only for a provider-acknowledged IRN and is marked cancelled only when the configured GSP adapter returns `status: CANCELLED` and a cancellation reference. Repeated cancellation requests return the recorded acknowledgement.
- A signed QR payload is stored only when returned by the adapter. Solstra does not generate IRNs, QR signatures or statutory cancellation eligibility; GSP/IRP credentials, provider-specific payload mapping and statutory time-limit checks remain external responsibilities.

## Backup replication operator controls

- Platform Operations now exposes manual off-site replication for stored tenant backup artifacts and displays the append-only replication event history alongside restore-drill results.
- A successful event requires the configured receiver to acknowledge durable storage with the exact checksum and tenant ID. A local restore drill validates the stored archive but does not restore it into a separate live database.


## External connector operations

- Webhook endpoints now support owner/admin signing-secret rotation, tenant-scoped delivery history and manual retry of FAILED/DEAD deliveries.
- Secret rotation returns the new secret once and invalidates the previous signing secret immediately. Coordinate receiver-side secret replacement before processing additional deliveries.
- Delivery history omits payload bodies; it reports status, event identity, attempt count and last error. Manual retry resets the attempt counter and re-enters the normal signed delivery worker.
- Existing outbound webhook contracts remain generic HTTPS + HMAC-SHA256. Vendor-specific OAuth, accounting ledger mapping, marketplace catalog sync and payment gateway certification are not implied by registering a webhook.

## Historical migration exports

- Owner/admin endpoint: `GET /api/v1/reports/migration/export?entity=customers&limit=500&cursor=<ObjectId>`.
- Supported entities: `customers`, `suppliers`, `products`, `sales` (issued invoices), `purchases` (non-cancelled) and `journals`.
- Exports are tenant-scoped, ordered by MongoDB ObjectId and cursor-paginated, with a maximum page size of 500.
- Reports workspace can download up to 20,000 records per JSON export. For larger workspaces, continue with the returned API cursor in separate controlled batches.
- Export is read-only. It does not import legacy payments, restore inventory movements, reconstruct old tax submissions or create opening balances. Reconcile source ledgers and use the audited opening-balance workflow for cutover.

## Offline POS device registration

- Browser POS stores a UUID device identity per authenticated tenant/user scope and registers it through `POST /api/v1/platform/offline/devices/register`.
- `POST /api/v1/platform/offline/sync` accepts the device ID and updates last-seen only for an active device belonging to the authenticated tenant and user.
- `GET /api/v1/platform/offline/devices` lists the current user's registered devices. Owner/admin can revoke a device using `POST /api/v1/platform/offline/devices/:deviceId/revoke`.
- A revoked identity cannot self-reactivate. Clear the local device identity and enroll a new device identity after an administrator has verified the device. Pending invoices from revoked devices require manual reconciliation before they are re-entered under another device.
- Legacy clients that omit deviceId remain accepted for compatibility; updated browser clients always include it.

## Enterprise security posture

- Owner/admin endpoint `GET /api/v1/platform/operations/security-posture` checks database connectivity/replica-set detection and presence of encryption, JWT, backup receiver, GST GSP and payment webhook configuration.
- The dashboard reports configuration presence only. It is not a penetration test, key-strength/rotation audit, external provider connectivity test or compliance certification.

## Communication provider credential rotation

- Owner/admin can rotate a configured communication provider credential with `POST /api/v1/platform/communications/providers/:id/rotate-secret` and body `{ "apiToken": "<replacement-token>" }`.
- The replacement token is encrypted with AES-256-GCM and the old token is invalidated immediately. The API never returns stored credentials. Update the provider-side token before the next queued delivery.
- This endpoint rotates credentials only; it does not certify provider connectivity or validate the new token against the external service.

## Migration export integrity manifest

- Every migration export page includes `totalMatching`, `pageSha256` and `integrityAlgorithm: SHA-256` metadata.
- The Reports workspace verifies each page checksum in the browser before adding records to the downloaded file. The resulting V2 JSON contains a per-page manifest, source record count and a complete/partial indicator.
- A partial export (20,000-record UI cap or changed source count during paging) must not be treated as a complete migration. Re-run or continue from the API cursor and reconcile source totals at cutover.

## Sequenced multi-device offline sync

- Updated browser clients attach a monotonically increasing `batchSequence` to each device sync request. The server binds each accepted sequence to a SHA-256 fingerprint of the entire operation batch and stores the acknowledged result on the tenant/user/device record.
- An exact retry of the most recently acknowledged sequence replays the stored result without recreating invoices. Reusing a sequence with different content, or sending an older sequence, is rejected as a conflict.
- Per-invoice tenant-scoped idempotency keys remain the final duplicate-sale protection. A later batch sequence can retry invoices whose prior per-operation result was FAILED.
- Legacy clients may omit `batchSequence` during the compatibility window; their per-invoice idempotency behavior remains unchanged.

## API request rate limiting

- The API uses atomic fixed-window counters in shared MongoDB: 10 authentication requests per 15 minutes per client IP and 300 general requests per minute per client IP. Health checks are excluded.
- Responses expose `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` and `Retry-After` headers.
- This is a shared application-level quota, not a DDoS mitigation service. Configure trusted proxy handling at ingress and use an edge WAF/API gateway for volumetric attacks.


## Controlled historical master-data import

- Owner/admin endpoints: `POST /api/v1/reports/migration/import/preview`, `POST /api/v1/reports/migration/import/commit`, and `GET /api/v1/reports/migration/import/runs?page=1`.
- The import API accepts 1–200 customer or supplier rows per request, rejects unknown fields, normalizes email/GSTIN values, validates phone/email/GSTIN/state code formats, and detects duplicates in the batch and current tenant data.
- Commit requires a stable caller-generated run key. The tenant/run key is unique and bound to a SHA-256 payload fingerprint. Exact retries of completed/partial runs replay the saved outcome; reusing a key with changed content is rejected.
- Imports create master records only. They do not create historical invoices, payments, inventory movements, GST submissions, accounting journals, customer balances or opening stock. Reconcile these through separate controlled workflows.
- The Reports workspace accepts JSON arrays or exported JSON files containing an `items` array, previews the rows, and requires an explicit commit confirmation.

## Subscription billing dunning

- The platform worker marks tenants with overdue due invoices as `PAST_DUE` and emits tenant-wide in-app reminders no more than once per 24-hour window, up to seven reminders per invoice.
- Reminder claims are atomic on the invoice record. Reminder notifications are audit-visible in the tenant notification centre. The worker does not suspend a workspace automatically or send external email/SMS/WhatsApp unless a configured provider and delivery workflow are explicitly used.
- Razorpay checkout remains optional and requires `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`. Payment status is authoritative only after a valid signed gateway webhook confirms capture and amount/currency match.

## Offline POS reconciliation

- Owner/admin can inspect tenant-wide sync records at `GET /api/v1/platform/offline/sync-records?page=1&status=FAILED`; other users see only their own sync records.
- Each record exposes status, invoice reference/result, failure message, device identity and batch sequence without storing the full offline invoice payload in the server-side history.
- Resolve a failed invoice from the original browser queue. Never manufacture a new idempotency key until the original payload and invoice status have been reconciled.



## Shared API rate limiting

- API request counters are stored atomically in the shared MongoDB database collection `api_rate_limit_buckets`, so multiple API instances use the same fixed-window counters.
- Authentication endpoints are limited to 10 requests per client IP per 15-minute window; other API requests are limited to 300 per client IP per one-minute window. Health probes are excluded.
- Expired counter documents are removed by a MongoDB TTL index. The API fails closed with HTTP 503 if the shared counter operation fails while MongoDB is connected; it does not silently bypass the distributed limit.
- When MongoDB has not connected during process startup, the guard temporarily uses a bounded process-local fallback. Configure trusted proxy handling correctly so `request.ip` reflects the real client IP; never trust arbitrary forwarded headers from untrusted clients.

## Offline batch recovery and acknowledgement semantics

- A device batch sequence is bound to the SHA-256 digest of its complete operation list. Reusing a sequence with a different payload is rejected.
- The latest batch stores its terminal `SUCCEEDED`, `PARTIAL` or `FAILED` outcome and exact response for safe replay. Replaying the same terminal batch returns the saved result and never creates invoices again.
- A batch left in `PROCESSING` for more than five minutes can be reclaimed using the same sequence and identical payload. Individual invoice idempotency keys remain the authoritative duplicate protection.
- A batch is not marked successful when one or more invoices fail. Mixed results are `PARTIAL`; all failed/conflicted results are `FAILED`; any still-processing operation keeps the batch in `PROCESSING`.
- The server still validates stock, prices, permissions and tax at sync time. These controls do not implement automatic cross-device stock conflict resolution; rejected invoices require user review.


## Enterprise integration readiness and remaining provider setup

- Owner/admin endpoint `GET /api/v1/platform/integrations/provider-readiness` reports credential-presence and tenant communication-provider counts for Razorpay, Zoho Books, QuickBooks, Shopify, WooCommerce, email, SMS and WhatsApp. It never returns credential values.
- Razorpay subscription checkout and signed payment-captured webhook processing are implemented. Configure test keys first, verify order amount/currency and webhook signature in the Razorpay sandbox, then replace them with production keys using the deployment secret manager.
- TallyPrime is supported as XML interchange, not live OAuth (TallyPrime's local/hosted integration model requires a separately deployed connector and mapped ledgers). Zoho Books and QuickBooks OAuth credentials and Shopify/WooCommerce credentials are readiness checks only in this release; authorization-code exchange, refresh-token lifecycle, vendor API synchronization, webhook subscriptions and field mapping still require provider-specific connector implementation and sandbox validation. Do not interpret `configured: true` as a connected account.
- Email/SMS/WhatsApp delivery currently uses the tenant's HTTPS webhook adapter. The adapter must call the actual vendor API, apply opt-in/suppression/template rules and send signed delivery receipts. This release does not embed certified Twilio, Meta WhatsApp Cloud API, SendGrid or other provider SDKs.

## Isolated disaster-recovery restore rehearsal

- Set `DR_RESTORE_MONGO_URI` to a separately managed MongoDB deployment. The application rejects a target whose hostname matches the configured production `MONGODB_URI`.
- `POST /api/v1/platform/backups/:id/restore-drill` restores the selected archive into a randomly named temporary database on that separate host, checks each restored collection count and verifies that the tenant record is present, then drops the temporary database in a `finally` cleanup path.
- A result of `PASSED` means the temporary isolated restore and post-restore checks completed. `VALIDATED_ONLY` means the archive passed local checksum/format/tenant checks but no isolated target was configured. `FAILED` means validation or isolated restore failed.
- Use a dedicated least-privilege DR user allowed to create/drop only the drill database namespace. Test with non-production data first. Confirm the target has enough capacity and that network access is restricted. A successful smoke restore is not a full application failover rehearsal: test indexes, migrations, application startup, read/write flows, recovery time and recovery point objectives separately.

## External operational alert delivery

- Owner/admin endpoint `POST /api/v1/platform/operations/alerts/dispatch` evaluates current operational metrics and posts active alerts to `OPERATIONS_ALERT_WEBHOOK_URL` using bearer authentication and HMAC-SHA256 in `x-solstra-alert-signature`.
- Configure both `OPERATIONS_ALERT_WEBHOOK_URL` and `OPERATIONS_ALERT_WEBHOOK_TOKEN` in the deployment secret manager. The endpoint uses the same HTTPS/public-host validation as other outbound integrations, does not follow redirects and times out after 10 seconds.
- The endpoint sends only active alerts; it returns `NO_ACTIVE_ALERTS` without contacting the receiver when the current metrics contain no alerts. Schedule this endpoint from a trusted external monitor or call it from an operator workflow. The receiver must verify the HMAC over the exact raw body and route alerts to the on-call system.
- This is an outbound alert delivery hook, not a hosted monitoring service. Infrastructure metrics, alert deduplication/escalation policies, paging schedules and provider credentials remain the responsibility of the monitoring platform.

## Historical transaction migration boundary

- Existing migration APIs support customer/supplier master-data imports, product catalogue imports, and cursor-paginated exports of issued sales, non-cancelled purchases and posted journals.
- Historical transaction export is not an operational transaction import: importing old sales/purchases directly as current invoices would incorrectly affect stock, receivables/payables, tax-period controls and accounting journals. Do not replay historical source transactions through live create endpoints.
- For cutover, reconcile source-system invoice/payment/credit-note/purchase totals by period, GSTIN, document number and ledger; import master data; post approved opening stock and opening balances through the audited workflows; then retain source transaction exports as immutable migration evidence. A dedicated staging-to-cutover workflow with source-specific mapping, duplicate resolution, transaction reconstruction and accountant sign-off is still required before historical sales/purchases can become native operational records.

## Offline multi-device stock conflict handling

- Every offline invoice is revalidated by the normal server-side sales workflow at sync time; current stock, warehouse allocation, pricing, promotions, permissions and tax are authoritative. The client-side stock snapshot is informational only.
- A sale that conflicts with current stock is rejected and remains available for operator review; device sequence replay and per-invoice idempotency prevent duplicate creation. Do not automatically retry a stock-conflicted invoice with a new idempotency key.
- This release does not reserve inventory for disconnected devices or provide an automatic conflict-resolution UI for choosing substitute warehouse/quantities. Until a reservation/merge workflow is deployed, use one active offline-selling device per warehouse or keep high-risk stock-controlled sales online.



## Historical transaction archive import and control-total reconciliation

- Owner/admin endpoints: `POST /api/v1/reports/migration/historical/preview`, `POST /api/v1/reports/migration/historical/commit`, `GET /api/v1/reports/migration/historical/runs?page=1`, and `GET /api/v1/reports/migration/historical/reconciliation/:runKey`.
- Supports SALES and PURCHASES source document headers in batches of 1–200. Each row requires a unique source ID, source document number, valid source date and non-negative total; taxable/tax amounts are stored in integer paise. Only INR is accepted.
- Preview detects duplicate source IDs within the batch and previously imported source records. Optional expected document count and expected total amount are checked before commit.
- A tenant/source-system/entity/source-ID unique index protects retries. Run keys are bound to SHA-256 payload fingerprints. Exact retries of completed runs replay the result; incomplete runs can resume missing records.
- Imported rows are sanitized archive metadata for migration evidence and reconciliation. They are **not** native operational invoices or purchases and do not post stock, customer/supplier balances, payments, GST submissions or journals. Reconcile the archive against source control totals, then use approved opening stock/balance workflows and accountant sign-off for cutover. Full native transaction reconstruction remains a separate controlled migration project.

## Scheduled recurring expense execution

- The platform worker now discovers due recurring-expense schedules across tenants and invokes the existing idempotent per-tenant runner automatically.
- Generated expenses, their accounting journals and schedule advancement remain in a MongoDB transaction. The worker caps processing at 50 due schedules per tenant invocation and 100 tenants per worker cycle; remaining due schedules are picked up by subsequent cycles.
- Journal attribution uses the schedule creator rather than a synthetic system user. Configure the API worker to remain available and monitor recurring expense generation through expense records and accounting journals.
