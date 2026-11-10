import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

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
