import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  CONNECTOR_DOC,
  CONNECTOR_EXPENSE_CATEGORIES,
  CONNECTOR_MAX_ENTRY_CENTS,
  CONNECTOR_NOT_SUPPORTED,
  CONNECTOR_TOOLS,
} from "../../lib/portal/connector-capabilities";
import { EXPENSE_CATEGORIES } from "../../lib/portal/expenses";
import { MAX_ENTRY_CENTS } from "../../lib/portal/team-store";

const MCP = "tools/car-connector-mcp/panam_car_mcp.py";

function source(path: string): string {
  return readFileSync(path, "utf8");
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

test("the docs page renders from the capabilities module and carries a date", () => {
  assert.match(CONNECTOR_DOC.updated, /^\d{4}-\d{2}-\d{2}$/);
  const page = source("app/admin/connector/connector-docs.tsx");
  assert.match(page, /CONNECTOR_TOOLS/);
  assert.match(page, /CONNECTOR_NOT_SUPPORTED/);
  assert.match(page, /CONNECTOR_DOC\.updated/);
  assert.match(page, /isAdmin/);
  assert.doesNotMatch(page, /panam_[a-z_]+/, "tool names belong in connector-capabilities.ts only");
  assert.match(source("app/admin/admin-portal.tsx"), /href="\/admin\/connector\/"/);
});

test("the docs page shows no token, secret, or endpoint credential", () => {
  for (const path of ["lib/portal/connector-capabilities.ts", "app/admin/connector/connector-docs.tsx"]) {
    const text = source(path);
    assert.doesNotMatch(text, /PORTAL_TEAM_TOKEN|PANAM_TEAM_TOKEN|Bearer|Authorization/);
    assert.doesNotMatch(text, /\/api\/portal\/team/);
    assert.doesNotMatch(text, /[A-Za-z0-9_-]{40,}/);
  }
});
