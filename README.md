# Panamerica Auto Rentals

Public marketing site for **Panamerica Auto Rentals**, the trade name of **Panamerica Auto, LLC** — a Florida LLC doing fleet management and automotive logistics, with a focus on assets on Turo and other rideshare platforms.

Dark-mode Next.js App Router site. No booking engine, payments, or auth.

## Run locally

```bash
npm install
npm run dev
```

Then open [http://127.0.0.1:43147](http://127.0.0.1:43147).

```bash
npm run build
npm start
```

## Pages

- `/` — hero (logo + brand), one-liner, three service tiles, owner-plan ladder tiles (no-lock-in teaser on the ladder), contact CTA; **Our Fleet** goes to `/fleet`
- `/fleet` — 13 cards (4 Panamerica-managed in Cape Coral + 9 SafeWheels in Punta Gorda): photo, name, location/partner label, Book on Turo. Data: `data/fleet.ts` + `public/fleet/`
- `/services` — fleet management, platform ops (Turo & rideshare), automotive logistics
- `/plans` — owner service ladder: Spotlight (self-serve $10 / $15 / $25 Coming), then fleet management 80/20, 50/50 guaranteed payment, and 20/80 owner exit (month-to-month from day one teaser; fleet rungs include Spotlight listing + insights). Each rung links to its agreement (`/plans/<slug>`) with a PDF download and to the shared Exhibit A (Vehicle Schedule) PDF. Viewer text lives in `data/agreements.json`; the agreement PDFs in `public/plans/*-agreement.pdf` are owner-supplied; do not hard-code terms into page copy.
- `/partners` — curated Fleet partners (no Turo scrape)
- `/about` — company description, Fleet partners teaser, and Sunbiz legal facts for Panamerica Auto, LLC
- `/contact` — name / email / message; **Send** opens `mailto:`; **Schedule an intro call** opens the Google Calendar booking page in a new tab. Under the phone and email: **Find us on** Google and Facebook (same URLs as the footer). Yelp is omitted until a public URL exists. These listings are not in the primary nav.

## Contact email

Send always posts to `mailto:`. Default address is `panamerica.cars@gmail.com`.

**Schedule an intro call** on `/contact` opens the public 15-minute Google Calendar appointment page (`https://calendar.app.google/Kpfn3aeKQ2VvZyeQ6`) in a new tab.

Override with `CONTACT_EMAIL` (Vercel env or `.env.local`):

```bash
CONTACT_EMAIL=panamerica.cars@gmail.com
```

## Link previews (Open Graph)

Home, `/fleet`, `/plans`, `/partners`, `/services`, `/about`, and `/contact` emit Open Graph + Twitter `summary_large_image` tags. Canonical share URL is `https://www.panamericafleet.com` (the apex 308-redirects to www). `/sitemap.xml` (from `app/sitemap.ts`) lists the public pages and `robots.txt` points to it. The thumbnail is the branded `public/og.jpg` (1200×630), served at `/og.jpg` with no auth.

After a production deploy, force a re-scrape so iMessage / Slack / Facebook / LinkedIn drop the old empty preview:

- [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) — scrape `https://www.panamericafleet.com`
- [opengraph.xyz](https://www.opengraph.xyz/) — same URL
- Slack and iMessage cache the first fetch; they usually refresh after the Facebook scrape or after sharing with a one-time `?v=2` query (do not leave a query on the public canonical)

Rebuild the thumbnail from the logo if the brand mark changes:

```bash
python3 scripts/build-og-image.py
```

## Favicon

The tab icon is the silver coupe from `public/logo.jpg` (red stripe, no wordmark). Next.js App Router files:

| File | Size |
|------|------|
| `app/favicon.ico` | 16×16 and 32×32 |
| `app/apple-icon.png` | 180×180 (`apple-touch-icon`) |
| `app/icon.png` | 512×512 |

Rebuild after the logo art changes:

```bash
python3 scripts/build-favicons.py
```

Browsers cache favicons hard. Check a fresh session on the production deploy, both the apex and `www`.

## Deploy on Vercel via Origin

This repository is meant to live on Origin under `chrisv-btc`. Chris’s Vercel account is already connected to Origin — create a Vercel project and import the Origin repo (do not add a GitHub mirror as a deploy workaround).

Set `CONTACT_EMAIL` in the Vercel project if you want a different inbox. Leave it unset to keep the Gmail default.

## Local listings

Google Business Profile and the Facebook page are the only public listings wired on the site. Source: `localListings` in `lib/site.ts`.

| Surface | What |
|---------|------|
| Footer | Text links **Google** and **Facebook**, same row as Contact. New tab. |
| `/contact` | “Find us on Google and Facebook” under the phone and email. |
| JSON-LD | `Organization` + `LocalBusiness` on every page: name Panamerica Auto, LLC, phone, email, `https://www.panamericafleet.com`, `sameAs` those two URLs, `areaServed` Lee County and Southwest Florida. No street address. |

Do not add Yelp until a public URL is in `localListings`. Do not add these links to `nav` (primary header).

## Plan agreements (release checklist)

`/plans` marketing copy and the four agreement documents must ship together. If you change a rung's public terms on `/plans`, re-check the matching document in `data/agreements.json` and regenerate the PDF:

```bash
python3 scripts/build-plan-agreements.py
```

Do **not** reconstruct agreement clauses from the marketing copy. Owner-final PDFs attached on the tracking issue replace the labeled drafts; set `status` to `"final"` only after the owner marks them final. Draft files must stay labeled DRAFT until then — they are not a live offer.

| Rung | Viewer | PDF |
|------|--------|-----|
| Spotlight | `/plans/spotlight` | `/plans/spotlight-agreement.pdf` |
| Standard management | `/plans/standard-management` | `/plans/standard-management-agreement.pdf` |
| Guaranteed payment + shared OpEx | `/plans/guaranteed-payment` | `/plans/guaranteed-payment-agreement.pdf` |
| Owner exit | `/plans/owner-exit` | `/plans/owner-exit-agreement.pdf` |
| Exhibit A (all rungs) | — | `/plans/exhibit-a-vehicle-schedule.pdf` |

The four agreement PDFs and Exhibit A are owner-supplied (`"pdfSource": "owner"` in `data/agreements.json`). `scripts/build-plan-agreements.py` skips them so a regenerate cannot overwrite them with stubs.

## Legal line

Footer and About use the Florida Sunbiz record (verified 2026-09-03):

Panamerica Auto, LLC · Florida LLC · Doc L26000295877 · Active

Registered-agent suite in St. Petersburg is the statutory mailing address, not an operating HQ.
