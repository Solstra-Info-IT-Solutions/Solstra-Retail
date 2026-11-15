# Solstra identity approval controls

## Client registration

- Public `POST /api/v1/auth/register` creates a pending registration request only.
- The submitted password is stored as a bcrypt hash; no tenant or user record is created before approval.
- Pending requests expire after 30 days. Expired password hashes are removed and the request is eligible for cleanup.
- Solstra platform operators review requests through `GET /api/v1/auth/platform/registration-requests` and `POST /api/v1/auth/platform/registration-requests/:id/review`.
- Approval creates the tenant and owner account in one MongoDB transaction and starts the seven-day trial at approval time. Rejection removes the stored password hash and never activates an account.

## Password changes

- Authenticated users submit `POST /api/v1/auth/password-change-requests` with their current password and proposed new password.
- The current password is verified. The proposed password is bcrypt-hashed; reviewers cannot retrieve or view the password.
- The existing password remains active until Solstra approval. Requests expire after seven days.
- Approval atomically updates the password hash and increments the account token version. All previously issued JWT sessions are invalidated and the client must sign in again.
- Rejection preserves the existing password and removes the pending new password hash.

## Solstra operator allowlist

Set `PLATFORM_ADMIN_USER_IDS` in the API deployment environment to a comma-separated list of trusted Solstra operator MongoDB user IDs. These IDs are checked server-side for every platform approval action; frontend role visibility is not an authorization boundary.

The authenticated operator can obtain their own ID from `GET /api/v1/auth/me` (`user.userId`). Do not place email addresses, passwords, JWTs or other secrets in this setting.

## Operational notes

- Approval collections create their required partial-unique and TTL indexes at API startup, even when general production auto-indexing is disabled.
- Registration and password approval records retain reviewer, timestamp and mandatory reason after completion; pending records are automatically expired and their password hashes are erased.
- Business identity verification is a manual Solstra review. Automated email/phone OTP verification and approval notifications require a configured transactional messaging provider and are not claimed by this workflow.
