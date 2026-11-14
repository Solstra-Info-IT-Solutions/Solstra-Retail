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

Cross-tenant tenant listing, plan changes, suspension and usage summaries are protected by `PLATFORM_ADMIN_USER_IDS`. Changes require a reason and create append-only `saas_admin_audit` records. Workspace user, product and branch creation is checked against the configured tenant capacity fields. Subscription invoices can be requested by workspace owners/admins. The current release supports manual platform-operator payment reconciliation at fixed monthly plan rates (Starter ₹499, Growth ₹1,499, Business ₹3,999; Enterprise by quotation). It does not collect payment automatically, calculate GST on subscription invoices or integrate a payment gateway.

## Inventory valuation reconciliation

The valuation reconciliation endpoint is read-only. It reports products awaiting verified opening valuation and flags warehouse allocations that exceed aggregate quantity or value. Unallocated aggregate stock is permitted. It does not automatically rewrite historical inventory cost, accounting journals or stock movements.

## Advanced inventory lifecycle

The Advanced Inventory workspace exposes batch receipts and expiry lists, serial registry management, draft stocktakes with explicit completion, and dynamic pricing rule management. POS checkout now requires selecting the exact available warehouse serials when a product has registered serial inventory. Serial states are moved to SOLD in the same database transaction as the invoice, and credit-note returns restore serialized units to IN_STOCK only when the return is restocked; non-restocked serials remain in RETURNED quarantine state. When a warehouse/product has batch records, POS consumes unexpired batches by FEFO and records exact batch allocations on invoice lines. Restocked credit-note returns restore those quantities to the original unexpired batches; expired batch returns must be quarantined by issuing the credit note without restocking. Products with legacy unbatched stock remain sellable when no batch records exist for the selected warehouse.


## GST e-invoice preparation and external accounting interchange

- Reports expose `GET /api/v1/reports/gst/einvoice-readiness?from=YYYY-MM-DD&to=YYYY-MM-DD` for issued B2B invoices. It checks seller/recipient GSTIN format, invoice number length, state codes, recipient name, HSN/UQC/quantity/taxable values and GST component reconciliation.
- The preflight is a data-quality checklist only. It does not decide statutory e-invoice applicability/turnover thresholds and does not generate IRNs, signed QR codes, acknowledgements or e-way bills. Live IRP submission requires an approved GSP integration, sandbox certification, credentials and production approval.
- `GET /api/v1/reports/accounting/journal-export?from=YYYY-MM-DD&to=YYYY-MM-DD` downloads posted journal lines as a generic accounting interchange CSV. Map ledger codes/names and reconcile opening balances before importing into Tally or another accounting package. It is not an official Tally XML or live sync connector.

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
