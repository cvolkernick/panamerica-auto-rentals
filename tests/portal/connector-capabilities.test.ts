import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import {
  connectorCapabilitiesJson,
  CONNECTOR_DOC,
  CONNECTOR_EXPENSE_CATEGORIES,
  CONNECTOR_MAX_ENTRY_CENTS,
  CONNECTOR_NOT_SUPPORTED,
  CONNECTOR_TOOLS,
} from "../../lib/portal/connector-capabilities";
import type { PortalEnv } from "../../lib/portal/env";
import { EXPENSE_CATEGORIES } from "../../lib/portal/expenses";
import { handlePortal } from "../../lib/portal/handler";
import { MAX_ENTRY_CENTS } from "../../lib/portal/team-store";

import { call, DEALER, devEnv, PANAMERICA, request } from "./support";

const MCP = "tools/car-connector-mcp/panam_car_mcp.py";
const TEAM_TOKEN = "t".repeat(48);

function source(path: string): string {
  return readFileSync(path, "utf8");
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Names of functions decorated with @mcp.tool() in the MCP server. */
function registeredTools(py: string): string[] {
  return [...py.matchAll(/@mcp\.tool\(\)\s*\n\s*def (\w+)\(/g)].map((m) => m[1]);
}

function pyTuple(py: string, name: string): string[] {
  const match = py.match(new RegExp(`^${name} = \\(([\\s\\S]*?)\\)`, "m"));
  assert.ok(match, `${name} tuple not found in ${MCP}`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

test("the docs page lists exactly the tools the MCP server registers", () => {
  const py = source(MCP);
  const documented = CONNECTOR_TOOLS.map((tool) => tool.name);
  assert.equal(new Set(documented).size, documented.length, "duplicate tool in connector-capabilities.ts");
  const registered = registeredTools(py);
  assert.ok(registered.length > 0, "no @mcp.tool() functions found");
  assert.deepEqual([...documented].sort(), [...registered].sort());
  assert.deepEqual([...documented].sort(), [...pyTuple(py, "TOOL_NAMES")].sort());
});

test("the docs page entry cap matches the API and the MCP", () => {
  assert.equal(CONNECTOR_MAX_ENTRY_CENTS, MAX_ENTRY_CENTS);
  const py = source(MCP).match(/^MAX_ENTRY_CENTS = ([\d_]+)/m);
  assert.ok(py);
  assert.equal(Number(py[1].replaceAll("_", "")), MAX_ENTRY_CENTS);
  const dollars = `$${(MAX_ENTRY_CENTS / 100).toLocaleString("en-US")}`;
  assert.ok(
    CONNECTOR_NOT_SUPPORTED.some((line) => line.includes(dollars)),
    `not-supported list should state the ${dollars} cap`
  );
});

test("the docs page expense categories match the API minus commission, and the MCP", () => {
  const api = EXPENSE_CATEGORIES.filter((c) => c !== "commission");
  assert.deepEqual([...CONNECTOR_EXPENSE_CATEGORIES], api);
  assert.deepEqual(pyTuple(source(MCP), "EXPENSE_CATEGORIES"), api);
  assert.ok(CONNECTOR_NOT_SUPPORTED.some((line) => /receipt photo/i.test(line)));
  assert.ok(CONNECTOR_NOT_SUPPORTED.some((line) => /^Commission expenses/.test(line)));
  assert.ok(CONNECTOR_NOT_SUPPORTED.some((line) => /commission rows/i.test(line)));
  assert.ok(CONNECTOR_NOT_SUPPORTED.some((line) => /owner pii/i.test(line)));
});

test("the capabilities module stays server-only and carries a date", () => {
  assert.match(CONNECTOR_DOC.updated, /^\d{4}-\d{2}-\d{2}$/);
  const page = source("app/admin/connector/connector-docs.tsx");
  assert.match(page, /\/api\/portal\/admin\/connector-capabilities/);
  assert.match(page, /isAdmin/);
  assert.doesNotMatch(page, /panam_[a-z_]+/, "tool names belong in connector-capabilities.ts only");
  assert.match(source("app/admin/admin-portal.tsx"), /href="\/admin\/connector\/"/);
  assert.match(source("lib/portal/handler.ts"), /from "\.\/connector-capabilities"/);
  // No page, component or client module may import the capability list.
  const importsCapabilities = /(?:from|import\(|require\()\s*["'][^"']*connector-capabilities["']/;
  for (const file of walk("app").concat(walk("components"))) {
    assert.equal(importsCapabilities.test(source(file)), false, `${file} imports connector-capabilities`);
  }
  for (const file of walk("lib")) {
    if (/^\s*["']use client["']/m.test(source(file))) {
      assert.equal(importsCapabilities.test(source(file)), false, `${file} imports connector-capabilities`);
    }
  }
});

test("the docs page shows no token, secret, or endpoint credential", () => {
  for (const path of ["lib/portal/connector-capabilities.ts", "app/admin/connector/connector-docs.tsx"]) {
    const text = source(path);
    assert.doesNotMatch(text, /PORTAL_TEAM_TOKEN|PANAM_TEAM_TOKEN|Bearer|Authorization/);
    assert.doesNotMatch(text, /\/api\/portal\/team/);
    assert.doesNotMatch(text, /[A-Za-z0-9_-]{40,}/);
  }
});

describe("GET /api/portal/admin/connector-capabilities", () => {
  const path = "/api/portal/admin/connector-capabilities";

  test("needs an admin session: 401 signed out, 401 with only the team token, 403 non-admin, 200 admin", async () => {
    const admin = devEnv(PANAMERICA, { PORTAL_TEAM_TOKEN: TEAM_TOKEN });

    const ok = await call(admin, "GET", path);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.data, connectorCapabilitiesJson());
    assert.deepEqual(
      (ok.data?.tools as { name: string }[]).map((tool) => tool.name),
      CONNECTOR_TOOLS.map((tool) => tool.name)
    );

    const owner = await call(admin, "POST", "/api/portal/admin/owners", {
      name: "Dealer Partner",
      email: DEALER,
    });
    assert.equal(owner.status, 201);
    const nonAdmin = await call({ ...admin, PORTAL_DEV_EMAIL: DEALER }, "GET", path);
    assert.equal(nonAdmin.status, 403);
    assert.equal(nonAdmin.text.includes("panam_list_cars"), false);

    const stranger = await call({ ...admin, PORTAL_DEV_EMAIL: "stranger@example.com" }, "GET", path);
    assert.equal(stranger.status, 403);
    assert.equal(stranger.text.includes("panam_list_cars"), false);

    const signedOut: PortalEnv = { DB: admin.DB, PORTAL_TEAM_TOKEN: TEAM_TOKEN };
    const anon = await call(signedOut, "GET", path);
    assert.equal(anon.status, 401);
    assert.equal(anon.text.includes("panam_list_cars"), false);

    const team = await handlePortal(
      request("GET", path, {
        origin: null,
        headers: { authorization: `Bearer ${TEAM_TOKEN}`, "x-agent-name": "probe" },
      }),
      signedOut
    );
    assert.equal(team.status, 401);
    assert.equal((await team.text()).includes("panam_list_cars"), false);
  });
});
