/**
 * The installable-app service worker (public/sw.js) must never handle or cache
 * /api/* or the signed-in portals. Loads the real file in a sandbox with a fake
 * `self` and fires fetch events at it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const ORIGIN = "https://www.panamericafleet.com";
type Listener = (event: unknown) => void;

function loadWorker() {
  const listeners: Record<string, Listener> = {};
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Listener) => {
      listeners[type] = fn;
    },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  const caches = {
    open: () => Promise.resolve({ match: () => Promise.resolve(undefined), put: () => Promise.resolve(), add: () => Promise.resolve() }),
    keys: () => Promise.resolve([]),
    delete: () => Promise.resolve(true),
  };
  runInNewContext(readFileSync("public/sw.js", "utf8"), {
    self,
    caches,
    URL,
    Request: class {},
    Response: { error: () => ({}) },
    fetch: () => Promise.reject(new Error("offline")),
    Promise,
    Boolean,
  });
  return listeners;
}

function handled(path: string, init: { method?: string; mode?: string; range?: boolean; origin?: string } = {}): boolean {
  const listeners = loadWorker();
  let responded = false;
  listeners.fetch({
    request: {
      url: `${init.origin ?? ORIGIN}${path}`,
      method: init.method ?? "GET",
      mode: init.mode ?? "navigate",
      headers: { get: (name: string) => (name === "range" && init.range ? "bytes=0-" : null) },
    },
    respondWith: (response: unknown) => {
      responded = true;
      Promise.resolve(response).catch(() => undefined);
    },
    waitUntil: () => undefined,
  });
  return responded;
}

test("sw never handles /api or /api/ requests", () => {
  for (const path of ["/api", "/api?x=1", "/api/", "/api/portal/session", "/api/portal/admin/cars", "/api/anything"]) {
    assert.equal(handled(path, { mode: "cors" }), false, path);
    assert.equal(handled(path, { mode: "navigate" }), false, path);
    assert.equal(handled(path, { method: "POST", mode: "cors" }), false, path);
  }
});

test("sw never handles the signed-in portals or invite pages", () => {
  for (const path of [
    "/owner/",
    "/owner/statement/",
    "/owner/invite/?t=x",
    "/manager/",
    "/manager/invite/",
    "/admin/",
    "/admin/managers/",
    "/admin/cars/ABC123/",
    "/owner",
    "/admin",
  ]) {
    assert.equal(handled(path), false, path);
  }
});

test("sw handles public navigations and hashed build assets only", () => {
  assert.equal(handled("/"), true);
  assert.equal(handled("/fleet/"), true);
  assert.equal(handled("/_next/static/chunks/app-abc123.js", { mode: "no-cors" }), true);
  // Not intercepted: non-GET, cross-origin, range/video, plain static files.
  assert.equal(handled("/contact/", { method: "POST" }), false);
  assert.equal(handled("/", { origin: "https://example.com" }), false);
  assert.equal(handled("/cyberfleet/tesla-1.mp4", { mode: "no-cors", range: true }), false);
  assert.equal(handled("/plans/management-agreement.pdf", { mode: "no-cors" }), false);
  assert.equal(handled("/logo.jpg", { mode: "no-cors" }), false);
});

test("sw cache is versioned and old panam caches are cleaned on activate", () => {
  const sw = readFileSync("public/sw.js", "utf8");
  assert.match(sw, /const VERSION = "v\d+";/);
  assert.match(sw, /key\.startsWith\(CACHE_PREFIX\) && key !== PAGES && key !== ASSETS/);
  assert.match(sw, /self\.clients\.claim\(\)/);
});

test("sw.js is served uncached and the manifest with its content type", () => {
  const headers = readFileSync("public/_headers", "utf8");
  assert.match(headers, /\/sw\.js\n  Content-Type: application\/javascript; charset=utf-8\n  Cache-Control: no-cache, no-store, must-revalidate/);
  assert.match(headers, /\/manifest\.webmanifest\n  Content-Type: application\/manifest\+json/);
  // Portal Functions must not start running for the worker or manifest.
  const routes = JSON.parse(readFileSync("public/_routes.json", "utf8")) as { include: string[] };
  assert.ok(!routes.include.some((p) => p === "/*" || p.startsWith("/sw") || p.startsWith("/manifest")));
});
