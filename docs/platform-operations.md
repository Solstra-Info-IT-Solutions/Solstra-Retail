# Platform operations deployment notes

## Required environment configuration

- `WEBHOOK_SECRET_ENCRYPTION_KEY`: exactly 32 random bytes encoded as 64 hexadecimal characters. Generate with `openssl rand -hex 32`. Webhook signing secrets are encrypted with AES-256-GCM before they are stored. Do not rotate this key without re-encrypting existing integration secrets.
- `PLATFORM_ADMIN_USER_IDS`: comma-separated authenticated User ObjectIds allowed to use cross-tenant SaaS operator APIs. Leave unset to disable platform-wide tenant administration. Do not add ordinary tenant owner IDs.

## Automation and notifications

Automation rules are tenant-scoped and support the event types `SALE_CREATED`, `EXPENSE_PENDING_APPROVAL`, `LOW_STOCK` and `MANUAL`. Actions currently supported are in-app notifications and queued webhook delivery. Rule executions have a unique tenant/rule/event key and can be retried after a failed execution. Successful sales and expense creation emit events; other event types can be triggered by an authorized workspace administrator or future domain integrations.

Notifications are delivered to each active user in the tenant and have per-user read state. This release provides in-app notifications and webhook event delivery; email, SMS, WhatsApp and browser push require provider credentials and provider-specific adapters.

## Webhook integrations

Only HTTPS endpoints on port 443 are accepted. Local/private IP ranges and localhost names are rejected, redirects are not followed, and deliveries are signed using HMAC-SHA256 in the `x-solstra-signature` header. The receiver should verify the signature against the exact raw request body. Delivery retries use exponential backoff and stop after five attempts. The background worker checks due deliveries once per minute.

## Offline POS

The browser caches recently retrieved product catalogue entries and stores queued sale payloads in IndexedDB. When connectivity returns, the POS submits batches to `POST /api/v1/platform/offline/sync`. The server validates each sale using the normal sales workflow, tenant scope, stock checks, accounting transaction and existing sale idempotency key. A queued offline sale is **not a finalized invoice** until the server reports `SUCCEEDED`. Stock, price, promotion and customer state can change while offline; the server is authoritative and may reject a stale queued sale for review. Do not clear browser site data while the queue is pending.

## Backups and recovery

Backup policies support daily or weekly schedules. The API worker claims due policies atomically and creates compressed tenant-scoped JSON archives in MongoDB GridFS, with SHA-256 verification and configurable retention (1–90 days). User password hashes are excluded. Archives can be listed, downloaded and validated against their workspace identity.

GridFS is in the same MongoDB deployment, so these snapshots protect against some application-level mistakes but **are not a disaster-recovery copy for loss of the MongoDB cluster/account**. Download or replicate archives to a separately administered cloud account or offline vault. Restore is deliberately validation-only in this release; production restore should be performed in an isolated database with a reviewed migration and reconciliation plan.

## SaaS operator controls

Cross-tenant tenant listing, plan changes, suspension and usage summaries are protected by `PLATFORM_ADMIN_USER_IDS`. Changes require a reason and create append-only `saas_admin_audit` records. Workspace user, product and branch creation is checked against the configured tenant capacity fields. Payment collection, recurring billing, tax invoices and plan payment gateway integration are not included; these require a billing provider and credentials.

## Inventory valuation reconciliation

The valuation reconciliation endpoint is read-only. It reports products awaiting verified opening valuation and flags warehouse allocations that exceed aggregate quantity or value. Unallocated aggregate stock is permitted. It does not automatically rewrite historical inventory cost, accounting journals or stock movements.
