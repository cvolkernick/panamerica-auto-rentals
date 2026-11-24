/**
 * Runs AFTER `npm run build` (npm run test:bundle; CI runs it right after the build step).
 * The connector capability list is admin-only: it is served by
 * GET /api/portal/admin/connector-capabilities behind the admin session and must not
 * appear anywhere in the public static output (HTML, JS chunks, RSC payloads, JSON).
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  CONNECTOR_NOT_SUPPORTED,
  CONNECTOR_RULES,
  CONNECTOR_TOOLS,
} from "../../lib/portal/connector-capabilities";

const OUT = "out";
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|pdf|woff2?|ttf|otf|eot|mp4|webm|zip)$/i;

/** The only connector text the public shell may carry: the small /admin/ link label and page title. */
const ALLOWED = ["Team connector (MCP): what it can and can't do", "Team connector (MCP)"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : BINARY.test(name) ? [] : [path];
  });
}

/** Undo the escapes HTML, JSON and JS bundles use, so a phrase can't hide behind &#x27; or \u0027. */
function normalize(text: string): string {
  return text
    .replace(/&#x27;|&#39;|&apos;|\\u0027|\\'/g, "'")
    .replace(/&quot;|\\u0022|\\"/g, '"')
    .replace(/&amp;|\\u0026/g, "&")
    .replace(/&lt;|\\u003c/gi, "<")
    .replace(/&gt;|\\u003e/gi, ">")
    .replace(/\\u2019/g, "\u2019");
}

function stripAllowed(text: string): string {
  let out = text;
  for (const label of ALLOWED) out = out.split(label).join("");
  return out;
}

const NEEDLES: string[] = [
  ...CONNECTOR_TOOLS.map((tool) => tool.name),
  ...CONNECTOR_TOOLS.map((tool) => tool.summary),
  ...CONNECTOR_NOT_SUPPORTED,
  ...CONNECTOR_RULES,
  // Distinctive fragments, in case a sentence is split or reworded in a chunk.
  "panam_",
  "Receipt photo parsing",
  "Commission expenses",
  "commission rows",
  "owner PII",
  "Rules on every write",
  "MAX_ENTRY_CENTS",
  "CONNECTOR_",
  "50,000",
  "5000000",
  "5_000_000",
];

test("the build output exists and includes the connector shell", () => {
  assert.ok(existsSync(join(OUT, "admin", "connector", "index.html")), "run `npm run build` first");
  assert.ok(existsSync(join(OUT, "admin", "index.html")));
});

test("no connector capability content ships in the public build output", () => {
  const all = files(OUT);
  assert.ok(all.length > 20, `only ${all.length} files under ${OUT}/`);
  const hits: string[] = [];
  for (const file of all) {
    const text = stripAllowed(normalize(readFileSync(file, "utf8")));
    for (const needle of NEEDLES) {
      if (text.includes(needle)) hits.push(`${file}: ${JSON.stringify(needle.slice(0, 60))}`);
    }
  }
  assert.deepEqual(hits, [], `capability content found in ${OUT}/:\n${hits.join("\n")}`);
});

test("the /admin/ link label is present (allow-listed) and points at the shell", () => {
  const admin = readdirSync(OUT, { recursive: true })
    .map(String)
    .filter((path) => path.startsWith("_next") && path.endsWith(".js"))
    .map((path) => normalize(readFileSync(join(OUT, path), "utf8")))
    .join("\n");
  assert.ok(admin.includes(ALLOWED[0]), "footer link label not found in any chunk");
  assert.ok(admin.includes("/admin/connector/"), "footer link href not found in any chunk");
});
