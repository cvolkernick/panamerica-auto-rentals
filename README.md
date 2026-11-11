# Panamerica Auto Rentals

Public marketing site for **Panamerica Auto Rentals**, the trade name of **Panamerica Auto, LLC** — a Florida LLC that rents vehicles by the day, week, or month to individuals and gig drivers in Fort Myers and Cape Coral, with fleet partner programs for vehicle owners.

Dark-mode Next.js App Router site. No booking engine and no payments. The signed-in owner portal (`/owner`, `/admin`) is separate from the public pages. It is not linked from the nav, footer, or sitemap. Setup is in `docs/owner-portal.md`.

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

- `/` — hero (logo + brand), rental-first one-liner, three service tiles (rentals, gig driver rentals, fleet partners), one fleet-management plan with trip-length commission (no-lock-in teaser); hero actions are Book Direct (`/fleet`), driver rentals (`/drivers`), and fleet partners (`/partners`)
- `/fleet` — 13 cards (4 Panamerica-managed in Cape Coral + 9 SafeWheels in Punta Gorda): photo, name, location/partner label, Book on a rental platform. Data: `data/fleet.ts` + `public/fleet/`
- `/services` — rentals (Book Direct on /fleet), gig driver rentals (/drivers), and fleet partners for vehicle owners (/partners)
- `/management` — Fleet Management, the one owner plan. Public commission is 20% for trips under 7 days, 15% for 7–21 days, and 10% for trips over 21 days. First month: half commission — 10% / 7.5% / 5%. Month-to-month from day one. The plan links to its agreement (`/management/agreement`) with a PDF download and to the shared Exhibit A (Vehicle Schedule) PDF. Viewer text lives in `data/agreements.json`. Do not copy marketing rates into the agreement PDF; the public rates stay on the page, and the written agreement confirms terms for a vehicle. `public/_redirects` sends `/plans` and `/plans/` to `/management` and `/management/` with status 301. Those rules are exact, so `/plans/*.pdf` is unchanged.
- `/partners` — curated Fleet partners (no rental-platform scrape)
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

Home, `/fleet`, `/management`, `/partners`, `/services`, `/about`, and `/contact` emit Open Graph + Twitter `summary_large_image` tags. Canonical share URL is `https://www.panamericafleet.com` (the apex 308-redirects to www). `/sitemap.xml` (from `app/sitemap.ts`) lists the public pages and `robots.txt` points to it. The thumbnail is the branded `public/og.jpg` (1200×630), served at `/og.jpg` with no auth.

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

`/management` marketing copy and the fleet management agreement must ship together. If you change the public commission on `/management`, re-check the document in `data/agreements.json` and regenerate the draft PDF:

```bash
python3 scripts/build-plan-agreements.py
```

Do **not** reconstruct agreement clauses from the marketing copy. Owner-final PDFs attached on the tracking issue replace the labeled drafts; set `status` to `"final"` only after the owner marks them final. Draft files must stay labeled DRAFT until then — they are not a live offer.

| Plan | Viewer | PDF |
|------|--------|-----|
| Fleet Management | `/management/agreement` | `/plans/management-agreement.pdf` |
| Exhibit A | — | `/plans/exhibit-a-vehicle-schedule.pdf` |

The fleet management agreement PDF is a generated draft (`"pdfSource": "generated"`). Exhibit A is generated from `scripts/build-exhibit-a.py` (`python3 scripts/build-exhibit-a.py`). `scripts/build-plan-agreements.py` skips any document marked `"pdfSource": "owner"` so a regenerate cannot overwrite it.

## Legal line

Footer and About use the Florida Sunbiz record (verified 2026-09-03):

Panamerica Auto, LLC · Florida LLC · Doc L26000295877 · Active

Registered-agent suite in St. Petersburg is the statutory mailing address, not an operating HQ.
