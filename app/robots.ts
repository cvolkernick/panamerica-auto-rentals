import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/owner/", "/manager/", "/admin/", "/sign-in/", "/api/"],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}

export const dynamic = "force-static";
