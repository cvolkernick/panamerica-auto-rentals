# Owner portal setup

This is the one-time setup for the signed-in owner portal. Nothing in this file has been applied to Cloudflare. Do not run these commands as part of a normal site edit, and do not commit database ids, Access audience tags, or tokens.

The public site stays a Next.js static export (`output: 'export'`, `trailingSlash: true`). `/owner/` and `/admin/` are static shells that fetch JSON from Pages Functions under `/api/portal/*`. Booking is unchanged.

## What this slice is

- One owner is seeded: **Panamerica Auto Rentals**, `panamerica.cars@gmail.com`, stored as admin.
- That person signs in with a Cloudflare Access one-time PIN to their email. No new email vendor.
- `/owner/` lists that owner's cars (year, make, model, color, plate, VIN).
- `/admin/` lists owners, adds and edits owners, and adds, edits, deletes, and assigns cars.
- Every owner car query is `WHERE owner_id = <the signed-in owner>`. Admin routes require admin.
- These URLs are not in the nav, footer, or sitemap. Pages send `noindex`.

## What is not in this slice

Team accounts, money, miles, a second person signing in, booking changes, and self-serve signup. An admin can store another owner row now. That person still cannot sign in until someone later adds their email to the Access policy. Do not do that as part of this setup.

## Auth

Cloudflare Access sits in front of `/owner`, `/admin`, and `/api/portal`. It emails a one-time PIN. Pages Functions read `Cf-Access-Jwt-Assertion`, check the signature against the team certs (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`), and require the issuer and the application audience (`CF_ACCESS_AUD`). The email claim must match an `owners` row. Any other email gets a 403 page. The API returns HTTP 403. The HTML shell is static, so the document itself is the noindex 403 screen after that response.

`owners.is_admin` marks an admin. The seeded row is admin. `ADMIN_EMAILS` (comma-separated) also grants admin for an email that already has an owners row. It does not create a login by itself.

`PORTAL_DEV_AUTH` is the local bypass. It works only when the value is exactly `1`, and only off the live hosts. `www.panamericafleet.com`, `panamericafleet.com`, and `*.pages.dev` ignore it. Leave it unset on the Pages project. Production config in this repo does not turn it on.

## 1. Create the D1 database

From the repo, when you are ready:

```bash
npx wrangler d1 create panamerica-portal
```

Copy the database id into the Pages binding in the next steps. Do not commit it.

## 2. Apply the migration

```bash
npx wrangler d1 execute panamerica-portal --remote --file=migrations/0001_init.sql
```

This creates `owners` and `cars` and inserts only the Panamerica owner. It does not insert cars. Run it once. Running it again fails on the existing tables, which is what you want.

## 3. Bind D1 on the Pages project

The Pages project must build this repo (`npm run build`) with output directory `out`, so the `/functions` directory is deployed with the static files. Uploading only the `out` folder leaves the API out.

In the Cloudflare dashboard: Workers & Pages → the site project → Settings → Functions → D1 database bindings.

| Variable name | Database |
| --- | --- |
| `DB` | `panamerica-portal` |

The name has to be `DB`.

## 4. Create the Access application

Zero Trust → Access → Applications → Add an application → Self-hosted.

Name it `Panamerica owner portal`. Protect only these paths on `www.panamericafleet.com`. Do not protect the whole domain. `/`, `/fleet`, and the rest of the public site must stay open.

| Subdomain | Domain | Path |
| --- | --- | --- |
| `www` | `panamericafleet.com` | `/owner` |
| `www` | `panamericafleet.com` | `/admin` |
| `www` | `panamericafleet.com` | `/api/portal` |

Policy: Allow. Include → Emails → `panamerica.cars@gmail.com`. One-time PIN is the login method (Access → Settings → Authentication → One-time PIN, on by default).

If the dashboard makes you create three applications instead of three paths, that is fine. Copy every Application Audience (AUD) tag.

Copy the AUD tag from the application overview. You will paste it as `CF_ACCESS_AUD`.

Confirm in a private window:

- `https://www.panamericafleet.com/owner/` asks for the email PIN.
- `https://www.panamericafleet.com/fleet/` does not.

## 5. Set the Pages environment variables

Workers & Pages → the site project → Settings → Environment variables. Set them for Production. Do not set the dev bypass.

| Name | Value |
| --- | --- |
| `CF_ACCESS_TEAM_DOMAIN` | `<team>.cloudflareaccess.com` (the team host, no path) |
| `CF_ACCESS_AUD` | The AUD tag from step 4. Comma-separate tags if you created more than one Access app. |
| `ADMIN_EMAILS` | Optional. `panamerica.cars@gmail.com` is already admin from the seed. |
| `PORTAL_DEV_AUTH` | Leave unset. |
| `PORTAL_DEV_EMAIL` | Leave unset. |

Redeploy the Pages project after the binding and variables exist so Functions can see them. That deploy is a separate step from this repo change. Do it when you want the portal live.

## 6. Local preview

`npm run dev` serves the static shells only. Pages Functions do not run inside `next dev`. For a local API, use Wrangler against a local D1 and a gitignored `.dev.vars`:

```bash
npx wrangler d1 execute panamerica-portal --local --file=migrations/0001_init.sql
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

Use `127.0.0.1`. The bypass does nothing on `pages.dev` or `panamericafleet.com`.

## Checks

```bash
npm test
npm run build
```

`npm test` covers Access email mapping, the dev bypass staying off, owner isolation (one owner cannot read another owner's car by id), VIN and year validation, and admin create / edit / delete.
