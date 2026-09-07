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

- `/` — hero (logo + brand), one-liner, three service tiles, owner-plan tiles, contact CTA
- `/services` — fleet management, platform ops (Turo & rideshare), automotive logistics
- `/plans` — owner management service plans (80/20, 50/50 guaranteed payment, 20/80 owner exit)
- `/about` — Sunbiz legal facts for Panamerica Auto, LLC
- `/contact` — name / email / message; **Send** opens `mailto:`

## Contact email

Send always posts to `mailto:`. Default address is `panamerica.cars@gmail.com`.

Override with `CONTACT_EMAIL` (Vercel env or `.env.local`):

```bash
CONTACT_EMAIL=panamerica.cars@gmail.com
```

## Deploy on Vercel via Origin

This repository is meant to live on Origin under `chrisv-btc`. Chris’s Vercel account is already connected to Origin — create a Vercel project and import the Origin repo (do not add a GitHub mirror as a deploy workaround).

Set `CONTACT_EMAIL` in the Vercel project if you want a different inbox. Leave it unset to keep the Gmail default.

## Legal line

Footer and About use the Florida Sunbiz record (verified 2026-09-03):

Panamerica Auto, LLC · Florida LLC · Doc L26000295877 · Active

Registered-agent suite in St. Petersburg is the statutory mailing address, not an operating HQ.
