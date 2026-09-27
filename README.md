# WorkShift

WorkShift is an attendance system that verifies an authenticated employee with two mandatory checks: a 128-dimensional facial descriptor and a GPS position inside the employee's office radius. IP, Wi-Fi BSSID and device reuse are non-blocking fraud signals for HR review.

## Structure

- `apps/web` — React/Vite dashboard authenticated by Clerk.
- `apps/api` — Express API that verifies Clerk session tokens and keeps biometric evidence server-side.
- `supabase/migrations` — PostgreSQL, PostGIS, pgvector, RLS and database functions.

## Configure Clerk

The Clerk application is linked to `app_3IM9Na6OCdLJT9zzAwX7bevgcam`. In the Clerk Dashboard, copy its publishable and secret keys from **API keys**. Do not put `CLERK_SECRET_KEY` or `CLERK_WEBHOOK_SIGNING_SECRET` in the web application.

1. Copy `apps/api/.env.example` to `apps/api/.env`, then set the Supabase values, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `CLERK_WEBHOOK_SIGNING_SECRET`.
2. Copy `apps/web/.env.example` to `apps/web/.env.local`, then set `VITE_CLERK_PUBLISHABLE_KEY` to the same publishable key.
3. In Clerk Dashboard, add `http://localhost:5173` to the development instance's allowed origins. Add each deployed web URL before production deployment.
4. Apply the database migrations, including `202608240001_clerk_auth.sql`.
5. In Clerk Dashboard > **Webhooks**, add a public endpoint at `https://YOUR_PUBLIC_API_URL/api/v1/webhooks/clerk`, subscribe to `user.created`, `user.updated`, and `user.deleted`, then copy that endpoint's Signing Secret to `CLERK_WEBHOOK_SIGNING_SECRET`.
6. In Clerk Dashboard > **User & Authentication** > **Social connections**, enable Google. The redirect URI shown by Clerk must be added to the Google OAuth client; do not replace it with the WorkShift callback URL.

The web and API keys must come from the same Clerk instance (both `pk_test`/`sk_test`, or both `pk_live`/`sk_live`), and `users.clerk_user_id` refers to users of that instance. Otherwise the API rejects the web's session token (`jwk-kid-mismatch` in the API log) and cannot find the user for password login. A production instance needs a domain you own: its Frontend API (`clerk.<domain>`) requires DNS records, which cannot be created under `*.vercel.app`.

Google OAuth uses `/oauth/callback` only to complete the Clerk redirect, then `/oauth/complete` exchanges the Clerk session for a WorkShift token. Production static hosting must rewrite both paths (and other SPA paths) to `index.html`; `apps/web/vercel.json` provides this for Vercel.

## HR Wi-Fi and employee imports

The HR **Cấu hình IP Wi-Fi** tab shows the IP currently enforced for the company and can either save the public IP detected by the API request or a manually entered IPv4/IPv6 address. The detected value is the public egress IP, not a private router address such as `192.168.x.x`.

The HR **Nhân viên** tab can import up to 50 invitations from CSV or `.xlsx`. Required columns are `Họ và tên` and `Email`; `Phòng ban` or `Mã phòng ban` is optional. Employees must use the configured `@gmail.com` policy. The file is validated in the browser before the API creates application invitations, so each accepted invitation gets the required WorkShift company and department metadata.

## Start locally

```bash
npm install
npm run dev
```

The browser application runs on `http://localhost:5173`; the API listens on `http://localhost:3001`.

## Access policy

WorkShift has one system administrator: `hungblockchain06@gmail.com`. That account is promoted to `ADMIN` automatically at its next sign-in. Accounts in the `@company.com` domain are internal company managers (`HR`); they can manage employees and departments and send email only to `@company.com` recipients. Other email domains are denied by the API and their Clerk session is signed out.

Public registration is removed from the web application. HR creates internal accounts by sending a Clerk invitation from **Quan ly cong ty**. Invitations intentionally use Clerk's managed acceptance page, which completes the invitation ticket and password setup before the employee signs in to WorkShift. In Clerk Dashboard, also disable public sign-ups for this instance so the same rule is enforced before a Clerk session can be created. Apply the migration `202608260001_company_access_policy.sql` in Supabase before enabling the policy for existing users.

## Operations setup

The previous first-admin bootstrap flow is retired. Do not use `/sign-up`: sign in as `hungblockchain06@gmail.com` to create the system administrator profile, then use **Quan ly cong ty** to invite internal users.

1. Sign in as `hungblockchain06@gmail.com`; its WorkShift profile is created as the system `ADMIN` automatically.
2. HR users must be added through **Quan ly cong ty**. Public registration and first-admin promotion are disabled.
3. Create an office, configure its GPS radius and work hours, then assign each employee to an office from **Quản trị**.
4. If `require_trusted_device` is enabled for an office, the first successful check-in registers the browser installation. An ADMIN can reset it from the employee table.

`allowed_bssid` is retained only for a native/mobile client that can collect Wi-Fi BSSID. Browsers do not send it and are not automatically flagged.

For existing Supabase Auth users, sign in through Clerk first, then safely link the matching profile by setting its Clerk user ID in the SQL editor:

```sql
update public.users
set clerk_user_id = 'user_your_clerk_user_id'
where email = 'employee@example.com';
```

## API surface

All API routes require a Clerk session-token bearer token except `GET /health` and the signed public Clerk webhook.

| Route | Purpose |
| --- | --- |
| `POST /api/v1/faces/enroll` | Store one consented face vector and its private source image. |
| `POST /api/v1/attendance/challenge` | Issues an authenticated, one-time 90-second challenge before camera capture. |
| `POST /api/v1/attendance/check-in` | Account-bound face + GPS check-in; consumes the server-issued challenge and stores immutable capture evidence. |
| `POST /api/v1/attendance/check-out` | Close the authenticated employee's current daily record. |
| `GET /api/v1/attendance/today`, `/history` | Employee's sanitized attendance data. |
| `GET /api/v1/admin/summary`, `/flags` | HR/Admin dashboard data; a reviewed alert can be updated with `PATCH /admin/attendance/:id/review`. |
| `POST /api/v1/webhooks/clerk` | Public Svix-verified Clerk events: creates/updates profiles and deactivates deleted users. |

## Deployment

Deploy `apps/web` as a static Vite application and `apps/api` as a Node service or Vercel REST function (`api/index.js`). Set the API's `SUPABASE_*`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`, and `WEB_ORIGIN` variables only on the API host. Set only `VITE_CLERK_PUBLISHABLE_KEY` and `VITE_API_URL` on the frontend host.

For example, if the web site is `https://app.example.com` and API is `https://api.example.com`, use:

```text
WEB_ORIGIN=https://app.example.com
VITE_API_URL=https://api.example.com/api/v1
```

Add `https://app.example.com` to Clerk **Allowed origins**. Do not add API secrets to the web build. The Clerk webhook URL is separate: `https://api.example.com/api/v1/webhooks/clerk`.

## SMTP email and rate limits

WorkShift uses PostgreSQL/Supabase for distributed API rate limiting; no Redis or Upstash configuration is required. Apply `202608250002_smtp_and_postgres_rate_limit.sql` after the previous migrations.

To deliver queued notifications through SMTP, set these API-only variables and restart the API:

```text
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password-or-app-password
SMTP_FROM=WorkShift <no-reply@example.com>
```

Use `SMTP_SECURE=true` only for implicit TLS, usually port 465. An ADMIN can dispatch the queue with `POST /api/v1/admin/notifications/dispatch`; schedule that endpoint with your deployment platform after validating a delivery manually.

## Important production controls

- Use HTTPS and configure the actual web origin in `WEB_ORIGIN` and Clerk's allowed origins.
- Keep `SUPABASE_SERVICE_ROLE_KEY`, `CLERK_SECRET_KEY`, and `CLERK_WEBHOOK_SIGNING_SECRET` only on the API host.
- Configure a signed consent process and a retention/deletion policy for biometrics.
- Browser JavaScript cannot read Wi-Fi BSSID and cannot conclusively detect mock GPS. Treat these as risk signals, and add liveness detection/mobile device attestation for high-assurance deployments.
- The blink challenge, server-issued nonce and photo hash reduce replay risk, but client-side code can still be manipulated. For payroll-grade anti-spoofing, add liveness/embedding verification in a trusted service or native mobile device attestation.
