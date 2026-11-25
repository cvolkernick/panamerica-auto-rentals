import type { MetadataRoute } from "next";

import { SITE_NAME } from "@/lib/seo";
import { positioning } from "@/lib/site";

/** Brand navy (--color-navy in app/globals.css). */
export const PWA_THEME_COLOR = "#070b16";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: SITE_NAME,
    short_name: "Panamerica",
    description: positioning,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: PWA_THEME_COLOR,
    theme_color: PWA_THEME_COLOR,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

export const dynamic = "force-static";
