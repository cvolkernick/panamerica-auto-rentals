# Installable app (PWA)

The public site can be installed to a phone or desktop home screen
("Add to Home Screen" on iPhone, "Install app" in Chrome/Edge).

## Pieces

| File | What it does |
| --- | --- |
| `app/manifest.ts` | Builds `/manifest.webmanifest`: name, colours, `start_url` `/`, `display` standalone, icons. |
| `scripts/build-pwa-icons.mjs` | `prebuild` step. Writes `public/icons/` (git-ignored) from the existing `app/icon.png`. No new artwork. |
| `app/layout.tsx` | `theme-color`, apple web-app tags, and registers the worker. The apple-touch-icon comes from `app/apple-icon.png`. |
| `components/service-worker-register.tsx` | Registers `/sw.js` after load, production only. |
| `public/sw.js` | The service worker. |
| `app/offline/page.tsx` | Shown when a page is opened offline with no saved copy (noindex). |
| `public/_headers` | `sw.js` served `no-cache, no-store`; manifest served as `application/manifest+json`. |

## What the worker does and never does

- **Never** handles `/api` and `/api/*`, `/owner*`, `/manager*`, `/admin*` (including invite
  pages), non-GET, cross-origin or range (video) requests. Those go to the
  network exactly as without a worker. No portal or signed-in data is cached.
- Public page navigations: network-first; a good copy is kept for offline use;
  otherwise `/offline/`.
- `/_next/static/*` (hashed file names): cache-first.
- Everything else (images, PDFs, video): not intercepted.

Tests: `tests/portal/pwa-service-worker.test.ts` (runs the real `sw.js` against
fake fetch events) and `tests/build/pwa.test.ts` (checks `out/` after build).

## Shipping an update

Bump `VERSION` in `public/sw.js` when the worker logic changes. The new worker
installs, calls `skipWaiting`, and on activate deletes every older `panam-`
cache before `clients.claim()`. Page and asset caches need no bump for content
changes: pages are network-first and assets are content-hashed.

## Kill switch

If the worker ever misbehaves, replace `public/sw.js` with the file below and
deploy Pages. Because `sw.js` is served `no-cache`, each installed client picks
it up on its next visit, deletes the `panam-` caches, unregisters, and reloads
its open tabs from the network. Then remove `<ServiceWorkerRegister />` from
`app/layout.tsx` (or leave it; registering this file is harmless).

```js
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("panam-")).map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: "window" }))
      .then((clients) => clients.forEach((client) => client.navigate(client.url))),
  );
});
```

A plain Pages rollback to a deploy from before the worker existed does **not**
remove an installed worker by itself (the old deploy has no `sw.js`, so the
browser keeps the last one until its 24-hour update check fails). Use the kill
switch instead of, or together with, a rollback.

## Start URL

`start_url` is `/` (the public site). Owners and managers who install it land on
the home page and tap through to their portal. A separate portal install
(`start_url` `/owner/` or `/manager/`) would need its own manifest and scope;
not built.
