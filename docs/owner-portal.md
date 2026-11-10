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

The browser runs Argon2id in WebAssembly (`m=19456`, `t=2`, `p=1`). The salt is SHA-256 of a fixed site prefix plus the normalized email, so the server does not look up a salt and a salt list cannot show which emails exist. The browser sends that 32-byte result. The Worker stores HMAC-SHA256 of it, keyed with the `PORTAL_PEPPER` secret, and compares the HMAC in constant time. The Worker does not run Argon2id, bcrypt, or PBKDF2. The database never stores the password or the raw derived key.

Login and logout live at `/api/portal/login` and `/api/portal/logout`. Logout deletes the session row. A new login rotates the session id. Sessions expire after 7 days. State-changing requests must come from the same origin and send the CSRF token returned by login and by `/api/portal/session`.

Unknown emails and wrong passwords get the same `invalid_credentials` response. Only failed logins count, and a request that is already limited is not counted again. The tight limit is one email plus one IPv4 address, or one email plus one IPv6 /64. One IPv6 /48 is also limited to 60 failed logins in 15 minutes, so rotating /64s inside that network cannot keep guessing. A different /48 can still sign in. The higher email-wide cap applies only to a network that already has a few recent failures, so a clean network can still sign in. A browser that signed in before keeps a device cookie that skips that email-wide cap. `*.pages.dev` cannot log in and cannot use a session cookie.

`public/_routes.json` invokes Functions only for `/owner`, `/owner/*`, `/admin`, `/admin/*`, and `/api/portal/*`. Public pages, including `/` and `/fleet`, are served as static files.

`owners.is_admin` marks an admin. The seeded row is admin. `ADMIN_EMAILS` (comma-separated) also grants admin for an email that already has an owners row. It does not create a login by itself.

`PORTAL_DEV_AUTH` is the local bypass. It works only when the value is exactly `1`, and only off the live hosts. `www.panamericafleet.com`, `panamericafleet.com`, and `*.pages.dev` ignore it. Leave it unset on the Pages project. Production config in this repo does not turn it on.

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

## 4. Set the pepper

Generate a pepper on a trusted machine and paste it into the Pages project as an encrypted environment variable named `PORTAL_PEPPER`. Use at least 32 characters. Do not commit it, and do not put it in this file.

```bash
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Workers & Pages → the site project → Settings → Environment variables → Production → `PORTAL_PEPPER`. Redeploy so Functions can read it. Login and the setup route do nothing useful until this secret exists.

## 5. Set the first password

Do this after the functions are deployed and `PORTAL_PEPPER` is set. The password is typed only into stdin. It does not go in git, in this file, in a migration, or on a command line.

Set `PORTAL_SETUP_TOKEN` on the Pages project to a long random string (32 characters or more). Leave `PORTAL_DEV_AUTH` unset. Redeploy so the function can see the token. Then, from a trusted machine, `read -s` takes the password without echoing it. The script turns that stdin into the derived key. curl reads the JSON from its own stdin with `--data @-`, so the password is not a command-line argument:

```bash
read -s -p "Password: " PORTAL_PASSWORD
printf '%s' "$PORTAL_PASSWORD" | npx tsx scripts/portal-setup-body.mts panamerica.cars@gmail.com \
  | curl -sS -X POST https://www.panamericafleet.com/api/portal/setup-password \
      -H "content-type: application/json" \
      -H "x-portal-setup-token: $PORTAL_SETUP_TOKEN" \
      --data @-
unset PORTAL_PASSWORD
```

Running the script on its own in a terminal also prompts for the password and does not echo it.

A success response is `{"ok":true}`. The response does not include the password, the derived key, or the HMAC. Remove `PORTAL_SETUP_TOKEN` from the Pages project when you are done and redeploy. While it is unset, that route responds as not found. Leave `PORTAL_PEPPER` in place. Login needs it.

## 6. Pages environment variables

Workers & Pages → the site project → Settings → Environment variables. Set them for Production. Do not set the dev bypass.

| Name | Value |
| --- | --- |
| `ADMIN_EMAILS` | Optional. `panamerica.cars@gmail.com` is already admin from the seed. |
| `PORTAL_PEPPER` | The HMAC pepper from step 4. Leave it set. |
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

## 7. Local preview

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

Use `127.0.0.1`. The bypass does nothing on `pages.dev` or `panamericafleet.com`. To try the real form locally, leave the bypass unset, set `PORTAL_PEPPER` in `.dev.vars`, and set the password the same way as step 5. Do not put that password or pepper in the repo.

## Checks

```bash
npm test
npm run build
```

`npm test` covers login, bad credentials, unknown emails, unauthenticated 401s, rate limits, owner isolation, admin gates, the dev bypass staying off, pages.dev rejection, the setup token, VIN and year validation, and admin create / edit / delete.

`npm run build` still writes `out/owner` and `out/admin`.
