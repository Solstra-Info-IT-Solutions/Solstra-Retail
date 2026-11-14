# Enterprise production-readiness gates

This checklist distinguishes application code from external production certification. A configured secret or a successful HTTP response is not proof of a provider-certified integration.

| Workstream | Current application foundation | Remaining production acceptance gate |
|---|---|---|
| Zoho Books / QuickBooks / Shopify / WooCommerce | Provider credential-presence checks; Tally XML interchange | Implement and verify OAuth authorization, token refresh/revocation, provider-specific field mapping, webhook verification, idempotent bidirectional sync, retry/reconciliation and sandbox certification for each provider |
| Native historical sales/purchase migration | Preview/commit archive with source IDs, duplicate protection and source control totals | Build mapping and posting pipeline for native invoices, purchases, stock movements, customer/supplier balances, payments, GST snapshots and accounting journals; dry-run and opening/closing balance reconciliation before cutover |
| Offline inventory conflict resolution | Device registration/revocation, monotonic sync sequence, idempotent sales replay and conflict reporting | Add reservation-aware conflict policy, warehouse substitution/partial fulfilment decisions, supervisor approval, replay-safe stock adjustments and multi-device race tests; never silently overwrite stock |
| Disaster recovery | Checksummed backups, off-site replication acknowledgement and isolated restore smoke test | Run against separately managed production DR infrastructure; validate indexes/migrations, credentials, restore time, application startup, tenant isolation, failover and measured RPO/RTO |
| Razorpay | Subscription checkout foundation and signed, amount/currency-checked, replay-safe payment-captured webhook | Exercise real sandbox/live account flows including failed/authorized/captured/refunded/disputed events, customer invoice settlement, reconciliation, webhook retries and finance sign-off |
| Email / SMS / WhatsApp | Tenant-configured HTTPS delivery adapters, signed delivery receipts and retry/dead-letter controls | Implement provider-specific adapters/templates/consent handling, delivery-status callbacks, rate limits and opt-out compliance; complete sandbox and production delivery tests |
| Monitoring / alerting | Operational metrics and signed alert webhook dispatch | Persist alert incidents, deduplicate, assign/acknowledge/resolve, escalation timers, on-call routing and test receiver outages/recovery |
| Historical valuation / COGS | Moving-average valuation, valuation initialization and warehouse-vs-product reconciliation | Import dated opening quantities/cost layers and reconstruct historic receipts/issues/returns; reconcile inventory subledger to GL and validate historical COGS by period |
| Serial lifecycle | Registration and listing; this release adds audited IN_STOCK → SOLD → RETURNED → IN_STOCK/DAMAGED transitions linked to tenant-scoped sale invoices | Wire serial selection into POS sale/return transactions atomically, enforce quantity/serial parity, warranty linkage and serial movement audit reconciliation |
| GST / GSP | GST reports, e-invoice/GSP adapter submission records and readiness checks | Obtain GSP credentials/certification, validate current schemas and statutory rules, run sandbox and production filing/reconciliation with tax professional sign-off |
| Expense attachments | Expense records currently retain a URL field | Add private object storage, authenticated upload/download, content-type/size validation, malware scanning, tenant-bound object keys, retention/deletion and signed short-lived access URLs |
| Security / performance / E2E | Authentication/authorization, tenant scoping, audit events, rate limiting and existing unit/HTTP E2E suites | Independent penetration test, threat-model remediation, WAF/edge controls, load/soak/chaos testing, restore/failover tests and expanded provider/migration/offline end-to-end suites |

## Release policy

- Provider secrets must be supplied through the deployment secret manager; never commit them or expose them through readiness APIs.
- External credentials, provider sandbox/live accounts, GSP approval, object-storage infrastructure, a separate DR deployment and a monitoring receiver are deployment prerequisites, not repository-only tasks.
- Never promote a workstream to production-ready solely because environment variables are present.
- Historical imports that cannot be mapped unambiguously must remain in preview/review state. Do not post speculative stock, payment, tax or ledger entries.
- Offline inventory conflicts must remain visible for controlled resolution until a deterministic, tested policy is available.
- A production release requires green CI plus successful provider-specific, infrastructure and security acceptance evidence.
