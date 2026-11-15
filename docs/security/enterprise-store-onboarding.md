# Enterprise store onboarding and team governance

## Client registration

Public `POST /api/v1/auth/register` creates a pending registration request only. It does not create a tenant, user, or login session. Solstra approval creates the tenant and owner account atomically and starts the seven-day trial.

The registration profile captures:
- Owner name, login email, primary and alternate mobile numbers.
- Legal business name and store/trading name.
- Industry, sub-category, business description, business contact email and website.
- Full registered address, state name and GST state code, district, PIN and country.
- GST registration status. GSTIN and GST legal details are required/accepted only when GST registration is enabled; unregistered businesses can submit without a GSTIN.
- Optional PNG, JPEG or WebP store logo, maximum 1 MB.

Supported initial industries: general retail, grocery, medical/pharmacy, electronics, fashion/apparel, wholesale/distribution, e-commerce, restaurant/food, automotive, beauty/cosmetics, hardware/building materials and other.

## Solstra governance

Authenticated Solstra operators must be allowlisted using `PLATFORM_ADMIN_USER_IDS`. Platform endpoints:
- `GET /api/v1/auth/platform/registration-requests` — complete pending registration profiles.
- `GET /api/v1/auth/platform/registration-summary` — pending/approved/rejected/expired requests and client store totals.
- `GET /api/v1/auth/platform/store-directory` — tenant profile, owner account, contact, industry, GST, branding and subscription state.
- `POST /api/v1/auth/platform/registration-requests/:id/review` — approve or reject with an audited reason.

Solstra operator workspaces are excluded from client store totals and directory results. Registration records are retained for audit; expiry clears the password hash and marks the request expired. Rejected and approved requests never retain the password hash.

## Store profile

Owners and administrators can read and update `GET/PATCH /api/v1/tenant/profile`. Profile data is tenant-scoped. GSTIN is optional while GST registration is disabled; enabling GST registration requires a valid GSTIN whose first two digits match the configured GST state code.

## Employee access governance

Owners and administrators can:
- Create separate employee logins with designation and mobile number.
- Start from Cashier, Sales Executive, Inventory Manager, Accountant or Custom permission templates.
- Review and change individual module permissions through `GET /api/v1/auth/permissions` and `PATCH /api/v1/auth/users/:id/permissions`.
- Deactivate/reactivate staff through `PATCH /api/v1/auth/users/:id/status`.

Employee permissions are tenant-scoped and deny-by-default. Permission changes and account status changes are retained in the user audit history. Deactivation increments the token version, invalidating existing sessions.

## Logo storage and limits

The current implementation accepts a data URL for PNG/JPEG/WebP logos and stores the bounded asset in MongoDB with the tenant/registration profile. The API JSON body limit is 2 MB and the logo limit is 1 MB. For larger media libraries or high-volume public storefront assets, migrate logos to a configured object-storage/CDN provider rather than expanding tenant documents.
