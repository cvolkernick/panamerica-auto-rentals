# Divergences: cvolkernick main (51ea5a9) vs live site (static-export-source lineage)

Method: `next build` of main 51ea5a9 (prerendered HTML) compared, text + <head> + JSON-LD, against the published GitHub Pages tree for every route.

| Area | main 51ea5a9 | live / this PR | Resolution |
|------|--------------|----------------|------------|
| Header/footer nav | no Fleet link | `Fleet` link | live |
| `/fleet` page, `data/fleet.ts`, `public/fleet/*` | absent | 13 cards | live (new) |
| Home hero 2nd button | `Turo` (external) | `Our Fleet` -> `/fleet` | live |
| `/plans` | no agreements | "Review the agreement / Draft / Download PDF" per rung, `/plans/<slug>` viewers, `data/agreements.json`, PDFs, `planDisclaimer` | live |
| `/partners` | no Tesla cards | Tesla Model 3 2022 / 2020 entries | live |
| `/services` copy | "no vehicle listings on this site" | points to the Fleet page | live |
| `/contact` | listings as heading + list from `publicListings` | `Schedule an intro call` button x2 (`introCallUrl`) + "Find us on Google and Facebook." sentence from `localListings` | live; Google/Facebook links kept (identical URLs) |
| `publicListings` (lib/site.ts) | Google + Facebook, used by footer, contact, JSON-LD | same two URLs as `localListings` (footer, contact, JSON-LD `sameAs`) | not dropped: renamed to live's `localListings`; every surface that used it still renders the same links (verified in export diff). Yelp stays omitted |
| JSON-LD | `organizationJsonLd()` in `lib/seo.ts` injected in layout | `LocalBusinessJsonLd` component + `localBusinessJsonLd()` | live; same fields/values (only key order differs) |
| Canonical / og:url / og:image host | apex `https://panamericafleet.com` | `https://www.panamericafleet.com` (`SITE_URL`; apex 308s to www) | live (matches the host the site is actually served on); NOTE for Chris |
| `/about` legal fact | `Authorized member: Thais Lira` (`legal.authorizedMember`) | `Authorized members: Chris Volkernick and Thais Lira` (`legal.authorizedMembers` + `formatNameList`) | live |
| `/about` people | "Meet the founder" (Chris) + "Meet the team" (Thais, third-person bio) | single "Meet the founders": Chris, then Thais Lira (heading is the name only), approved first-person bios verbatim, no photos | new approved wording |
| `/about` one-roof section | same content (PR #3) | same | identical |
| favicon / icons | old `favicon.ico` | `favicon.ico` + `icon.png` + `apple-icon.png`, `scripts/build-favicons.py` | live |
| `robots.txt` / `sitemap.xml` | robots only, no sitemap | robots with sitemap + `sitemap.xml`, both `force-static` | live |
| Layout | - | `overflow-x-hidden`, `min-w-0` mobile fixes | live |
| `next.config.ts` | default | `output: "export"`, `images.unoptimized` (static export for GitHub Pages) | live; see PR body note on Vercel |
| README | old | documents Fleet, agreements, favicons, local listings | live + `/about` bullet updated |

Main-only things dropped: only `publicListings`, `organizationJsonLd`, `PUBLIC_WEB_URL` in seo.ts and apex canonical host, each superseded by the equivalent live implementation above. Nothing else exists on main that is absent from this branch (main 51ea5a9 is an ancestor of the PR head).
