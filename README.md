# Solstra Retail — API foundation

Private SaaS foundation for the India-first Solstra Retail product.

## Stack
- NestJS + TypeScript
- MongoDB Atlas + Mongoose
- JWT access tokens
- Tenant-scoped authorization
- Strict 7 × 24-hour server-enforced trial

## Requirements
- Node.js 20+
- MongoDB Atlas or local MongoDB replica set (transactions are used during signup)

## Run locally
```bash
cp apps/api/.env.example apps/api/.env
# Set MONGODB_URI and JWT_ACCESS_SECRET in apps/api/.env
npm install
npm run dev
```
API: `http://localhost:4000/api/v1`

## First API calls
Register:
```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "name": "Shop Owner",
  "email": "owner@example.com",
  "password": "Use-A-Strong-Password-123!",
  "businessName": "My Retail Store"
}
```
Login:
```http
POST /api/v1/auth/login
Content-Type: application/json

{ "email": "owner@example.com", "password": "Use-A-Strong-Password-123!" }
```
Use the returned token:
```http
GET /api/v1/auth/me
Authorization: Bearer <accessToken>
```

## Trial enforcement
- Trial begins once, at successful tenant activation during registration.
- `trialEndsAt = trialStartedAt + 168 hours`, stored in UTC.
- Server time (`Date.now()`) is authoritative.
- No client-supplied activation date, reset, or extension endpoint exists.
- Expired tenants receive `402 TRIAL_EXPIRED` on protected write requests.
- Login and `/auth/me` remain available so the owner can reach account/billing screens.
- The guard is applied globally; add narrowly scoped `@SkipTrial()` only to explicitly safe routes.

## Tenant isolation rules
- Never trust a `tenantId` supplied in request body, query string, or headers.
- Resolve tenant identity from the authenticated JWT subject and active membership.
- Every tenant-owned query must include the authenticated `tenantId`.
- Use `TenantScopedService` as the pattern for all future repositories.
- Do not expose raw Mongoose models directly from controllers.
- For every new tenant-owned collection, add `tenantId` and compound indexes beginning with `tenantId`.

## Important production hardening before launch
1. Configure HTTPS, CORS allowlist, rate limiting, request logging and monitoring.
2. Store JWT secrets in Render secret environment variables; rotate them.
3. Add email verification, password reset, refresh-token rotation and session revocation.
4. Add authorization roles/permissions and branch-level scope.
5. Add idempotency keys and audit logging for billing/inventory writes.
6. Add automated tests for cross-tenant access and trial expiry.
7. Configure MongoDB Atlas backups, least-privilege database credentials and network access.
8. Add Razorpay only after subscription/webhook flows are implemented and signature-verified.

This is a backend foundation, not yet a complete POS or production-ready billing system.
