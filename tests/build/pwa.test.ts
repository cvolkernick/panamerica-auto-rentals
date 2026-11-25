/**
 * Runs AFTER `npm run build`: the static export carries the installable-app
 * pieces (manifest, worker, offline page, icons at their real sizes) and the
 * HTML links them.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const OUT = "out";

function pngSize(path: string): [number, number] {
  const buf = readFileSync(path);
  assert.equal(buf.toString("ascii", 1, 4), "PNG", `${path} is a PNG`);
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

test("out/ has the manifest, worker, offline page and icons", () => {
  for (const file of ["manifest.webmanifest", "sw.js", "offline/index.html", "apple-icon.png", "icon.png"]) {
    assert.ok(existsSync(join(OUT, file)), file);
  }
  assert.deepEqual(pngSize(join(OUT, "icons/icon-192.png")), [192, 192]);
  assert.deepEqual(pngSize(join(OUT, "icons/icon-512.png")), [512, 512]);
  assert.deepEqual(pngSize(join(OUT, "icons/icon-maskable-512.png")), [512, 512]);
});

test("manifest is installable and points at real icons", () => {
  const manifest = JSON.parse(readFileSync(join(OUT, "manifest.webmanifest"), "utf8"));
  assert.equal(manifest.name, "Panamerica Auto Rentals");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.ok(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable"));
  for (const icon of manifest.icons as { src: string }[]) {
    assert.ok(existsSync(join(OUT, icon.src)), icon.src);
  }
});

test("pages link the manifest, theme colour and apple web-app tags", () => {
  for (const page of ["index.html", "fleet/index.html", "owner/index.html"]) {
    const html = readFileSync(join(OUT, page), "utf8");
    assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest"/, page);
    assert.match(html, /<meta name="theme-color" content="#070b16"/, page);
    assert.match(html, /apple-mobile-web-app-title/, page);
    assert.match(html, /rel="apple-touch-icon"/, page);
  }
  // Portal pages keep noindex; the offline page is noindex too.
  for (const page of ["owner/index.html", "manager/index.html", "admin/index.html", "sign-in/index.html", "offline/index.html"]) {
    assert.match(readFileSync(join(OUT, page), "utf8"), /<meta name="robots" content="noindex"/, page);
  }
});
