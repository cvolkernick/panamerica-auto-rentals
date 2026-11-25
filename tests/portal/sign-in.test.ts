/**
 * Unified /sign-in/ page: header link placement, role routing, no sign-up,
 * no account enumeration, and the same apex/noindex/worker rules as the portals.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  PORTAL_DESTINATIONS,
  destinationsFor,
  sessionRoleFlags,
  signInRoute,
} from "../../lib/portal/destinations";
import { isPortalSurface, portalApexRedirect } from "../../lib/portal/hosts";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

test("admin goes to /admin/, single-role accounts go straight to their portal", () => {
  assert.deepEqual(signInRoute({ admin: true, owner: true, manager: true }), { kind: "redirect", href: "/admin/" });
  assert.deepEqual(signInRoute({ admin: true, owner: false, manager: false }), { kind: "redirect", href: "/admin/" });
  assert.deepEqual(signInRoute({ admin: false, owner: true, manager: false }), { kind: "redirect", href: "/owner/" });
  assert.deepEqual(signInRoute({ admin: false, owner: false, manager: true }), { kind: "redirect", href: "/manager/" });
});

test("owner and manager together get a chooser in priority order", () => {
  const route = signInRoute({ admin: false, owner: true, manager: true });
  assert.equal(route.kind, "choose");
  assert.deepEqual(
    route.kind === "choose" ? route.options.map((option) => option.href) : [],
    ["/owner/", "/manager/"],
  );
});

test("no roles means no portal, and unknown role flags are ignored", () => {
  assert.deepEqual(signInRoute({ admin: false, owner: false, manager: false }), { kind: "none" });
  assert.deepEqual(signInRoute(null), { kind: "none" });
  // A future role only routes once it has an entry in PORTAL_DESTINATIONS.
  assert.deepEqual(signInRoute({ renter: true }), { kind: "none" });
  assert.deepEqual(destinationsFor({ renter: true, owner: true }).map((d) => d.role), ["owner"]);
});

test("destinations are fixed same-origin portal paths (no open redirect)", () => {
  for (const destination of PORTAL_DESTINATIONS) {
    assert.match(destination.href, /^\/(admin|owner|manager)\/$/);
  }
  assert.doesNotMatch(source("app/sign-in/sign-in-portal.tsx"), /searchParams|URLSearchParams|location\.search|[?&]next=/);
});

test("older sessions without roles fall back to the admin flag plus the owner view", () => {
  assert.deepEqual(sessionRoleFlags({ owner: { isAdmin: false } }), { admin: false, owner: true });
  assert.deepEqual(sessionRoleFlags({ owner: { isAdmin: true } }), { admin: true, owner: true });
  const roles = { admin: false, owner: false, manager: true };
  assert.equal(sessionRoleFlags({ owner: { isAdmin: false }, roles }), roles);
});

test("Sign in sits right after Cyber Fleet in the desktop and mobile menus", () => {
  const header = source("components/site-header.tsx");
  const desktop = header.slice(header.indexOf('aria-label="Primary"'), header.indexOf('id="mobile-nav"'));
  const mobile = header.slice(header.indexOf('id="mobile-nav"'));
  for (const menu of [desktop, mobile]) {
    const cyber = menu.indexOf("{cyberfleetNav.label}");
    const signIn = menu.indexOf("{signInNav.label}");
    assert.ok(cyber > 0 && signIn > cyber, "Sign in follows Cyber Fleet");
  }
  assert.match(source("lib/site.ts"), /href: "\/sign-in\/"/);
  assert.match(source("lib/site.ts"), /label: "Sign in"/);
});

test("sign-in page has no sign-up, a generic error, and the renter line", () => {
  const page = source("app/sign-in/sign-in-portal.tsx");
  assert.doesNotMatch(page, /href="[^"]*(sign-?up|register)/i);
  assert.doesNotMatch(page, /"\/api\/portal\/(signup|sign-up|register)/);
  assert.doesNotMatch(page, />\s*(Sign up|Create (an )?account|Register)\b/);
  assert.match(page, /Renting with us\?/);
  assert.match(page, /href="\/fleet\/"/);
  assert.match(page, /Book through our fleet page\./);
  assert.match(page, /<PortalLogin/);
  // The shared login form keeps one message for every bad email or password.
  const ui = source("components/portal/ui.tsx");
  assert.match(ui, /That email or password is not valid\./);
  assert.match(ui, /title = "Owner sign-in"/);
  assert.match(source("app/sign-in/page.tsx"), /robots: "noindex"/);
});

test("sign-in is a portal surface: apex redirects it to www so the host-only cookie works", () => {
  for (const path of ["/sign-in", "/sign-in/"]) assert.equal(isPortalSurface(path), true, path);
  assert.equal(isPortalSurface("/signing"), false);
  const redirect = portalApexRedirect(new Request("https://panamericafleet.com/sign-in/"));
  assert.equal(redirect?.status, 308);
  assert.equal(redirect?.headers.get("location"), "https://www.panamericafleet.com/sign-in/");
  assert.equal(portalApexRedirect(new Request("https://www.panamericafleet.com/sign-in/")), null);
  const headers = source("public/_headers");
  assert.match(headers, /\/sign-in\/\n  X-Robots-Tag: noindex/);
  assert.match(headers, /\/sign-in\/\*\n  X-Robots-Tag: noindex/);
});

test("portals use the role switcher", () => {
  for (const [path, role] of [
    ["app/owner/owner-portal.tsx", "owner"],
    ["app/manager/manager-portal.tsx", "manager"],
    ["app/admin/admin-portal.tsx", "admin"],
  ] as const) {
    assert.match(source(path), new RegExp(`<PortalRoleSwitcher roles=\\{[^}]+\\)?\\} current="${role}" />`), path);
  }
});
