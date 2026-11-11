import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { functionsInvokedFor, type FunctionRoutes } from "../../lib/portal/routes";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

test("fleet management states the first-month half commission", () => {
  const line = "First month: half commission — 10% / 7.5% / 5%.";
  assert.match(source("lib/site.ts"), new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const page = source("app/management/page.tsx");
  assert.match(page, /managementPlan\.firstMonth/);
  assert.match(page, /\$\{managementPlan\.firstMonth\}/);
  assert.match(page, /20% for trips under 7 days, 15% for 7–21 days, and 10% for trips over 21 days/);
});

test("exhibit A is the single Fleet Management schedule", () => {
  const pdf = source("public/plans/exhibit-a-vehicle-schedule.pdf");
  assert.match(pdf, /Plan: Fleet Management/);
  assert.match(pdf, /20%/);
  assert.match(pdf, /trips under 7 days/);
  assert.match(pdf, /15%/);
  assert.match(pdf, /10%/);
  assert.match(pdf, /over 21/);
  assert.match(pdf, /First month: half commission/);
  assert.match(pdf, /7\.5%/);
  assert.match(pdf, /5%/);
  assert.match(pdf, /Full name:/);
  assert.match(pdf, /VIN:/);
  assert.match(pdf, /Monthly car payment amount:/);
  assert.match(pdf, /Monthly insurance premium:/);
  assert.match(pdf, /Lender \/ lienholder name:/);
  for (const banned of ["Spotlight", "Owner Exit", "Shared Opex", "50/50", "20/80", "80/20", "payoff", "Payoff", "rung", "Rung"]) {
    assert.equal(pdf.includes(banned), false, banned);
  }
});

test("sitemap source stays on the public paths", () => {
  const sitemap = source("app/sitemap.ts");
  assert.match(sitemap, /\/fleet/);
  assert.match(sitemap, /\/management/);
  assert.doesNotMatch(sitemap, /\/plans/);
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
  for (const path of ["app/owner/page.tsx", "app/admin/page.tsx", "app/owner/invite/page.tsx"]) {
    assert.match(source(path), /noindex/);
  }
});

test("the invite page is noindex and stays out of the sitemap", () => {
  assert.match(source("app/owner/invite/page.tsx"), /noindex/);
  assert.doesNotMatch(source("app/sitemap.ts"), /invite/);
  assert.match(source("app/robots.ts"), /\/owner\//);
  const routes = JSON.parse(source("public/_routes.json")) as FunctionRoutes;
  for (const path of ["/owner/invite/", "/owner/invite/index.html", "/api/portal/invite"]) {
    assert.equal(functionsInvokedFor(path, routes), true, path);
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

test("old plans URLs redirect exactly and stay outside Functions", () => {
  const redirects = source("public/_redirects");
  assert.match(redirects, /^\/plans\s+\/management\s+301$/m);
  assert.match(redirects, /^\/plans\/\s+\/management\/\s+301$/m);
  assert.doesNotMatch(redirects, /\/plans\/\*/);
  const routes = JSON.parse(source("public/_routes.json")) as FunctionRoutes;
  for (const path of ["/plans", "/plans/", "/management", "/management/", "/plans/management-agreement.pdf"]) {
    assert.equal(functionsInvokedFor(path, routes), false, path);
  }
});

test("functions are not invoked for public routes", () => {
  const routes = JSON.parse(source("public/_routes.json")) as FunctionRoutes;
  assert.deepEqual(routes.include, ["/owner", "/owner/*", "/admin", "/admin/*", "/api/portal/*"]);
  assert.deepEqual(routes.exclude, []);
  for (const path of ["/", "/fleet", "/fleet/", "/plans", "/plans/", "/management", "/management/", "/about", "/contact/", "/sitemap.xml", "/robots.txt"]) {
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
