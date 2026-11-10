# Owner portal setup

This is the one-time setup for the signed-in owner portal. Nothing in this file has been applied to Cloudflare. Do not run these commands as part of a normal site edit, and do not commit database ids, tokens, passwords, or password hashes.

The public site stays a Next.js static export (`output: 'export'`, `trailingSlash: true`). `/owner/` and `/admin/` are static shells that fetch JSON from Pages Functions under `/api/portal/*`. Booking on `/fleet` is unchanged.

## What this slice is

- One owner is seeded: **Panamerica Auto Rentals**, `panamerica.cars@gmail.com`, stored as admin.
- That person signs in with an email and password on `/owner/` and `/admin/`. There is no Cloudflare Access app and no Zero Trust.
- `/owner/` lists that owner's cars (year, make, model, color, plate, VIN).
- `/admin/` lists owners, adds and edits owners, and adds, edits, deletes, and assigns cars.
- Every owner car query is `WHERE owner_id = <the signed-in owner>`. Admin routes require admin.
- These URLs are not in the nav, footer, or sitemap. Pages send `noindex`. The login form is the signed-out state of those same pages.

## What is not in this slice

Team accounts, money, miles, a second person signing in, booking changes, and self-serve signup. An admin can store another owner row now. That person still cannot sign in until a password is set for them later. Do not add other owners as part of this setup.

## Auth

Pages Functions under `/api/portal` check a server-side session row in D1. The browser holds only an HttpOnly cookie named `__Host-portal_session` (`Secure`, `SameSite=Lax`, `Path=/`, no `Domain`). `__Host-` cannot be shared across hosts, so `/owner`, `/admin`, and `/api/portal` on `panamericafleet.com` redirect to `https://www.panamericafleet.com` with status 308. Public pages are not redirected by that rule.

Passwords are stored as Argon2id hashes (`m=19456`, `t=2`, `p=1`). The database never stores the password. Login and logout live at `/api/portal/login` and `/api/portal/logout`. Logout deletes the session row. A new login rotates the session id. Sessions expire after 7 days. State-changing requests must come from the same origin and send the CSRF token returned by login and by `/api/portal/session`.

Unknown emails and wrong passwords get the same `invalid_credentials` response. Login attempts are limited per email and per IP. `*.pages.dev` cannot log in and cannot use a session cookie.

`owners.is_admin` marks an admin. The seeded row is admin. `ADMIN_EMAILS` (comma-separated) also grants admin for an email that already has an owners row. It does not create a login by itself.

`PORTAL_DEV_AUTH` is the local bypass. It works only when the value is exactly `1`, and only off the live hosts. `www.panamericafleet.com`, `panamericafleet.com`, and `*.pages.dev` ignore it. Leave it unset on the Pages project. Production config in this repo does not turn it on.

Argon2id at these settings uses more CPU than the Workers Free plan allows (10 ms). On that plan a sign-in can fail with Error 1102. Workers Paid gives a default 30 second CPU budget, which covers a sign-in. That is a Pages/Workers compute setting. It does not turn on Access or Zero Trust.

## 1. Create the D1 database

From the repo, when you are ready:

```bash
npx wrangler d1 create panamerica-portal
```

Copy the database id into the Pages binding in the next steps. Do not commit it.

## 2. Apply the migrations

```bash
npx wrangler d1 execute panamerica-portal --remote --file=migrations/0001_init.sql
npx wrangler d1 execute panamerica-portal --remote --file=migrations/0002_auth.sql
```

`0001` creates `owners` and `cars` and inserts only the Panamerica owner. It does not insert cars. `0002` adds `password_hash`, `sessions`, and `login_attempts`. It does not set a password. Run each file once. Running one again fails on the existing tables, which is what you want. If `0001` was already applied, run only `0002`.

## 3. Bind D1 on the Pages project

The Pages project must build this repo (`npm run build`) with output directory `out`, and the deploy must start from the project root so the `/functions` directory is included. Uploading only the `out` folder leaves the API out.

In the Cloudflare dashboard: Workers & Pages → the site project → Settings → Functions → D1 database bindings.

| Variable name | Database |
| --- | --- |
| `DB` | `panamerica-portal` |

The name has to be `DB`.

## 4. Set the first password

Do this after the functions are deployed. The password is typed only in your shell. It does not go in git, in this file, or in a migration.

Set `PORTAL_SETUP_TOKEN` on the Pages project to a long random string (32 characters or more). Leave `PORTAL_DEV_AUTH` unset. Redeploy so the function can see the token. Then, from a trusted machine:

```bash
curl -sS -X POST https://www.panamericafleet.com/api/portal/setup-password \
  -H "content-type: application/json" \
  -H "x-portal-setup-token: $PORTAL_SETUP_TOKEN" \
  -d '{"email":"panamerica.cars@gmail.com","password":"'"$PORTAL_PASSWORD"'"}'
```

`PORTAL_PASSWORD` is the new password in that shell only. A success response is `{"ok":true}`. The response does not include the password or the hash. Remove `PORTAL_SETUP_TOKEN` from the Pages project when you are done and redeploy. While it is unset, that route responds as not found.

If you would rather write the hash yourself, hash on the trusted machine and paste the hash into the command. Do not commit it. The placeholder below is not a real hash.

```bash
npx tsx -e 'import { hashPassword } from "./lib/portal/password.ts"; const pw = process.env.PORTAL_PASSWORD; if (!pw) process.exit(1); hashPassword(pw).then((hash) => process.stdout.write(hash));'
npx wrangler d1 execute panamerica-portal --remote --command "UPDATE owners SET password_hash = '<paste hash>' WHERE email = 'panamerica.cars@gmail.com';"
```

The Pages project needs the `nodejs_compat` compatibility flag only if a later dependency asks for Node built-ins. This login path uses Web Crypto and does not.

## 5. Pages environment variables

Workers & Pages → the site project → Settings → Environment variables. Set them for Production. Do not set the dev bypass.

| Name | Value |
| --- | --- |
| `ADMIN_EMAILS` | Optional. `panamerica.cars@gmail.com` is already admin from the seed. |
| `PORTAL_SETUP_TOKEN` | Only while you are setting the first password. Then unset it. |
| `PORTAL_DEV_AUTH` | Leave unset. |
| `PORTAL_DEV_EMAIL` | Leave unset. |

Do not create an Access application. The portal does not read an Access team domain or an Access audience tag.

Redeploy from the project root after the binding and variables exist so Functions can see them. That deploy is a separate step from this repo change. Do it when you want the portal live.

Confirm in a private window:

- `https://www.panamericafleet.com/owner/` shows the email and password form.
- `https://www.panamericafleet.com/fleet/` does not.
- `https://panamericafleet.com/owner/` redirects to the www owner page.
- `https://panamericafleet.com/fleet/` is unchanged from the existing public routing.

## 6. Local preview

`npm run dev` serves the static shells only. Pages Functions do not run inside `next dev`. For a local API, use Wrangler against a local D1 and a gitignored `.dev.vars`:

```bash
npx wrangler d1 execute panamerica-portal --local --file=migrations/0001_init.sql
npx wrangler d1 execute panamerica-portal --local --file=migrations/0002_auth.sql
```

`.dev.vars` (do not commit):

```bash
PORTAL_DEV_AUTH=1
PORTAL_DEV_EMAIL=panamerica.cars@gmail.com
```

Then, after `npm run build`:

```bash
npx wrangler pages dev out --d1 DB=<database id from step 1>
```

Use `127.0.0.1`. The bypass does nothing on `pages.dev` or `panamericafleet.com`. To try the real form locally, leave the bypass unset and set a hash in the local database the same way as step 4. Do not put that password in the repo.

## Checks

```bash
npm test
npm run build
```

`npm test` covers login, bad credentials, unknown emails, unauthenticated 401s, rate limits, owner isolation, admin gates, the dev bypass staying off, pages.dev rejection, the setup token, VIN and year validation, and admin create / edit / delete.

`npm run build` still writes `out/owner` and `out/admin`.
