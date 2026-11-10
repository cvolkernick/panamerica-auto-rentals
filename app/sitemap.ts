import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/seo";

/** Public pages linked from the site nav and footer. Keep in sync with `nav` / `cyberfleetNav` in lib/site.ts. Do not add the signed-in portal. */
const PUBLIC_PATHS = [
  "/",
  "/about",
  "/contact",
  "/cyberfleet",
  "/drivers",
  "/fleet",
  "/partners",
  "/plans",
  "/services",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map((path) => ({ url: absoluteUrl(path) }));
}

export const dynamic = "force-static";
