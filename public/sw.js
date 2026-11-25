/* Panamerica Auto Rentals: installable-app service worker.
 *
 * Deliberately small and conservative:
 * - Never touches /api/*, the signed-in portals (/owner, /manager, /admin),
 *   non-GET requests, cross-origin requests, or range (video) requests.
 *   Those go straight to the network as if no worker existed.
 * - Public page navigations: network-first. A good response is kept so the
 *   page still opens offline; with no copy, the /offline/ page is shown.
 * - Hashed build assets (/_next/static/*): cache-first. Their file names
 *   change on every build, so a cached copy is never stale.
 * - Everything else (images, PDFs, video, icons): not intercepted.
 *
 * Updating: bump VERSION. The new worker installs, takes over on activate,
 * and deletes every older "panam-" cache.
 *
 * Kill switch: replace this file with the self-unregistering worker in
 * docs/pwa.md and deploy. Every open client drops the worker and its caches
 * on its next check (sw.js is served no-cache, so that is the next visit).
 */
const VERSION = "v1";
const CACHE_PREFIX = "panam-";
const PAGES = `${CACHE_PREFIX}pages-${VERSION}`;
const ASSETS = `${CACHE_PREFIX}assets-${VERSION}`;
const OFFLINE_URL = "/offline/";

/** Paths the worker must never handle or cache. */
const BYPASS_PREFIXES = ["/api/", "/owner", "/manager", "/admin"];

function isBypassed(pathname) {
  // Plain prefix match on purpose: over-matching only means "not handled",
  // which is always safe.
  return BYPASS_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** How a request is handled: "bypass", "page", or "asset". */
function strategyFor(request, origin) {
  if (request.method !== "GET") return "bypass";
  if (request.headers && request.headers.get && request.headers.get("range")) return "bypass";
  const url = new URL(request.url);
  if (url.origin !== origin) return "bypass";
  if (isBypassed(url.pathname)) return "bypass";
  if (request.mode === "navigate") return "page";
  if (url.pathname.startsWith("/_next/static/")) return "asset";
  return "bypass";
}

function cacheable(response) {
  return Boolean(
    response && response.ok && response.status === 200 && response.type === "basic" && !response.redirected,
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGES)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== PAGES && key !== ASSETS)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function networkFirstPage(event) {
  const request = event.request;
  return fetch(request)
    .then((response) => {
      if (cacheable(response)) {
        const copy = response.clone();
        event.waitUntil(caches.open(PAGES).then((cache) => cache.put(request, copy)));
      }
      return response;
    })
    .catch(() =>
      caches
        .open(PAGES)
        .then((cache) =>
          cache.match(request).then((hit) => hit || cache.match(OFFLINE_URL)),
        )
        .then((hit) => hit || Response.error()),
    );
}

function cacheFirstAsset(event) {
  const request = event.request;
  return caches.open(ASSETS).then((cache) =>
    cache.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (cacheable(response)) {
            const copy = response.clone();
            event.waitUntil(cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
}

self.addEventListener("fetch", (event) => {
  const strategy = strategyFor(event.request, self.location.origin);
  if (strategy === "page") event.respondWith(networkFirstPage(event));
  else if (strategy === "asset") event.respondWith(cacheFirstAsset(event));
  // "bypass": no respondWith, so the browser handles it normally.
});
