import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { functionsInvokedFor, type FunctionRoutes } from "../../lib/portal/routes";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

test("sitemap source stays on the public paths", () => {
  const sitemap = source("app/sitemap.ts");
  assert.match(sitemap, /\/fleet/);
  assert.doesNotMatch(sitemap, /\/owner/);
  assert.doesNotMatch(sitemap, /\/admin/);
});

test("robots disallows the portal and still allows the public site", () => {
  const robots = source("app/robots.ts");
  assert.match(robots, /allow:\s*"\/"/);
  assert.match(robots, /\/owner\//);
  assert.match(robots, /\/admin\//);
  assert.match(robots, /\/api\//);
});

test("header and footer do not link the portal", () => {
  for (const path of ["components/site-header.tsx", "components/site-footer.tsx", "lib/site.ts"]) {
    const text = source(path);
    assert.doesNotMatch(text, /\/owner/);
    assert.doesNotMatch(text, /\/admin/);
  }
});

test("dev auth is not enabled in committed config", () => {
  assert.equal(existsSync("wrangler.toml"), false);
  assert.equal(existsSync("wrangler.json"), false);
  assert.equal(existsSync("wrangler.jsonc"), false);
  const example = source(".env.example");
  assert.match(example, /PORTAL_DEV_AUTH=/);
  assert.doesNotMatch(example, /PORTAL_DEV_AUTH=1/);
});

test("portal pages ask robots not to index", () => {
  for (const path of ["app/owner/page.tsx", "app/admin/page.tsx"]) {
    assert.match(source(path), /noindex/);
  }
});

test("login is the signed-out portal shell and access jwt config is gone", () => {
  assert.match(source("components/portal/ui.tsx"), /type="password"/);
  assert.match(source("components/portal/ui.tsx"), /Log out/);
  assert.match(source("app/owner/owner-portal.tsx"), /PortalLogin/);
  assert.match(source("app/admin/admin-portal.tsx"), /PortalLogin/);
  assert.equal(existsSync("lib/portal/access.ts"), false);
  assert.doesNotMatch(source("app/sitemap.ts"), /login/);
  for (const path of [
    "docs/owner-portal.md",
    ".env.example",
    "lib/portal/env.ts",
    "lib/portal/handler.ts",
    "package.json",
  ]) {
    assert.doesNotMatch(source(path), /CF_ACCESS/);
    assert.doesNotMatch(source(path), /Cf-Access-Jwt/);
  }
  assert.doesNotMatch(source("package.json"), /"jose"/);
  assert.doesNotMatch(source("migrations/0001_init.sql"), /password_hash/);
  assert.doesNotMatch(source("migrations/0002_auth.sql"), /\$argon2id\$v=/);
});

test("functions are not invoked for public routes", () => {
  const routes = JSON.parse(source("public/_routes.json")) as FunctionRoutes;
  assert.deepEqual(routes.include, ["/owner", "/owner/*", "/admin", "/admin/*", "/api/portal/*"]);
  assert.deepEqual(routes.exclude, []);
  for (const path of ["/", "/fleet", "/fleet/", "/plans/", "/about", "/contact/", "/sitemap.xml", "/robots.txt"]) {
    assert.equal(functionsInvokedFor(path, routes), false, path);
  }
  for (const path of ["/owner", "/owner/", "/admin/", "/admin/index.html", "/api/portal/login", "/api/portal/logout", "/api/portal/session"]) {
    assert.equal(functionsInvokedFor(path, routes), true, path);
  }
  assert.equal(existsSync("functions/_middleware.ts"), true);
});

test("owner portal docs do not recommend a paid worker plan", () => {
  const docs = source("docs/owner-portal.md");
  assert.doesNotMatch(docs, /Workers Paid/i);
  assert.doesNotMatch(docs, /Workers Standard/i);
  assert.match(docs, /--data @-/);
  assert.match(docs, /read -s/);
  assert.match(docs, /scripts\/portal-setup-body\.mts/);
  assert.equal(existsSync("scripts/portal-setup-body.ts"), false);
  assert.doesNotMatch(docs, /password":"'"/);
});
