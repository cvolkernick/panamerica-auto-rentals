#!/usr/bin/env node
/**
 * Writes the installable-app icons into public/icons/ (git-ignored) from the
 * existing brand favicon app/icon.png (512×512, cropped from public/logo.jpg by
 * scripts/build-favicons.py). Runs as `prebuild`, so every `npm run build`
 * regenerates them. No new artwork.
 *
 *   icon-192.png           192×192  purpose "any"
 *   icon-512.png           512×512  purpose "any"
 *   icon-maskable-512.png  512×512  purpose "maskable" (art scaled into the
 *                          80% safe zone on the art's edge navy)
 *
 * Uses sharp (a direct devDependency; Next.js also ships it). If sharp cannot load, the 512 source
 * is copied for every icon so the build never fails; tests/build/pwa.test.ts
 * checks the real sizes and fails CI in that case.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "app", "icon.png");
const OUT = join(ROOT, "public", "icons");
const EDGE_NAVY = { r: 1, g: 12, b: 32, alpha: 1 }; // the icon art's own edge colour

mkdirSync(OUT, { recursive: true });

let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.warn("build-pwa-icons: sharp unavailable, copying the 512 source for every icon");
  for (const name of ["icon-192.png", "icon-512.png", "icon-maskable-512.png"]) {
    copyFileSync(SOURCE, join(OUT, name));
  }
  process.exit(0);
}

await sharp(SOURCE).resize(192, 192).png().toFile(join(OUT, "icon-192.png"));
await sharp(SOURCE).resize(512, 512).png().toFile(join(OUT, "icon-512.png"));
const inner = await sharp(SOURCE).resize(410, 410).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: EDGE_NAVY } })
  .composite([{ input: inner, gravity: "center" }])
  .png()
  .toFile(join(OUT, "icon-maskable-512.png"));
console.log("build-pwa-icons: wrote public/icons/");
