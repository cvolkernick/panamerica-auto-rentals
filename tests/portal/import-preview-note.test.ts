import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("import preview says nothing is imported until the button is clicked", () => {
  const page = readFileSync("app/admin/imports/imports-admin.tsx", "utf8");
  const note = "Preview only, not imported yet. Click Import matched trips to save these trips.";
  assert.ok(page.includes(note));
  assert.match(page, /\{open\.status === "preview" \? \(\s*<p[^>]*>\s*Preview only, not imported yet\./);
  assert.ok(page.indexOf("Import matched trips\n") < page.indexOf(note));
});
